// Shared transaction-history fetchers for the Activity page and the token-detail
// panel. Both used to duplicate this logic, which is why token transfers (SPL,
// TRC-20, scan-chain ERC-20) were missing from both. Keep it here once.
//
// Coverage per chain:
//   Alchemy EVM (eth/polygon/arb/op/base): native + internal + ERC-20 (asset
//     transfers). erc20 rows carry the contract address for per-token filtering.
//   Scan-API EVM (bsc/avax/…): native txlist + ERC-20 tokentx.
//   Solana: native SOL (balance delta) + SPL tokens (pre/post token balances).
//   Tron: native TRX + TRC-20 token transfers.
//   Bitcoin / Litecoin / XRP / Sui: native only.

import { NETWORKS } from "@/lib/networks";
import { ALCHEMY_KEY, MORALIS_KEY } from "@/lib/env";
import { SOL_RPC } from "@/lib/chains/solana";

// send/receive = a plain transfer; swap = token→token on one chain; bridge =
// same/related asset moved across chains. `type` stays as the raw direction
// (drives the amount sign/colour); `kind` is the richer classification the UI
// labels and badges from. On-chain-only rows have kind derived from type; the
// local activity log (txLog.ts) supplies real swap/bridge kinds.
export type TxKind = "send" | "receive" | "swap" | "bridge";

export interface TxRecord {
  hash: string;
  counterparty: string;
  value: string;
  symbol: string;
  timestamp: number;
  type: "sent" | "received";
  kind?: TxKind;
  // Logo URL for the primary asset, when the source knows it (local log rows).
  logo?: string;
  explorerUrl: string;
  chainName?: string;
  chainId?: string;
  // ERC-20 contract / SPL mint / TRC-20 contract, lowercased. Undefined for a
  // native-coin transfer. Used to filter the token-detail panel to one token.
  assetAddr?: string;
  // ── swap / bridge "other side" (the asset received, or the destination) ──
  toSymbol?: string;
  toValue?: string;
  toAssetAddr?: string;
  toLogo?: string;
  toChainId?: string;
  toChainName?: string;
}

/** The classification the UI renders from — real kind if present, else the raw direction. */
export function kindOf(tx: TxRecord): TxKind {
  return tx.kind ?? (tx.type === "sent" ? "send" : "receive");
}

const dedupeKey = (tx: TxRecord) => `${tx.chainId}-${(tx.hash || "").toLowerCase()}`;

/**
 * Collapse on-chain rows that are really one swap: a single tx hash on one
 * chain that moved a token OUT of and a (different) token INTO the same wallet.
 * Covers swaps done outside NumPay (which the local log won't have). Rows keyed
 * by a hash the local log already owns are left untouched — the merge drops them.
 */
export function coalesceSwaps(records: TxRecord[]): TxRecord[] {
  const byHash = new Map<string, TxRecord[]>();
  for (const r of records) {
    const k = dedupeKey(r);
    (byHash.get(k) ?? byHash.set(k, []).get(k)!).push(r);
  }
  const out: TxRecord[] = [];
  for (const group of byHash.values()) {
    const sent = group.find((r) => r.type === "sent");
    const recv = group.find((r) => r.type === "received");
    // A genuine swap has both legs and they are different assets.
    if (group.length >= 2 && sent && recv && (sent.assetAddr || "") !== (recv.assetAddr || "")) {
      out.push({
        ...sent,
        kind: "swap",
        // from = the leg we spent; to = the leg we received.
        symbol: sent.symbol, value: sent.value, assetAddr: sent.assetAddr, logo: sent.logo,
        toSymbol: recv.symbol, toValue: recv.value, toAssetAddr: recv.assetAddr, toLogo: recv.logo,
        toChainId: recv.chainId, toChainName: recv.chainName,
        counterparty: "",
      });
    } else {
      out.push(...group);
    }
  }
  return out.sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Merge locally-logged NumPay transactions into fetched on-chain history.
 * A logged row wins for its (chain, hash) — it carries the true kind, logos and
 * both sides — and drops every on-chain leg sharing that key so a swap/bridge
 * shows as one row, not its raw transfer legs.
 */
export function mergeLoggedTxs(onchain: TxRecord[], logged: TxRecord[]): TxRecord[] {
  const loggedKeys = new Set(logged.map(dedupeKey));
  const merged = [...logged, ...onchain.filter((r) => !loggedKeys.has(dedupeKey(r)))];
  // Final dedupe (an on-chain source can list the same hash twice across sources).
  const seen = new Set<string>();
  return merged
    .filter((r) => { const k = `${dedupeKey(r)}-${r.assetAddr || "native"}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.timestamp - a.timestamp);
}

/**
 * Does this record involve a given asset on a given chain? Matches either the
 * primary side or the swap/bridge "to" side, so a swap shows on both token
 * pages and a bridge shows on its source- and destination-chain token pages.
 */
export function txInvolvesAsset(tx: TxRecord, chainId: string, addr: string | undefined, isNative: boolean): boolean {
  const a = addr?.toLowerCase();
  const sideMatch = (cId?: string, aAddr?: string) =>
    cId === chainId && (isNative ? !aAddr : (aAddr || "").toLowerCase() === a);
  return sideMatch(tx.chainId, tx.assetAddr) || sideMatch(tx.toChainId, tx.toAssetAddr);
}

// Optional symbol/decimals lookup for SPL mints (and any token whose symbol the
// indexer does not give us), keyed by lowercased mint/contract address.
export type TokenMeta = Record<string, { symbol: string; decimals?: number }>;

export const ALCHEMY_NETS: Record<string, string> = {
  ethereum: "eth-mainnet",
  polygon: "polygon-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
  base: "base-mainnet",
};

// Moralis hex chain ids, used as the working history source for chains whose
// block-explorer V1 endpoints are dead (see fetchScan note). Mirrors
// MORALIS_CHAINS in autoTokens.ts; kept local so the history bundle doesn't pull
// in that heavy module. Alchemy still serves eth/polygon/arb/op/base.
export const MORALIS_CHAINS: Record<string, string> = {
  bsc: "0x38", avalanche: "0xa86a", fantom: "0xfa", cronos: "0x19",
  gnosis: "0x64", moonbeam: "0x504", celo: "0xa4ec", scroll: "0x82750",
  linea: "0xe708", mantle: "0x1388", blast: "0x13e31",
};

export const SCAN_APIS: Record<string, string> = {
  bsc: "https://api.bscscan.com/api",
  avalanche: "https://api.snowscan.xyz/api",
  fantom: "https://api.ftmscan.com/api",
  cronos: "https://api.cronoscan.com/api",
  gnosis: "https://api.gnosisscan.io/api",
  moonbeam: "https://api-moonbeam.moonscan.io/api",
  celo: "https://api.celoscan.io/api",
  scroll: "https://api.scrollscan.com/api",
  linea: "https://api.lineascan.build/api",
  mantle: "https://api.mantlescan.xyz/api",
  blast: "https://api.blastscan.io/api",
};

export const SUPPORTED = new Set<string>([
  ...Object.keys(ALCHEMY_NETS),
  ...Object.keys(MORALIS_CHAINS),
  ...Object.keys(SCAN_APIS),
  "bitcoin", "litecoin", "solana", "xrp", "tron", "sui",
]);

// ── helpers ─────────────────────────────────────────────────────────────────────

// Render a JS number without exponential notation, trimmed, for the value column.
function plainAmount(n: number): string {
  if (!isFinite(n) || n === 0) return "0";
  const a = Math.abs(n);
  if (a >= 1e15 || a < 1e-6) return n.toFixed(8).replace(/\.?0+$/, "");
  return String(n);
}

function shortMint(addr: string): string {
  return addr && addr.length > 10 ? `${addr.slice(0, 4)}…${addr.slice(-4)}` : addr;
}

function tronAddrToHex(addr: string): string {
  const ABC = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";
  let n = BigInt(0);
  for (const c of addr) {
    const i = ABC.indexOf(c);
    if (i < 0) return "";
    n = n * 58n + BigInt(i);
  }
  return n.toString(16).padStart(50, "0").slice(0, 42);
}

// ── EVM: Alchemy asset transfers (native + internal + ERC-20) ─────────────────────

async function fetchAlchemy(chainId: string, address: string): Promise<TxRecord[]> {
  const sub = ALCHEMY_NETS[chainId];
  if (!sub) return [];
  const net = NETWORKS[chainId];
  const url = `https://${sub}.g.alchemy.com/v2/${ALCHEMY_KEY}`;
  const opts = { method: "POST", headers: { "Content-Type": "application/json" } };
  const body = (dir: "from" | "to") => JSON.stringify({
    jsonrpc: "2.0", id: 1, method: "alchemy_getAssetTransfers",
    params: [{
      fromBlock: "0x0", toBlock: "latest",
      [dir === "from" ? "fromAddress" : "toAddress"]: address,
      category: ["external", "internal", "erc20"],
      withMetadata: true, maxCount: "0x19", order: "desc",
    }],
  });

  const [sentR, recvR] = await Promise.all([
    fetch(url, { ...opts, body: body("from") }).then((r) => r.json()).catch(() => null),
    fetch(url, { ...opts, body: body("to") }).then((r) => r.json()).catch(() => null),
  ]);

  const records: TxRecord[] = [];
  const seen = new Set<string>();
  const push = (transfers: any[], type: "sent" | "received") => {
    for (const tx of transfers || []) {
      // One hash can carry several transfers (e.g. an internal + an ERC-20);
      // key by hash + asset so they don't collapse into one row.
      const contract = tx.rawContract?.address ? String(tx.rawContract.address).toLowerCase() : undefined;
      const key = `${tx.hash}-${contract || "native"}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const ts = tx.metadata?.blockTimestamp ? new Date(tx.metadata.blockTimestamp).getTime() : 0;
      records.push({
        hash: tx.hash,
        counterparty: type === "sent" ? (tx.to || "") : (tx.from || ""),
        value: tx.value != null ? plainAmount(parseFloat(tx.value)) : "0",
        symbol: tx.asset || net?.symbol || "",
        timestamp: ts, type,
        explorerUrl: `${net?.explorer}/tx/${tx.hash}`,
        chainName: net?.name, chainId,
        assetAddr: contract,
      });
    }
  };
  push(sentR?.result?.transfers, "sent");
  push(recvR?.result?.transfers, "received");
  return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
}

// ── EVM: block-explorer txlist (native) + tokentx (ERC-20) ────────────────────────
//
// NOTE: these are Etherscan-family V1 endpoints. Etherscan has deprecated V1 in
// favour of a single V2 API (`api.etherscan.io/v2/api?chainid=...&apikey=...`),
// so without an Etherscan key these calls now return {status:"0",message:"NOTOK"}
// and yield nothing. That is a pre-existing breakage for ALL history on these
// chains (native + tokens), not specific to tokens. The native + tokentx pair
// below is correct and will work once an Etherscan V2 key (or a GoldRush/Moralis
// migration, keys we already have) is wired in. Chains that route through Alchemy
// (eth/polygon/arb/op/base) are unaffected and include ERC-20.

async function fetchScan(chainId: string, address: string): Promise<TxRecord[]> {
  const base = SCAN_APIS[chainId];
  if (!base) return [];
  const net = NETWORKS[chainId];
  const addr = address.toLowerCase();

  const [nativeData, tokenData] = await Promise.all([
    fetch(`${base}?module=account&action=txlist&address=${address}&page=1&offset=20&sort=desc`).then((r) => r.json()).catch(() => null),
    fetch(`${base}?module=account&action=tokentx&address=${address}&page=1&offset=25&sort=desc`).then((r) => r.json()).catch(() => null),
  ]);

  const records: TxRecord[] = [];

  if (nativeData?.status === "1" && Array.isArray(nativeData.result)) {
    for (const tx of nativeData.result) {
      if (tx.value === "0") continue; // contract calls with no native value
      const isSent = tx.from?.toLowerCase() === addr;
      records.push({
        hash: tx.hash,
        counterparty: isSent ? tx.to : tx.from,
        value: plainAmount(parseInt(tx.value || "0") / 1e18),
        symbol: net?.symbol || "",
        timestamp: parseInt(tx.timeStamp || "0") * 1000,
        type: isSent ? "sent" : "received",
        explorerUrl: `${net?.explorer}/tx/${tx.hash}`,
        chainName: net?.name, chainId,
      });
    }
  }

  if (tokenData?.status === "1" && Array.isArray(tokenData.result)) {
    for (const tx of tokenData.result) {
      const isSent = tx.from?.toLowerCase() === addr;
      const dec = parseInt(tx.tokenDecimal || "18");
      records.push({
        hash: tx.hash,
        counterparty: isSent ? tx.to : tx.from,
        value: plainAmount(Number(tx.value || "0") / Math.pow(10, dec)),
        symbol: tx.tokenSymbol || "TOKEN",
        timestamp: parseInt(tx.timeStamp || "0") * 1000,
        type: isSent ? "sent" : "received",
        explorerUrl: `${net?.explorer}/tx/${tx.hash}`,
        chainName: net?.name, chainId,
        assetAddr: tx.contractAddress ? String(tx.contractAddress).toLowerCase() : undefined,
      });
    }
  }

  return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
}

// ── EVM: Moralis decoded history (native + ERC-20) ────────────────────────────────
// The working source for chains whose explorer V1 API is dead. Two calls: native
// transactions and decoded ERC-20 transfers. Uses the MORALIS_KEY already shipped
// for token balances.

const MORALIS_BASE = "https://deep-index.moralis.io/api/v2.2";

async function fetchMoralis(chainId: string, address: string): Promise<TxRecord[]> {
  const hex = MORALIS_CHAINS[chainId];
  if (!hex || !MORALIS_KEY) return [];
  const net = NETWORKS[chainId];
  const headers = { "X-API-Key": MORALIS_KEY, Accept: "application/json" };
  const addr = address.toLowerCase();

  const [nativeR, tokenR] = await Promise.all([
    fetch(`${MORALIS_BASE}/${address}?chain=${hex}&limit=25&order=DESC`, { headers }).then((r) => r.json()).catch(() => null),
    fetch(`${MORALIS_BASE}/${address}/erc20/transfers?chain=${hex}&limit=25&order=DESC`, { headers }).then((r) => r.json()).catch(() => null),
  ]);

  const records: TxRecord[] = [];

  for (const tx of nativeR?.result || []) {
    if (!tx.value || tx.value === "0") continue; // contract calls with no native value
    const isSent = tx.from_address?.toLowerCase() === addr;
    records.push({
      hash: tx.hash,
      counterparty: isSent ? (tx.to_address || "") : (tx.from_address || ""),
      value: plainAmount(Number(tx.value) / Math.pow(10, net?.decimals ?? 18)),
      symbol: net?.symbol || "",
      timestamp: tx.block_timestamp ? new Date(tx.block_timestamp).getTime() : 0,
      type: isSent ? "sent" : "received",
      explorerUrl: `${net?.explorer}/tx/${tx.hash}`,
      chainName: net?.name, chainId,
    });
  }

  for (const tx of tokenR?.result || []) {
    const isSent = tx.from_address?.toLowerCase() === addr;
    const amt = tx.value_decimal != null
      ? parseFloat(tx.value_decimal)
      : Number(tx.value || "0") / Math.pow(10, Number(tx.token_decimals ?? 18));
    records.push({
      hash: tx.transaction_hash,
      counterparty: isSent ? (tx.to_address || "") : (tx.from_address || ""),
      value: plainAmount(amt),
      symbol: tx.token_symbol || "TOKEN",
      timestamp: tx.block_timestamp ? new Date(tx.block_timestamp).getTime() : 0,
      type: isSent ? "sent" : "received",
      explorerUrl: `${net?.explorer}/tx/${tx.transaction_hash}`,
      chainName: net?.name, chainId,
      assetAddr: tx.address ? String(tx.address).toLowerCase() : undefined,
    });
  }

  return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, 30);
}

// ── UTXO chains ───────────────────────────────────────────────────────────────────

function fetchUtxo(addr: string, api: string, explorer: string, symbol: string, chainId: string): Promise<TxRecord[]> {
  return fetch(`${api}/address/${addr}/txs`).then((r) => r.json()).then((txs: any[]) =>
    (txs || []).slice(0, 20).map((tx: any): TxRecord => {
      const inputs: string[] = tx.vin.map((v: any) => v.prevout?.scriptpubkey_address || "");
      const isSent = inputs.includes(addr);
      const ts = (tx.status?.block_time || 0) * 1000;
      if (isSent) {
        const amt = tx.vout.filter((v: any) => v.scriptpubkey_address !== addr).reduce((s: number, v: any) => s + (v.value || 0), 0);
        const to = tx.vout.find((v: any) => v.scriptpubkey_address !== addr)?.scriptpubkey_address || "";
        return { hash: tx.txid, counterparty: to, value: (amt / 1e8).toFixed(8), symbol, timestamp: ts, type: "sent", explorerUrl: `${explorer}/tx/${tx.txid}`, chainName: NETWORKS[chainId]?.name, chainId };
      }
      const amt = tx.vout.filter((v: any) => v.scriptpubkey_address === addr).reduce((s: number, v: any) => s + (v.value || 0), 0);
      const from = inputs.find((a) => a && a !== addr) || "";
      return { hash: tx.txid, counterparty: from, value: (amt / 1e8).toFixed(8), symbol, timestamp: ts, type: "received", explorerUrl: `${explorer}/tx/${tx.txid}`, chainName: chainId === "bitcoin" ? "Bitcoin" : "Litecoin", chainId };
    })
  ).catch(() => []);
}

// ── Solana: native SOL + SPL token balance deltas ─────────────────────────────────

function parseSolanaTx(tx: any, address: string, sig: any, tokenMeta: TokenMeta): TxRecord[] {
  const out: TxRecord[] = [];
  const ts = (sig.blockTime || 0) * 1000;
  const explorerUrl = `https://solscan.io/tx/${sig.signature}`;

  const keys: string[] = (tx.transaction.message.accountKeys || []).map((k: any) =>
    typeof k === "string" ? k : (k.pubkey || "")
  );
  const myIdx = keys.findIndex((k) => k === address);

  // ── SPL token changes: diff pre/post token balances owned by the user ──
  const pre: any[] = tx.meta?.preTokenBalances || [];
  const post: any[] = tx.meta?.postTokenBalances || [];
  const preByIdx = new Map<number, any>();
  for (const b of pre) preByIdx.set(b.accountIndex, b);
  const postByIdx = new Map<number, any>();
  for (const b of post) postByIdx.set(b.accountIndex, b);

  const idxs = new Set<number>([...preByIdx.keys(), ...postByIdx.keys()]);
  for (const idx of idxs) {
    const p = preByIdx.get(idx);
    const q = postByIdx.get(idx);
    const owner = q?.owner ?? p?.owner;
    if (owner !== address) continue;
    const mint = q?.mint ?? p?.mint;
    if (!mint) continue;
    const preAmt = p ? Number(p.uiTokenAmount?.uiAmountString ?? p.uiTokenAmount?.uiAmount ?? 0) : 0;
    const postAmt = q ? Number(q.uiTokenAmount?.uiAmountString ?? q.uiTokenAmount?.uiAmount ?? 0) : 0;
    const diff = postAmt - preAmt;
    if (Math.abs(diff) < 1e-9) continue;
    const meta = tokenMeta[mint.toLowerCase()];
    out.push({
      hash: sig.signature,
      counterparty: "",
      value: plainAmount(Math.abs(diff)),
      symbol: meta?.symbol || shortMint(mint),
      timestamp: ts,
      type: diff < 0 ? "sent" : "received",
      explorerUrl, chainName: "Solana", chainId: "solana",
      assetAddr: mint.toLowerCase(),
    });
  }

  // ── Native SOL change. Suppress fee/rent noise when the tx is really an SPL
  //    transfer (a token op still moves a little SOL for fees + ATA rent). ──
  if (myIdx >= 0) {
    const preL = tx.meta?.preBalances?.[myIdx] ?? 0;
    const postL = tx.meta?.postBalances?.[myIdx] ?? 0;
    const diffL = postL - preL;
    const threshold = out.length > 0 ? 5_000_000 : 5000; // ~0.005 SOL if a token also moved
    if (Math.abs(diffL) >= threshold) {
      let counterparty = "";
      for (let i = 0; i < keys.length; i++) {
        if (i === myIdx) continue;
        const d = diffL < 0
          ? (tx.meta?.postBalances?.[i] ?? 0) - (tx.meta?.preBalances?.[i] ?? 0)
          : (tx.meta?.preBalances?.[i] ?? 0) - (tx.meta?.postBalances?.[i] ?? 0);
        if (d > 0) { counterparty = keys[i]; break; }
      }
      out.push({
        hash: sig.signature, counterparty,
        value: plainAmount(Math.abs(diffL) / 1e9), symbol: "SOL",
        timestamp: ts, type: diffL < 0 ? "sent" : "received",
        explorerUrl, chainName: "Solana", chainId: "solana",
      });
    }
  }

  return out;
}

async function fetchSolana(address: string, tokenMeta: TokenMeta): Promise<TxRecord[]> {
  const rpc = SOL_RPC;
  try {
    const sigData = await fetch(rpc, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [address, { limit: 14 }] }),
    }).then((r) => r.json());
    const sigs: any[] = sigData?.result || [];

    const results = await Promise.all(sigs.map(async (sig): Promise<TxRecord[]> => {
      try {
        const txData = await fetch(rpc, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] }),
        }).then((r) => r.json());
        const tx = txData?.result;
        if (!tx) return [];
        return parseSolanaTx(tx, address, sig, tokenMeta);
      } catch { return []; }
    }));

    return results.flat();
  } catch { return []; }
}

// ── XRP ─────────────────────────────────────────────────────────────────────────

async function fetchXrp(address: string): Promise<TxRecord[]> {
  try {
    const data = await fetch("https://xrplcluster.com", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "account_tx", params: [{ account: address, limit: 20 }] }),
    }).then((r) => r.json());
    const XRP_EPOCH = 946684800;
    return (data?.result?.transactions || []).flatMap((entry: any): TxRecord[] => {
      const tx = entry.tx || entry;
      if (tx.TransactionType !== "Payment" || typeof tx.Amount !== "string") return [];
      const isSent = tx.Account === address;
      if (!tx.hash) return [];
      return [{
        hash: tx.hash,
        counterparty: isSent ? (tx.Destination || "") : (tx.Account || ""),
        value: (parseInt(tx.Amount) / 1e6).toFixed(4), symbol: "XRP",
        timestamp: tx.date ? (tx.date + XRP_EPOCH) * 1000 : 0,
        type: isSent ? "sent" : "received",
        explorerUrl: `https://xrpscan.com/tx/${tx.hash}`,
        chainName: "XRP Ledger", chainId: "xrp",
      }];
    });
  } catch { return []; }
}

// ── Tron: native TRX + TRC-20 ─────────────────────────────────────────────────────

async function fetchTron(address: string): Promise<TxRecord[]> {
  const out: TxRecord[] = [];
  const myHex = tronAddrToHex(address);

  // Native TRX
  try {
    const data = await fetch(
      `https://api.trongrid.io/v1/accounts/${address}/transactions?limit=20&order_by=block_timestamp%2Cdesc`
    ).then((r) => r.json());
    for (const tx of (data?.data || []).slice(0, 20)) {
      const contract = tx.raw_data?.contract?.[0];
      if (!contract || contract.type !== "TransferContract") continue;
      const val = contract.parameter?.value;
      if (!val?.amount) continue;
      const isSent = myHex ? val.owner_address === myHex : false;
      out.push({
        hash: tx.txID,
        counterparty: isSent ? (val.to_address || "") : (val.owner_address || ""),
        value: (val.amount / 1e6).toFixed(4), symbol: "TRX",
        timestamp: tx.block_timestamp || 0,
        type: isSent ? "sent" : "received",
        explorerUrl: `https://tronscan.org/#/transaction/${tx.txID}`,
        chainName: "Tron", chainId: "tron",
      });
    }
  } catch { /* keep any TRC-20 we got */ }

  // TRC-20 token transfers (USDT on Tron is the common case)
  try {
    const data = await fetch(
      `https://api.trongrid.io/v1/accounts/${address}/transactions/trc20?limit=20&only_confirmed=true`
    ).then((r) => r.json());
    for (const tx of (data?.data || []).slice(0, 20)) {
      if (!tx.value || !tx.token_info) continue;
      const dec = Number(tx.token_info.decimals ?? 6);
      const isSent = tx.from === address;
      out.push({
        hash: tx.transaction_id,
        counterparty: isSent ? (tx.to || "") : (tx.from || ""),
        value: plainAmount(Number(tx.value) / Math.pow(10, dec)),
        symbol: tx.token_info.symbol || "TRC20",
        timestamp: tx.block_timestamp || 0,
        type: isSent ? "sent" : "received",
        explorerUrl: `https://tronscan.org/#/transaction/${tx.transaction_id}`,
        chainName: "Tron", chainId: "tron",
        assetAddr: tx.token_info.address ? String(tx.token_info.address).toLowerCase() : undefined,
      });
    }
  } catch { /* native already collected */ }

  return out.sort((a, b) => b.timestamp - a.timestamp).slice(0, 25);
}

// ── Sui ─────────────────────────────────────────────────────────────────────────

async function fetchSui(address: string): Promise<TxRecord[]> {
  try {
    const rpc = "https://fullnode.mainnet.sui.io";
    const opts = { method: "POST", headers: { "Content-Type": "application/json" } };
    const [sentR, recvR] = await Promise.all([
      fetch(rpc, { ...opts, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_queryTransactionBlocks", params: [{ filter: { FromAddress: address }, options: { showBalanceChanges: true } }, null, 12, true] }) }).then((r) => r.json()).catch(() => null),
      fetch(rpc, { ...opts, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "suix_queryTransactionBlocks", params: [{ filter: { ToAddress: address }, options: { showBalanceChanges: true } }, null, 12, true] }) }).then((r) => r.json()).catch(() => null),
    ]);
    const seen = new Set<string>();
    const records: TxRecord[] = [];
    const parse = (blocks: any[], type: "sent" | "received") => {
      for (const block of blocks || []) {
        if (seen.has(block.digest)) continue;
        seen.add(block.digest);
        const change = (block.balanceChanges || []).find((c: any) =>
          c.owner?.AddressOwner === address && c.coinType?.includes("::sui::SUI")
        );
        if (!change) continue;
        const amount = parseInt(change.amount || "0");
        if (Math.abs(amount) < 10_000) continue;
        records.push({
          hash: block.digest, counterparty: "",
          value: (Math.abs(amount) / 1e9).toFixed(6), symbol: "SUI",
          timestamp: block.timestampMs ? parseInt(block.timestampMs) : 0,
          type,
          explorerUrl: `https://suiscan.xyz/mainnet/tx/${block.digest}`,
          chainName: "Sui", chainId: "sui",
        });
      }
    };
    parse(sentR?.result?.data, "sent");
    parse(recvR?.result?.data, "received");
    return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
  } catch { return []; }
}

// ── Public API ────────────────────────────────────────────────────────────────────

// Fetch one chain's history. `evmAddress` is used for all EVM chains; non-EVM
// addresses come from `nonEvmWallet[chainId].address`. `solTokenMeta` lets SPL
// rows show a real symbol instead of a shortened mint.
export async function fetchChainHistory(
  chainId: string,
  evmAddress: string,
  nonEvmWallet: any | null,
  solTokenMeta: TokenMeta = {},
): Promise<TxRecord[]> {
  return coalesceSwaps(await fetchChainHistoryRaw(chainId, evmAddress, nonEvmWallet, solTokenMeta));
}

async function fetchChainHistoryRaw(
  chainId: string,
  evmAddress: string,
  nonEvmWallet: any | null,
  solTokenMeta: TokenMeta,
): Promise<TxRecord[]> {
  try {
    if (ALCHEMY_NETS[chainId]) return await fetchAlchemy(chainId, evmAddress);
    // Moralis is the working source for these chains; fall back to the (mostly
    // deprecated) block-explorer API only when there is no Moralis key.
    if (MORALIS_CHAINS[chainId] && MORALIS_KEY) return await fetchMoralis(chainId, evmAddress);
    if (SCAN_APIS[chainId]) return await fetchScan(chainId, evmAddress);

    const addr = nonEvmWallet?.[chainId]?.address;
    if (!addr) return [];
    if (chainId === "bitcoin") return await fetchUtxo(addr, "https://blockstream.info/api", "https://blockstream.info", "BTC", "bitcoin");
    if (chainId === "litecoin") return await fetchUtxo(addr, "https://litecoinspace.org/api", "https://litecoinspace.org", "LTC", "litecoin");
    if (chainId === "solana") return await fetchSolana(addr, solTokenMeta);
    if (chainId === "xrp") return await fetchXrp(addr);
    if (chainId === "tron") return await fetchTron(addr);
    if (chainId === "sui") return await fetchSui(addr);
    return [];
  } catch {
    return [];
  }
}

// Fetch every supported chain and merge, newest first.
export async function fetchAllChains(
  evmAddress: string,
  nonEvmWallet: any | null,
  solTokenMeta: TokenMeta = {},
): Promise<TxRecord[]> {
  const jobs: Promise<TxRecord[]>[] = [];
  for (const chainId of Object.keys(ALCHEMY_NETS)) jobs.push(fetchChainHistoryRaw(chainId, evmAddress, null, solTokenMeta));
  for (const chainId of Object.keys(SCAN_APIS)) jobs.push(fetchChainHistoryRaw(chainId, evmAddress, null, solTokenMeta));
  if (nonEvmWallet) {
    for (const chainId of ["bitcoin", "litecoin", "solana", "xrp", "tron", "sui"]) {
      jobs.push(fetchChainHistoryRaw(chainId, evmAddress, nonEvmWallet, solTokenMeta));
    }
  }
  // Coalesce once over the whole set (groups by chain+hash, so cross-chain is
  // safe), then dedupe and cap.
  const all = coalesceSwaps((await Promise.all(jobs)).flat());
  const seen = new Set<string>();
  return all
    .filter((tx) => { const k = `${tx.chainId}-${tx.hash}-${tx.assetAddr || "native"}`; if (seen.has(k)) return false; seen.add(k); return true; })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 60);
}

// Build a mint/contract -> {symbol,decimals} map from the wallet's known tokens
// on a chain, for labelling SPL/token rows.
export function tokenMetaFromList(tokens: { symbol: string; address: string; decimals?: number }[] | undefined): TokenMeta {
  const m: TokenMeta = {};
  for (const t of tokens || []) {
    if (t.address) m[t.address.toLowerCase()] = { symbol: t.symbol, decimals: t.decimals };
  }
  return m;
}
