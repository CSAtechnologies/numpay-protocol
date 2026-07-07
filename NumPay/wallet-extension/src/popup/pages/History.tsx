import { useState, useEffect, useCallback, useMemo, useRef } from "react";
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
import { type LoggedTx, loadTxLog, loggedToRecords } from "@/lib/txLog";
import { reconcilePending, speedUpTx, cancelTx } from "@/lib/pendingTx";

const NON_EVM_NAMES: Record<string, string> = {
  bitcoin: "Bitcoin", solana: "Solana", sui: "Sui",
  tron: "Tron", xrp: "XRP Ledger", litecoin: "Litecoin",
};

// ── Component ─────────────────────────────────────────────────────────────────

export default function History() {
  const { wallet, activeChainId, activeAddress, filterChainId, nonEvmWallet, tokensByChain } = useWallet();
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [loading, setLoading] = useState(true);       // skeleton: only the first paint of a scope
  const [refreshing, setRefreshing] = useState(false); // in-flight indicator (spins the refresh icon)
  const [busyHash, setBusyHash] = useState<string | null>(null); // speed-up/cancel in flight
  const [actionError, setActionError] = useState("");
  // Raw logged entries (with nonce/to/gas) keyed by chain-hash, for replacements.
  const logMapRef = useRef<Map<string, LoggedTx>>(new Map());

  const isAllChains = filterChainId === null;
  const displayChainId = isAllChains ? activeChainId : filterChainId;
  const chainName = isAllChains ? "All Assets" : (NETWORKS[displayChainId]?.name ?? NON_EVM_NAMES[displayChainId] ?? displayChainId);
  const isSupported = isAllChains || SUPPORTED.has(displayChainId);
  const explorerBase = !isAllChains && NETWORKS[displayChainId]?.explorer
    ? `${NETWORKS[displayChainId].explorer}/address/${activeAddress}`
    : null;

  // Symbol lookup so SPL/token rows show a real ticker instead of a raw mint.
  const solTokenMeta = useMemo(() => tokenMetaFromList(tokensByChain?.["solana"]), [tokensByChain]);

  // The background balance sweep hands useWallet a fresh tokensByChain (and so a
  // fresh solTokenMeta) every ~minute. Reading those — plus nonEvmWallet and the
  // evm address — through refs keeps fetchHistory's identity stable, so a
  // background tick refreshes silently instead of re-running the effect and
  // flashing the loading skeleton. Only a real scope change (wallet / chain /
  // all-vs-single) rebuilds fetchHistory and shows the skeleton.
  const solTokenMetaRef = useRef(solTokenMeta); solTokenMetaRef.current = solTokenMeta;
  const nonEvmWalletRef = useRef(nonEvmWallet); nonEvmWalletRef.current = nonEvmWallet;
  const walletAddrRef = useRef(wallet?.address); walletAddrRef.current = wallet?.address;
  const txsSigRef = useRef("");

  // Content signature so a silent refresh only re-renders when something changed
  // (status included so a pending → confirmed transition repaints).
  const sigOf = (list: TxRecord[]) =>
    list.map((t) => `${t.chainId}:${t.hash}:${t.assetAddr || ""}:${t.value}:${t.kind || t.type}:${t.status || ""}`).join("|");

  const fetchHistory = useCallback(async (opts?: { skeleton?: boolean }) => {
    const skeleton = opts?.skeleton ?? false;
    const evmAddr = activeAddress || walletAddrRef.current || "";
    if (!evmAddr && !nonEvmWalletRef.current) { if (skeleton) setLoading(false); return; }
    if (skeleton) setLoading(true);
    setRefreshing(true);
    try {
      const records = isAllChains
        ? await fetchAllChains(walletAddrRef.current || "", nonEvmWalletRef.current, solTokenMetaRef.current)
        : await fetchChainHistory(displayChainId, activeAddress, nonEvmWalletRef.current, solTokenMetaRef.current);
      // Merge the user's own NumPay transactions (send/swap/bridge) so they are
      // always present with their real kind, regardless of indexer coverage.
      // Reconcile pending sends against receipts first so their status settles.
      const rawLog = await reconcilePending(await loadTxLog());
      logMapRef.current = new Map(rawLog.map((e) => [`${e.chainId}-${e.hash.toLowerCase()}`, e]));
      const logged = loggedToRecords(rawLog).filter((r) =>
        isAllChains || r.chainId === displayChainId || r.toChainId === displayChainId
      );
      const merged = mergeLoggedTxs(records, logged);
      const sig = sigOf(merged);
      if (sig !== txsSigRef.current) { txsSigRef.current = sig; setTxs(merged); }
    } catch {
      // Only wipe the list on an explicit (skeleton) load; a background failure
      // keeps the last good data on screen.
      if (skeleton) { txsSigRef.current = ""; setTxs([]); }
    } finally {
      if (skeleton) setLoading(false);
      setRefreshing(false);
    }
  }, [isAllChains, displayChainId, activeAddress]);

  // Scope changed (or first mount): reset the diff and do a skeleton load.
  useEffect(() => {
    txsSigRef.current = "";
    void fetchHistory({ skeleton: true });
  }, [fetchHistory]);

  // Silent background refresh: a 60s poll plus the wsWatch incoming-funds signal,
  // both diffed so the UI only updates when the data actually changes.
  useEffect(() => {
    const id = setInterval(() => void fetchHistory({ skeleton: false }), 60_000);
    const onMsg = (msg: any, sender: any) => {
      if (msg?.type === "NUMPAY_FUNDS_EVENT" && sender?.id === chrome.runtime?.id && !sender?.tab) {
        void fetchHistory({ skeleton: false });
      }
    };
    chrome.runtime?.onMessage?.addListener(onMsg);
    return () => { clearInterval(id); chrome.runtime?.onMessage?.removeListener(onMsg); };
  }, [fetchHistory]);

  // Speed up / cancel a pending EVM send by re-broadcasting at the same nonce.
  async function replacePending(tx: TxRecord, mode: "speed" | "cancel") {
    const entry = logMapRef.current.get(`${tx.chainId}-${(tx.hash || "").toLowerCase()}`);
    if (!entry || !wallet?.privateKey) return;
    setBusyHash(tx.hash); setActionError("");
    try {
      if (mode === "speed") await speedUpTx(entry, wallet.privateKey);
      else await cancelTx(entry, wallet.privateKey);
      await fetchHistory({ skeleton: false });
    } catch (e: any) {
      setActionError(e?.reason || e?.message || `Could not ${mode === "speed" ? "speed up" : "cancel"} the transaction`);
    } finally {
      setBusyHash(null);
    }
  }
  // A pending send on an EVM chain with the data needed to replace it.
  const canReplace = (tx: TxRecord) =>
    tx.status === "pending" && tx.kind === "send" && !!NETWORKS[tx.chainId || ""] &&
    logMapRef.current.get(`${tx.chainId}-${(tx.hash || "").toLowerCase()}`)?.nonce != null;

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
            onClick={() => fetchHistory({ skeleton: false })}
            disabled={refreshing}
            className="p-1.5 rounded-lg hover:bg-surface-2 text-muted hover:text-text-primary transition-colors disabled:opacity-40"
          >
            <RefreshIcon size={13} className={refreshing ? "animate-spin" : ""} />
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

          {/* Action error */}
          {actionError && (
            <div className="mt-2 px-3 py-2 rounded-xl bg-accent-red/5 border border-accent-red/15">
              <p className="text-accent-red text-[11px] leading-relaxed">{actionError}</p>
            </div>
          )}

          {/* Transaction list */}
          {!loading && txs.length > 0 && (
            <div className="pt-1 space-y-0.5">
              {txs.map((tx) => {
                const replaceable = canReplace(tx);
                return (
                  <TxRow
                    key={`${tx.chainId}-${tx.hash}-${tx.assetAddr || "native"}`}
                    tx={tx}
                    size={36}
                    showChain={isAllChains}
                    className="animate-slide-up"
                    busy={busyHash === tx.hash}
                    onSpeedUp={replaceable ? () => void replacePending(tx, "speed") : undefined}
                    onCancel={replaceable ? () => void replacePending(tx, "cancel") : undefined}
                  />
                );
              })}
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}
