// One transaction row, shared by the Activity page and the token-detail panel so
// both render identically (the two used to diverge). The circle shows the asset
// logo — the token you moved — with a small corner badge marking the kind
// (send / receive / swap / bridge); swap and bridge get their own label, colour,
// and a "from → to" subtitle.

import { type TxRecord, kindOf, type TxKind } from "@numpay/core/txHistory";
import { AssetIcon, ExternalLinkIcon } from "./Icons";

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const KIND_META: Record<TxKind, { label: string; color: string }> = {
  send:    { label: "Send",    color: "#ef4444" },
  receive: { label: "Receive", color: "#22c55e" },
  swap:    { label: "Swap",    color: "#7c6df0" },
  bridge:  { label: "Bridge",  color: "#3b82f6" },
};

// Small white glyph inside the corner badge, one per kind.
function KindGlyph({ kind }: { kind: TxKind }) {
  const p = { width: 9, height: 9, viewBox: "0 0 24 24", fill: "none", stroke: "#fff", strokeWidth: 3, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  if (kind === "send")    return <svg {...p}><line x1="7" y1="17" x2="17" y2="7" /><polyline points="8 7 17 7 17 16" /></svg>;
  if (kind === "receive") return <svg {...p}><line x1="17" y1="7" x2="7" y2="17" /><polyline points="16 17 7 17 7 8" /></svg>;
  if (kind === "swap")    return <svg {...p}><polyline points="17 2 21 6 17 10" /><path d="M3 6h18" /><polyline points="7 22 3 18 7 14" /><path d="M21 18H3" /></svg>;
  // bridge
  return <svg {...p}><polyline points="14 5 20 11 14 17" /><path d="M20 11H4" /></svg>;
}

export default function TxRow({
  tx,
  size = 36,
  showChain = false,
  className = "",
  onSpeedUp,
  onCancel,
  busy = false,
}: {
  tx: TxRecord;
  size?: number;
  showChain?: boolean;
  className?: string;
  // Provided by the Activity page for pending, replaceable EVM sends only.
  onSpeedUp?: () => void;
  onCancel?: () => void;
  busy?: boolean;
}) {
  const kind = kindOf(tx);
  const meta = KIND_META[kind];
  const pending = tx.status === "pending";
  const failed = tx.status === "failed";
  const showActions = pending && (onSpeedUp || onCancel);

  // The circle shows the asset the row is "about": for a swap that's the token
  // received, otherwise the primary asset.
  const face = kind === "swap" && tx.toSymbol
    ? { symbol: tx.toSymbol, logo: tx.toLogo, chainId: tx.toChainId ?? tx.chainId, address: tx.toAssetAddr }
    : { symbol: tx.symbol, logo: tx.logo, chainId: tx.chainId, address: tx.assetAddr };

  // Amount shown on the right, and its colour.
  const amount =
    kind === "send"    ? { text: `-${tx.value} ${tx.symbol}`, color: "#ef4444" }
    : kind === "receive" ? { text: `+${tx.value} ${tx.symbol}`, color: "#22c55e" }
    : kind === "swap"    ? { text: `+${tx.toValue ?? ""} ${tx.toSymbol ?? ""}`.trim(), color: "#22c55e" }
    : /* bridge */         { text: `${tx.value} ${tx.symbol}`, color: "var(--text)" };

  // Second line: counterparty for transfers, from→to for swap/bridge.
  const subtitle =
    kind === "swap"   ? `${tx.symbol} → ${tx.toSymbol ?? ""}`
    : kind === "bridge" ? `${tx.chainName ?? ""} → ${tx.toChainName ?? tx.chainName ?? ""}`
    : tx.counterparty ? `${kind === "send" ? "To" : "From"} ${shortAddr(tx.counterparty)}`
    : "";

  const badge = Math.max(14, Math.round(size * 0.44));

  const anchor = (
      <a
        href={tx.explorerUrl || undefined}
        target="_blank"
        rel="noopener noreferrer"
        // When actions are shown the row is wrapped in a div (below); otherwise
        // the anchor is the list item itself and carries the animation class.
        // Keeping the bare anchor when there are no actions preserves the
        // token-row :last-child divider rule.
        className={`token-row no-underline ${showActions ? "" : className}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          {/* Asset logo + kind badge */}
          <div className="relative flex-shrink-0" style={{ width: size, height: size }}>
            <AssetIcon symbol={face.symbol} logo={face.logo} chainId={face.chainId} address={face.address} size={size} />
            <div
              aria-hidden
              style={{
                position: "absolute", right: -2, bottom: -2,
                width: badge, height: badge, borderRadius: "50%",
                background: meta.color,
                display: "flex", alignItems: "center", justifyContent: "center",
                boxShadow: "0 0 0 2px var(--bg)",
              }}
            >
              <KindGlyph kind={kind} />
            </div>
          </div>

          {/* Label + subtitle */}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <p className="text-[13px] font-semibold" style={{ color: meta.color }}>{meta.label}</p>
              {pending && (
                <span className="inline-flex items-center gap-1 text-[10px] font-medium text-amber">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber animate-pulse" />Pending
                </span>
              )}
              {failed && <span className="text-[10px] font-medium text-accent-red">Failed</span>}
            </div>
            <p className="text-[11px] text-muted truncate">
              {subtitle || <span className="italic opacity-60">address unavailable</span>}
            </p>
            {(showChain || tx.timestamp > 0) && (
              <div className="flex items-center gap-2 mt-0.5">
                {showChain && tx.chainName && (
                  <span className="text-[10px] text-brand-400/70 font-medium">{tx.chainName}</span>
                )}
                {tx.timestamp > 0 && <span className="text-[10px] text-muted/55">{timeAgo(tx.timestamp)}</span>}
                <span className="flex items-center gap-1 text-[10px] text-muted/40"><ExternalLinkIcon size={9} />View</span>
              </div>
            )}
          </div>
        </div>

        {/* Amount */}
        <div className="text-right flex-shrink-0 ml-2">
          <p className="text-[13px] font-semibold tabular-nums" style={{ color: amount.color }}>{amount.text}</p>
        </div>
      </a>
  );

  if (!showActions) return anchor;

  return (
    <div className={className}>
      {anchor}
      {/* Speed-up / cancel for a pending EVM send */}
      <div className="flex gap-2 mt-1 mb-1 pl-[52px]">
        {onSpeedUp && (
          <button
            type="button"
            onClick={onSpeedUp}
            disabled={busy}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 disabled:opacity-40 transition-colors"
          >
            {busy ? "…" : "Speed up"}
          </button>
        )}
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="px-2.5 py-1 rounded-lg text-[11px] font-semibold bg-surface-2 text-muted hover:text-accent-red disabled:opacity-40 transition-colors"
          >
            {busy ? "…" : "Cancel"}
          </button>
        )}
      </div>
    </div>
  );
}
