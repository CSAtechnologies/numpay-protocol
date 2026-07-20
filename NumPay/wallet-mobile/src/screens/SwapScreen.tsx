// Mobile Swap — same-chain swaps through the shared core engine
// (@numpay/core/swap): EVM via ParaSwap / KyberSwap / Relay, Solana via
// Jupiter, with the fee config baked in, guard-checked execution, and the
// same error copy as the extension. Pickers offer the chain's native coin,
// the wallet's discovered tokens, and a curated buy-side list.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NETWORKS } from "@numpay/core/networks";
import { getUsdPrice } from "@numpay/core/currency";
import {
  evmSwapReserve, SOL_FEE_RESERVE, parseSwapError, sanitizeSlippagePct,
  type RouteOption, type SwapToken,
} from "@numpay/core/swap";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import { fetchEvmQuotes, swapEvm, fetchSolanaSwapQuotes, swapSolana } from "../wallet/swap";
import { buildChainTokenList, buildSolanaTokenList } from "../wallet/tokenList";
import { explorerTxUrl } from "../wallet/send";
import type { MobileWalletState } from "../wallet/useMobileWallet";
import { colors, radius, type as ts } from "../ui/theme";
import { AlertCard, Btn, Chip, Card, Field, ScreenHeader, SectionLabel } from "../ui/components";
import { useCurrencyPref, formatFiatLine } from "../ui/currency";
import { AssetIcon, ChainBadge, ChainIcon } from "../ui/coins";
import { TxResultOverlay, type TxFxStatus } from "../ui/TxResultOverlay";

const QUOTE_DEBOUNCE_MS = 700;

// Unfunded chains sort by real-world swap usage, not NETWORKS insertion order
// (which led with a wall of L2s). Chains outside this list keep their
// NETWORKS order after it.
const SWAP_CHAIN_ORDER = [
  "ethereum", "solana", "base", "bsc", "arbitrum", "polygon", "optimism", "avalanche",
];

export function SwapScreen({ w, onBack, onBridge, onSessionExpired, initialChainId, initialFromAddr }: {
  w: MobileWalletState;
  onBack: () => void;
  /** Cross-chain buy-side pick hands off to the Bridge flow. */
  onBridge?: () => void;
  onSessionExpired?: () => void;
  /** Preselect (TokenDetail "Swap" entry): the chain, and the sell-side token
   *  by contract/mint address (undefined = the chain's native coin). */
  initialChainId?: string;
  initialFromAddr?: string;
}) {
  // Every swappable chain, funded ones first (by USD value) so the chains the
  // user can actually sell from lead the row — but never HIDE a chain: quotes
  // are keyless and an empty wallet can still price a swap anywhere (extension
  // behavior; the funded-only chip row read as "only ETH and Solana").
  const chains = useMemo(() => {
    const funded = w.rows
      .filter((r) => r.isNative && r.balanceNum > 0 && (NETWORKS[r.chainId] || r.chainId === "solana"))
      .sort((a, b) => b.usdValue - a.usdValue)
      .map((r) => r.chainId);
    const rest = [...Object.keys(NETWORKS), "solana"]
      .filter((id) => !funded.includes(id))
      .sort((a, b) => {
        const ai = SWAP_CHAIN_ORDER.indexOf(a), bi = SWAP_CHAIN_ORDER.indexOf(b);
        return (ai === -1 ? SWAP_CHAIN_ORDER.length : ai) - (bi === -1 ? SWAP_CHAIN_ORDER.length : bi);
      });
    const list = [...funded, ...rest];
    if (initialChainId && !list.includes(initialChainId) &&
        (NETWORKS[initialChainId] || initialChainId === "solana")) {
      list.unshift(initialChainId);
    }
    return list;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w.rows]);

  const cur = useCurrencyPref();
  const [chainId, setChainId] = useState(initialChainId ?? chains[0] ?? "ethereum");
  // Consumed once by the pair-reset effect below, then cleared: chain switches
  // after entry go back to the native→default pairing.
  const initFromAddr = useRef(initialFromAddr?.toLowerCase());
  const isSolana = chainId === "solana";
  const net = NETWORKS[chainId];

  // Native + held + curated tokens for the chain (EVM builder, or the Solana
  // one — Solana lives outside NETWORKS/DEFAULT_TOKENS).
  const tokenList = useMemo(
    () => isSolana
      ? buildSolanaTokenList(w.rows, w.tokensByChain)
      : buildChainTokenList(chainId, w.rows, w.tokensByChain),
    [chainId, isSolana, w.rows, w.tokensByChain],
  );

  const [fromToken, setFromToken] = useState<SwapToken | null>(null);
  const [toToken, setToToken] = useState<SwapToken | null>(null);
  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  // The picker has its own chain row (extension parity): it opens on the
  // swap's chain but can browse any chain's tokens.
  const [pickerChain, setPickerChain] = useState(chainId);
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [selRoute, setSelRoute] = useState(0);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState("");
  const [swapping, setSwapping] = useState(false);
  const [txFx, setTxFx] = useState<TxFxStatus | null>(null);
  const [txDetail, setTxDetail] = useState("");
  const [txHash, setTxHash] = useState("");
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quoteSeq = useRef(0);

  // Reset the pair when the chain changes: native → first stable-ish default.
  // On TokenDetail entry the first pass instead sells the entry token → native.
  useEffect(() => {
    const native = tokenList[0] ?? null;
    let from = native;
    if (initFromAddr.current) {
      const m = tokenList.find((t) => t.address?.toLowerCase() === initFromAddr.current);
      if (m) from = m;
      initFromAddr.current = undefined;
    }
    setFromToken(from);
    setToToken(from === native ? (tokenList.find((t) => t.address) ?? null) : native);
    setAmount(""); setRoutes([]); setError(""); setTxHash("");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainId]);

  const scheduleQuote = useCallback((amt: string, from: SwapToken | null, to: SwapToken | null) => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    setRoutes([]); setSelRoute(0); setError("");
    if (!from || !to || !(parseFloat(amt) > 0)) return;
    if (from.address === to.address && !from.address === !to.address) return;
    const seq = ++quoteSeq.current;
    setQuoting(true);
    quoteTimer.current = setTimeout(async () => {
      const found = isSolana
        ? await fetchSolanaSwapQuotes(from, to, amt, sanitizeSlippagePct(slippage))
        : await fetchEvmQuotes(chainId, from, to, amt, w.evmAddress, sanitizeSlippagePct(slippage));
      if (seq !== quoteSeq.current) return;
      setQuoting(false);
      setRoutes(found);
      if (found.length === 0) setError("No routes found. Try a different amount or pair.");
    }, QUOTE_DEBOUNCE_MS);
  }, [chainId, isSolana, slippage, w.evmAddress]);

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
      // Native coin: hold back the network fee (SOL rent+fee, or live EVM gas).
      const reserve = isSolana ? SOL_FEE_RESERVE : await evmSwapReserve(chainId);
      v = Math.max(0, bal - reserve);
    }
    const s = v > 0 ? String(Number(v.toFixed(8))) : "0";
    setAmount(s);
    scheduleQuote(s, fromToken, toToken);
  }

  function selectToken(t: SwapToken) {
    if (picking === "from") {
      if (pickerChain !== chainId) {
        // Selling from another chain: move the whole swap there with this
        // token preselected (the pair-reset effect consumes the ref).
        initFromAddr.current = t.address?.toLowerCase();
        setPicking(null);
        setChainId(pickerChain);
        return;
      }
      setFromToken(t);
      scheduleQuote(amount, t, toToken);
    } else if (picking === "to") {
      if (pickerChain !== chainId) {
        // Buying on a different chain than the sell side is a bridge, not a
        // swap — hand off to the Bridge flow (extension auto-switch parity).
        setPicking(null);
        onBridge?.();
        return;
      }
      setToToken(t);
      scheduleQuote(amount, fromToken, t);
    }
    setPicking(null);
  }

  function flip() {
    const f = fromToken, t = toToken;
    setFromToken(t); setToToken(f);
    scheduleQuote(amount, t, f);
  }

  async function handleSwap() {
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
    setSwapping(true); setError(""); setTxHash(""); setTxDetail(""); setTxFx("pending");
    try {
      let hash: string;
      if (isSolana) {
        const solBal = w.rows.find((r) => r.isNative && r.chainId === "solana")?.balanceNum ?? 0;
        setTxDetail("Confirming your swap on-chain…");
        hash = await swapSolana(
          mnemonic, route, fromToken, toToken, amount, route.destAmount, slippage, solBal,
          // Price moved past slippage during the fresh re-quote: refresh the display.
          () => scheduleQuote(amount, fromToken, toToken),
        );
      } else {
        hash = await swapEvm(
          mnemonic, chainId, route, fromToken, toToken, amount, route.destAmount, slippage,
          setTxDetail, () => w.refresh(),
        );
      }
      setTxHash(hash);
      setTxFx("success");
      w.refresh();
    } catch (e: any) {
      setError(e?.message || "Swap failed");
      setTxFx("error");
    } finally {
      setSwapping(false);
    }
  }

  const price = (t: SwapToken | null): number => {
    if (!t) return 0;
    if (t.priceUsd) return t.priceUsd;
    return w.rates ? getUsdPrice(t.symbol, w.rates) : 0;
  };
  const sellUsd = fromToken && parseFloat(amount) > 0 ? parseFloat(amount) * price(fromToken) : 0;
  const best = routes[selRoute];
  const buyUsd = best?.destUsd ?? (toToken && best ? parseFloat(best.destAmount) * price(toToken) : 0);
  const errView = error ? parseSwapError(error) : null;

  // Token picker takes over the screen while active: the wallet's own
  // holdings first (with balance + fiat value), then the curated list —
  // extension picker semantics, so held tokens are never buried under
  // buy-side stables.
  if (picking) {
    const balOf = (t: SwapToken) => parseFloat(t.balance) || 0;
    const pickerTokens = pickerChain === chainId
      ? tokenList
      : pickerChain === "solana"
        ? buildSolanaTokenList(w.rows, w.tokensByChain)
        : buildChainTokenList(pickerChain, w.rows, w.tokensByChain);
    const held = pickerTokens
      .filter((t) => balOf(t) > 0)
      .sort((a, b) => balOf(b) * price(b) - balOf(a) * price(a));
    const others = pickerTokens.filter((t) => balOf(t) <= 0);
    const renderRow = (t: SwapToken) => {
      const bal = balOf(t);
      const usd = bal * price(t);
      return (
        <Pressable
          key={`${t.chainId}:${t.address ?? "native"}`}
          onPress={() => selectToken(t)}
          style={st.tokenRow}
        >
          <View style={{ width: 32, height: 32 }}>
            <AssetIcon symbol={t.symbol} logo={t.logo} chainId={t.chainId} address={t.address} size={32} />
            {!!t.address && <ChainBadge chainId={t.chainId} size={14} />}
          </View>
          <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
            <Text style={st.tokenSym} numberOfLines={1}>{t.symbol}</Text>
            <Text style={st.tokenSub} numberOfLines={1}>{t.name}</Text>
          </View>
          {bal > 0 && (
            <View style={{ alignItems: "flex-end" }}>
              <Text style={st.tokenBal}>
                {bal.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </Text>
              {usd > 0 && (
                <Text style={st.tokenSub}>
                  {formatFiatLine(usd, cur.code, cur.currency, w.rates)}
                </Text>
              )}
            </View>
          )}
        </Pressable>
      );
    };
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title={picking === "from" ? "Sell" : "Buy"} onBack={() => setPicking(null)} />
        {/* Chain row inside the picker: browse any chain's tokens. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 8 }}>
          {chains.map((id) => (
            <Chip
              key={id}
              label={id === "solana" ? "Solana" : NETWORKS[id]?.name ?? id}
              active={pickerChain === id}
              onPress={() => setPickerChain(id)}
              icon={<ChainIcon chainId={id} size={16} />}
            />
          ))}
        </ScrollView>
        {picking === "to" && pickerChain !== chainId && (
          <Text style={[st.subText, { marginBottom: 6 }]}>
            Buying on a different chain than you sell from is a bridge — picking a token here opens Bridge.
          </Text>
        )}
        <ScrollView showsVerticalScrollIndicator={false}>
          {held.length > 0 && <SectionLabel text="Your tokens" style={{ marginBottom: 4 } as object} />}
          {held.map(renderRow)}
          {held.length > 0 && others.length > 0 && (
            <SectionLabel text="All tokens" style={{ marginTop: 16, marginBottom: 4 } as object} />
          )}
          {others.map(renderRow)}
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Swap" onBack={onBack} />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Chain selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 4 }}>
          {chains.map((id) => (
            <Chip
              key={id}
              label={id === "solana" ? "Solana" : NETWORKS[id]?.name ?? id}
              active={chainId === id}
              onPress={() => setChainId(id)}
              icon={<ChainIcon chainId={id} size={16} />}
            />
          ))}
        </ScrollView>

        {/* SELL */}
        <SectionLabel text="Sell" style={{ marginTop: 10 } as object} />
        <Card style={st.sideCard}>
          <Pressable onPress={() => { setPickerChain(chainId); setPicking("from"); }} style={st.tokenBtn}>
            {fromToken && (
              <View style={{ width: 28, height: 28 }}>
                <AssetIcon symbol={fromToken.symbol} logo={fromToken.logo} chainId={chainId} address={fromToken.address} size={28} />
                {!!fromToken.address && <ChainBadge chainId={chainId} size={12} />}
              </View>
            )}
            <Text style={st.tokenBtnText}>{fromToken?.symbol ?? "—"}</Text>
            <Text style={st.chev}>▾</Text>
          </Pressable>
          <View style={{ flex: 1 }}>
            <Field
              placeholder="0.0"
              keyboardType="decimal-pad"
              value={amount}
              onChangeText={handleAmount}
              style={{ marginTop: 0, textAlign: "right" }}
            />
          </View>
        </Card>
        <View style={st.subRow}>
          <Text style={st.subText}>
            Balance {parseFloat(fromToken?.balance || "0").toLocaleString(undefined, { maximumFractionDigits: 6 })}
            {"  "}
            <Text style={st.maxInline} onPress={() => { void handleMax(); }}>MAX</Text>
          </Text>
          <Text style={st.subText}>{sellUsd > 0 ? `≈ ${formatFiatLine(sellUsd, cur.code, cur.currency, w.rates)}` : " "}</Text>
        </View>

        {/* Flip */}
        <Pressable onPress={flip} style={st.flipBtn}>
          <Text style={{ color: colors.brand2, fontSize: 16, fontWeight: "700" }}>⇅</Text>
        </Pressable>

        {/* BUY */}
        <SectionLabel text="Buy" />
        <Card style={st.sideCard}>
          <Pressable onPress={() => { setPickerChain(chainId); setPicking("to"); }} style={st.tokenBtn}>
            {toToken && (
              <View style={{ width: 28, height: 28 }}>
                <AssetIcon symbol={toToken.symbol} logo={toToken.logo} chainId={chainId} address={toToken.address} size={28} />
                {!!toToken.address && <ChainBadge chainId={chainId} size={12} />}
              </View>
            )}
            <Text style={st.tokenBtnText}>{toToken?.symbol ?? "—"}</Text>
            <Text style={st.chev}>▾</Text>
          </Pressable>
          <View style={{ flex: 1, alignItems: "flex-end", paddingRight: 4 }}>
            <Text style={st.receiveText}>{best ? best.destAmount : quoting ? "…" : "0"}</Text>
            {buyUsd > 0 && <Text style={st.subText}>≈ {formatFiatLine(buyUsd, cur.code, cur.currency, w.rates)}</Text>}
          </View>
        </Card>

        {/* Slippage */}
        <View style={st.slipRow}>
          <Text style={st.subText}>Slippage</Text>
          {["0.1", "0.5", "1"].map((v) => (
            <Chip key={v} label={`${v}%`} active={slippage === v} onPress={() => setSlippage(v)} />
          ))}
        </View>

        {/* Routes */}
        {routes.length > 0 && (
          <View style={{ marginTop: 10 }}>
            <SectionLabel text="Routes" />
            {routes.map((r, i) => (
              <Pressable key={r.provider} onPress={() => setSelRoute(i)} style={[st.routeRow, i === selRoute && st.routeSel]}>
                <Text style={st.routeName}>{r.label}</Text>
                {r.tag && <Text style={st.routeTag}>{r.tag}</Text>}
                <View style={{ flex: 1 }} />
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={st.routeAmt}>{r.destAmount} {toToken?.symbol}</Text>
                  <Text style={st.subText}>Gas ~${parseFloat(r.gasCostUSD || "0").toFixed(2)}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
        {quoting && routes.length === 0 && <Text style={[st.subText, { marginTop: 10 }]}>Fetching quotes…</Text>}

        {errView && (
          <AlertCard
            tone={errView.preSend ? "amber" : "danger"}
            title={errView.title}
            body={errView.body}
            hint={errView.hint}
            safe={errView.preSend}
            style={{ marginTop: 12 }}
          />
        )}

        <Btn
          label={swapping ? "Swapping…" : fromToken && toToken ? `Swap ${fromToken.symbol} for ${toToken.symbol}` : "Swap"}
          onPress={() => { void handleSwap(); }}
          disabled={swapping || quoting || !routes.length || !(parseFloat(amount) > 0)}
          style={{ marginTop: 16, marginBottom: 24 }}
        />
      </ScrollView>

      {txFx && (
        <TxResultOverlay
          status={txFx}
          kind="swap"
          amountLabel={fromToken && toToken ? `${amount} ${fromToken.symbol} → ${best?.destAmount ?? ""} ${toToken.symbol}` : ""}
          detail={txDetail || undefined}
          txHash={txHash || undefined}
          explorerUrl={txHash ? explorerTxUrl(chainId, txHash) : undefined}
          errorTitle={errView?.title}
          errorMessage={errView?.body}
          onClose={() => { if (txFx === "success") onBack(); setTxFx(null); }}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  sideCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginTop: 8,
    gap: 10,
  },
  tokenBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderRadius: radius.button,
    backgroundColor: "rgba(124, 109, 240, 0.10)",
  },
  tokenBtnText: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "600" },
  chev: { color: colors.muted, fontSize: 11 },
  receiveText: { color: colors.textPrimary, fontSize: 20, fontWeight: "600", fontVariant: ["tabular-nums"] },
  subRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, gap: 10 },
  subText: { color: colors.muted2, fontSize: 10.5 },
  maxInline: { color: colors.brand2, fontWeight: "700" },
  flipBtn: {
    alignSelf: "center",
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
    marginVertical: 8,
  },
  slipRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 12 },
  routeRow: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginTop: 6,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
    gap: 8,
  },
  routeSel: { borderColor: colors.brand },
  routeName: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600" },
  routeTag: {
    color: colors.brand2, fontSize: 9.5, fontWeight: "700",
    backgroundColor: "rgba(124, 109, 240, 0.14)",
    paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6,
    overflow: "hidden",
  },
  routeAmt: { color: colors.textPrimary, fontSize: ts.row, fontVariant: ["tabular-nums"] },
  tokenRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  tokenSym: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600" },
  tokenSub: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
  tokenBal: { color: colors.textPrimary, fontSize: ts.row, fontVariant: ["tabular-nums"] },
});
