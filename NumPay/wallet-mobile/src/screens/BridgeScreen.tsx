// Mobile Bridge — cross-chain transfers through the shared core engine
// (@numpay/core/swap): LI.FI routes + guard-checked execution. EVM source and
// destination in this slice (Solana source follows). Separate from-chain and
// to-chain selectors keep the flow explicit; the swap screen stays same-chain.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NETWORKS } from "@numpay/core/networks";
import { getUsdPrice } from "@numpay/core/currency";
import {
  evmSwapReserve, parseSwapError, sanitizeSlippagePct,
  type BridgeRoute, type SwapToken,
} from "@numpay/core/swap";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import { fetchBridgeRoutes, bridgeEvm } from "../wallet/bridge";
import { buildChainTokenList } from "../wallet/tokenList";
import { explorerTxUrl } from "../wallet/send";
import type { MobileWalletState } from "../wallet/useMobileWallet";
import { colors, radius, type as ts } from "../ui/theme";
import { AlertCard, Btn, Chip, Card, Field, ScreenHeader, SectionLabel } from "../ui/components";
import { useCurrencyPref, formatFiatLine } from "../ui/currency";
import { AssetIcon, ChainIcon } from "../ui/coins";
import { TxResultOverlay, type TxFxStatus } from "../ui/TxResultOverlay";

// EVM chains offered as bridge destinations (all LI.FI-supported + in NETWORKS).
const DEST_CHAINS = [
  "ethereum", "base", "arbitrum", "optimism", "polygon", "bsc", "avalanche", "linea", "scroll",
];
const QUOTE_DEBOUNCE_MS = 700;

export function BridgeScreen({ w, onBack, onSessionExpired }: {
  w: MobileWalletState;
  onBack: () => void;
  onSessionExpired?: () => void;
}) {
  // Source chains: EVM chains the wallet holds anything on (native or token).
  const fromChains = useMemo(() => {
    const ids = new Set<string>();
    for (const r of w.rows) if (NETWORKS[r.chainId] && r.balanceNum > 0) ids.add(r.chainId);
    if (ids.size === 0) ids.add("base");
    return [...ids];
  }, [w.rows]);

  const cur = useCurrencyPref();
  const [fromChain, setFromChain] = useState(fromChains[0] ?? "base");
  const [toChain, setToChain] = useState(fromChains[0] === "base" ? "arbitrum" : "base");

  const fromTokens = useMemo(() => buildChainTokenList(fromChain, w.rows, w.tokensByChain), [fromChain, w.rows, w.tokensByChain]);
  const toTokens = useMemo(() => buildChainTokenList(toChain, w.rows, w.tokensByChain), [toChain, w.rows, w.tokensByChain]);

  const [fromToken, setFromToken] = useState<SwapToken | null>(null);
  const [toToken, setToToken] = useState<SwapToken | null>(null);
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  const [amount, setAmount] = useState("");
  const [routes, setRoutes] = useState<BridgeRoute[]>([]);
  const [selRoute, setSelRoute] = useState(0);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState("");
  const [bridging, setBridging] = useState(false);
  const [txFx, setTxFx] = useState<TxFxStatus | null>(null);
  const [txDetail, setTxDetail] = useState("");
  const [txHash, setTxHash] = useState("");
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quoteSeq = useRef(0);

  // Reset the source token when the source chain changes.
  useEffect(() => {
    setFromToken(fromTokens[0] ?? null);
    setAmount(""); setRoutes([]); setError(""); setTxHash("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromChain]);

  // Reset the destination token when the destination chain changes: prefer a
  // stablecoin/default (address token) so a bridge has a concrete target.
  useEffect(() => {
    setToToken(toTokens.find((t) => t.address) ?? toTokens[0] ?? null);
    setRoutes([]); setError("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [toChain]);

  const price = useCallback((t: SwapToken | null): number => {
    if (!t) return 0;
    if (t.priceUsd) return t.priceUsd;
    return w.rates ? getUsdPrice(t.symbol, w.rates) : 0;
  }, [w.rates]);

  const scheduleQuote = useCallback((amt: string, from: SwapToken | null, to: SwapToken | null) => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    setRoutes([]); setSelRoute(0); setError("");
    if (!from || !to || !(parseFloat(amt) > 0)) return;
    if (from.chainId === to.chainId) { setError("Pick two different chains to bridge."); return; }
    const seq = ++quoteSeq.current;
    setQuoting(true);
    quoteTimer.current = setTimeout(async () => {
      const { routes: found, error: err } = await fetchBridgeRoutes(
        from, to, amt, w.evmAddress, sanitizeSlippagePct("0.5"),
      );
      if (seq !== quoteSeq.current) return;
      setQuoting(false);
      setRoutes(found);
      if (err) setError(err);
    }, QUOTE_DEBOUNCE_MS);
  }, [w.evmAddress]);

  function handleAmount(v: string) {
    const clean = v.replace(/[^0-9.]/g, "");
    setAmount(clean);
    scheduleQuote(clean, fromToken, toToken);
  }

  async function handleMax() {
    if (!fromToken) return;
    const bal = parseFloat(fromToken.balance) || 0;
    if (bal <= 0) return;
    let v = bal;
    if (!fromToken.address) {
      const reserve = await evmSwapReserve(fromChain, true); // bridge reserve
      v = Math.max(0, bal - reserve);
    }
    const s = v > 0 ? String(Number(v.toFixed(8))) : "0";
    setAmount(s);
    scheduleQuote(s, fromToken, toToken);
  }

  function selectToken(t: SwapToken) {
    if (picking === "from") { setFromToken(t); scheduleQuote(amount, t, toToken); }
    else if (picking === "to") { setToToken(t); scheduleQuote(amount, fromToken, t); }
    setPicking(null);
  }

  async function handleBridge() {
    const route = routes[selRoute];
    if (!route || !fromToken || !toToken || !(parseFloat(amount) > 0)) return;
    const bal = parseFloat(fromToken.balance) || 0;
    if (parseFloat(amount) > bal) { setError("Insufficient balance"); return; }
    const mnemonic = await getUnlockedMnemonic();
    if (!mnemonic) {
      setError("Wallet is locked. Unlock NumPay and try again.");
      onSessionExpired?.();
      return;
    }
    Keyboard.dismiss();
    setBridging(true); setError(""); setTxHash(""); setTxDetail(""); setTxFx("pending");
    try {
      const receive = receiveAmount(route, toToken);
      const hash = await bridgeEvm(
        mnemonic, fromChain, fromToken, toToken, amount, receive, price(fromToken),
        setTxDetail, () => w.refresh(),
      );
      setTxHash(hash);
      setTxFx("success");
      w.refresh();
    } catch (e: any) {
      setError(e?.message || "Bridge failed");
      setTxFx("error");
    } finally {
      setBridging(false);
    }
  }

  const best = routes[selRoute];
  const receive = best && toToken ? receiveAmount(best, toToken) : "";
  const sellUsd = fromToken && parseFloat(amount) > 0 ? parseFloat(amount) * price(fromToken) : 0;
  const buyUsd = best?.toAmountUSD ? parseFloat(best.toAmountUSD) : (toToken && receive ? parseFloat(receive) * price(toToken) : 0);
  const errView = error ? parseSwapError(error, "Bridge") : null;

  // Token picker takeover.
  if (picking) {
    const list = picking === "from" ? fromTokens : toTokens;
    const balOf = (t: SwapToken) => parseFloat(t.balance) || 0;
    const sorted = [...list].sort((a, b) => balOf(b) * price(b) - balOf(a) * price(a));
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title={picking === "from" ? "From token" : "To token"} onBack={() => setPicking(null)} />
        <ScrollView showsVerticalScrollIndicator={false}>
          {sorted.map((t) => (
            <Pressable key={`${t.chainId}:${t.address ?? "native"}`} onPress={() => selectToken(t)} style={st.tokenRow}>
              <AssetIcon symbol={t.symbol} logo={t.logo} chainId={t.chainId} address={t.address} size={32} />
              <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                <Text style={st.tokenSym} numberOfLines={1}>{t.symbol}</Text>
                <Text style={st.tokenSub} numberOfLines={1}>{t.name}</Text>
              </View>
              {balOf(t) > 0 && (
                <Text style={st.tokenBal}>{balOf(t).toLocaleString(undefined, { maximumFractionDigits: 6 })}</Text>
              )}
            </Pressable>
          ))}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Bridge" onBack={onBack} />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* From chain */}
        <SectionLabel text="From chain" style={{ marginTop: 8 } as object} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 4 }}>
          {fromChains.map((id) => (
            <Chip key={id} label={NETWORKS[id]?.name ?? id} active={fromChain === id}
              onPress={() => { setFromChain(id); if (toChain === id) setToChain(id === "base" ? "arbitrum" : "base"); }}
              icon={<ChainIcon chainId={id} size={16} />} />
          ))}
        </ScrollView>

        {/* SELL */}
        <Card style={st.sideCard}>
          <Pressable onPress={() => setPicking("from")} style={st.tokenBtn}>
            {fromToken && <AssetIcon symbol={fromToken.symbol} logo={fromToken.logo} chainId={fromChain} address={fromToken.address} size={28} />}
            <Text style={st.tokenBtnText}>{fromToken?.symbol ?? "—"}</Text>
            <Text style={st.chev}>▾</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Field placeholder="0.0" keyboardType="decimal-pad" value={amount} onChangeText={handleAmount}
              style={{ marginTop: 0, textAlign: "right" }} />
          </View>
        </Card>
        <View style={st.subRow}>
          <Text style={st.subText}>
            Balance {parseFloat(fromToken?.balance || "0").toLocaleString(undefined, { maximumFractionDigits: 6 })}
            {"  "}<Text style={st.maxInline} onPress={() => { void handleMax(); }}>MAX</Text>
          </Text>
          <Text style={st.subText}>{sellUsd > 0 ? `≈ ${formatFiatLine(sellUsd, cur.code, cur.currency, w.rates)}` : " "}</Text>
        </View>

        {/* To chain */}
        <SectionLabel text="To chain" style={{ marginTop: 12 } as object} />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginTop: 4 }}>
          {DEST_CHAINS.filter((id) => id !== fromChain).map((id) => (
            <Chip key={id} label={NETWORKS[id]?.name ?? id} active={toChain === id}
              onPress={() => setToChain(id)} icon={<ChainIcon chainId={id} size={16} />} />
          ))}
        </ScrollView>

        {/* BUY */}
        <Card style={st.sideCard}>
          <Pressable onPress={() => setPicking("to")} style={st.tokenBtn}>
            {toToken && <AssetIcon symbol={toToken.symbol} logo={toToken.logo} chainId={toChain} address={toToken.address} size={28} />}
            <Text style={st.tokenBtnText}>{toToken?.symbol ?? "—"}</Text>
            <Text style={st.chev}>▾</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: "flex-end", paddingRight: 4 }}>
            <Text style={st.receiveText}>{best ? receive : quoting ? "…" : "0"}</Text>
            {buyUsd > 0 && <Text style={st.subText}>≈ {formatFiatLine(buyUsd, cur.code, cur.currency, w.rates)}</Text>}
          </View>
        </Card>

        {/* Routes */}
        {routes.length > 0 && (
          <View style={{ marginTop: 12 }}>
            <SectionLabel text="Routes" />
            {routes.map((r, i) => (
              <Pressable key={r.id} onPress={() => setSelRoute(i)} style={[st.routeRow, i === selRoute && st.routeSel]}>
                <Text style={st.routeName}>{routeName(r)}</Text>
                {r.tags?.[0] && <Text style={st.routeTag}>{r.tags[0]}</Text>}
                <View style={{ flex: 1 }} />
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={st.routeAmt}>{receiveAmount(r, toToken)} {toToken?.symbol}</Text>
                  <Text style={st.subText}>Gas ~${parseFloat(r.gasCostUSD || "0").toFixed(2)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
        {quoting && routes.length === 0 && <Text style={[st.subText, { marginTop: 12 }]}>Finding bridge routes…</Text>}

        {errView && (
          <AlertCard tone={errView.preSend ? "amber" : "danger"} title={errView.title} body={errView.body}
            hint={errView.hint} safe={errView.preSend} style={{ marginTop: 12 }} />
        )}

        <Btn
          label={bridging ? "Bridging…" : fromToken && toToken ? `Bridge ${fromToken.symbol} → ${toToken.symbol}` : "Bridge"}
          onPress={() => { void handleBridge(); }}
          disabled={bridging || quoting || !routes.length || !(parseFloat(amount) > 0)}
          style={{ marginTop: 16, marginBottom: 24 }}
        />
      </ScrollView>

      {txFx && (
        <TxResultOverlay
          status={txFx}
          kind="bridge"
          amountLabel={fromToken && toToken ? `${amount} ${fromToken.symbol} → ${receive} ${toToken.symbol}` : ""}
          detail={txDetail || undefined}
          txHash={txHash || undefined}
          explorerUrl={txHash ? explorerTxUrl(fromChain, txHash) : undefined}
          errorTitle={errView?.title}
          errorMessage={errView?.body}
          onClose={() => { if (txFx === "success") onBack(); setTxFx(null); }}
        />
      )}
    </View>
  );
}

function receiveAmount(r: BridgeRoute, to: SwapToken | null): string {
  if (!to) return "";
  try { return parseFloat(ethers.formatUnits(r.toAmount, to.decimals)).toFixed(Math.min(to.decimals, 6)); }
  catch { return "0"; }
}

function routeName(r: BridgeRoute): string {
  return r.steps?.[0]?.toolDetails?.name || r.steps?.[0]?.tool || "Bridge";
}

const st = StyleSheet.create({
  sideCard: { flexDirection: "row", alignItems: "center", padding: 12, marginTop: 8, gap: 10 },
  tokenBtn: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingVertical: 6, paddingHorizontal: 8, borderRadius: radius.button,
    backgroundColor: "rgba(124, 109, 240, 0.10)",
  },
  tokenBtnText: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "600" },
  chev: { color: colors.muted, fontSize: 11 },
  receiveText: { color: colors.textPrimary, fontSize: 20, fontWeight: "600", fontVariant: ["tabular-nums"] },
  subRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, gap: 10 },
  subText: { color: colors.muted2, fontSize: 10.5 },
  maxInline: { color: colors.brand2, fontWeight: "700" },
  routeRow: {
    flexDirection: "row", alignItems: "center", padding: 12, marginTop: 6,
    borderRadius: radius.button, borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card, gap: 8,
  },
  routeSel: { borderColor: colors.brand },
  routeName: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600" },
  routeTag: {
    color: colors.brand2, fontSize: 9.5, fontWeight: "700",
    backgroundColor: "rgba(124, 109, 240, 0.14)",
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden",
  },
  routeAmt: { color: colors.textPrimary, fontSize: ts.row, fontVariant: ["tabular-nums"] },
  tokenRow: {
    flexDirection: "row", alignItems: "center", paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider,
  },
  tokenSym: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600" },
  tokenSub: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
  tokenBal: { color: colors.textPrimary, fontSize: ts.row, fontVariant: ["tabular-nums"] },
});
