// Mobile Swap — one screen for same-chain swaps AND cross-chain bridges, the
// way the extension's Swap page works: the mode is DERIVED from the pair
// (fromToken.chainId !== toToken.chainId is a bridge), never chosen from a
// menu. Same-chain runs through the shared swap engine (@numpay/core/swap:
// ParaSwap / KyberSwap / Relay on EVM, Jupiter on Solana); cross-chain runs
// through LI.FI routes + executeBridge in the same core module, so every chain
// core can route (23 incl. Solana) is offered here, not a hand-kept list.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ethers } from "ethers";
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { NETWORKS } from "@numpay/core/networks";
import { getUsdPrice } from "@numpay/core/currency";
import {
  evmSwapReserve, SOL_FEE_RESERVE, parseSwapError, sanitizeSlippagePct,
  type BridgeRoute, type RouteOption, type SwapToken,
} from "@numpay/core/swap";
import { upsertCustomToken } from "@numpay/core/customTokens";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import {
  detectToken, detectErrorMessage, isTokenAddressFor, looksLikeTokenAddress,
} from "../wallet/tokenDetect";
import { fetchEvmQuotes, swapEvm, fetchSolanaSwapQuotes, swapSolana } from "../wallet/swap";
import { bridgeTokens, canBridge, fetchBridgeRoutes } from "../wallet/bridge";
import { buildChainTokenList, buildSolanaTokenList } from "../wallet/tokenList";
import { explorerTxUrl } from "../wallet/send";
import type { MobileWalletState } from "../wallet/useMobileWallet";
import { colors, radius, type as ts } from "../ui/theme";
import { Notice, Btn, Chip, Card, Field, IconBtn, ScreenHeader, SectionLabel } from "../ui/components";
import { Sheet, SheetActions, SheetPanel, SheetRow } from "../ui/Sheet";
import { useCurrencyPref, formatFiatLine } from "../ui/currency";
import { AssetIcon, ChainBadge, ChainIcon, LogoCoin } from "../ui/coins";
import { ChevronDownIcon, LayersIcon, SearchIcon, SettingsIcon, SwapIcon, XIcon } from "../ui/icons";
import { ImportTokenCard } from "../ui/ImportTokenCard";
import { TxResultOverlay, type TxFxStatus } from "../ui/TxResultOverlay";

const QUOTE_DEBOUNCE_MS = 700;

// Unfunded chains sort by real-world swap usage, not NETWORKS insertion order
// (which led with a wall of L2s). Chains outside this list keep their
// NETWORKS order after it.
const SWAP_CHAIN_ORDER = [
  "ethereum", "solana", "base", "bsc", "arbitrum", "polygon", "optimism", "avalanche",
];

const chainLabel = (id: string) => (id === "solana" ? "Solana" : NETWORKS[id]?.name ?? id);

/** Bridge routes carry a raw destination amount; swap routes carry a formatted one. */
function bridgeReceive(r: BridgeRoute, to: SwapToken | null): string {
  if (!to) return "";
  try { return parseFloat(ethers.formatUnits(r.toAmount, to.decimals)).toFixed(Math.min(to.decimals, 6)); }
  catch { return "0"; }
}

function bridgeName(r: BridgeRoute): string {
  return r.steps?.[0]?.toolDetails?.name || r.steps?.[0]?.tool || "Bridge";
}

/** LI.FI quotes carry the bridge's own mark and its expected duration. */
function bridgeLogo(r: BridgeRoute): string {
  return r.steps?.[0]?.toolDetails?.logoURI || "";
}

function bridgeMinutes(r: BridgeRoute): number | null {
  const dur = r.steps?.[0]?.estimate?.executionDuration;
  return dur ? Math.ceil(dur / 60) : null;
}

export function SwapScreen({ w, onBack, onSessionExpired, initialChainId, initialFromAddr }: {
  w: MobileWalletState;
  onBack: () => void;
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

  // Tokens for one chain: the EVM builder, or the Solana one (Solana lives
  // outside NETWORKS/DEFAULT_TOKENS).
  const listFor = useCallback(
    (id: string) => (id === "solana"
      ? buildSolanaTokenList(w.rows, w.tokensByChain)
      : buildChainTokenList(id, w.rows, w.tokensByChain)),
    [w.rows, w.tokensByChain],
  );

  const [fromToken, setFromToken] = useState<SwapToken | null>(null);
  const [toToken, setToToken] = useState<SwapToken | null>(null);

  // The pair is the only state that matters (extension parity). This screen
  // has NO chain selector: the sell chain is simply wherever the sell token
  // lives, you change it by picking a token on another chain inside the
  // picker, and the pair alone decides swap vs bridge. Deriving it rather
  // than storing it is what lets a cross-chain pick stand instead of being
  // reset by a chain-change effect.
  const chainId = fromToken?.chainId ?? initialChainId ?? chains[0] ?? "ethereum";

  const [picking, setPicking] = useState<"from" | "to" | null>(null);
  // The picker's own chain row is the only place chains are chosen. It opens
  // on the current side's chain and can browse any chain's tokens; picking a
  // buy-side token on another chain turns the pair into a bridge in place.
  const [pickerChain, setPickerChain] = useState(initialChainId ?? chains[0] ?? "ethereum");
  // One field does both jobs: it filters the list, and when what you typed is
  // a contract address instead of a name it becomes the import flow. A wallet
  // that lists 23 chains of tokens is unusable without the first, and the
  // second is the only way to reach a token free-tier discovery never returned.
  const [search, setSearch] = useState("");
  const [importState, setImportState] = useState<"idle" | "loading" | "preview">("idle");
  const [importToken, setImportToken] = useState<SwapToken | null>(null);
  const [importError, setImportError] = useState("");
  const [amount, setAmount] = useState("");
  const [slippage, setSlippage] = useState("0.5");
  // Slippage lives behind the header gear, as in the extension: it is a setting,
  // not a step in the flow, and giving it a permanent row on a phone screen
  // pushed the routes below the fold.
  const [showSettings, setShowSettings] = useState(false);
  const [routes, setRoutes] = useState<RouteOption[]>([]);
  const [bRoutes, setBRoutes] = useState<BridgeRoute[]>([]);
  const [selRoute, setSelRoute] = useState(0);
  const [quoting, setQuoting] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [txFx, setTxFx] = useState<TxFxStatus | null>(null);
  const [txDetail, setTxDetail] = useState("");
  const [txHash, setTxHash] = useState("");
  // Pre-sign preview. The CTA opens this; only its own confirm button signs.
  const [showConfirm, setShowConfirm] = useState(false);
  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const quoteSeq = useRef(0);

  const toChainId = toToken?.chainId ?? chainId;
  const isBridge = !!fromToken && !!toToken && fromToken.chainId !== toToken.chainId;
  const solanaAddress = w.nonEvmAddresses?.solana;

  // Seed the pair once, on the entry chain: native → first stable-ish default,
  // or the TokenDetail entry token → native. Runs once and never again, so a
  // later cross-chain pick is never undone.
  const seeded = useRef(false);
  useEffect(() => {
    if (seeded.current) return;
    const list = listFor(initialChainId ?? chains[0] ?? "ethereum");
    if (list.length === 0) return;
    seeded.current = true;
    const native = list[0];
    let from = native;
    if (initialFromAddr) {
      const m = list.find((t) => t.address?.toLowerCase() === initialFromAddr.toLowerCase());
      if (m) from = m;
    }
    setFromToken(from);
    setToToken(from === native ? (list.find((t) => t.address) ?? null) : native);
  }, [chains, listFor, initialChainId, initialFromAddr]);

  // Held balances stream in after mount, and with no chain-change effect left
  // to rebuild the pair there is nothing else to pick them up: re-read the
  // selected tokens' balances as their chain's data lands, or a funded wallet
  // keeps reading "Balance 0" and MAX yields nothing.
  useEffect(() => {
    const sync = (prev: SwapToken | null): SwapToken | null => {
      if (!prev) return prev;
      const found = listFor(prev.chainId).find(
        (t) => (t.address ?? "").toLowerCase() === (prev.address ?? "").toLowerCase(),
      );
      return found && found.balance !== prev.balance ? { ...prev, balance: found.balance } : prev;
    };
    setFromToken(sync);
    setToToken(sync);
  }, [listFor]);

  // The token picker is internal screen state (the `if (picking)` block below),
  // not a route, so App.tsx's global back handler can't see it: a hardware back
  // there would fall through to the "swap" case and unwind the whole screen,
  // losing any typed search or half-finished import. Register a picker-scoped
  // handler while `picking` is set — RN fires the newest listener first, so
  // returning true here consumes the press before App's ever runs. This hook
  // sits ABOVE the early return on purpose: moving it below would change the
  // hook count between renders and throw. A back inside an open import
  // preview/loading backs out to the list first, one level at a time.
  useEffect(() => {
    if (!picking) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (importState !== "idle") {
        setImportState("idle"); setImportToken(null); setImportError("");
        return true;
      }
      setPicking(null);
      resetSearch();
      return true;
    });
    return () => sub.remove();
  }, [picking, importState]);

  const scheduleQuote = useCallback((amt: string, from: SwapToken | null, to: SwapToken | null) => {
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    setRoutes([]); setBRoutes([]); setSelRoute(0); setError("");
    if (!from || !to || !(parseFloat(amt) > 0)) return;
    const cross = from.chainId !== to.chainId;
    if (!cross && from.address === to.address && !from.address === !to.address) return;
    if (cross && (!canBridge(from.chainId) || !canBridge(to.chainId))) {
      setError(`Bridge not supported for ${chainLabel(from.chainId)} → ${chainLabel(to.chainId)} yet`);
      return;
    }
    const seq = ++quoteSeq.current;
    setQuoting(true);
    quoteTimer.current = setTimeout(async () => {
      if (cross) {
        // Cross-chain: LI.FI routes, fetched in core (shared with the extension).
        const { routes: found, error: err } = await fetchBridgeRoutes(
          from, to, amt, w.evmAddress, sanitizeSlippagePct(slippage), solanaAddress,
        );
        if (seq !== quoteSeq.current) return;
        setQuoting(false);
        setBRoutes(found);
        if (err) setError(err);
        return;
      }
      const found = from.chainId === "solana"
        ? await fetchSolanaSwapQuotes(from, to, amt, sanitizeSlippagePct(slippage))
        : await fetchEvmQuotes(from.chainId, from, to, amt, w.evmAddress, sanitizeSlippagePct(slippage));
      if (seq !== quoteSeq.current) return;
      setQuoting(false);
      setRoutes(found);
      if (found.length === 0) setError("No routes found. Try a different amount or pair.");
    }, QUOTE_DEBOUNCE_MS);
  }, [slippage, w.evmAddress, solanaAddress]);

  function handleAmount(v: string) {
    const clean = v.replace(/[^0-9.]/g, "");
    setAmount(clean);
    scheduleQuote(clean, fromToken, toToken);
  }

  // Amount presets (extension parity: 25 / 50 / 75 / MAX). Every one of them is
  // reserve-aware, not just MAX: the reserve caps the result, so a 75% of a
  // nearly-empty native balance can still not exceed what is actually spendable.
  async function applyPreset(p: number) {
    if (!fromToken) return;
    const bal = parseFloat(fromToken.balance) || 0;
    if (bal <= 0) return;
    // Native input pays the fee out of this same balance: SOL keeps its fee +
    // ATA-rent cushion, a native EVM coin reserves the live estimated fee for an
    // aggregator-sized tx (a bridge costs more gas than a swap, hence the flag).
    // ERC-20s and SPL tokens need none, the fee comes from the native coin.
    const isNativeSol = fromToken.chainId === "solana" && !fromToken.address;
    const isNativeEvm = !fromToken.address && !!NETWORKS[fromToken.chainId];
    const reserve = isNativeSol
      ? SOL_FEE_RESERVE
      : isNativeEvm ? await evmSwapReserve(fromToken.chainId, isBridge) : 0;
    const cap = Math.max(0, bal - reserve);
    const v = Math.min(bal * p, cap);
    const s = v > 0 ? String(Number(v.toFixed(Math.min(fromToken.decimals, 8)))) : "0";
    setAmount(s);
    scheduleQuote(s, fromToken, toToken);
  }

  // Only the picked side changes. The other side stands, so picking a token on
  // another chain is what turns the pair into a bridge (either direction) and
  // the sell chain follows the sell token with no separate state to keep in
  // step.
  function selectToken(t: SwapToken) {
    if (picking === "from") {
      setFromToken(t);
      scheduleQuote(amount, t, toToken);
    } else if (picking === "to") {
      setToToken(t);
      scheduleQuote(amount, fromToken, t);
    }
    setPicking(null);
    resetSearch();
  }

  function resetSearch() {
    setSearch(""); setImportState("idle"); setImportToken(null); setImportError("");
  }

  // ── Import by address ─────────────────────────────────────────────────────
  // The chain row above the field is the only chain selector on this screen
  // (see the pair comment), so an import always targets pickerChain. A pasted
  // address whose shape belongs to the other family is a wrong-network hint,
  // never a silent chain switch: the network a token lands on is exactly the
  // thing that must stay visible.
  async function handleImport() {
    const raw = search.trim();
    setImportState("loading"); setImportError("");
    try {
      const found = await detectToken(pickerChain, raw, {
        evmAddress: w.evmAddress, solanaAddress: solanaAddress,
      });
      setImportToken({
        symbol: found.symbol, name: found.name, logo: found.logo,
        address: pickerChain === "solana" ? raw : raw.toLowerCase(),
        decimals: found.decimals, balance: found.balance ?? "0",
        chainId: pickerChain, chainName: chainLabel(pickerChain), custom: true,
      });
      setImportState("preview");
    } catch (e: any) {
      setImportError(detectErrorMessage(e));
      setImportState("idle");
    }
  }

  async function confirmImport() {
    const t = importToken;
    if (!t?.address) return;
    // Persist through the shared store (dedupes by chain+address), then have
    // the wallet re-read it so the token also shows on the dashboard and in
    // the other pickers, not just in this swap.
    await upsertCustomToken({
      chainId: t.chainId, address: t.address, symbol: t.symbol,
      name: t.name, decimals: t.decimals, logo: t.logo,
    });
    void w.reloadCustom();
    selectToken(t);
  }

  function flip() {
    const f = fromToken, t = toToken;
    setFromToken(t); setToToken(f);
    scheduleQuote(amount, t, f);
  }

  const price = (t: SwapToken | null): number => {
    if (!t) return 0;
    if (t.priceUsd) return t.priceUsd;
    return w.rates ? getUsdPrice(t.symbol, w.rates) : 0;
  };

  async function handleSubmit() {
    if (!fromToken || !toToken || !(parseFloat(amount) > 0)) return;
    const bal = parseFloat(fromToken.balance) || 0;
    if (parseFloat(amount) > bal) { setError("Insufficient balance"); return; }
    const mnemonic = await getUnlockedMnemonic();
    if (!mnemonic) {
      setError("Wallet is locked. Unlock NumPay and try again.");
      onSessionExpired?.();
      return;
    }
    Keyboard.dismiss();
    setBusy(true); setError(""); setTxHash(""); setTxDetail(""); setTxFx("pending");
    try {
      let hash: string;
      if (isBridge) {
        const route = bRoutes[selRoute];
        if (!route) return;
        hash = await bridgeTokens(
          mnemonic, fromToken, toToken, amount, bridgeReceive(route, toToken),
          price(fromToken), setTxDetail, () => w.refresh(),
        );
      } else {
        const route = routes[selRoute];
        if (!route) return;
        if (fromToken.chainId === "solana") {
          const solBal = w.rows.find((r) => r.isNative && r.chainId === "solana")?.balanceNum ?? 0;
          setTxDetail("Confirming your swap on-chain…");
          hash = await swapSolana(
            mnemonic, route, fromToken, toToken, amount, route.destAmount, slippage, solBal,
            // Price moved past slippage during the fresh re-quote: refresh the display.
            () => scheduleQuote(amount, fromToken, toToken),
          );
        } else {
          hash = await swapEvm(
            mnemonic, fromToken.chainId, route, fromToken, toToken, amount, route.destAmount, slippage,
            setTxDetail, () => w.refresh(),
          );
        }
      }
      setTxHash(hash);
      setTxFx("success");
      // The whole point of a swap is that the FROM balance drops, often to
      // zero. That row only clears once the token indexer catches up with the
      // block, so this re-checks instead of asking once and caching the
      // pre-swap answer for the next three minutes.
      w.refreshAfterTx();
    } catch (e: any) {
      setError(e?.message || (isBridge ? "Bridge failed" : "Swap failed"));
      setTxFx("error");
    } finally {
      setBusy(false);
    }
  }

  const bestSwap = routes[selRoute];
  const bestBridge = bRoutes[selRoute];
  const hasRoute = isBridge ? !!bestBridge : !!bestSwap;
  const receiveAmt = isBridge
    ? (bestBridge ? bridgeReceive(bestBridge, toToken) : "")
    : (bestSwap?.destAmount ?? "");
  const sellUsd = fromToken && parseFloat(amount) > 0 ? parseFloat(amount) * price(fromToken) : 0;
  const buyUsd = isBridge
    ? (bestBridge?.toAmountUSD ? parseFloat(bestBridge.toAmountUSD)
       : (toToken && receiveAmt ? parseFloat(receiveAmt) * price(toToken) : 0))
    : (bestSwap?.destUsd ?? (toToken && bestSwap ? parseFloat(bestSwap.destAmount) * price(toToken) : 0));
  const errView = error ? parseSwapError(error, isBridge ? "Bridge" : "Swap") : null;

  // ── Pre-sign preview figures ──────────────────────────────────────────────
  // A bridge quote already prices the destination net of the bridge's own
  // fees and its toAmount is not a slippage-bounded DEX output, so the
  // minimum-received line is swap-only (the extension does the same).
  const minReceived = !isBridge && receiveAmt && toToken
    ? (parseFloat(receiveAmt) * (1 - sanitizeSlippagePct(slippage) / 100))
        .toFixed(Math.min(toToken.decimals, 6))
    : "";
  const routeLabel = isBridge
    ? (bestBridge ? bridgeName(bestBridge) : "—")
    : (bestSwap?.label ?? "—");
  // Which key signs decides where the funds land: a Solana-side leg pays out
  // to the Solana address, everything else to the EVM one.
  const payoutChain = isBridge ? toChainId : chainId;
  const recipient = (payoutChain === "solana" ? solanaAddress : w.evmAddress) || "";

  // Who is actually quoting. Naming them is the honest version of "best price":
  // the wallet is not the venue, it is reading these aggregators.
  const providerLine = isBridge
    ? "Powered by LI.FI"
    : chainId === "solana" ? "Powered by Jupiter" : "ParaSwap · KyberSwap · Relay";

  // Unit price of the pair as quoted. Swap-only: a bridge's destination amount
  // is net of bridge fees, so a "1 X ≈ Y" line there would read as a market
  // rate while actually being rate-minus-fees.
  const rateLine = !isBridge && hasRoute && receiveAmt && parseFloat(amount) > 0 && fromToken && toToken
    ? `1 ${fromToken.symbol} ≈ ${(parseFloat(receiveAmt) / parseFloat(amount)).toFixed(4)} ${toToken.symbol}`
    : "";

  // Token picker takes over the screen while active: the wallet's own
  // holdings first (with balance + fiat value), then the curated list —
  // extension picker semantics, so held tokens are never buried under
  // buy-side stables.
  if (picking) {
    const balOf = (t: SwapToken) => parseFloat(t.balance) || 0;
    const q = search.trim().toLowerCase();
    // A pasted address is matched against the list FIRST. Pasting the address
    // of a token already listed should just find it, not walk the user through
    // importing something they already have.
    const matches = (t: SwapToken) =>
      !q || t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q) ||
      (t.address ?? "").toLowerCase() === q;
    const pickerTokens = listFor(pickerChain).filter(matches);
    const held = pickerTokens
      .filter((t) => balOf(t) > 0)
      .sort((a, b) => balOf(b) * price(b) - balOf(a) * price(a));
    const others = pickerTokens.filter((t) => balOf(t) <= 0);
    // Import is offered only when the query is an address, nothing in the list
    // already matches it, and the shape belongs to the selected chain.
    const isAddrQuery = looksLikeTokenAddress(search.trim());
    const rightShape = isTokenAddressFor(pickerChain, search.trim());
    const showImport = isAddrQuery && pickerTokens.length === 0;
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
    const crossPick = picking === "to" && pickerChain !== chainId;
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader
          title={picking === "from" ? "Sell" : "Buy"}
          onBack={() => { setPicking(null); resetSearch(); }}
        />
        {/* Chain row inside the picker: browse any chain's tokens. */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 8 }}>
          {chains.map((id) => (
            <Chip
              key={id}
              label={chainLabel(id)}
              active={pickerChain === id}
              onPress={() => {
                setPickerChain(id);
                // A half-finished import belongs to the chain it was started
                // on; carrying its preview across would offer to add a token
                // on a network it was never looked up against.
                setImportState("idle"); setImportToken(null); setImportError("");
              }}
              icon={<ChainIcon chainId={id} size={16} />}
            />
          ))}
        </ScrollView>
        <View style={st.searchRow}>
          <SearchIcon size={15} color={colors.muted} />
          <Field
            placeholder="Search or paste a token address"
            autoCapitalize="none"
            autoCorrect={false}
            value={search}
            onChangeText={(v) => {
              setSearch(v);
              setImportState("idle"); setImportToken(null); setImportError("");
            }}
            style={st.searchField}
          />
          {search.length > 0 && (
            <Pressable onPress={resetSearch} hitSlop={8} accessibilityLabel="Clear search">
              <XIcon size={12} color={colors.muted} />
            </Pressable>
          )}
        </View>
        {crossPick && (
          <Text style={[st.subText, { marginBottom: 6 }]}>
            {canBridge(pickerChain) && canBridge(chainId)
              ? `Buying on ${chainLabel(pickerChain)} while selling on ${chainLabel(chainId)} bridges across chains.`
              : `Bridging ${chainLabel(chainId)} → ${chainLabel(pickerChain)} is not supported yet.`}
          </Text>
        )}
        <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
          {showImport && (
            <ImportTokenCard
              address={search.trim()}
              chainId={pickerChain}
              chainName={chainLabel(pickerChain)}
              rightShape={rightShape}
              state={importState}
              token={importToken}
              error={importError}
              onFetch={() => { void handleImport(); }}
              onCancel={() => { setImportState("idle"); setImportToken(null); }}
              onAdd={() => { void confirmImport(); }}
            />
          )}
          {!showImport && pickerTokens.length === 0 && (
            <Text style={[st.subText, { textAlign: "center", marginTop: 28 }]}>
              No token matches “{search.trim()}” on {chainLabel(pickerChain)}.{"\n"}
              Paste its contract address to import it.
            </Text>
          )}
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
      <ScreenHeader
        title={isBridge ? "Bridge" : "Swap"}
        subtitle={providerLine}
        onBack={onBack}
        right={
          <IconBtn onPress={() => setShowSettings((s) => !s)} label="Swap settings">
            <SettingsIcon size={15} color={showSettings ? colors.brand2 : colors.muted} />
          </IconBtn>
        }
      />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Slippage, behind the gear. Chips for the common values plus a free
            field, because a thin pair on a small-cap token sometimes needs a
            number the chips do not offer. */}
        {showSettings && (
          <Card style={st.settingsCard}>
            <SectionLabel text="Slippage tolerance" style={{ marginTop: 0, marginBottom: 8 } as object} />
            <View style={st.slipRow}>
              {["0.1", "0.5", "1.0"].map((v) => (
                <Chip key={v} label={`${v}%`} active={slippage === v} onPress={() => setSlippage(v)} />
              ))}
              <Field
                value={slippage}
                onChangeText={(v) => setSlippage(v.replace(/[^0-9.]/g, ""))}
                keyboardType="decimal-pad"
                placeholder="%"
                style={st.slipInput}
              />
            </View>
          </Card>
        )}

        {/* SELL */}
        <SectionLabel text={isBridge ? `Sell on ${chainLabel(chainId)}` : "Sell"} style={{ marginTop: 10 } as object} />
        <Card style={st.sideCard}>
          <Pressable onPress={() => { setPickerChain(chainId); setPicking("from"); }} style={st.tokenBtn}>
            {fromToken && (
              <View style={{ width: 28, height: 28 }}>
                <AssetIcon symbol={fromToken.symbol} logo={fromToken.logo} chainId={chainId} address={fromToken.address} size={28} />
                {!!fromToken.address && <ChainBadge chainId={chainId} size={12} />}
              </View>
            )}
            <View>
              <Text style={st.tokenBtnText}>{fromToken?.symbol ?? "—"}</Text>
              <Text style={st.tokenBtnChain}>{chainLabel(chainId)}</Text>
            </View>
            <ChevronDownIcon size={12} color={colors.muted} />
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
          </Text>
          <Text style={st.subText}>{sellUsd > 0 ? `≈ ${formatFiatLine(sellUsd, cur.code, cur.currency, w.rates)}` : " "}</Text>
        </View>
        {/* Amount presets. Hidden on a zero balance: there is nothing for a
            percentage to be a percentage OF, and the extension hides them too. */}
        {(parseFloat(fromToken?.balance || "0") || 0) > 0 && (
          <View style={st.presetRow}>
            {[{ l: "25%", p: 0.25 }, { l: "50%", p: 0.5 }, { l: "75%", p: 0.75 }, { l: "MAX", p: 1 }].map(({ l, p }) => (
              <Pressable key={l} onPress={() => { void applyPreset(p); }} style={st.presetBtn}>
                <Text style={st.presetText}>{l}</Text>
              </Pressable>
            ))}
          </View>
        )}

        {/* Flip. Doubles as the mode indicator, the way the extension's does:
            a plain swap arrow while the pair is same-chain, and a brand-tinted
            "BRIDGE" pill the moment the pair spans two chains. It is the cue
            that tells the user a cross-chain pick changed what this screen
            will do, without ever leaving the screen. */}
        <Pressable onPress={flip} style={[st.flipBtn, isBridge && st.flipBtnBridge]}>
          {isBridge ? (
            <>
              <LayersIcon size={12} color={colors.brand2} />
              <Text style={st.flipLabel}>BRIDGE</Text>
            </>
          ) : (
            <SwapIcon size={14} color={colors.muted} />
          )}
        </Pressable>

        {/* BUY */}
        <SectionLabel text={isBridge ? `Buy on ${chainLabel(toChainId)}` : "Buy"} />
        <Card style={st.sideCard}>
          <Pressable onPress={() => { setPickerChain(toChainId); setPicking("to"); }} style={st.tokenBtn}>
            {toToken && (
              <View style={{ width: 28, height: 28 }}>
                <AssetIcon symbol={toToken.symbol} logo={toToken.logo} chainId={toChainId} address={toToken.address} size={28} />
                <ChainBadge chainId={toChainId} size={12} />
              </View>
            )}
            <View>
              <Text style={st.tokenBtnText}>{toToken?.symbol ?? "—"}</Text>
              <Text style={st.tokenBtnChain}>{chainLabel(toChainId)}</Text>
            </View>
            <ChevronDownIcon size={12} color={colors.muted} />
          </Pressable>
          <View style={{ flex: 1, alignItems: "flex-end", paddingRight: 4 }}>
            <Text style={st.receiveText}>{hasRoute ? receiveAmt : quoting ? "…" : "0"}</Text>
            {buyUsd > 0 && <Text style={st.subText}>≈ {formatFiatLine(buyUsd, cur.code, cur.currency, w.rates)}</Text>}
            {!!rateLine && <Text style={st.subText}>{rateLine}</Text>}
          </View>
        </Card>

        {/* Routes */}
        {isBridge && bRoutes.length > 0 && (
          <View style={{ marginTop: 10 }}>
            <SectionLabel text="Routes" />
            {bRoutes.map((r, i) => {
              const logo = bridgeLogo(r);
              const mins = bridgeMinutes(r);
              return (
                <Pressable key={r.id} onPress={() => setSelRoute(i)} style={[st.routeRow, i === selRoute && st.routeSel]}>
                  {/* The bridge's own mark. LI.FI does not always send one, and
                      an anonymous row is worse than a generic layers disc. */}
                  {logo
                    ? <LogoCoin uri={logo} label={bridgeName(r)} size={20} />
                    : <View style={st.routeLogoFallback}><LayersIcon size={10} color={colors.muted} /></View>}
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <View style={st.routeNameRow}>
                      <Text style={st.routeName} numberOfLines={1}>{bridgeName(r)}</Text>
                      {r.tags?.[0] && <Text style={st.routeTag}>{r.tags[0]}</Text>}
                    </View>
                    {/* Time matters more on a bridge than on a swap: the funds
                        are in flight, not just pending a block. */}
                    <Text style={st.subText}>
                      Gas ~${parseFloat(r.gasCostUSD || "0").toFixed(2)}{mins ? ` · ~${mins} min` : ""}
                    </Text>
                  </View>
                  <View style={{ alignItems: "flex-end" }}>
                    <Text style={st.routeAmt}>{bridgeReceive(r, toToken)} {toToken?.symbol}</Text>
                  </View>
                </Pressable>
              );
            })}
          </View>
        )}
        {!isBridge && routes.length > 0 && (
          <View style={{ marginTop: 10 }}>
            <SectionLabel text="Routes" />
            {routes.map((r, i) => (
              <Pressable key={r.provider} onPress={() => setSelRoute(i)} style={[st.routeRow, i === selRoute && st.routeSel]}>
                {/* Same row shape as a bridge route, so the aggregator is named
                    and pictured on both sides of the mode switch. */}
                {r.logo
                  ? <LogoCoin uri={r.logo} label={r.label} size={20} />
                  : <View style={st.routeLogoFallback}><SwapIcon size={10} color={colors.muted} /></View>}
                <View style={{ flex: 1, minWidth: 0 }}>
                  <View style={st.routeNameRow}>
                    <Text style={st.routeName} numberOfLines={1}>{r.label}</Text>
                    {r.tag && <Text style={st.routeTag}>{r.tag}</Text>}
                  </View>
                  <Text style={st.subText}>Gas ~${parseFloat(r.gasCostUSD || "0").toFixed(2)}</Text>
                </View>
                <View style={{ alignItems: "flex-end" }}>
                  <Text style={st.routeAmt}>{r.destAmount} {toToken?.symbol}</Text>
                </View>
              </Pressable>
            ))}
          </View>
        )}
        {quoting && !hasRoute && (
          <Text style={[st.subText, { marginTop: 10 }]}>
            {isBridge ? "Finding bridge routes…" : "Fetching quotes…"}
          </Text>
        )}

        {errView && (
          <Notice
            tone={errView.preSend ? "caution" : "danger"}
            title={errView.title}
            body={errView.body}
            hint={errView.hint}
            safe={errView.preSend}
            style={{ marginTop: 12 }}
          />
        )}

        <Btn
          label={
            busy
              ? (isBridge ? "Bridging…" : "Swapping…")
              : fromToken && toToken
                ? (isBridge
                    ? `Bridge ${fromToken.symbol} → ${toToken.symbol}`
                    : `Swap ${fromToken.symbol} for ${toToken.symbol}`)
                : "Swap"
          }
          onPress={() => { Keyboard.dismiss(); setShowConfirm(true); }}
          disabled={busy || quoting || !hasRoute || !(parseFloat(amount) > 0)}
          style={{ marginTop: 16, marginBottom: 24 }}
        />
      </ScrollView>

      {/* Pre-sign preview (extension parity). Nothing is signed until the
          confirm button here is pressed, and the figures shown are the ones
          the execute path binds against. */}
      {fromToken && toToken && (
        <Sheet
          open={showConfirm}
          onClose={() => setShowConfirm(false)}
          title={isBridge ? "Confirm bridge" : "Confirm swap"}
          body="Nothing is signed until you confirm. The transaction is re-checked against this quote first, and the funds go to your own wallet."
          tone="info"
          icon={<SwapIcon size={20} color={colors.brand2} />}
        >
          <SheetPanel>
            <SheetRow label="You pay" value={`${amount} ${fromToken.symbol} · ${chainLabel(chainId)}`} strong />
            <SheetRow
              label="You receive"
              value={`≈ ${receiveAmt || "—"} ${toToken.symbol} · ${chainLabel(toChainId)}`}
              strong
            />
            {minReceived && (
              <SheetRow
                label="Minimum received"
                value={`${minReceived} ${toToken.symbol} · ${sanitizeSlippagePct(slippage)}% slippage`}
              />
            )}
            <SheetRow label="Route" value={routeLabel} />
            <SheetRow
              label="Recipient"
              value={recipient
                ? `Your wallet · ${recipient.slice(0, 6)}…${recipient.slice(-4)}`
                : "Your wallet"}
            />
          </SheetPanel>
          <SheetActions
            confirmLabel={isBridge ? "Confirm & bridge" : "Confirm & swap"}
            onConfirm={() => { setShowConfirm(false); void handleSubmit(); }}
            onCancel={() => setShowConfirm(false)}
          />
        </Sheet>
      )}

      {txFx && (
        <TxResultOverlay
          status={txFx}
          kind={isBridge ? "bridge" : "swap"}
          amountLabel={fromToken && toToken ? `${amount} ${fromToken.symbol} → ${receiveAmt} ${toToken.symbol}` : ""}
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
  // With no chain row on the screen, the token button is the only thing that
  // says which chain this side is on.
  tokenBtnChain: { color: colors.muted, fontSize: 9.5, marginTop: 1 },
  receiveText: { color: colors.textPrimary, fontSize: 20, fontWeight: "600", fontVariant: ["tabular-nums"] },
  subRow: { flexDirection: "row", justifyContent: "space-between", marginTop: 6, gap: 10 },
  subText: { color: colors.muted2, fontSize: 10.5 },
  // Preset pills (.pill-brand at chip scale): brand-tinted so they read as
  // controls, not as the muted balance text they sit under.
  presetRow: { flexDirection: "row", gap: 8, marginTop: 8 },
  presetBtn: {
    paddingHorizontal: 12, paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "rgba(124, 109, 240, 0.10)",
  },
  presetText: { color: colors.brand2, fontSize: 11, fontWeight: "700" },
  flipBtn: {
    alignSelf: "center",
    flexDirection: "row",
    alignItems: "center", justifyContent: "center",
    gap: 5,
    minWidth: 34, height: 34,
    paddingHorizontal: 10,
    borderRadius: radius.button,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    marginVertical: 8,
  },
  flipBtnBridge: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  flipLabel: {
    color: colors.brand2, fontSize: 10, fontWeight: "700",
    letterSpacing: 0.8,
  },
  settingsCard: { padding: 12, marginTop: 10 },
  slipRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  // Free-entry slippage: fixed width so the chips keep their size, and the
  // number is centred the way the extension's input is.
  slipInput: {
    width: 64, marginTop: 0,
    paddingVertical: 6, paddingHorizontal: 8,
    textAlign: "center", fontSize: 12,
  },
  routeLogoFallback: {
    width: 20, height: 20, borderRadius: 10,
    backgroundColor: colors.surface2,
    alignItems: "center", justifyContent: "center",
  },
  routeNameRow: { flexDirection: "row", alignItems: "center", gap: 6 },
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
  // Search row: the icon and the clear control sit beside the input rather
  // than floating on top of it (Field is a plain TextInput, and a 42-character
  // pasted address fills the full width).
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12,
    borderRadius: radius.input,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: 10,
  },
  searchField: {
    flex: 1, marginTop: 0,
    backgroundColor: "transparent", borderWidth: 0,
    paddingHorizontal: 0, paddingVertical: 11,
  },
  tokenRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  // The pre-sign preview's own scrim/sheet/row/action styles lived here until
  // it moved onto the shared Sheet primitive (ui/Sheet.tsx), which is now the
  // single definition of what a modal surface looks like in this app.
  tokenSym: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600" },
  tokenSub: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
  tokenBal: { color: colors.textPrimary, fontSize: ts.row, fontVariant: ["tabular-nums"] },
});
