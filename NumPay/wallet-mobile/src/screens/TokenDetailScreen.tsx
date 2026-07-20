// Token detail — the extension's /token page at mobile scope: live price +
// 24h change, the price chart with range selector, balance hero, the
// Send / Swap / Receive actions, wSOL unwrap, market stats, and this asset's
// merged transaction history (on-chain sources where reachable proxy-only,
// always at least the wallet's own tx log — mergeLoggedTxs dedupes).
// Market data + chart come from core tokenMarket (CoinGecko → GeckoTerminal →
// DexScreener, covers unlisted memecoins by address) with the extension's
// 3-minute stale-while-revalidate cache semantics.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from "react-native-svg";
import { NETWORKS } from "@numpay/core/networks";
import { loadTxLog, loggedToRecords } from "@numpay/core/txLog";
import {
  type TxRecord, fetchChainHistory, tokenMetaFromList, mergeLoggedTxs, txInvolvesAsset,
} from "@numpay/core/txHistory";
import { WSOL_MINT, unwrapWsol } from "@numpay/core/chains/solana";
import { deriveNonEvmAddresses } from "@numpay/core/chains";
import { getUsdPrice } from "@numpay/core/currency";
import { getItem, setItem } from "@numpay/core/storage";
import {
  type MarketData, resolveMarketSource, marketSourceKey, loadMarketData, loadChart,
} from "@numpay/core/tokenMarket";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import type { AssetRow, MobileWalletState } from "../wallet/useMobileWallet";
import { colors, type as ts } from "../ui/theme";
import { AlertCard, Btn, Card, ScreenHeader, SectionLabel } from "../ui/components";
import { useCurrencyPref, formatFiat } from "../ui/currency";
import { AssetIcon, ChainBadge } from "../ui/coins";
import { TxRow } from "./ActivityScreen";

const RANGES = [
  { label: "1D", days: 1 },
  { label: "7D", days: 7 },
  { label: "1M", days: 30 },
  { label: "3M", days: 90 },
  { label: "1Y", days: 365 },
] as const;

// Same cache keys + TTL as the extension TokenDetail, so the two clients keep
// one caching story (storage itself is per-platform).
const MARKET_TTL = 3 * 60 * 1000;

async function readCache<T>(key: string, ttl: number): Promise<{ value: T; fresh: boolean } | null> {
  try {
    const raw = await getItem(key);
    if (!raw) return null;
    const { ts: t, value } = JSON.parse(raw) as { ts: number; value: T };
    if (value == null) return null;
    return { value, fresh: Date.now() - t < ttl };
  } catch { return null; }
}
function writeCache<T>(key: string, value: T): void {
  setItem(key, JSON.stringify({ ts: Date.now(), value })).catch(() => {});
}

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
function fmtPrice(p: number): string {
  return p >= 1
    ? `$${p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : `$${p.toLocaleString(undefined, { maximumSignificantDigits: 4 })}`;
}

// The extension's SVG sparkline, in react-native-svg. Fixed viewBox scaled to
// the card width (preserveAspectRatio none, same as the web version).
function PriceChart({ prices, isUp }: { prices: [number, number][]; isUp: boolean }) {
  const W = 320, H = 110, pad = 6;
  const vals = prices.map((p) => p[1]);
  const min = Math.min(...vals);
  const range = (Math.max(...vals) - min) || 1;
  const pts = vals.map((v, i) => {
    const x = (i / (vals.length - 1)) * W;
    const y = H - pad - ((v - min) / range) * (H - pad * 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const pathD = `M${pts.join("L")}`;
  const stroke = isUp ? colors.success : colors.danger;
  return (
    <Svg width="100%" height={110} viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
      <Defs>
        <SvgLinearGradient id="tdChartFill" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={stroke} stopOpacity={0.18} />
          <Stop offset="100%" stopColor={stroke} stopOpacity={0} />
        </SvgLinearGradient>
      </Defs>
      <Path d={`${pathD}L${W},${H}L0,${H}Z`} fill="url(#tdChartFill)" />
      <Path d={pathD} fill="none" stroke={stroke} strokeWidth={1.6} strokeLinejoin="round" />
    </Svg>
  );
}

export function TokenDetailScreen({ w, row, onBack, onSend, onSwap, onReceive, onSessionExpired }: {
  w: MobileWalletState;
  row: AssetRow;
  onBack: () => void;
  onSend: () => void;
  onSwap: () => void;
  onReceive: () => void;
  onSessionExpired?: () => void;
}) {
  const tokenAddr = row.isNative ? undefined : row.key.split(":")[1];
  const isWsol = row.chainId === "solana" && tokenAddr === WSOL_MINT.toLowerCase();
  // Swap is offered where core can route it (same gate as the extension).
  const canSwap = !!NETWORKS[row.chainId] || row.chainId === "solana";
  const fallbackPrice = row.balanceNum > 0
    ? row.usdValue / row.balanceNum
    : (w.rates ? getUsdPrice(row.symbol, w.rates) : 0);

  const cur = useCurrencyPref();
  const [rangeIdx, setRangeIdx] = useState(1); // default 7D
  const [chartPrices, setChartPrices] = useState<[number, number][]>([]);
  const [chartLoading, setChartLoading] = useState(false);
  const [market, setMarket] = useState<MarketData | null>(null);
  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [txLoading, setTxLoading] = useState(false);
  const [unwrapping, setUnwrapping] = useState(false);
  const [unwrapMsg, setUnwrapMsg] = useState("");
  const [error, setError] = useState("");

  // CoinGecko → GeckoTerminal → DexScreener resolution, address-keyed for
  // unlisted memecoins — identical core call to the extension.
  const src = useMemo(
    () => resolveMarketSource(row.symbol, row.chainId, tokenAddr),
    [row.symbol, row.chainId, tokenAddr],
  );

  // Market data — cache-first, revalidate when stale.
  useEffect(() => {
    if (!src) return;
    let live = true;
    (async () => {
      const key = `mktcache_${marketSourceKey(src)}`;
      const cached = await readCache<MarketData>(key, MARKET_TTL);
      if (!live) return;
      if (cached) { setMarket(cached.value); if (cached.fresh) return; }
      const d = await loadMarketData(src);
      if (!live) return;
      if (d) { setMarket(d); writeCache(key, d); }
    })();
    return () => { live = false; };
  }, [src]);

  // Chart — cache-first per range; never cache an empty series.
  useEffect(() => {
    if (!src) return;
    let live = true;
    const days = RANGES[rangeIdx].days;
    (async () => {
      const key = `chartcache2_${marketSourceKey(src)}_${days}`;
      const cached = await readCache<[number, number][]>(key, MARKET_TTL);
      if (!live) return;
      if (cached) { setChartPrices(cached.value); setChartLoading(false); if (cached.fresh) return; }
      else setChartLoading(true);
      const p = await loadChart(src, days);
      if (!live) return;
      if (p.length >= 2) { setChartPrices(p); writeCache(key, p); }
      else if (!cached) setChartPrices([]);
      setChartLoading(false);
    })();
    return () => { live = false; };
  }, [src, rangeIdx]);

  // On-chain history for this chain narrowed to THIS asset, merged with the
  // wallet's own logged txs (either side of a swap/bridge counts). Mobile is
  // proxy-only, so indexer-keyed sources may be empty; the log always shows.
  const nonEvmLike = useMemo(() => {
    const a = w.nonEvmAddresses;
    if (!a) return null;
    return {
      bitcoin: { address: a.bitcoin }, litecoin: { address: a.litecoin },
      solana: { address: a.solana }, xrp: { address: a.xrp },
      tron: { address: a.tron }, sui: { address: a.sui },
    };
  }, [w.nonEvmAddresses]);

  const loadTxs = useCallback(async () => {
    setTxLoading(true);
    try {
      const meta = tokenMetaFromList(w.tokensByChain[row.chainId]);
      const records = await fetchChainHistory(row.chainId, w.evmAddress, nonEvmLike, meta)
        .catch(() => [] as TxRecord[]);
      const involves = (r: TxRecord) => txInvolvesAsset(r, row.chainId, tokenAddr, row.isNative);
      const logged = loggedToRecords(await loadTxLog(w.evmAddress)).filter(involves);
      setTxs(mergeLoggedTxs(records.filter(involves), logged));
    } catch { /* keep whatever is shown */ }
    finally { setTxLoading(false); }
  }, [w.evmAddress, w.tokensByChain, nonEvmLike, row.chainId, row.isNative, tokenAddr]);

  useEffect(() => { void loadTxs(); }, [loadTxs]);

  // wSOL → SOL (extension TokenDetail parity; core does the account close).
  async function handleUnwrap() {
    setError(""); setUnwrapMsg("");
    const mnemonic = await getUnlockedMnemonic();
    if (!mnemonic) { onSessionExpired?.(); return; }
    setUnwrapping(true);
    try {
      const derived = await deriveNonEvmAddresses(mnemonic);
      const res = await unwrapWsol(derived.solana.secretKey);
      setUnwrapMsg(`Unwrapped to SOL. Tx ${res.signature.slice(0, 8)}…`);
      w.refresh();
    } catch (e: any) {
      setError(e?.message || "Unwrap failed");
    } finally {
      setUnwrapping(false);
    }
  }

  const currentPrice = market?.current_price ?? fallbackPrice;
  const priceChange = market?.price_change_percentage_24h ?? 0;
  const isUp = priceChange >= 0;

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={row.symbol} onBack={onBack} />
      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Price + 24h change */}
        <View style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
            <Text style={st.price}>{currentPrice > 0 ? fmtPrice(currentPrice) : "—"}</Text>
            {market && (
              <Text style={[st.change, { color: isUp ? colors.success : colors.danger }]}>
                {isUp ? "+" : ""}{priceChange.toFixed(2)}%
              </Text>
            )}
          </View>
          <Text style={st.changeLabel}>24h change</Text>
        </View>

        {/* Price chart + range selector */}
        <Card style={{ overflow: "hidden" }}>
          <View style={{ paddingHorizontal: 10, paddingTop: 10 }}>
            {chartPrices.length >= 2 ? (
              <PriceChart prices={chartPrices} isUp={isUp} />
            ) : (
              <View style={st.chartEmpty}>
                <Text style={st.chartEmptyText}>
                  {chartLoading ? "Loading chart…"
                    : market ? "Not enough price history yet for a chart"
                    : "No chart available for this token"}
                </Text>
              </View>
            )}
          </View>
          <View style={st.rangeRow}>
            {RANGES.map((r, i) => (
              <Pressable key={r.label} onPress={() => setRangeIdx(i)}
                style={[st.rangeBtn, rangeIdx === i && st.rangeBtnOn]}>
                <Text style={[st.rangeText, rangeIdx === i && st.rangeTextOn]}>{r.label}</Text>
              </Pressable>
            ))}
          </View>
        </Card>

        {/* Balance hero */}
        <Card style={st.hero}>
          <View style={{ width: 48, height: 48 }}>
            <AssetIcon
              symbol={row.symbol} logo={row.logo} chainId={row.chainId}
              address={tokenAddr} size={48}
            />
            {!row.isNative && <ChainBadge chainId={row.chainId} size={16} />}
          </View>
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={st.balance}>
              {row.balanceNum.toLocaleString(undefined, { maximumFractionDigits: 6 })} {row.symbol}
            </Text>
            <Text style={st.fiat}>
              {row.usdValue > 0 || currentPrice > 0
                ? formatFiat(row.balanceNum * currentPrice, cur.code, cur.currency, w.rates)
                : " "}
            </Text>
            <Text style={st.chain}>{row.name} · {row.chainName}</Text>
          </View>
        </Card>

        {/* Actions: Send / Swap / Receive (Swap where core can route it) */}
        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn label="Send" onPress={onSend} style={{ flex: 1 }} />
          {canSwap && <Btn label="Swap" variant="secondary" onPress={onSwap} style={{ flex: 1 }} />}
          <Btn label="Receive" variant="secondary" onPress={onReceive} style={{ flex: 1 }} />
        </View>

        {isWsol && (
          <Btn
            label={unwrapping ? "Unwrapping…" : "Unwrap to SOL"}
            variant="secondary"
            onPress={() => { void handleUnwrap(); }}
            disabled={unwrapping || row.balanceNum <= 0}
          />
        )}
        {!!unwrapMsg && <Text style={st.ok}>{unwrapMsg}</Text>}
        {!!error && (
          <AlertCard tone="danger" title="Action failed" body={error} style={{ marginTop: 10 }} />
        )}

        {/* Market stats */}
        {market && (
          <>
            <SectionLabel text="Market stats" style={{ marginTop: 20, marginBottom: 6 } as object} />
            <Card>
              <View style={st.statsGrid}>
                {[
                  { label: "Market Cap",         value: market.market_cap > 0 ? fmtLarge(market.market_cap) : "—" },
                  { label: "24h Volume",         value: market.total_volume > 0 ? fmtLarge(market.total_volume) : "—" },
                  { label: "Circulating Supply", value: market.circulating_supply > 0 ? fmtSupply(market.circulating_supply, row.symbol) : "—" },
                  { label: "All-Time High",      value: market.ath > 0 ? `$${market.ath.toLocaleString(undefined, { maximumFractionDigits: 2 })}` : "—" },
                ].map((s, i) => (
                  <View key={s.label} style={[st.statCell, i % 2 === 1 && st.statCellRight, i > 1 && st.statCellBottom]}>
                    <Text style={st.statLabel}>{s.label}</Text>
                    <Text style={st.statValue}>{s.value}</Text>
                  </View>
                ))}
              </View>
            </Card>
          </>
        )}

        {/* Transactions (on-chain merged with the wallet's own log) */}
        <View style={st.txHead}>
          <SectionLabel text="Transactions" />
          <Pressable hitSlop={8} onPress={() => { void loadTxs(); }}>
            <Text style={st.txRefresh}>{txLoading ? "Loading…" : "Refresh"}</Text>
          </Pressable>
        </View>
        {txs.map((t) => <TxRow key={`${t.chainId}:${t.hash}:${t.assetAddr ?? "native"}`} tx={t} showChain={false} />)}
        {txs.length === 0 && !txLoading && (
          <Text style={st.dim}>No transactions found for this asset yet.</Text>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  price: { color: colors.textPrimary, fontSize: 28, fontWeight: "700", letterSpacing: -0.5 },
  change: { fontSize: ts.row, fontWeight: "700", paddingBottom: 3 },
  changeLabel: { color: colors.muted, fontSize: ts.small, marginTop: 2 },

  chartEmpty: { height: 110, alignItems: "center", justifyContent: "center", paddingHorizontal: 24 },
  chartEmptyText: { color: colors.muted, fontSize: ts.small, textAlign: "center" },
  rangeRow: {
    flexDirection: "row", marginTop: 8,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider,
  },
  rangeBtn: { flex: 1, paddingVertical: 9, alignItems: "center" },
  rangeBtnOn: { backgroundColor: colors.brandTint },
  rangeText: { color: colors.muted, fontSize: ts.small, fontWeight: "600" },
  rangeTextOn: { color: colors.brand2 },

  hero: { flexDirection: "row", alignItems: "center", padding: 16, marginTop: 12 },
  balance: {
    color: colors.textPrimary, fontSize: 20, fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  fiat: { color: colors.textSecondary, fontSize: ts.row, marginTop: 2 },
  chain: { color: colors.muted, fontSize: ts.small, marginTop: 4 },
  ok: { color: colors.success, fontSize: ts.small, marginTop: 8 },

  statsGrid: { flexDirection: "row", flexWrap: "wrap" },
  statCell: { width: "50%", paddingHorizontal: 14, paddingVertical: 10 },
  statCellRight: { borderLeftWidth: StyleSheet.hairlineWidth, borderLeftColor: colors.divider },
  statCellBottom: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  statLabel: { color: colors.muted, fontSize: ts.label, marginBottom: 2 },
  statValue: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600", fontVariant: ["tabular-nums"] },

  txHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 20, marginBottom: 2,
  },
  txRefresh: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
  dim: { color: colors.muted, fontSize: ts.row, marginTop: 8 },
});
