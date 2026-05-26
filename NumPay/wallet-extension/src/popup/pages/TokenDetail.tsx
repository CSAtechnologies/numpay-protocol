import { useState, useEffect, useCallback } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useWallet } from "../hooks/useWallet";
import { useCurrency } from "../hooks/useCurrency";
import Layout from "../components/Layout";
import {
  ArrowLeftIcon, SendIcon, ReceiveIcon, ExternalLinkIcon,
  TrendingUpIcon, TokenIcon, ChainIcon, RefreshIcon,
} from "../components/Icons";
import { NETWORKS } from "@/lib/networks";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface TokenDetailState {
  symbol: string;
  name: string;
  logo?: string;
  balance: string;
  usdValue: number;
  chainName?: string;
  chainId?: string;
  isNative: boolean;
}

interface MarketData {
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  circulating_supply: number;
  ath: number;
}

interface TxRecord {
  hash: string;
  counterparty: string;
  value: string;
  symbol: string;
  timestamp: number;
  type: "sent" | "received";
  explorerUrl: string;
  chainName?: string;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SYMBOL_TO_COINGECKO: Record<string, string> = {
  ETH: "ethereum", BTC: "bitcoin", SOL: "solana", SUI: "sui",
  MATIC: "matic-network", POL: "matic-network",
  AVAX: "avalanche-2", BNB: "binancecoin", FTM: "fantom",
  MNT: "mantle", SEI: "sei-network",
  TRX: "tron", XRP: "ripple", LTC: "litecoin",
};

const RANGES = [
  { label: "1D", days: 1 },
  { label: "7D", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
] as const;

const ALCHEMY_KEY = "REDACTED_ROTATE_ME";
const ALCHEMY_NETS: Record<string, string> = {
  ethereum: "eth-mainnet", polygon: "polygon-mainnet",
  arbitrum: "arb-mainnet", optimism: "opt-mainnet", base: "base-mainnet",
};
const SCAN_APIS: Record<string, string> = {
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

// ── Chart ─────────────────────────────────────────────────────────────────────

function PriceChart({ prices, isUp }: { prices: [number, number][]; isUp: boolean }) {
  if (!prices || prices.length < 2) {
    return <div className="h-[110px] rounded-xl bg-surface-2 animate-pulse" />;
  }

  const vals = prices.map((p) => p[1]);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const range = max - min || 1;
  const W = 320;
  const H = 110;
  const pad = 6;

  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M${pts.join("L")}`;
  const fillD = `${pathD}L${W},${H}L0,${H}Z`;
  const stroke = isUp ? "#22c55e" : "#ef4444";
  const fill = isUp ? "rgba(34,197,94,0.10)" : "rgba(239,68,68,0.10)";

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 110 }} preserveAspectRatio="none">
      <defs>
        <linearGradient id="chartFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.18" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={fillD} fill="url(#chartFill)" />
      <path d={pathD} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" />
    </svg>
  );
}

// ── Transaction fetchers (single-chain) ───────────────────────────────────────

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || "Unknown";
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`;
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

async function fetchForChain(
  chainId: string,
  evmAddress: string,
  nonEvmWallet: any,
): Promise<TxRecord[]> {
  try {
    if (ALCHEMY_NETS[chainId]) {
      const sub = ALCHEMY_NETS[chainId];
      const net = NETWORKS[chainId];
      const url = `https://${sub}.g.alchemy.com/v2/${ALCHEMY_KEY}`;
      const opts = { method: "POST", headers: { "Content-Type": "application/json" } };
      const body = (dir: "from" | "to") => JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "alchemy_getAssetTransfers",
        params: [{ fromBlock: "0x0", toBlock: "latest",
          [dir === "from" ? "fromAddress" : "toAddress"]: evmAddress,
          category: ["external", "internal", "erc20"],
          withMetadata: true, maxCount: "0x14", order: "desc" }],
      });
      const [sentR, recvR] = await Promise.all([
        fetch(url, { ...opts, body: body("from") }).then((r) => r.json()).catch(() => null),
        fetch(url, { ...opts, body: body("to") }).then((r) => r.json()).catch(() => null),
      ]);
      const seen = new Set<string>();
      const records: TxRecord[] = [];
      const push = (transfers: any[], type: "sent" | "received") => {
        for (const tx of transfers || []) {
          if (seen.has(tx.hash)) continue;
          seen.add(tx.hash);
          const ts = tx.metadata?.blockTimestamp ? new Date(tx.metadata.blockTimestamp).getTime() : 0;
          records.push({
            hash: tx.hash,
            counterparty: type === "sent" ? (tx.to || "") : (tx.from || ""),
            value: tx.value != null ? parseFloat(tx.value).toFixed(6) : "0",
            symbol: tx.asset || net?.symbol || "",
            timestamp: ts, type,
            explorerUrl: `${net?.explorer}/tx/${tx.hash}`,
            chainName: net?.name,
          });
        }
      };
      push(sentR?.result?.transfers, "sent");
      push(recvR?.result?.transfers, "received");
      return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, 25);
    }

    if (SCAN_APIS[chainId]) {
      const base = SCAN_APIS[chainId];
      const net = NETWORKS[chainId];
      const data = await fetch(
        `${base}?module=account&action=txlist&address=${evmAddress}&page=1&offset=20&sort=desc`
      ).then((r) => r.json());
      if (data.status !== "1" || !Array.isArray(data.result)) return [];
      const addr = evmAddress.toLowerCase();
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
          chainName: net?.name,
        } as TxRecord;
      });
    }

    const addr = nonEvmWallet?.[chainId]?.address;
    if (!addr) return [];

    if (chainId === "bitcoin") {
      const txs = await fetch(`https://blockstream.info/api/address/${addr}/txs`).then((r) => r.json());
      return (txs || []).slice(0, 20).map((tx: any): TxRecord => {
        const inputs: string[] = tx.vin.map((v: any) => v.prevout?.scriptpubkey_address || "");
        const isSent = inputs.includes(addr);
        const ts = (tx.status?.block_time || 0) * 1000;
        if (isSent) {
          const amt = tx.vout.filter((v: any) => v.scriptpubkey_address !== addr).reduce((s: number, v: any) => s + (v.value || 0), 0);
          const to = tx.vout.find((v: any) => v.scriptpubkey_address !== addr)?.scriptpubkey_address || "";
          return { hash: tx.txid, counterparty: to, value: (amt / 1e8).toFixed(8), symbol: "BTC", timestamp: ts, type: "sent", explorerUrl: `https://blockstream.info/tx/${tx.txid}`, chainName: "Bitcoin" };
        }
        const amt = tx.vout.filter((v: any) => v.scriptpubkey_address === addr).reduce((s: number, v: any) => s + (v.value || 0), 0);
        const from = inputs.find((a) => a && a !== addr) || "";
        return { hash: tx.txid, counterparty: from, value: (amt / 1e8).toFixed(8), symbol: "BTC", timestamp: ts, type: "received", explorerUrl: `https://blockstream.info/tx/${tx.txid}`, chainName: "Bitcoin" };
      });
    }

    if (chainId === "litecoin") {
      const txs = await fetch(`https://litecoinspace.org/api/address/${addr}/txs`).then((r) => r.json());
      return (txs || []).slice(0, 20).map((tx: any): TxRecord => {
        const inputs: string[] = tx.vin.map((v: any) => v.prevout?.scriptpubkey_address || "");
        const isSent = inputs.includes(addr);
        const ts = (tx.status?.block_time || 0) * 1000;
        if (isSent) {
          const amt = tx.vout.filter((v: any) => v.scriptpubkey_address !== addr).reduce((s: number, v: any) => s + (v.value || 0), 0);
          const to = tx.vout.find((v: any) => v.scriptpubkey_address !== addr)?.scriptpubkey_address || "";
          return { hash: tx.txid, counterparty: to, value: (amt / 1e8).toFixed(8), symbol: "LTC", timestamp: ts, type: "sent", explorerUrl: `https://litecoinspace.org/tx/${tx.txid}`, chainName: "Litecoin" };
        }
        const amt = tx.vout.filter((v: any) => v.scriptpubkey_address === addr).reduce((s: number, v: any) => s + (v.value || 0), 0);
        const from = inputs.find((a) => a && a !== addr) || "";
        return { hash: tx.txid, counterparty: from, value: (amt / 1e8).toFixed(8), symbol: "LTC", timestamp: ts, type: "received", explorerUrl: `https://litecoinspace.org/tx/${tx.txid}`, chainName: "Litecoin" };
      });
    }

    if (chainId === "solana") {
      const rpc = `https://solana-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;
      const sigData = await fetch(rpc, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getSignaturesForAddress", params: [addr, { limit: 12 }] }),
      }).then((r) => r.json());
      const sigs: any[] = sigData?.result || [];
      const results = await Promise.all(sigs.map(async (sig): Promise<TxRecord | null> => {
        try {
          const txData = await fetch(rpc, {
            method: "POST", headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTransaction", params: [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }] }),
          }).then((r) => r.json());
          const tx = txData?.result;
          if (!tx) return null;
          const keys: string[] = (tx.transaction.message.accountKeys || []).map((k: any) => typeof k === "string" ? k : (k.pubkey || ""));
          const myIdx = keys.findIndex((k) => k === addr);
          if (myIdx < 0) return null;
          const pre = tx.meta?.preBalances?.[myIdx] ?? 0;
          const post = tx.meta?.postBalances?.[myIdx] ?? 0;
          const diff = post - pre;
          if (Math.abs(diff) < 5000) return null;
          let counterparty = "";
          for (let i = 0; i < keys.length; i++) {
            if (i === myIdx) continue;
            const d = diff < 0 ? (tx.meta?.postBalances?.[i] ?? 0) - (tx.meta?.preBalances?.[i] ?? 0) : (tx.meta?.preBalances?.[i] ?? 0) - (tx.meta?.postBalances?.[i] ?? 0);
            if (d > 0) { counterparty = keys[i]; break; }
          }
          return { hash: sig.signature, counterparty, value: (Math.abs(diff) / 1e9).toFixed(6), symbol: "SOL", timestamp: (sig.blockTime || 0) * 1000, type: diff < 0 ? "sent" : "received", explorerUrl: `https://solscan.io/tx/${sig.signature}`, chainName: "Solana" };
        } catch { return null; }
      }));
      return results.filter(Boolean) as TxRecord[];
    }

    if (chainId === "xrp") {
      const data = await fetch("https://xrplcluster.com", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ method: "account_tx", params: [{ account: addr, limit: 20 }] }),
      }).then((r) => r.json());
      const XRP_EPOCH = 946684800;
      return (data?.result?.transactions || []).flatMap((entry: any): TxRecord[] => {
        const tx = entry.tx || entry;
        if (tx.TransactionType !== "Payment" || typeof tx.Amount !== "string") return [];
        const isSent = tx.Account === addr;
        if (!tx.hash) return [];
        return [{ hash: tx.hash, counterparty: isSent ? (tx.Destination || "") : (tx.Account || ""), value: (parseInt(tx.Amount) / 1e6).toFixed(4), symbol: "XRP", timestamp: tx.date ? (tx.date + XRP_EPOCH) * 1000 : 0, type: isSent ? "sent" : "received", explorerUrl: `https://xrpscan.com/tx/${tx.hash}`, chainName: "XRP Ledger" }];
      });
    }

    if (chainId === "tron") {
      const myHex = tronAddrToHex(addr);
      const data = await fetch(`https://api.trongrid.io/v1/accounts/${addr}/transactions?limit=20&order_by=block_timestamp%2Cdesc`).then((r) => r.json());
      return (data?.data || []).slice(0, 20).flatMap((tx: any): TxRecord[] => {
        const contract = tx.raw_data?.contract?.[0];
        if (!contract || contract.type !== "TransferContract") return [];
        const val = contract.parameter?.value;
        if (!val?.amount) return [];
        const isSent = myHex ? val.owner_address === myHex : false;
        return [{ hash: tx.txID, counterparty: isSent ? (val.to_address || "") : (val.owner_address || ""), value: (val.amount / 1e6).toFixed(4), symbol: "TRX", timestamp: tx.block_timestamp || 0, type: isSent ? "sent" : "received", explorerUrl: `https://tronscan.org/#/transaction/${tx.txID}`, chainName: "Tron" }];
      });
    }

    if (chainId === "sui") {
      const rpc = "https://fullnode.mainnet.sui.io";
      const opts = { method: "POST", headers: { "Content-Type": "application/json" } };
      const [sentR, recvR] = await Promise.all([
        fetch(rpc, { ...opts, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_queryTransactionBlocks", params: [{ filter: { FromAddress: addr }, options: { showBalanceChanges: true } }, null, 12, true] }) }).then((r) => r.json()).catch(() => null),
        fetch(rpc, { ...opts, body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "suix_queryTransactionBlocks", params: [{ filter: { ToAddress: addr }, options: { showBalanceChanges: true } }, null, 12, true] }) }).then((r) => r.json()).catch(() => null),
      ]);
      const seen = new Set<string>();
      const records: TxRecord[] = [];
      const parse = (blocks: any[], type: "sent" | "received") => {
        for (const block of blocks || []) {
          if (seen.has(block.digest)) continue;
          seen.add(block.digest);
          const change = (block.balanceChanges || []).find((c: any) => c.owner?.AddressOwner === addr && c.coinType?.includes("::sui::SUI"));
          if (!change) continue;
          const amount = parseInt(change.amount || "0");
          if (Math.abs(amount) < 10_000) continue;
          records.push({ hash: block.digest, counterparty: "", value: (Math.abs(amount) / 1e9).toFixed(6), symbol: "SUI", timestamp: block.timestampMs ? parseInt(block.timestampMs) : 0, type, explorerUrl: `https://suiscan.xyz/mainnet/tx/${block.digest}`, chainName: "Sui" });
        }
      };
      parse(sentR?.result?.data, "sent");
      parse(recvR?.result?.data, "received");
      return records.sort((a, b) => b.timestamp - a.timestamp).slice(0, 20);
    }

    return [];
  } catch {
    return [];
  }
}

// ── Market data ───────────────────────────────────────────────────────────────

async function fetchMarketData(coinId: string): Promise<MarketData | null> {
  try {
    const data = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}?localization=false&tickers=false&community_data=false&developer_data=false`
    ).then((r) => r.json());
    const m = data?.market_data;
    if (!m) return null;
    return {
      current_price: m.current_price?.usd ?? 0,
      price_change_percentage_24h: m.price_change_percentage_24h ?? 0,
      market_cap: m.market_cap?.usd ?? 0,
      total_volume: m.total_volume?.usd ?? 0,
      circulating_supply: m.circulating_supply ?? 0,
      ath: m.ath?.usd ?? 0,
    };
  } catch {
    return null;
  }
}

async function fetchPriceChart(coinId: string, days: number): Promise<[number, number][]> {
  try {
    const data = await fetch(
      `https://api.coingecko.com/api/v3/coins/${coinId}/market_chart?vs_currency=usd&days=${days}`
    ).then((r) => r.json());
    return data?.prices ?? [];
  } catch {
    return [];
  }
}

// ── Formatters ────────────────────────────────────────────────────────────────

function fmtLarge(n: number): string {
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9)  return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6)  return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3)  return `$${(n / 1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function fmtSupply(n: number, symbol: string): string {
  if (n >= 1e9)  return `${(n / 1e9).toFixed(2)}B ${symbol}`;
  if (n >= 1e6)  return `${(n / 1e6).toFixed(2)}M ${symbol}`;
  if (n >= 1e3)  return `${(n / 1e3).toFixed(2)}K ${symbol}`;
  return `${n.toFixed(0)} ${symbol}`;
}

// ── Main component ─────────────────────────────────────────────────────────────

export default function TokenDetail() {
  const navigate = useNavigate();
  const location = useLocation();
  const token = (location.state as TokenDetailState | null);
  const { wallet, activeAddress, nonEvmWallet } = useWallet();
  const { currency } = useCurrency();
  const sym = currency?.symbol || "$";

  const coinId = token ? (SYMBOL_TO_COINGECKO[token.symbol.toUpperCase()] ?? null) : null;

  const [rangeIdx, setRangeIdx] = useState(1); // default 7D
  const [chartPrices, setChartPrices] = useState<[number, number][]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [market, setMarket] = useState<MarketData | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  // Fetch market data once
  useEffect(() => {
    if (!coinId) return;
    setMarketLoading(true);
    fetchMarketData(coinId).then((d) => { setMarket(d); setMarketLoading(false); });
  }, [coinId]);

  // Fetch chart when range changes
  useEffect(() => {
    if (!coinId) return;
    setChartLoading(true);
    fetchPriceChart(coinId, RANGES[rangeIdx].days).then((p) => { setChartPrices(p); setChartLoading(false); });
  }, [coinId, rangeIdx]);

  // Fetch transaction history for this chain
  const loadTxs = useCallback(async () => {
    if (!token?.chainId) return;
    setTxLoading(true);
    const evmAddr = activeAddress || wallet?.address || "";
    const records = await fetchForChain(token.chainId, evmAddr, nonEvmWallet);
    setTxs(records);
    setTxLoading(false);
  }, [token?.chainId, activeAddress, wallet?.address, nonEvmWallet]);

  useEffect(() => { loadTxs(); }, [loadTxs]);

  if (!token) {
    return (
      <Layout>
        <div className="flex flex-col items-center justify-center h-full gap-3 px-4">
          <p className="text-muted text-sm">No token selected.</p>
          <button onClick={() => navigate("/")} className="text-brand-400 text-sm">Go back</button>
        </div>
      </Layout>
    );
  }

  const currentPrice = market?.current_price ?? (token.usdValue / (parseFloat(token.balance) || 1));
  const priceChange = market?.price_change_percentage_24h ?? 0;
  const isUp = priceChange >= 0;
  const balanceNum = parseFloat(token.balance) || 0;
  const balanceUsd = balanceNum * currentPrice;

  const explorerBase = token.chainId && NETWORKS[token.chainId]?.explorer
    ? `${NETWORKS[token.chainId].explorer}/address/${activeAddress}`
    : null;

  return (
    <Layout>
      {/* ── Header ── */}
      <div className="flex items-center gap-3 px-4 pt-4 pb-3">
        <button
          onClick={() => navigate(-1)}
          className="w-8 h-8 rounded-xl flex items-center justify-center text-muted hover:text-text-primary bg-surface-2 border border-border transition-colors flex-shrink-0"
        >
          <ArrowLeftIcon size={15} />
        </button>
        <div className="flex items-center gap-2.5 flex-1 min-w-0">
          <TokenIcon symbol={token.symbol} logo={token.logo} size={32} />
          <div className="min-w-0">
            <p className="text-[14px] font-semibold text-text-primary leading-tight truncate">{token.name}</p>
            <p className="text-[11px] text-muted">{token.chainName}</p>
          </div>
        </div>
        {explorerBase && (
          <a
            href={explorerBase}
            target="_blank"
            rel="noopener noreferrer"
            className="w-8 h-8 rounded-xl flex items-center justify-center text-muted hover:text-brand-400 bg-surface-2 border border-border transition-colors flex-shrink-0"
          >
            <ExternalLinkIcon size={14} />
          </a>
        )}
      </div>

      {/* ── Price + change ── */}
      <div className="px-4 mb-3">
        <div className="flex items-end gap-2.5">
          {marketLoading ? (
            <div className="h-9 w-28 rounded-lg bg-surface-2 animate-pulse" />
          ) : (
            <p className="text-[32px] font-bold tracking-tight gradient-text leading-none">
              {currentPrice >= 1
                ? `$${currentPrice.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `$${currentPrice.toPrecision(4)}`}
            </p>
          )}
          {market && (
            <span
              className="text-[12px] font-semibold pb-0.5"
              style={{ color: isUp ? "#22c55e" : "#ef4444" }}
            >
              {isUp ? "+" : ""}{priceChange.toFixed(2)}%
            </span>
          )}
        </div>
        <p className="text-[11px] text-muted mt-0.5">24h change</p>
      </div>

      {/* ── Price chart ── */}
      <div className="px-4 mb-2">
        <div className="premium-card overflow-hidden p-0">
          <div className="px-3 pt-3 pb-1">
            {chartLoading ? (
              <div className="h-[110px] rounded-lg bg-surface-2 animate-pulse" />
            ) : (
              <PriceChart prices={chartPrices} isUp={isUp} />
            )}
          </div>

          {/* Range selector */}
          <div className="flex border-t border-border/40">
            {RANGES.map((r, i) => (
              <button
                key={r.label}
                onClick={() => setRangeIdx(i)}
                className="flex-1 py-2 text-[11px] font-medium transition-colors"
                style={{
                  color: rangeIdx === i ? "var(--brand-400, #a78bfa)" : "var(--text-muted)",
                  background: rangeIdx === i ? "rgba(167,139,250,0.08)" : "transparent",
                }}
              >
                {r.label}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Your balance ── */}
      <div className="px-4 mb-3">
        <div className="premium-card px-4 py-3">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted mb-2">Your Balance</p>
          <div className="flex items-end justify-between">
            <div>
              <p className="text-[22px] font-bold text-text-primary leading-none">
                {balanceNum >= 0.0001
                  ? balanceNum.toLocaleString("en", { maximumFractionDigits: 6 })
                  : balanceNum.toPrecision(2)}
                <span className="text-[14px] font-medium text-muted ml-1.5">{token.symbol}</span>
              </p>
              <p className="text-[12px] text-muted mt-0.5">
                {sym}{balanceUsd.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            {token.chainId && (
              <ChainIcon chainId={token.chainId} size={28} />
            )}
          </div>
        </div>
      </div>

      {/* ── Actions ── */}
      <div className="px-4 mb-4 grid grid-cols-2 gap-2.5">
        <button
          onClick={() => navigate("/send", { state: { prefillSymbol: token.symbol, prefillChain: token.chainId } })}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold transition-colors"
          style={{
            background: "linear-gradient(135deg, #b5a8ff 0%, #7c6df0 50%, #5b4cdb 100%)",
            color: "#fff",
            border: "none",
            boxShadow: "0 6px 16px -6px rgba(124,109,240,0.7)",
          }}
        >
          <SendIcon size={14} />
          Send
        </button>
        <button
          onClick={() => navigate("/receive")}
          className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold bg-surface-2 border border-border text-text-primary hover:border-brand-500/50 transition-colors"
        >
          <ReceiveIcon size={14} />
          Receive
        </button>
      </div>

      {/* ── Market stats ── */}
      {coinId && (
        <div className="px-4 mb-4">
          <div className="flex items-center gap-1.5 mb-2">
            <TrendingUpIcon size={13} className="text-muted" />
            <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Market Stats</p>
          </div>
          <div className="premium-card p-0 overflow-hidden">
            {marketLoading ? (
              <div className="h-[96px] animate-pulse bg-surface-2" />
            ) : market ? (
              <div className="grid grid-cols-2 divide-x divide-y divide-border/40">
                {[
                  { label: "Market Cap",       value: fmtLarge(market.market_cap) },
                  { label: "24h Volume",        value: fmtLarge(market.total_volume) },
                  { label: "Circulating Supply",value: fmtSupply(market.circulating_supply, token.symbol) },
                  { label: "All-Time High",     value: `$${market.ath.toLocaleString("en", { maximumFractionDigits: 2 })}` },
                ].map((s) => (
                  <div key={s.label} className="px-3.5 py-2.5">
                    <p className="text-[10px] text-muted mb-0.5">{s.label}</p>
                    <p className="text-[12px] font-semibold text-text-primary tabular-nums">{s.value}</p>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-muted text-[12px] text-center py-4">No market data available</p>
            )}
          </div>
        </div>
      )}

      {/* ── Transaction history ── */}
      <div className="px-4 pb-6">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted">Transactions</p>
          <button
            onClick={loadTxs}
            className="p-1.5 rounded-lg text-muted hover:text-brand-400 transition-colors"
          >
            <RefreshIcon size={12} />
          </button>
        </div>

        {txLoading ? (
          <div className="space-y-2">
            {[...Array(3)].map((_, i) => (
              <div key={i} className="token-row opacity-40 animate-pulse">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-surface-3 flex-shrink-0" />
                  <div className="space-y-1.5">
                    <div className="w-16 h-2.5 rounded bg-surface-3" />
                    <div className="w-24 h-2 rounded bg-surface-2" />
                  </div>
                </div>
                <div className="text-right space-y-1.5">
                  <div className="w-14 h-2.5 rounded bg-surface-3 ml-auto" />
                  <div className="w-10 h-2 rounded bg-surface-2 ml-auto" />
                </div>
              </div>
            ))}
          </div>
        ) : txs.length === 0 ? (
          <div className="premium-card py-6 text-center">
            <p className="text-muted text-[12px]">No transactions found</p>
          </div>
        ) : (
          <div className="space-y-1.5">
            {txs.map((tx) => (
              <a
                key={tx.hash}
                href={tx.explorerUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="token-row no-underline block"
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className="w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0"
                    style={{
                      background: tx.type === "sent"
                        ? "rgba(239,68,68,0.12)"
                        : "rgba(34,197,94,0.12)",
                    }}
                  >
                    {tx.type === "sent"
                      ? <SendIcon size={13} style={{ color: "#ef4444" }} />
                      : <ReceiveIcon size={13} style={{ color: "#22c55e" }} />}
                  </div>
                  <div className="min-w-0">
                    <p className="text-[12px] font-medium text-text-primary capitalize">{tx.type}</p>
                    <p className="text-[10px] text-muted truncate">
                      {tx.type === "sent" ? "To " : "From "}
                      {shortAddr(tx.counterparty)}
                    </p>
                  </div>
                </div>
                <div className="text-right flex-shrink-0">
                  <p
                    className="text-[12px] font-semibold tabular-nums"
                    style={{ color: tx.type === "sent" ? "#ef4444" : "#22c55e" }}
                  >
                    {tx.type === "sent" ? "-" : "+"}{tx.value} {tx.symbol}
                  </p>
                  <p className="text-[10px] text-muted">{timeAgo(tx.timestamp)}</p>
                </div>
              </a>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
