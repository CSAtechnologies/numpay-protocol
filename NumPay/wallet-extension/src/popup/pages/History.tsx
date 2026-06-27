import { useState, useEffect, useCallback, useMemo } from "react";
import { useWallet } from "../hooks/useWallet";
import Layout from "../components/Layout";
import { SendIcon, ReceiveIcon, ExternalLinkIcon, RefreshIcon, ActivityIcon, ChainBadge } from "../components/Icons";
import { NETWORKS } from "@/lib/networks";
import {
  type TxRecord,
  fetchChainHistory,
  fetchAllChains,
  tokenMetaFromList,
  SUPPORTED,
} from "@/lib/txHistory";

const NON_EVM_NAMES: Record<string, string> = {
  bitcoin: "Bitcoin", solana: "Solana", sui: "Sui",
  tron: "Tron", xrp: "XRP Ledger", litecoin: "Litecoin",
};

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
}

function timeAgo(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 2)    return "Just now";
  if (mins < 60)   return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days === 1)  return "Yesterday";
  if (days < 30)   return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function History() {
  const { wallet, activeChainId, activeAddress, filterChainId, nonEvmWallet, tokensByChain } = useWallet();
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const isAllChains = filterChainId === null;
  const displayChainId = isAllChains ? activeChainId : filterChainId;
  const chainName = isAllChains ? "All Assets" : (NETWORKS[displayChainId]?.name ?? NON_EVM_NAMES[displayChainId] ?? displayChainId);
  const isSupported = isAllChains || SUPPORTED.has(displayChainId);
  const explorerBase = !isAllChains && NETWORKS[displayChainId]?.explorer
    ? `${NETWORKS[displayChainId].explorer}/address/${activeAddress}`
    : null;

  // Symbol lookup so SPL/token rows show a real ticker instead of a raw mint.
  const solTokenMeta = useMemo(() => tokenMetaFromList(tokensByChain?.["solana"]), [tokensByChain]);

  const fetchHistory = useCallback(async () => {
    if (!activeAddress && !wallet?.address) { setLoading(false); return; }
    setLoading(true);
    try {
      const records = isAllChains
        ? await fetchAllChains(wallet?.address || "", nonEvmWallet, solTokenMeta)
        : await fetchChainHistory(displayChainId, activeAddress, nonEvmWallet, solTokenMeta);
      setTxs(records);
    } catch {
      setTxs([]);
    } finally {
      setLoading(false);
    }
  }, [isAllChains, displayChainId, activeAddress, wallet?.address, nonEvmWallet, solTokenMeta]);

  useEffect(() => { fetchHistory(); }, [fetchHistory]);

  return (
    <Layout title="Activity">
      <div className="app-bg min-h-full">
        {/* Chain + refresh bar */}
        <div className="px-4 pt-3 pb-2 flex items-center justify-between border-b border-surface-3/40">
          <div className="flex items-center gap-1.5">
            <div className="w-1.5 h-1.5 rounded-full bg-brand-400" />
            <span className="text-[11px] text-muted font-medium">{chainName}</span>
          </div>
          <button
            onClick={fetchHistory}
            disabled={loading}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-muted hover:text-text-primary transition-colors disabled:opacity-40"
          >
            <RefreshIcon size={13} className={loading ? "animate-spin" : ""} />
          </button>
        </div>

        <div className="px-4 pb-4">
          {/* Unsupported chain fallback */}
          {!loading && !isSupported && (
            <div className="flex flex-col items-center py-12 animate-fade-in gap-3">
              <div className="w-12 h-12 rounded-full premium-card flex items-center justify-center">
                <ActivityIcon size={20} className="text-muted" />
              </div>
              <p className="text-[13px] text-muted text-center leading-relaxed">
                Transaction history is not available for this chain in-app.
              </p>
              {explorerBase && (
                <a href={explorerBase} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1.5 text-[12px] text-brand-400 hover:text-brand-300 transition-colors">
                  View on Explorer
                  <ExternalLinkIcon size={11} />
                </a>
              )}
            </div>
          )}

          {/* Loading skeleton */}
          {loading && (
            <div className="animate-pulse pt-1">
              {[1, 2, 3, 4, 5].map(i => (
                <div key={i} className="flex items-start gap-3 py-3.5 border-b border-surface-3/30 last:border-0">
                  <div className="w-9 h-9 rounded-full bg-surface-3 flex-shrink-0 mt-0.5" />
                  <div className="flex-1 space-y-2.5">
                    <div className="flex justify-between items-center">
                      <div className="h-3 w-14 rounded-full bg-surface-3" />
                      <div className="h-3 w-24 rounded-full bg-surface-3" />
                    </div>
                    <div className="h-2.5 w-36 rounded-full bg-surface-3/70" />
                    <div className="h-2 w-16 rounded-full bg-surface-3/50" />
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Empty state */}
          {!loading && isSupported && txs.length === 0 && (
            <div className="flex flex-col items-center py-14 animate-fade-in">
              <div className="w-12 h-12 rounded-full premium-card flex items-center justify-center mb-3">
                <ActivityIcon size={20} className="text-muted" />
              </div>
              <p className="text-[13px] text-muted">No transactions found</p>
              <p className="text-[11px] text-muted/60 mt-1 text-center px-6">
                Your transactions will appear here once you start transacting.
              </p>
            </div>
          )}

          {/* Transaction list */}
          {!loading && txs.length > 0 && (
            <div className="pt-1">
              {txs.map((tx) => (
                <a
                  key={`${tx.chainId}-${tx.hash}-${tx.assetAddr || "native"}`}
                  href={tx.explorerUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-start gap-3 py-3.5 border-b border-surface-3/30 last:border-0 hover:bg-surface-2/30 transition-colors rounded-lg -mx-1 px-1 animate-slide-up"
                >
                  {/* Direction icon */}
                  <div className={`relative w-9 h-9 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
                    tx.type === "sent"
                      ? "bg-gradient-to-br from-accent-red/20 to-accent-red/5 border border-accent-red/15"
                      : "bg-gradient-to-br from-accent-green/20 to-accent-green/5 border border-accent-green/15"
                  }`}>
                    {tx.type === "sent"
                      ? <SendIcon size={13} className="text-accent-red" />
                      : <ReceiveIcon size={13} className="text-accent-green" />
                    }
                    {/* Chain badge — shown in All Assets mode. ChainIcon resolves a
                        real logo for every chain (EVM + non-EVM) by chainId, with
                        its own branded per-chain fallback, so no chain falls back to
                        a bare initial. */}
                    {isAllChains && tx.chainId && (
                      <ChainBadge chainId={tx.chainId} logo={NETWORKS[tx.chainId]?.logo} />
                    )}
                  </div>

                  {/* Text block */}
                  <div className="flex-1 min-w-0">
                    <div className="flex items-baseline justify-between mb-1.5">
                      <span className={`text-[13px] font-semibold ${tx.type === "sent" ? "text-accent-red" : "text-accent-green"}`}>
                        {tx.type === "sent" ? "Sent" : "Received"}
                      </span>
                      <span className="text-[13px] font-semibold tabular-nums text-text-primary ml-2 shrink-0">
                        {tx.type === "sent" ? "-" : "+"}{parseFloat(tx.value).toFixed(4)} {tx.symbol}
                      </span>
                    </div>

                    <p className="text-[11px] text-muted truncate mb-1.5">
                      {tx.counterparty
                        ? <>{tx.type === "sent" ? "To: " : "From: "}<span className="font-mono">{shortAddr(tx.counterparty)}</span></>
                        : <span className="italic opacity-60">address unavailable</span>
                      }
                    </p>

                    <div className="flex items-center gap-2">
                      {isAllChains && tx.chainName && (
                        <span className="text-[10px] text-brand-400/70 font-medium">{tx.chainName}</span>
                      )}
                      {tx.timestamp > 0 && (
                        <span className="text-[10px] text-muted/55">{timeAgo(tx.timestamp)}</span>
                      )}
                      <span className="flex items-center gap-1 text-[10px] text-muted/40">
                        <ExternalLinkIcon size={9} />
                        View
                      </span>
                    </div>
                  </div>
                </a>
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
