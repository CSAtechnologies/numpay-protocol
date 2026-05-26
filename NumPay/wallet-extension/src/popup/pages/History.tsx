import { useState, useEffect, useCallback } from "react";
import { useWallet } from "../hooks/useWallet";
import Layout from "../components/Layout";
import { SendIcon, ReceiveIcon, ExternalLinkIcon, RefreshIcon, ActivityIcon, ChainIcon } from "../components/Icons";
import { NETWORKS } from "@/lib/networks";

const ALCHEMY_KEY = "REDACTED_ROTATE_ME";

const ALCHEMY_NETS: Record<string, string> = {
  ethereum: "eth-mainnet",
  polygon:  "polygon-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
  base:     "base-mainnet",
};

const SCAN_APIS: Record<string, string> = {
  bsc:       "https://api.bscscan.com/api",
  avalanche: "https://api.snowscan.xyz/api",
  fantom:    "https://api.ftmscan.com/api",
  cronos:    "https://api.cronoscan.com/api",
  gnosis:    "https://api.gnosisscan.io/api",
  moonbeam:  "https://api-moonbeam.moonscan.io/api",
  celo:      "https://api.celoscan.io/api",
  scroll:    "https://api.scrollscan.com/api",
  linea:     "https://api.lineascan.build/api",
  mantle:    "https://api.mantlescan.xyz/api",
  blast:     "https://api.blastscan.io/api",
};

const NON_EVM_NAMES: Record<string, string> = {
  bitcoin: "Bitcoin", solana: "Solana", sui: "Sui",
  tron: "Tron", xrp: "XRP Ledger", litecoin: "Litecoin",
};

interface TxRecord {
  hash: string;
  counterparty: string;
  value: string;
  symbol: string;
  timestamp: number;
  type: "sent" | "received";
  explorerUrl: string;
  chainName?: string;
  chainId?: string;
}

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

// ── Fetchers ──────────────────────────────────────────────────────────────────

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
      withMetadata: true, maxCount: "0x14", order: "desc",
    }],
  });

  const [sentR, recvR] = await Promise.all([
    fetch(url, { ...opts, body: body("from") }).then(r => r.json()).catch(() => null),
    fetch(url, { ...opts, body: body("to")   }).then(r => r.json()).catch(() => null),
  ]);

  const records: TxRecord[] = [];
  const seen = new Set<string>();

  const push = (transfers: any[], type: "sent" | "received") => {
    for (const tx of transfers || []) {
      if (seen.has(tx.hash)) continue;
      seen.add(tx.hash);
      const ts = tx.metadata?.blockTimestamp
        ? new Date(tx.metadata.blockTimestamp).getTime() : 0;
      records.push({
        hash: tx.hash,
        counterparty: type === "sent" ? (tx.to || "") : (tx.from || ""),
        value: tx.value != null ? parseFloat(tx.value).toFixed(6) : "0",
        symbol: tx.asset || net?.symbol || "",
        timestamp: ts, type,
        explorerUrl: `${net?.explorer}/tx/${tx.hash}`,
        chainName: net?.name, chainId,
      });
    }
  };

  push(sentR?.result?.transfers, "sent");
  push(recvR?.result?.transfers, "received");
  return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, 25);
}

async function fetchScan(chainId: string, address: string): Promise<TxRecord[]> {
  const base = SCAN_APIS[chainId];
  if (!base) return [];
  const net = NETWORKS[chainId];
  try {
    const data = await fetch(
      `${base}?module=account&action=txlist&address=${address}&page=1&offset=20&sort=desc`
    ).then(r => r.json());
    if (data.status !== "1" || !Array.isArray(data.result)) return [];
    const addr = address.toLowerCase();
    return data.result.map((tx: any) => {
      const isSent = tx.from?.toLowerCase() === addr;
      return {
        hash: tx.hash,
        counterparty: isSent ? tx.to : tx.from,
        value: (parseInt(tx.value || "0") / 1e18).toFixed(6),
        symbol: net?.symbol || "",
        timestamp: parseInt(tx.timeStamp || "0") * 1000,
        type: isSent ? "sent" : "received",
        explorerUrl: `${net?.explorer}/tx/${tx.hash}`,
        chainName: net?.name, chainId,
      } as TxRecord;
    });
  } catch { return []; }
}

async function fetchBitcoin(address: string): Promise<TxRecord[]> {
  try {
    const txs = await fetch(`https://blockstream.info/api/address/${address}/txs`).then(r => r.json());
    return (txs || []).slice(0, 20).map((tx: any): TxRecord => {
      const inputs: string[] = tx.vin.map((v: any) => v.prevout?.scriptpubkey_address || "");
      const isSent = inputs.includes(address);
      const ts = (tx.status?.block_time || 0) * 1000;
      if (isSent) {
        const amt = tx.vout.filter((v: any) => v.scriptpubkey_address !== address).reduce((s: number, v: any) => s + (v.value || 0), 0);
        const to = tx.vout.find((v: any) => v.scriptpubkey_address !== address)?.scriptpubkey_address || "";
        return { hash: tx.txid, counterparty: to, value: (amt / 1e8).toFixed(8), symbol: "BTC", timestamp: ts, type: "sent", explorerUrl: `https://blockstream.info/tx/${tx.txid}`, chainName: "Bitcoin", chainId: "bitcoin" };
      } else {
        const amt = tx.vout.filter((v: any) => v.scriptpubkey_address === address).reduce((s: number, v: any) => s + (v.value || 0), 0);
        const from = inputs.find(a => a && a !== address) || "";
        return { hash: tx.txid, counterparty: from, value: (amt / 1e8).toFixed(8), symbol: "BTC", timestamp: ts, type: "received", explorerUrl: `https://blockstream.info/tx/${tx.txid}`, chainName: "Bitcoin", chainId: "bitcoin" };
      }
    });
  } catch { return []; }
}

async function fetchLitecoin(address: string): Promise<TxRecord[]> {
  try {
    const txs = await fetch(`https://litecoinspace.org/api/address/${address}/txs`).then(r => r.json());
    return (txs || []).slice(0, 20).map((tx: any): TxRecord => {
      const inputs: string[] = tx.vin.map((v: any) => v.prevout?.scriptpubkey_address || "");
      const isSent = inputs.includes(address);
      const ts = (tx.status?.block_time || 0) * 1000;
      if (isSent) {
        const amt = tx.vout.filter((v: any) => v.scriptpubkey_address !== address).reduce((s: number, v: any) => s + (v.value || 0), 0);
        const to = tx.vout.find((v: any) => v.scriptpubkey_address !== address)?.scriptpubkey_address || "";
        return { hash: tx.txid, counterparty: to, value: (amt / 1e8).toFixed(8), symbol: "LTC", timestamp: ts, type: "sent", explorerUrl: `https://litecoinspace.org/tx/${tx.txid}`, chainName: "Litecoin", chainId: "litecoin" };
      } else {
        const amt = tx.vout.filter((v: any) => v.scriptpubkey_address === address).reduce((s: number, v: any) => s + (v.value || 0), 0);
        const from = inputs.find(a => a && a !== address) || "";
        return { hash: tx.txid, counterparty: from, value: (amt / 1e8).toFixed(8), symbol: "LTC", timestamp: ts, type: "received", explorerUrl: `https://litecoinspace.org/tx/${tx.txid}`, chainName: "Litecoin", chainId: "litecoin" };
      }
    });
  } catch { return []; }
}

async function fetchSolana(address: string): Promise<TxRecord[]> {
  const rpc = `https://solana-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
  try {
    const sigData = await fetch(rpc, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [address, { limit: 12 }] }),
    }).then(r => r.json());

    const sigs: any[] = sigData?.result || [];

    const results = await Promise.all(sigs.map(async (sig): Promise<TxRecord | null> => {
      try {
        const txData = await fetch(rpc, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] }),
        }).then(r => r.json());
        const tx = txData?.result;
        if (!tx) return null;

        const keys: string[] = (tx.transaction.message.accountKeys || []).map((k: any) =>
          typeof k === "string" ? k : (k.pubkey || "")
        );
        const myIdx = keys.findIndex(k => k === address);
        if (myIdx < 0) return null;

        const pre  = tx.meta?.preBalances?.[myIdx]  ?? 0;
        const post = tx.meta?.postBalances?.[myIdx] ?? 0;
        const diff = post - pre;
        if (Math.abs(diff) < 5000) return null;

        let counterparty = "";
        for (let i = 0; i < keys.length; i++) {
          if (i === myIdx) continue;
          const d = diff < 0
            ? (tx.meta?.postBalances?.[i] ?? 0) - (tx.meta?.preBalances?.[i] ?? 0)
            : (tx.meta?.preBalances?.[i] ?? 0)  - (tx.meta?.postBalances?.[i] ?? 0);
          if (d > 0) { counterparty = keys[i]; break; }
        }

        return {
          hash: sig.signature, counterparty,
          value: (Math.abs(diff) / 1e9).toFixed(6), symbol: "SOL",
          timestamp: (sig.blockTime || 0) * 1000,
          type: diff < 0 ? "sent" : "received",
          explorerUrl: `https://solscan.io/tx/${sig.signature}`,
          chainName: "Solana", chainId: "solana",
        };
      } catch { return null; }
    }));

    return results.filter(Boolean) as TxRecord[];
  } catch { return []; }
}

async function fetchXrp(address: string): Promise<TxRecord[]> {
  try {
    const data = await fetch("https://xrplcluster.com", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ method: "account_tx", params: [{ account: address, limit: 20 }] }),
    }).then(r => r.json());

    const XRP_EPOCH = 946684800;
    return (data?.result?.transactions || []).flatMap((entry: any): TxRecord[] => {
      const tx = entry.tx || entry;
      if (tx.TransactionType !== "Payment" || typeof tx.Amount !== "string") return [];
      const isSent = tx.Account === address;
      const amount = parseInt(tx.Amount) / 1e6;
      if (!tx.hash) return [];
      return [{
        hash: tx.hash,
        counterparty: isSent ? (tx.Destination || "") : (tx.Account || ""),
        value: amount.toFixed(4), symbol: "XRP",
        timestamp: tx.date ? (tx.date + XRP_EPOCH) * 1000 : 0,
        type: isSent ? "sent" : "received",
        explorerUrl: `https://xrpscan.com/tx/${tx.hash}`,
        chainName: "XRP Ledger", chainId: "xrp",
      }];
    });
  } catch { return []; }
}

async function fetchTron(address: string): Promise<TxRecord[]> {
  try {
    const myHex = tronAddrToHex(address);
    const data = await fetch(
      `https://api.trongrid.io/v1/accounts/${address}/transactions?limit=20&order_by=block_timestamp%2Cdesc`
    ).then(r => r.json());

    return (data?.data || []).slice(0, 20).flatMap((tx: any): TxRecord[] => {
      const contract = tx.raw_data?.contract?.[0];
      if (!contract || contract.type !== "TransferContract") return [];
      const val = contract.parameter?.value;
      if (!val?.amount) return [];
      const isSent = myHex ? val.owner_address === myHex : false;
      return [{
        hash: tx.txID,
        counterparty: isSent ? (val.to_address || "") : (val.owner_address || ""),
        value: (val.amount / 1e6).toFixed(4), symbol: "TRX",
        timestamp: tx.block_timestamp || 0,
        type: isSent ? "sent" : "received",
        explorerUrl: `https://tronscan.org/#/transaction/${tx.txID}`,
        chainName: "Tron", chainId: "tron",
      }];
    });
  } catch { return []; }
}

async function fetchSui(address: string): Promise<TxRecord[]> {
  try {
    const rpc = "https://fullnode.mainnet.sui.io";
    const opts = { method: "POST", headers: { "Content-Type": "application/json" } };

    const [sentR, recvR] = await Promise.all([
      fetch(rpc, { ...opts, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_queryTransactionBlocks", params: [{ filter: { FromAddress: address }, options: { showBalanceChanges: true } }, null, 12, true] }) }).then(r => r.json()).catch(() => null),
      fetch(rpc, { ...opts, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "suix_queryTransactionBlocks", params: [{ filter: { ToAddress: address },   options: { showBalanceChanges: true } }, null, 12, true] }) }).then(r => r.json()).catch(() => null),
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

// ── Helpers ───────────────────────────────────────────────────────────────────

const SUPPORTED = new Set([
  ...Object.keys(ALCHEMY_NETS),
  ...Object.keys(SCAN_APIS),
  "bitcoin", "litecoin", "solana", "xrp", "tron", "sui",
]);

async function fetchAllChains(evmAddress: string, nonEvmWallet: any | null): Promise<TxRecord[]> {
  const jobs: Promise<TxRecord[]>[] = [];

  // All Alchemy EVM chains
  for (const chainId of Object.keys(ALCHEMY_NETS)) {
    jobs.push(fetchAlchemy(chainId, evmAddress).catch(() => []));
  }
  // All scan-API EVM chains
  for (const chainId of Object.keys(SCAN_APIS)) {
    jobs.push(fetchScan(chainId, evmAddress).catch(() => []));
  }
  // Non-EVM (only if addresses are available)
  if (nonEvmWallet) {
    jobs.push(fetchBitcoin(nonEvmWallet.bitcoin.address).catch(() => []));
    jobs.push(fetchLitecoin(nonEvmWallet.litecoin.address).catch(() => []));
    jobs.push(fetchSolana(nonEvmWallet.solana.address).catch(() => []));
    jobs.push(fetchXrp(nonEvmWallet.xrp.address).catch(() => []));
    jobs.push(fetchTron(nonEvmWallet.tron.address).catch(() => []));
    jobs.push(fetchSui(nonEvmWallet.sui.address).catch(() => []));
  }

  const results = await Promise.all(jobs);
  const all = results.flat();

  // Deduplicate by hash, sort newest first, cap at 50
  const seen = new Set<string>();
  return all
    .filter((tx) => { if (seen.has(tx.hash)) return false; seen.add(tx.hash); return true; })
    .sort((a, b) => b.timestamp - a.timestamp)
    .slice(0, 50);
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function History() {
  const { wallet, activeChainId, activeAddress, filterChainId, nonEvmWallet } = useWallet();
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [loading, setLoading] = useState(true);

  const isAllChains = filterChainId === null;
  const displayChainId = isAllChains ? activeChainId : filterChainId;
  const chainName = isAllChains ? "All Assets" : (NETWORKS[displayChainId]?.name ?? NON_EVM_NAMES[displayChainId] ?? displayChainId);
  const isSupported = isAllChains || SUPPORTED.has(displayChainId);
  const explorerBase = !isAllChains && NETWORKS[displayChainId]?.explorer
    ? `${NETWORKS[displayChainId].explorer}/address/${activeAddress}`
    : null;

  const fetchHistory = useCallback(async () => {
    if (!activeAddress && !wallet?.address) { setLoading(false); return; }
    setLoading(true);
    try {
      let records: TxRecord[] = [];

      if (isAllChains) {
        records = await fetchAllChains(wallet?.address || "", nonEvmWallet);
      } else {
        const addr = activeAddress;
        if      (ALCHEMY_NETS[displayChainId])      records = await fetchAlchemy(displayChainId, addr);
        else if (SCAN_APIS[displayChainId])         records = await fetchScan(displayChainId, addr);
        else if (displayChainId === "bitcoin")      records = await fetchBitcoin(addr);
        else if (displayChainId === "litecoin")     records = await fetchLitecoin(addr);
        else if (displayChainId === "solana")       records = await fetchSolana(addr);
        else if (displayChainId === "xrp")          records = await fetchXrp(addr);
        else if (displayChainId === "tron")         records = await fetchTron(addr);
        else if (displayChainId === "sui")          records = await fetchSui(addr);
      }

      setTxs(records);
    } catch {
      setTxs([]);
    } finally {
      setLoading(false);
    }
  }, [isAllChains, displayChainId, activeAddress, wallet?.address, nonEvmWallet]);

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
                  key={`${tx.chainId}-${tx.hash}`}
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
                    {/* Chain badge — shown in All Assets mode */}
                    {isAllChains && tx.chainId && (
                      <div className="absolute -bottom-0.5 -right-0.5 w-[14px] h-[14px] rounded-full overflow-hidden ring-1 ring-surface-0">
                        {NETWORKS[tx.chainId] ? (
                          <ChainIcon chainId={tx.chainId} logo={NETWORKS[tx.chainId].logo} size={14} />
                        ) : (
                          <div className="w-full h-full bg-surface-3 flex items-center justify-center">
                            <span className="text-[6px] font-bold text-muted">{tx.symbol.slice(0,1)}</span>
                          </div>
                        )}
                      </div>
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
