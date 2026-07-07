// Local activity log: every transaction NumPay itself broadcasts (send, swap,
// bridge) is recorded here at broadcast time. On-chain indexers are lossy — the
// Etherscan-V1 scan APIs are dead, providers rate-limit, and the Activity page
// and token-detail panel each fetch independently — so a tx can show in one
// place and not the other. This log is the source of truth for the user's OWN
// transactions: it is merged into both views (mergeLoggedTxs in txHistory.ts),
// deduped by chain+hash, so a swap/bridge always appears, once, with its real
// kind and both sides. It is transit metadata only: no keys, no amounts beyond
// what the user already sees on screen.

import { getItem, setItem } from "./storage";
import { NETWORKS } from "./networks";
import { type TxRecord, type TxKind, type TxStatus } from "./txHistory";

const KEY = "numpay_txlog";
const CAP = 120;

// A logged NumPay transaction. `value`/`symbol`/`assetAddr` describe the
// primary (spent) side; the `to*` fields describe the received side (swap) or
// destination (bridge). The `status` + EVM replacement fields power the pending
// tracker and speed-up/cancel (which rebuild the tx at the same nonce).
export interface LoggedTx {
  hash: string;
  chainId: string;
  kind: TxKind;
  timestamp: number;
  symbol: string;
  value: string;
  assetAddr?: string;   // lowercased contract/mint; undefined = native
  logo?: string;
  counterparty?: string;
  toSymbol?: string;
  toValue?: string;
  toAssetAddr?: string;
  toLogo?: string;
  toChainId?: string;
  // Lifecycle + EVM replacement data (sends only).
  status?: TxStatus;
  nonce?: number;
  from?: string;
  to?: string;
  valueWei?: string;
  data?: string;
  maxFeeWei?: string;
  maxPrioWei?: string;
  gasPriceWei?: string;
}

const NON_EVM_EXPLORER_TX: Record<string, (h: string) => string> = {
  solana:   (h) => `https://solscan.io/tx/${h}`,
  tron:     (h) => `https://tronscan.org/#/transaction/${h}`,
  sui:      (h) => `https://suiscan.xyz/mainnet/tx/${h}`,
  xrp:      (h) => `https://xrpscan.com/tx/${h}`,
  bitcoin:  (h) => `https://blockstream.info/tx/${h}`,
  litecoin: (h) => `https://litecoinspace.org/tx/${h}`,
};

const NON_EVM_NAMES: Record<string, string> = {
  bitcoin: "Bitcoin", solana: "Solana", sui: "Sui",
  tron: "Tron", xrp: "XRP Ledger", litecoin: "Litecoin",
};

/** Block-explorer URL for a tx on any supported chain (EVM + non-EVM). */
export function explorerTxUrl(chainId: string, hash: string): string {
  const evm = NETWORKS[chainId]?.explorer;
  if (evm) return `${evm}/tx/${hash}`;
  return NON_EVM_EXPLORER_TX[chainId]?.(hash) ?? "";
}

/** Human chain name for a chain id (EVM + non-EVM). */
export function chainNameOf(chainId?: string): string | undefined {
  if (!chainId) return undefined;
  return NETWORKS[chainId]?.name ?? NON_EVM_NAMES[chainId] ?? chainId;
}

export async function loadTxLog(): Promise<LoggedTx[]> {
  try {
    const raw = await getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

/**
 * Record a NumPay-broadcast transaction. Deduped by chain+hash (a retry or a
 * re-render can't create a second row), newest first, capped. Never throws:
 * logging is best-effort telemetry for the UI, never in the send/swap critical
 * path. Pass lowercased asset addresses.
 */
export async function logTx(entry: LoggedTx): Promise<void> {
  if (!entry.hash || !entry.chainId) return;
  try {
    const list = await loadTxLog();
    const key = `${entry.chainId}-${entry.hash.toLowerCase()}`;
    const next = [entry, ...list.filter((e) => `${e.chainId}-${e.hash.toLowerCase()}` !== key)].slice(0, CAP);
    await setItem(KEY, JSON.stringify(next));
  } catch { /* best-effort */ }
}

/** Update a logged entry in place (by chain+hash); patch may set a new hash for
 *  a replacement (speed-up/cancel). Never throws. */
export async function updateTx(chainId: string, hash: string, patch: Partial<LoggedTx>): Promise<void> {
  try {
    const list = await loadTxLog();
    const i = list.findIndex((e) => e.chainId === chainId && e.hash.toLowerCase() === hash.toLowerCase());
    if (i < 0) return;
    list[i] = { ...list[i], ...patch };
    await setItem(KEY, JSON.stringify(list));
  } catch { /* best-effort */ }
}

/** Convert logged entries to TxRecords for merging into fetched history. */
export function loggedToRecords(logged: LoggedTx[]): TxRecord[] {
  return logged.map((e): TxRecord => ({
    hash: e.hash,
    counterparty: e.counterparty || "",
    value: e.value,
    symbol: e.symbol,
    timestamp: e.timestamp,
    // Direction drives the amount colour: a send/bridge spends, a swap nets a
    // received asset; receives (which we don't log) come from the chain.
    type: e.kind === "receive" ? "received" : "sent",
    kind: e.kind,
    status: e.status,
    logo: e.logo,
    explorerUrl: explorerTxUrl(e.chainId, e.hash),
    chainName: chainNameOf(e.chainId),
    chainId: e.chainId,
    assetAddr: e.assetAddr,
    toSymbol: e.toSymbol,
    toValue: e.toValue,
    toAssetAddr: e.toAssetAddr,
    toLogo: e.toLogo,
    toChainId: e.toChainId,
    toChainName: chainNameOf(e.toChainId),
  }));
}
