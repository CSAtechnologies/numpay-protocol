import { useState, useEffect, useCallback, useMemo } from "react";
import { useWallet } from "../hooks/useWallet";
import Layout from "../components/Layout";
import { ExternalLinkIcon, RefreshIcon, ActivityIcon } from "../components/Icons";
import TxRow from "../components/TxRow";
import { NETWORKS } from "@/lib/networks";
import {
  type TxRecord,
  fetchChainHistory,
  fetchAllChains,
  tokenMetaFromList,
  mergeLoggedTxs,
  SUPPORTED,
} from "@/lib/txHistory";
import { loadTxLog, loggedToRecords } from "@/lib/txLog";

const NON_EVM_NAMES: Record<string, string> = {
  bitcoin: "Bitcoin", solana: "Solana", sui: "Sui",
  tron: "Tron", xrp: "XRP Ledger", litecoin: "Litecoin",
};

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
      // Merge the user's own NumPay transactions (send/swap/bridge) so they are
      // always present with their real kind, regardless of indexer coverage.
      const logged = loggedToRecords(await loadTxLog()).filter((r) =>
        isAllChains || r.chainId === displayChainId || r.toChainId === displayChainId
      );
      setTxs(mergeLoggedTxs(records, logged));
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
            <div className="pt-1 space-y-0.5">
              {txs.map((tx) => (
                <TxRow
                  key={`${tx.chainId}-${tx.hash}-${tx.assetAddr || "native"}`}
                  tx={tx}
                  size={36}
                  showChain={isAllChains}
                  className="animate-slide-up"
                />
              ))}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
