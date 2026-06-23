import { ExternalLinkIcon } from "./Icons";

// A full-popup overlay that plays a NumPay-native confirmation animation for a
// send, swap, or bridge. Three states share one shell:
//   pending  → a brand gradient ring spinner ("Sending…")
//   success  → a gradient ring + check that draw themselves in, a soft pulse,
//              and a few brand "orbs" that rise behind it (echoing the dashboard)
//   error    → the same ring in red with a cross that draws in
// It stays until the user dismisses it (no auto-close), so the explorer link and
// the error detail remain readable.

export type TxFxStatus = "pending" | "success" | "error";
export type TxKind = "send" | "swap" | "bridge";

interface TxResultOverlayProps {
  status: TxFxStatus;
  kind: TxKind;
  /** e.g. "0.5 ETH" or "0.5 ETH → 12.3 USDC" */
  amountLabel?: string;
  explorerUrl?: string;
  txHash?: string;
  errorTitle?: string;
  errorMessage?: string;
  onClose: () => void;
}

const TITLES: Record<TxKind, Record<TxFxStatus, string>> = {
  send:   { pending: "Sending…",   success: "Sent",            error: "Send failed" },
  swap:   { pending: "Swapping…",  success: "Swap submitted",  error: "Swap failed" },
  bridge: { pending: "Bridging…",  success: "Bridge submitted", error: "Bridge failed" },
};

const PENDING_SUB: Record<TxKind, string> = {
  send:   "Broadcasting to the network…",
  swap:   "Confirming your swap on-chain…",
  bridge: "Submitting your bridge transfer…",
};

export default function TxResultOverlay({
  status,
  kind,
  amountLabel,
  explorerUrl,
  txHash,
  errorTitle,
  errorMessage,
  onClose,
}: TxResultOverlayProps) {
  const isError = status === "error";
  const isPending = status === "pending";
  const accent = isError ? "#f87171" /* accent-red */ : "#34d399" /* accent-green */;
  const gradId = `txfx-${status}`;
  const title = isError ? errorTitle || TITLES[kind].error : TITLES[kind][status];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/60 backdrop-blur-sm animate-fade-in"
      onClick={isPending ? undefined : onClose}
      role="dialog"
      aria-modal="true"
    >
      <div
        className="tx-pop premium-card w-full max-w-[300px] px-6 py-7 flex flex-col items-center text-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* ── Animated mark ─────────────────────────────────────────── */}
        <div className="relative w-28 h-28 flex items-center justify-center">
          {/* rising brand orbs (success only) */}
          {status === "success" && (
            <>
              <span className="tx-orb absolute bottom-7 left-7 w-2 h-2 rounded-full bg-brand-400/80" style={{ animationDelay: "0.15s" }} />
              <span className="tx-orb absolute bottom-6 right-8 w-1.5 h-1.5 rounded-full bg-brand-300/80" style={{ animationDelay: "0.35s" }} />
              <span className="tx-orb absolute bottom-8 left-1/2 w-2.5 h-2.5 rounded-full bg-accent-green/70" style={{ animationDelay: "0.05s" }} />
              <span className="tx-orb absolute bottom-7 right-1/3 w-1.5 h-1.5 rounded-full bg-brand-500/80" style={{ animationDelay: "0.5s" }} />
            </>
          )}

          {/* soft glow */}
          <div
            className={`absolute inset-4 rounded-full blur-2xl ${isError ? "bg-accent-red/25" : "bg-accent-green/25"} ${isPending ? "" : "tx-glow"}`}
          />

          {/* expanding pulse ring (success only) */}
          {status === "success" && (
            <span className="tx-pulse absolute inset-3 rounded-full border-2 border-accent-green/50" />
          )}

          {isPending ? (
            <div className="relative w-[78px] h-[78px] rounded-full border-[5px] border-brand-500/20 border-t-brand-500 animate-spin" />
          ) : (
            <svg viewBox="0 0 96 96" className="relative w-[88px] h-[88px]">
              <defs>
                <linearGradient id={gradId} x1="0" y1="0" x2="1" y2="1">
                  <stop offset="0%" stopColor="#7c6df0" />
                  <stop offset="100%" stopColor={accent} />
                </linearGradient>
              </defs>
              {/* faint track */}
              <circle cx="48" cy="48" r="40" fill="none" stroke="var(--border)" strokeWidth="4" opacity="0.5" />
              {/* drawn ring */}
              <circle
                cx="48" cy="48" r="40" fill="none"
                stroke={`url(#${gradId})`} strokeWidth="4" strokeLinecap="round"
                pathLength={1} transform="rotate(-90 48 48)" className="tx-ring"
              />
              {status === "success" ? (
                <path
                  d="M30 49 L43 62 L67 35" fill="none"
                  stroke={`url(#${gradId})`} strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round"
                  pathLength={1} className="tx-mark"
                />
              ) : (
                <>
                  <path d="M36 36 L60 60" fill="none" stroke={`url(#${gradId})`} strokeWidth="5.5" strokeLinecap="round" pathLength={1} className="tx-mark" />
                  <path d="M60 36 L36 60" fill="none" stroke={`url(#${gradId})`} strokeWidth="5.5" strokeLinecap="round" pathLength={1} className="tx-mark tx-mark-late" />
                </>
              )}
            </svg>
          )}
        </div>

        {/* ── Copy ──────────────────────────────────────────────────── */}
        <h2 className="mt-4 text-[18px] font-bold text-text-primary">{title}</h2>
        {amountLabel && !isError && (
          <p className="mt-1 text-[13px] text-text-secondary break-all">{amountLabel}</p>
        )}
        {isError && errorMessage && (
          <p className="mt-2 text-[12px] text-text-secondary leading-relaxed break-words">{errorMessage}</p>
        )}
        {isPending && (
          <p className="mt-1.5 text-[12px] text-muted">{PENDING_SUB[kind]}</p>
        )}

        {status === "success" && explorerUrl && txHash && (
          <a
            href={explorerUrl} target="_blank" rel="noopener noreferrer"
            className="mt-3 inline-flex items-center gap-1 text-brand-400 text-[11px] hover:underline break-all"
          >
            {txHash.slice(0, 14)}…{txHash.slice(-8)} <ExternalLinkIcon size={11} />
          </a>
        )}

        {/* ── Action ────────────────────────────────────────────────── */}
        {!isPending && (
          <button onClick={onClose} className="btn-primary-premium mt-6 text-[13px]">
            {isError ? "Try again" : "Done"}
          </button>
        )}
      </div>
    </div>
  );
}
