// Token detail — the extension's /token page at mobile scope: live price +
// 24h change, the price chart with range selector, balance hero, the
// Send / Swap / Receive actions, wSOL unwrap, market stats, and this asset's
// merged transaction history (on-chain sources where reachable proxy-only,
// always at least the wallet's own tx log — mergeLoggedTxs dedupes).
// Market data + chart come from core tokenMarket (CoinGecko → GeckoTerminal →
// DexScreener, covers unlisted memecoins by address) with the extension's
// 3-minute stale-while-revalidate cache semantics.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import Svg, { Defs, LinearGradient as SvgLinearGradient, Path, Stop } from "react-native-svg";
import { NETWORKS } from "@numpay/core/networks";
import { explorerTxUrl, loadTxLog, loggedToRecords } from "@numpay/core/txLog";
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
import { colors, radius, type as ts, themedStyles } from "../ui/theme";
import { LinearGradient } from "expo-linear-gradient";
import {
  Notice, Card, EmptyState, GradientNumber, SectionLabel, SkeletonRow,
  Tappable,
} from "../ui/components";
import {
  ActivityIcon, AlertIcon, ArrowLeftIcon, ExternalLinkIcon, ReceiveIcon,
  RefreshIcon, SendIcon, SwapIcon, TrendingUpIcon,
} from "../ui/icons";
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
  // Mirrors the extension's result box: outcome, copy, and the signature to
  // link, rather than a bare green line.
  const [unwrapMsg, setUnwrapMsg] = useState<{ ok: boolean; text: string; sig?: string } | null>(null);
  const [error, setError] = useState("");

  const explorerBase = NETWORKS[row.chainId]?.explorer
    ? `${NETWORKS[row.chainId].explorer}/address/${w.evmAddress}`
    : null;

  // Risk signals the indexer reported. Only EXPLICIT flags warn: a missing
  // score means "unknown", not "unsafe".
  const risks: string[] = [];
  if (!row.isNative) {
    if (row.possibleSpam) risks.push("Flagged as possible spam or scam");
    if (row.verifiedContract === false) risks.push("Unverified contract");
    if (typeof row.securityScore === "number" && row.securityScore < 50) {
      risks.push(`Low security score (${row.securityScore}/100)`);
    }
  }

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
    setError(""); setUnwrapMsg(null);
    const mnemonic = await getUnlockedMnemonic();
    if (!mnemonic) { onSessionExpired?.(); return; }
    setUnwrapping(true);
    try {
      const derived = await deriveNonEvmAddresses(mnemonic);
      const res = await unwrapWsol(derived.solana.secretKey);
      const sol = Number(res.lamports) / 1e9;
      setUnwrapMsg({
        ok: true,
        text: `Unwrapped ${sol.toLocaleString(undefined, { maximumFractionDigits: 6 })} SOL to your native balance.`,
        sig: res.signature,
      });
      w.refreshAfterTx();
    } catch (e: any) {
      setUnwrapMsg({ ok: false, text: e?.message || "Unwrap failed. Try again." });
    } finally {
      setUnwrapping(false);
    }
  }

  const currentPrice = market?.current_price ?? fallbackPrice;
  const priceChange = market?.price_change_percentage_24h ?? 0;
  const isUp = priceChange >= 0;

  return (
    <View style={{ flex: 1 }}>
      {/* Header: back, the asset itself (icon + name + chain), explorer link.
          The extension identifies the page with the token, not a text title. */}
      <View style={st.header}>
        <Pressable
          onPress={onBack}
          hitSlop={10}
          accessibilityRole="button"
          accessibilityLabel="Go back"
          style={({ pressed }) => [st.headerBtn, pressed && { borderColor: colors.borderLight }]}
        >
          <ArrowLeftIcon size={15} color={colors.muted} />
        </Pressable>
        <View style={st.headerAsset}>
          <AssetIcon
            symbol={row.symbol} logo={row.logo} chainId={row.chainId}
            address={tokenAddr} size={32}
          />
          <View style={{ flex: 1, minWidth: 0, marginLeft: 10 }}>
            <Text style={st.headerName} numberOfLines={1}>{row.name}</Text>
            <Text style={st.headerChain}>{row.chainName}</Text>
          </View>
        </View>
        {explorerBase && (
          <Pressable
            hitSlop={10}
            onPress={() => { Linking.openURL(explorerBase).catch(() => {}); }}
            accessibilityRole="link"
            accessibilityLabel="View on block explorer"
            style={({ pressed }) => [st.headerBtn, pressed && { borderColor: colors.borderLight }]}
          >
            <ExternalLinkIcon size={14} color={colors.muted} />
          </Pressable>
        )}
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>

        {/* Risk / spam warning */}
        {risks.length > 0 && (
          <View style={st.riskBox}>
            <AlertIcon size={16} color={colors.caution} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.riskTitle}>Caution: this token has risk signals</Text>
              {risks.map((r) => (
                <Text key={r} style={st.riskItem}>{"•"}  {r}</Text>
              ))}
              <Text style={st.riskNote}>
                Scam tokens can mimic real ones. Verify the contract before sending or swapping.
              </Text>
            </View>
          </View>
        )}

        {/* Price + 24h change — gradient numerals, as in the popup */}
        <View style={{ marginBottom: 10 }}>
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: 8 }}>
            {currentPrice > 0
              ? <GradientNumber text={fmtPrice(currentPrice)} size={32} />
              : <Text style={st.price}>—</Text>}
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
              <Tappable feedback="row" key={r.label} onPress={() => setRangeIdx(i)}
                style={[st.rangeBtn, rangeIdx === i && st.rangeBtnOn]}>
                <Text style={[st.rangeText, rangeIdx === i && st.rangeTextOn]}>{r.label}</Text>
              </Tappable>
            ))}
          </View>
        </Card>

        {/* Your balance — labelled card, big number with a muted ticker, fiat
            underneath, asset disc on the right (extension layout). */}
        <Card style={st.balanceCard}>
          <Text style={st.balanceLabel}>YOUR BALANCE</Text>
          <View style={{ flexDirection: "row", alignItems: "flex-end", justifyContent: "space-between" }}>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={st.balance}>
                {row.balanceNum >= 0.0001
                  ? row.balanceNum.toLocaleString(undefined, { maximumFractionDigits: 6 })
                  : row.balanceNum.toPrecision(2)}
                <Text style={st.balanceSym}> {row.symbol}</Text>
              </Text>
              <Text style={st.fiat}>
                {row.usdValue > 0 || currentPrice > 0
                  ? formatFiat(row.balanceNum * currentPrice, cur.code, cur.currency, w.rates)
                  : " "}
              </Text>
            </View>
            <View style={{ width: 28, height: 28 }}>
              <AssetIcon
                symbol={row.symbol} logo={row.logo} chainId={row.chainId}
                address={tokenAddr} size={28}
              />
              {!row.isNative && <ChainBadge chainId={row.chainId} size={11} />}
            </View>
          </View>
        </Card>

        {/* Actions: Send / Swap / Receive (Swap where core can route it).
            Icon + label, Send carrying the brand gradient. */}
        <View style={{ flexDirection: "row", gap: 10, marginTop: 12 }}>
          <Pressable
            onPress={onSend}
            style={({ pressed }) => [{ flex: 1 }, pressed && { transform: [{ scale: 0.98 }] }]}
          >
            <LinearGradient
              colors={["#b5a8ff", "#7c6df0", "#5b4cdb"]}
              locations={[0, 0.5, 1]}
              start={{ x: 0, y: 0 }}
              end={{ x: 1, y: 1 }}
              style={st.actionBtn}
            >
              <SendIcon size={14} color="#fff" />
              <Text style={st.actionLabelOn}>Send</Text>
            </LinearGradient>
          </Pressable>
          {canSwap && (
            <Pressable
              onPress={onSwap}
              style={({ pressed }) => [st.actionBtn, st.actionBtnSecondary, { flex: 1 }, pressed && { borderColor: colors.brand }]}
            >
              <SwapIcon size={14} color={colors.textPrimary} />
              <Text style={st.actionLabel}>Swap</Text>
            </Pressable>
          )}
          <Pressable
            onPress={onReceive}
            style={({ pressed }) => [st.actionBtn, st.actionBtnSecondary, { flex: 1 }, pressed && { borderColor: colors.brand }]}
          >
            <ReceiveIcon size={14} color={colors.textPrimary} />
            <Text style={st.actionLabel}>Receive</Text>
          </Pressable>
        </View>

        {isWsol && (
          <View style={{ marginTop: 12 }}>
            <Pressable
              onPress={() => { void handleUnwrap(); }}
              disabled={unwrapping || row.balanceNum <= 0}
              style={({ pressed }) => [
                st.actionBtn, st.actionBtnSecondary,
                (unwrapping || row.balanceNum <= 0) && { opacity: 0.5 },
                pressed && { borderColor: colors.brand },
              ]}
            >
              <Text style={st.actionLabel}>{unwrapping ? "Unwrapping…" : "Unwrap to SOL"}</Text>
            </Pressable>
            {unwrapMsg && (
              // Was four raw rgba values on a green (#22c55e) that is not in the
              // palette at all, with the message itself painted in the base
              // success/danger tones. Those are tuned as ICON fills: at
              // ts.small on this card the success line measured 2.54:1 and the
              // failure line 3.76:1. The *Text tones exist for exactly this and
              // clear 5.4:1+ in both themes.
              <View style={[st.resultBox, {
                borderColor: unwrapMsg.ok ? colors.successLine : colors.dangerLine,
                backgroundColor: unwrapMsg.ok ? colors.successTint : colors.dangerTint,
              }]}>
                <Text style={{ color: unwrapMsg.ok ? colors.successText : colors.dangerText, fontSize: ts.small, lineHeight: 16 }}>
                  {unwrapMsg.text}
                </Text>
                {unwrapMsg.ok && unwrapMsg.sig && (
                  <Tappable feedback="row"
                    hitSlop={6}
                    onPress={() => { Linking.openURL(explorerTxUrl("solana", unwrapMsg.sig!)).catch(() => {}); }}
                    style={st.resultLink}
                  >
                    <Text style={st.resultLinkText}>View transaction</Text>
                    <ExternalLinkIcon size={10} color={colors.brand2} />
                  </Tappable>
                )}
              </View>
            )}
            <Text style={st.unwrapNote}>
              Wrapped SOL is the token form of SOL. Unwrapping returns it, plus the account rent,
              to your spendable SOL.
            </Text>
          </View>
        )}
        {!!error && (
          <Notice tone="danger" title="Action failed" body={error} style={{ marginTop: 10 }} />
        )}

        {/* Market stats */}
        {market && (
          <>
            <View style={st.statsHead}>
              <TrendingUpIcon size={13} color={colors.muted} />
              <SectionLabel text="Market stats" />
            </View>
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
          <Tappable feedback="row"
            hitSlop={8}
            disabled={txLoading}
            onPress={() => { void loadTxs(); }}
            style={[st.txRefreshBtn, txLoading && { opacity: 0.4 }]}
            accessibilityLabel="Refresh transactions"
          >
            <RefreshIcon size={12} color={colors.muted} />
          </Tappable>
        </View>
        {txLoading && txs.length === 0 && (
          <>
            <SkeletonRow discSize={34} /><SkeletonRow discSize={34} /><SkeletonRow discSize={34} />
          </>
        )}
        {txs.map((t) => (
          <TxRow key={`${t.chainId}:${t.hash}:${t.assetAddr ?? "native"}`} tx={t} showChain={false} size={34} />
        ))}
        {txs.length === 0 && !txLoading && (
          <EmptyState
            icon={<ActivityIcon size={18} color={colors.muted} />}
            title="No transactions found"
            style={{ paddingVertical: 28 }}
          />
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const st = themedStyles((colors) => ({
  header: { flexDirection: "row", alignItems: "center", gap: 10, height: 50, marginBottom: 6 },
  headerBtn: {
    width: 32, height: 32, borderRadius: radius.button,
    backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  headerAsset: { flexDirection: "row", alignItems: "center", flex: 1, minWidth: 0 },
  headerName: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "600" },
  headerChain: { color: colors.muted, fontSize: ts.small, marginTop: 1 },

  riskBox: {
    flexDirection: "row", gap: 10,
    paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: radius.tile, marginBottom: 12,
    // Same half-converted panel as DappApprovalSheet's risk row: the fill and
    // the title were retoned, the border was left as raw #f59e0b at 0.4.
    borderWidth: 1, borderColor: colors.cautionLine,
    backgroundColor: colors.cautionTint,
  },
  riskTitle: { color: colors.caution, fontSize: 12, fontWeight: "600" },
  riskItem: { color: colors.muted, fontSize: ts.small, marginTop: 2, lineHeight: 15 },
  riskNote: { color: colors.muted2, fontSize: ts.label, marginTop: 5, lineHeight: 14 },

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

  balanceCard: { paddingHorizontal: 16, paddingVertical: 12, marginTop: 12 },
  balanceLabel: {
    color: colors.muted, fontSize: ts.label, fontWeight: "600",
    letterSpacing: 1.2, marginBottom: 8,
  },
  balance: {
    color: colors.textPrimary, fontSize: 22, fontWeight: "700",
    fontVariant: ["tabular-nums"],
  },
  balanceSym: { color: colors.muted, fontSize: ts.body, fontWeight: "500" },
  fiat: { color: colors.muted, fontSize: 12, marginTop: 3 },

  actionBtn: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 7,
    paddingVertical: 10, borderRadius: radius.button,
  },
  actionBtnSecondary: {
    backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border,
  },
  actionLabel: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600" },
  actionLabelOn: { color: colors.onBrand, fontSize: ts.row, fontWeight: "600" },

  resultBox: {
    marginTop: 8, paddingHorizontal: 12, paddingVertical: 10,
    borderRadius: radius.tile, borderWidth: 1,
  },
  resultLink: { flexDirection: "row", alignItems: "center", gap: 5, marginTop: 5 },
  resultLinkText: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
  unwrapNote: { color: colors.muted, fontSize: ts.label, marginTop: 6, lineHeight: 14 },

  statsHead: {
    flexDirection: "row", alignItems: "center", gap: 6,
    marginTop: 20, marginBottom: 6,
  },
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
  txRefreshBtn: { padding: 6, borderRadius: radius.iconBtn },
}));
