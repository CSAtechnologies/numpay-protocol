import { useState, useEffect, useCallback, useMemo } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useWallet } from "../hooks/useWallet";
import { useCurrency } from "../hooks/useCurrency";
import Layout from "../components/Layout";
import {
  ArrowLeftIcon, SendIcon, ReceiveIcon, ExternalLinkIcon,
  TrendingUpIcon, AssetIcon, RefreshIcon, SwapIcon,
} from "../components/Icons";
import { NETWORKS } from "@/lib/networks";
import { type TxRecord, fetchChainHistory, tokenMetaFromList } from "@/lib/txHistory";
import { getItem, setItem } from "@/lib/storage";
import { usdToDisplayCurrency } from "@/lib/currency";
import {
  type MarketData,
  resolveMarketSource,
  marketSourceKey,
  loadMarketData,
  loadChart,
} from "@/lib/tokenMarket";

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
  address?: string;
  possibleSpam?: boolean;
  securityScore?: number;
  verifiedContract?: boolean;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const RANGES = [
  { label: "1D", days: 1 },
  { label: "7D", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
] as const;

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

// ── Helpers ─────────────────────────────────────────────────────────────────────

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

// ── Market data ───────────────────────────────────────────────────────────────

// CoinGecko's free tier is slow and rate-limited, so market data + chart series
// are cached per coin/range (stale-while-revalidate). A reopen paints instantly
// from cache; a background refetch keeps it current once the cache goes stale.
const MARKET_TTL = 3 * 60 * 1000; // 3 minutes

// Read a fresh-or-stale cached value. Returns { value, fresh } or null on miss.
async function readCache<T>(key: string, ttl: number): Promise<{ value: T; fresh: boolean } | null> {
  try {
    const raw = await getItem(key);
    if (!raw) return null;
    const { ts, value } = JSON.parse(raw) as { ts: number; value: T };
    if (value == null) return null;
    return { value, fresh: Date.now() - ts < ttl };
  } catch {
    return null;
  }
}

function writeCache<T>(key: string, value: T): void {
  setItem(key, JSON.stringify({ ts: Date.now(), value })).catch(() => {});
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
  const { wallet, activeAddress, nonEvmWallet, tokensByChain } = useWallet();
  const { currency, currencyCode, rates } = useCurrency();
  const sym = currency?.symbol || "$";

  // Resolve a market-data target across the source chain (CoinGecko → GeckoTerminal
  // → DexScreener). Covers natives, majors, and unlisted memecoins by address.
  const src = useMemo(
    () => (token ? resolveMarketSource(token.symbol, token.chainId, token.address) : null),
    [token],
  );

  const [rangeIdx, setRangeIdx] = useState(1); // default 7D
  const [chartPrices, setChartPrices] = useState<[number, number][]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [market, setMarket] = useState<MarketData | null>(null);
  const [marketLoading, setMarketLoading] = useState(false);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [txLoading, setTxLoading] = useState(false);

  // Symbol lookup for SPL/token rows on this chain.
  const solTokenMeta = useMemo(
    () => tokenMetaFromList(token?.chainId ? tokensByChain?.[token.chainId] : undefined),
    [tokensByChain, token?.chainId]
  );

  // Market data — cache-first, revalidate when stale
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    (async () => {
      const key = `mktcache_${marketSourceKey(src)}`;
      const cached = await readCache<MarketData>(key, MARKET_TTL);
      if (cancelled) return;
      if (cached) { setMarket(cached.value); setMarketLoading(false); if (cached.fresh) return; }
      else setMarketLoading(true);
      const d = await loadMarketData(src);
      if (cancelled) return;
      if (d) { setMarket(d); writeCache(key, d); }
      setMarketLoading(false);
    })();
    return () => { cancelled = true; };
  }, [src]);

  // Chart — cache-first per range, revalidate when stale
  useEffect(() => {
    if (!src) return;
    let cancelled = false;
    const days = RANGES[rangeIdx].days;
    (async () => {
      // v2 prefix: ignore any empty/failed series the earlier build cached.
      const key = `chartcache2_${marketSourceKey(src)}_${days}`;
      const cached = await readCache<[number, number][]>(key, MARKET_TTL);
      if (cancelled) return;
      if (cached) { setChartPrices(cached.value); setChartLoading(false); if (cached.fresh) return; }
      else setChartLoading(true);
      const p = await loadChart(src, days);
      if (cancelled) return;
      if (p.length >= 2) {
        setChartPrices(p);
        writeCache(key, p);           // only ever cache a real series — never poison with an empty/failed fetch
      } else if (!cached) {
        setChartPrices([]);           // genuinely no chartable history; show the empty state but don't cache it
      }                               // else: a transient empty refetch — keep the cached chart on screen
      setChartLoading(false);
    })();
    return () => { cancelled = true; };
  }, [src, rangeIdx]);

  // Fetch transaction history for this chain, then narrow to THIS token: native
  // coin pages show native transfers; a token page shows only that token's
  // transfers (matched by contract / mint).
  const loadTxs = useCallback(async () => {
    if (!token?.chainId) return;
    setTxLoading(true);
    const evmAddr = activeAddress || wallet?.address || "";
    const records = await fetchChainHistory(token.chainId, evmAddr, nonEvmWallet, solTokenMeta);
    const tokenAddr = token.address?.toLowerCase();
    const filtered = token.isNative
      ? records.filter((r) => !r.assetAddr)
      : tokenAddr
        ? records.filter((r) => r.assetAddr === tokenAddr)
        : records;
    setTxs(filtered);
    setTxLoading(false);
  }, [token?.chainId, token?.address, token?.isNative, activeAddress, wallet?.address, nonEvmWallet, solTokenMeta]);

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
  // Convert the USD balance into the user's selected display currency; without
  // this the value was shown with the currency symbol but the raw USD number.
  const balanceFiat = usdToDisplayCurrency(balanceUsd, currencyCode, rates);

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
          <AssetIcon symbol={token.symbol} logo={token.logo} chainId={token.chainId} address={token.address} size={32} />
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

      {/* ── Risk / spam warning ── */}
      {!token.isNative && (() => {
        const risks: string[] = [];
        if (token.possibleSpam) risks.push("Flagged as possible spam or scam");
        if (token.verifiedContract === false) risks.push("Unverified contract");
        if (typeof token.securityScore === "number" && token.securityScore < 50)
          risks.push(`Low security score (${token.securityScore}/100)`);
        if (risks.length === 0) return null;
        return (
          <div className="px-4 mb-3">
            <div
              className="rounded-xl px-3 py-2.5 flex gap-2.5"
              style={{ border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.10)" }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" className="flex-shrink-0 mt-0.5" style={{ color: "#f59e0b" }}>
                <path d="M12 9v4m0 4h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0Z"
                  stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <div className="min-w-0">
                <p className="text-[12px] font-semibold" style={{ color: "#f59e0b" }}>Caution: this token has risk signals</p>
                <ul className="text-[11px] text-muted mt-0.5 list-disc pl-4">
                  {risks.map((r) => <li key={r}>{r}</li>)}
                </ul>
                <p className="text-[10px] text-muted mt-1">Scam tokens can mimic real ones. Verify the contract before sending or swapping.</p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* ── Price + change ── */}
      <div className="px-4 mb-3">
        <div className="flex items-end gap-2.5">
          {marketLoading ? (
            <div className="h-9 w-28 rounded-lg bg-surface-2 animate-pulse" />
          ) : (
            <p className="text-[32px] font-bold tracking-tight gradient-text leading-none">
              {currentPrice >= 1
                ? `$${currentPrice.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
                : `$${currentPrice.toLocaleString("en", { maximumSignificantDigits: 4 })}`}
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
            ) : chartPrices.length >= 2 ? (
              <PriceChart prices={chartPrices} isUp={isUp} />
            ) : (
              <div className="h-[110px] flex items-center justify-center">
                <p className="text-[11px] text-muted text-center px-6">
                  {market ? "Not enough price history yet for a chart" : "No chart available for this token"}
                </p>
              </div>
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
                {sym}{balanceFiat.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </p>
            </div>
            <AssetIcon symbol={token.symbol} logo={token.logo} chainId={token.chainId} address={token.address} size={28} />
          </div>
        </div>
      </div>

      {/* ── Actions ── */}
      {(() => {
        // Swap is offered where we can actually route it: EVM chains + Solana.
        const canSwap = !!NETWORKS[token.chainId ?? ""] || token.chainId === "solana";
        return (
          <div className={`px-4 mb-4 grid gap-2.5 ${canSwap ? "grid-cols-3" : "grid-cols-2"}`}>
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
            {canSwap && (
              <button
                onClick={() => navigate("/swap", { state: { prefillChain: token.chainId, prefillAddress: token.address, prefillSymbol: token.symbol } })}
                className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold bg-surface-2 border border-border text-text-primary hover:border-brand-500/50 transition-colors"
              >
                <SwapIcon size={14} />
                Swap
              </button>
            )}
            <button
              onClick={() => navigate("/receive", { state: { chainId: token.chainId } })}
              className="flex items-center justify-center gap-2 py-2.5 rounded-xl text-[13px] font-semibold bg-surface-2 border border-border text-text-primary hover:border-brand-500/50 transition-colors"
            >
              <ReceiveIcon size={14} />
              Receive
            </button>
          </div>
        );
      })()}

      {/* ── Market stats ── */}
      {src && market && (
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
                  { label: "Market Cap",       value: market.market_cap > 0 ? fmtLarge(market.market_cap) : "—" },
                  { label: "24h Volume",        value: market.total_volume > 0 ? fmtLarge(market.total_volume) : "—" },
                  { label: "Circulating Supply",value: market.circulating_supply > 0 ? fmtSupply(market.circulating_supply, token.symbol) : "—" },
                  { label: "All-Time High",     value: market.ath > 0 ? `$${market.ath.toLocaleString("en", { maximumFractionDigits: 2 })}` : "—" },
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
                key={`${tx.hash}-${tx.assetAddr || "native"}`}
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
                      {tx.counterparty
                        ? <>{tx.type === "sent" ? "To " : "From "}{shortAddr(tx.counterparty)}</>
                        : <span className="italic opacity-60">address unavailable</span>}
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
