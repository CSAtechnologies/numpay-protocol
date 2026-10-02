import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ethers } from "ethers";
import { useWallet } from "../hooks/useWallet";
import { useCurrency } from "../hooks/useCurrency";
import { usdToDisplayCurrency, getUsdPrice } from "@numpay/core/currency";
import { NETWORKS } from "@numpay/core/networks";
import { DEFAULT_TOKENS } from "@numpay/core/tokens";
import { markBalancesDirty } from "@numpay/core/balanceBus";
import { logTx } from "@numpay/core/txLog";
import { type NonEvmChain } from "@numpay/core/chains";
import { resolveSolanaToken } from "@numpay/core/chains/solana";
import { getSigner, isLocked } from "@numpay/core/wallet";
import { getCustomTokens, upsertCustomToken } from "@numpay/core/customTokens";
import Layout from "../components/Layout";
import AlertCard, { InlineNotice } from "../components/AlertCard";
import TxResultOverlay, { type TxFxStatus } from "../components/TxResultOverlay";
import {
  SwapIcon, ChevronDownIcon, SettingsIcon, ChainIcon, ChainBadge, AssetIcon,
  SearchIcon, ArrowLeftIcon, ExternalLinkIcon, RefreshIcon, CheckIcon,
  LayersIcon,
} from "../components/Icons";

// Swap engine (types, fee config, quote fetchers, reserves, error parsing)
// lives in @numpay/core/swap so the mobile app shares it. Only the React
// component and its presentation stay here.
import {
  type SwapToken, type RouteOption, type BridgeRoute,
  ERC20_ABI, chainRank,
  isAddress, isSolanaMint, SOL_FEE_RESERVE,
  evmSwapReserve, sanitizeSlippagePct,
  buildAllSwapTokens, fetchParaswapQuote, fetchKyberQuote, fetchRelayQuote, parseSwapError,
  executeEvmSwap, fetchBridgeRoutes, executeBridge as executeBridgeCore,
  fetchJupiterSwapQuote, executeSolanaSwap,
} from "@numpay/core/swap";

const TAG_STYLE: Record<string, string> = {
  RECOMMENDED: "bg-brand-500/15 text-brand-400",
  CHEAPEST:    "bg-accent-green/15 text-accent-green",
  FASTEST:     "bg-amber/15 text-amber",
};

function SwapErrorCard({ message, tone, kind = "Swap" }: { message: string; tone: "danger" | "amber"; kind?: "Swap" | "Bridge" }) {
  const e = parseSwapError(message, kind);
  return (
    <AlertCard
      title={e.title} body={e.body} hint={e.hint} tone={tone}
      figures={e.figures ? { ...e.figures, unit: "SOL" } : undefined}
    />
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function Swap() {
  const { wallet, network, balance, tokens, chainBalances, nonEvmWallet, nonEvmChains, tokensByChain } = useWallet();
  const { currencyCode, currency, rates } = useCurrency();

  // The user's held Solana SPL tokens, shaped for the swap picker.
  const solanaHeld = useMemo<SwapToken[]>(() => {
    return (tokensByChain["solana"] ?? []).map((t) => ({
      symbol: t.symbol, name: t.name, logo: t.logo, address: t.address,
      decimals: t.decimals, balance: t.balance || "0", chainId: "solana", chainName: "Solana",
      priceUsd: (t as any).priceUsd, possibleSpam: (t as any).possibleSpam,
    }));
  }, [tokensByChain]);

  // The user's held EVM tokens across all chains (so any held token is swappable).
  const evmHeld = useMemo<SwapToken[]>(() => {
    const out: SwapToken[] = [];
    for (const [chainId, toks] of Object.entries(tokensByChain)) {
      const net = NETWORKS[chainId];
      if (!net) continue; // EVM built-in chains only (solana handled above)
      for (const t of toks) {
        if (!t.address) continue;
        out.push({
          symbol: t.symbol, name: t.name, logo: t.logo, address: t.address,
          decimals: t.decimals, balance: t.balance || "0", chainId, chainName: net.name,
          priceUsd: (t as any).priceUsd, possibleSpam: (t as any).possibleSpam,
        });
      }
    }
    return out;
  }, [tokensByChain]);

  // Custom tokens (persisted via lib/customTokens — the shared single-schema
  // store). Balance shows 0 in the picker until held balances merge in; the
  // old path persisted a stale balance snapshot, which was no better.
  const [customTokens, setCustomTokens] = useState<SwapToken[]>([]);
  useEffect(() => {
    getCustomTokens().then((list) => {
      setCustomTokens(list.map((ct) => ({
        symbol: ct.symbol, name: ct.name, address: ct.address, decimals: ct.decimals,
        logo: ct.logo, balance: "0", chainId: ct.chainId,
        chainName: NETWORKS[ct.chainId]?.name ?? ct.chainId, custom: true,
      })));
    }).catch(() => {});
  }, []);

  const allTokens = useMemo(
    () => buildAllSwapTokens(chainBalances, tokens, network.id, customTokens, nonEvmChains, solanaHeld, evmHeld),
    [chainBalances, tokens, network.id, customTokens, nonEvmChains, solanaHeld, evmHeld],
  );

  // Default tokens
  const makeDefault = useCallback((side: "from" | "to"): SwapToken => {
    const net = NETWORKS[network.id] || NETWORKS["ethereum"];
    if (side === "from") {
      const cb = chainBalances.find((c) => c.networkId === net.id);
      return { symbol: net.symbol, name: net.name, logo: net.logo, decimals: net.decimals,
        balance: cb?.balance || balance || "0", chainId: net.id, chainName: net.name };
    }
    const usdc = (DEFAULT_TOKENS[net.chainId] || []).find((t) => t.symbol === "USDC");
    if (usdc) return { symbol: usdc.symbol, name: usdc.name, logo: usdc.logo, address: usdc.address,
      decimals: usdc.decimals, balance: "0", chainId: net.id, chainName: net.name };
    const arb = NETWORKS["arbitrum"];
    return { symbol: arb.symbol, name: arb.name, logo: arb.logo, decimals: arb.decimals,
      balance: "0", chainId: "arbitrum", chainName: arb.name };
  }, [network.id, balance, chainBalances]);

  const [fromToken,    setFromToken]    = useState<SwapToken>(() => makeDefault("from"));
  const [toToken,      setToToken]      = useState<SwapToken>(() => makeDefault("to"));
  const [fromAmount,   setFromAmount]   = useState("");
  const [slippage,     setSlippage]     = useState("0.5");
  const [showSettings, setShowSettings] = useState(false);

  // Picker state
  const [pickerMode,   setPickerMode]   = useState<"from" | "to" | null>(null);
  const [pickerSearch, setPickerSearch] = useState("");
  const [pickerChain,  setPickerChain]  = useState<string | null>(null);

  // Import state (inside picker)
  const [importState, setImportState] = useState<"idle" | "loading" | "preview">("idle");
  const [importToken, setImportToken] = useState<SwapToken | null>(null);
  const [importError, setImportError] = useState("");

  // Swap routes
  const [routeOptions,  setRouteOptions]  = useState<RouteOption[]>([]);
  const [selectedRoute, setSelectedRoute] = useState(0);
  const [loadingQuote,  setLoadingQuote]  = useState(false);
  const [quoteError,    setQuoteError]    = useState("");
  const [swapping,      setSwapping]      = useState(false);
  const [txHash,        setTxHash]        = useState("");
  const [swapError,     setSwapError]     = useState("");

  // Pre-sign preview confirmation (readable summary before anything is signed)
  const [showConfirm,   setShowConfirm]   = useState(false);

  // Bridge routes
  const [bridgeRoutes,  setBridgeRoutes]  = useState<BridgeRoute[]>([]);
  const [selBridge,     setSelBridge]     = useState(0);
  const [loadingBridge, setLoadingBridge] = useState(false);
  const [bridgeError,   setBridgeError]   = useState("");
  const [bridging,      setBridging]      = useState(false);
  const [bridgeTxHash,  setBridgeTxHash]  = useState("");

  // Drives the animated result overlay. Set only inside executeSwap/executeBridge
  // (not on route-fetch errors), so the celebration/error overlay is tied to an
  // actual signed transaction.
  const [txFx,          setTxFx]          = useState<TxFxStatus | null>(null);
  // Stage line for the pending overlay ("Approving USDT (1 of 2)…"), so the
  // approval-then-swap minute reads as progress instead of a frozen spinner.
  const [txFxDetail,    setTxFxDetail]    = useState("");

  const quoteTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const location = useLocation();
  const prefillApplied = useRef(false);

  // Sync native balances from chainBalances
  useEffect(() => {
    const sync = (prev: SwapToken): SwapToken => {
      if (prev.address) return prev;
      const cb = chainBalances.find((c) => c.networkId === prev.chainId);
      return cb ? { ...prev, balance: cb.balance } : prev;
    };
    setFromToken(sync);
    setToToken(sync);
  }, [chainBalances]);

  // Sync ERC-20 balances for current network
  useEffect(() => {
    const sync = (prev: SwapToken): SwapToken => {
      if (!prev.address || prev.chainId !== network.id) return prev;
      const found = tokens.find((t: any) => t.address?.toLowerCase() === prev.address!.toLowerCase());
      return found ? { ...prev, balance: found.balance || "0" } : prev;
    };
    setFromToken(sync);
    setToToken(sync);
  }, [tokens, network.id]);

  // Sync balances for tokens on ANY chain as held-token data streams in
  // (Solana SPL / Tron / Sui fetches, the cross-chain auto-token sweep).
  // Without this, a token prefilled from its detail page — or picked before
  // its chain's data loaded — shows balance 0 until manually reselected.
  useEffect(() => {
    const sync = (prev: SwapToken): SwapToken => {
      if (!prev.address) return prev; // natives are synced from chainBalances above
      const found = allTokens.find(
        (t) => t.chainId === prev.chainId && t.address?.toLowerCase() === prev.address!.toLowerCase(),
      );
      if (!found || !found.balance || found.balance === prev.balance) return prev;
      return { ...prev, balance: found.balance };
    };
    setFromToken(sync);
    setToToken(sync);
  }, [allTokens]);

  // Prefill the "sell" token when arriving from a token's detail page (Swap button).
  // Applied once, after allTokens is populated so we can resolve full token data.
  useEffect(() => {
    if (prefillApplied.current) return;
    const st = location.state as { prefillChain?: string; prefillAddress?: string; prefillSymbol?: string } | null;
    if (!st?.prefillChain) return;
    const addrL = st.prefillAddress?.toLowerCase();
    const match = allTokens.find((t) =>
      t.chainId === st.prefillChain &&
      (addrL ? t.address?.toLowerCase() === addrL
             : (!t.address && (!st.prefillSymbol || t.symbol === st.prefillSymbol)))
    );
    if (!match) return;
    prefillApplied.current = true;
    setFromToken(match);
    // Pick a sensible same-chain counterpart so it's a swap, not a bridge.
    const sameChainOther = (t: SwapToken) =>
      t.chainId === match.chainId && (t.address || "") !== (match.address || "");
    const counterpart =
      allTokens.find((t) => sameChainOther(t) && t.symbol === "USDC") ??
      allTokens.find((t) => sameChainOther(t) && !t.address) ??
      allTokens.find(sameChainOther);
    if (counterpart) setToToken(counterpart);
  }, [allTokens, location.state]);

  const isBridge = fromToken.chainId !== toToken.chainId;

  function clearRoutes() {
    setRouteOptions([]); setSelectedRoute(0); setQuoteError("");
    setBridgeRoutes([]); setSelBridge(0); setBridgeError("");
    setTxHash(""); setBridgeTxHash(""); setSwapError("");
  }

  // ── Unified quote fetch ───────────────────────────────────────────────────

  const fetchQuotesForPair = useCallback(async (amt: string, from: SwapToken, to: SwapToken) => {
    if (!amt || parseFloat(amt) <= 0 || !wallet) return;

    if (from.chainId !== to.chainId) {
      // Cross-chain: LI.FI routes fetched in core (shared with mobile).
      setLoadingBridge(true); setBridgeError(""); setBridgeRoutes([]); setSelBridge(0);
      try {
        const { routes, error } = await fetchBridgeRoutes(
          from, to, amt, wallet.address, sanitizeSlippagePct(slippage), nonEvmWallet?.solana.address,
        );
        if (error) setBridgeError(error);
        setBridgeRoutes(routes);
      } finally {
        setLoadingBridge(false);
      }
    } else if (from.chainId === "solana" && to.chainId === "solana") {
      // Solana same-chain swap via Jupiter (quote fetch in core).
      setLoadingQuote(true); setQuoteError(""); setRouteOptions([]); setSelectedRoute(0);
      try {
        const q = await fetchJupiterSwapQuote(from, to, amt, sanitizeSlippagePct(slippage));
        if (q) setRouteOptions([q]);
        else setQuoteError("No Jupiter route found for this pair");
      } catch (e: any) {
        setQuoteError(e.message || "Quote failed");
      } finally {
        setLoadingQuote(false);
      }
    } else {
      const net = NETWORKS[from.chainId];
      if (!net) return;
      setLoadingQuote(true); setQuoteError(""); setRouteOptions([]); setSelectedRoute(0);
      try {
        const [ps, ky, rl] = await Promise.all([
          fetchParaswapQuote(net.chainId, from, to, amt),
          fetchKyberQuote(net.chainId, from, to, amt),
          fetchRelayQuote(net.chainId, from, to, amt, wallet.address, sanitizeSlippagePct(slippage)),
        ]);
        const routes = [ps, ky, rl].filter(Boolean) as RouteOption[];
        if (routes.length > 0) {
          routes.sort((a, b) => parseFloat(b.destAmount) - parseFloat(a.destAmount));
          routes[0].tag = "Best";
        }
        setRouteOptions(routes);
        if (routes.length === 0) setQuoteError("No swap routes found for this pair");
      } catch (e: any) {
        setQuoteError(e.message || "Quote failed");
      } finally {
        setLoadingQuote(false);
      }
    }
  }, [wallet, slippage, nonEvmWallet]);

  function scheduleQuote(amt: string, from: SwapToken, to: SwapToken) {
    if (quoteTimer.current) clearTimeout(quoteTimer.current);
    if (amt && parseFloat(amt) > 0)
      quoteTimer.current = setTimeout(() => fetchQuotesForPair(amt, from, to), 700);
  }

  function handleFromAmountChange(val: string) {
    const clean = val.replace(/[^0-9.]/g, "");
    setFromAmount(clean); clearRoutes();
    scheduleQuote(clean, fromToken, toToken);
  }

  function handleSwapDir() {
    setFromToken(toToken); setToToken(fromToken);
    setFromAmount(""); clearRoutes();
  }

  // ── Token picker: select ──────────────────────────────────────────────────

  function selectToken(t: SwapToken) {
    const newFrom = pickerMode === "from" ? t : fromToken;
    const newTo   = pickerMode === "to"   ? t : toToken;
    setFromToken(newFrom); setToToken(newTo);
    setPickerMode(null); setPickerSearch(""); setPickerChain(null);
    setImportState("idle"); setImportToken(null); setImportError("");
    clearRoutes();
    // Keep the existing amount and immediately re-fetch quotes for the new pair
    if (fromAmount && parseFloat(fromAmount) > 0) {
      scheduleQuote(fromAmount, newFrom, newTo);
    }
  }

  // ── Custom token import ───────────────────────────────────────────────────

  const importChainId = pickerChain || network.id;

  async function handleImport() {
    const raw = pickerSearch.trim();
    setImportState("loading"); setImportError("");

    // Solana mint → resolve metadata via Jupiter (works regardless of selected tab)
    if (isSolanaMint(raw)) {
      try {
        const tok = await resolveSolanaToken(raw);
        if (!tok) throw new Error();
        setImportToken({
          symbol: tok.symbol, name: tok.name, logo: tok.logo, address: tok.address,
          decimals: tok.decimals, balance: "0", chainId: "solana", chainName: "Solana", custom: true,
        });
        setImportState("preview");
      } catch {
        setImportError("Could not find that Solana token. Check the mint address.");
        setImportState("idle");
      }
      return;
    }

    const addr = raw.toLowerCase();
    const net  = NETWORKS[importChainId];
    if (!net || !wallet) { setImportState("idle"); return; }
    try {
      const provider = new ethers.JsonRpcProvider(net.rpcUrl);
      const c = new ethers.Contract(addr, ERC20_ABI, provider);
      const [name, symbol, decimals, balRaw] = await Promise.all([
        c.name(), c.symbol(), c.decimals(), c.balanceOf(wallet.address),
      ]);
      setImportToken({
        symbol: String(symbol), name: String(name), address: addr,
        decimals: Number(decimals),
        balance: ethers.formatUnits(balRaw as bigint, Number(decimals)),
        chainId: importChainId, chainName: net.name, custom: true,
      });
      setImportState("preview");
    } catch {
      setImportError("Could not fetch token info. Check the address and selected network.");
      setImportState("idle");
    }
  }

  async function confirmImport() {
    if (!importToken?.address || !importToken.chainId) return;
    // Persist through the shared store (dedupes by chain+address); keep the
    // freshly-fetched balance in local state for this session's picker.
    await upsertCustomToken({
      chainId: importToken.chainId, address: importToken.address,
      symbol: importToken.symbol, name: importToken.name,
      decimals: importToken.decimals, logo: importToken.logo,
    });
    setCustomTokens((prev) => [
      ...prev.filter(
        (t) => !(t.address?.toLowerCase() === importToken.address?.toLowerCase() && t.chainId === importToken.chainId),
      ),
      importToken,
    ]);
    selectToken(importToken);
  }

  // ── Swap execute ──────────────────────────────────────────────────────────

  async function executeSwap() {
    const route = routeOptions[selectedRoute];
    if (!wallet || !route || !fromAmount) return;
    if (await isLocked()) { setSwapError("Wallet is locked. Reopen NumPay to unlock, then try again."); return; }

    // ── Solana swap via Jupiter (pre-checks + execution in core) ────────────
    if (route.provider === "jupiter") {
      if (!nonEvmWallet?.solana) { setSwapError("Solana wallet not ready"); return; }
      setSwapping(true); setSwapError(""); setTxHash(""); setTxFxDetail(""); setTxFx("pending");
      try {
        const txid = await executeSolanaSwap(route, {
          fromToken, toToken, fromAmount,
          solanaSecretKey: nonEvmWallet.solana.secretKey,
          solanaAddress: nonEvmWallet.solana.address,
          solBalance: nonEvmChains.find((c) => c.id === "solana")?.balance ?? 0,
          slippage,
          onRepriceNeeded: () => scheduleQuote(fromAmount, fromToken, toToken),
        });
        setTxHash(txid);
        void logTx({
          owner: wallet?.address,
          hash: txid, chainId: "solana", kind: "swap", timestamp: Date.now(),
          symbol: fromToken.symbol, value: fromAmount, assetAddr: fromToken.address?.toLowerCase(), logo: fromToken.logo,
          toSymbol: toToken.symbol, toValue: receiveAmt, toAssetAddr: toToken.address?.toLowerCase(), toLogo: toToken.logo, toChainId: toToken.chainId,
        });
        // Overlay the spent side immediately; the received side shows up on the
        // fast-poll reconciliation (Solana confirms in ~1s).
        markBalancesDirty([{ chainId: "solana", tokenAddress: fromToken.address || undefined, delta: -parseFloat(fromAmount) }]);
        setTxFx("success");
      } catch (e: any) {
        setSwapError(e.message || "Swap failed");
        setTxFx("error");
      } finally {
        setSwapping(false);
      }
      return;
    }

    const net = NETWORKS[fromToken.chainId];
    if (!net) return;
    setSwapping(true); setSwapError(""); setTxHash(""); setTxFxDetail(""); setTxFx("pending");
    try {
      const signer = getSigner(wallet.privateKey, net.rpcUrl);
      // Receipts are detected by polling; the 4s default adds up to ~8s of
      // dead time across the approval + swap waits. This signer is created
      // fresh per swap, so the faster cadence affects nothing else.
      (signer.provider as ethers.JsonRpcProvider).pollingInterval = 1000;

      // Guards, aggregator build calls, approval and broadcast live in
      // @numpay/core/swap (shared with mobile). onMined fires when a receipt
      
// lands so the received token appears without waiting out the poll.
      const outHash = await executeEvmSwap(route, {
        signer, owner: wallet.address, chainId: net.chainId, symbol: net.symbol,
        fromToken, toToken, fromAmount, slippage,
        onProgress: setTxFxDetail,
        onMined: () => markBalancesDirty(),
      });
      setTxHash(outHash);
      void logTx({
        owner: wallet?.address,
        hash: outHash, chainId: fromToken.chainId, kind: "swap", timestamp: Date.now(),
        symbol: fromToken.symbol, value: fromAmount, assetAddr: fromToken.address?.toLowerCase(), logo: fromToken.logo,
        toSymbol: toToken.symbol, toValue: receiveAmt, toAssetAddr: toToken.address?.toLowerCase(), toLogo: toToken.logo, toChainId: toToken.chainId,
      });
      // Overlay the spent side immediately (relay already waited for its
      // receipts inside core; paraswap/kyber refresh again when theirs land).
      markBalancesDirty([{ chainId: fromToken.chainId, tokenAddress: fromToken.address || undefined, delta: -parseFloat(fromAmount) }]);
      setTxFx("success");
    } catch (e: any) { setSwapError(e.message || "Swap failed"); setTxFx("error"); }
    finally { setSwapping(false); }
  }

  // ── Bridge execute ────────────────────────────────────────────────────────

  async function executeBridge() {
    if (!wallet || !bridgeRoutes[selBridge] || !fromAmount) return;
    if (await isLocked()) { setBridgeError("Wallet is locked. Reopen NumPay to unlock, then try again."); return; }
    const fromNet = NETWORKS[fromToken.chainId];
    const isSolanaSource = fromToken.chainId === "solana";
    setBridging(true); setBridgeError(""); setBridgeTxHash(""); setTxFxDetail(""); setTxFx("pending");
    try {
      // Quote fetch, guard sequence and execution live in @numpay/core/swap
      // (shared with mobile). The extension supplies the signer/keys and does
      // the presentation (progress detail, logTx, balance-bus nudges).
      const evmSigner = isSolanaSource ? undefined : (() => {
        const s = getSigner(wallet.privateKey, fromNet!.rpcUrl);
        (s.provider as ethers.JsonRpcProvider).pollingInterval = 1000;
        return s;
      })();
      const hash = await executeBridgeCore({
        fromToken, toToken, fromAmount, evmAddress: wallet.address,
        evmSigner,
        solanaSecretKey: isSolanaSource ? nonEvmWallet?.solana.secretKey : undefined,
        solanaAddress: isSolanaSource ? nonEvmWallet?.solana.address : undefined,
        fromTokenUsdPrice: tokenUsdPrice(fromToken),
        onProgress: setTxFxDetail,
        onMined: () => markBalancesDirty(),
      });
      setBridgeTxHash(hash);
      void logTx({
        owner: wallet.address,
        hash, chainId: fromToken.chainId, kind: "bridge", timestamp: Date.now(),
        symbol: fromToken.symbol, value: fromAmount, assetAddr: fromToken.address?.toLowerCase(), logo: fromToken.logo,
        toSymbol: toToken.symbol, toValue: receiveAmt, toAssetAddr: toToken.address?.toLowerCase(), toLogo: toToken.logo, toChainId: toToken.chainId,
      });
      // Overlay the spent side; the destination-chain arrival is minutes away
      // (bridge latency), so only the source side is shown as spent.
      markBalancesDirty([{ chainId: fromToken.chainId, tokenAddress: fromToken.address || undefined, delta: -parseFloat(fromAmount) }]);
      setTxFx("success");
    } catch (e: any) { setBridgeError(e.message || "Bridge failed"); setTxFx("error"); }
    finally { setBridging(false); }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const fromBalance = useMemo(() => {
    if (!fromToken.address) {
      const cb = chainBalances.find((c) => c.networkId === fromToken.chainId);
      const multiChainBal = parseFloat(cb?.balance || "0");
      // For the active network we also have the direct single-network balance from
      // refresh() (a live read with no race timeout). Prefer it when present: it is
      // the freshest authoritative figure, so MAX can't overshoot on a stale-high
      // cached multichain value. Fall back to the cached multichain balance only
      // when the direct read is unavailable (a different network, or the live fetch
      // timed out to 0).
      const directBal = fromToken.chainId === network.id ? parseFloat(balance) : 0;
      return (directBal > 0 ? directBal : multiChainBal) || parseFloat(fromToken.balance) || 0;
    }
    return parseFloat(fromToken.balance) || 0;
  }, [fromToken, chainBalances, network.id, balance]);

  const receiveAmt = useMemo(() => {
    if (isBridge) {
      const br = bridgeRoutes[selBridge];
      if (!br) return "";
      try { return parseFloat(ethers.formatUnits(br.toAmount, toToken.decimals)).toFixed(Math.min(toToken.decimals, 6)); }
      catch { return ""; }
    }
    return routeOptions[selectedRoute]?.destAmount || "";
  }, [isBridge, bridgeRoutes, selBridge, routeOptions, selectedRoute, toToken]);

  // Fiat value under each amount. The selected quote's own USD figures win
  // (post-fee, both sides priced at the same snapshot); before a quote lands
  // (or when a provider omits them) fall back to held-token / native prices.
  // null hides the line instead of showing a wrong figure.
  const fiatLine = useCallback((usd: number) => {
    if (!(usd > 0)) return null;
    const v = usdToDisplayCurrency(usd, currencyCode, rates);
    const sym = currency?.symbol || "$";
    if (v < 0.01) return `< ${sym}0.01`;
    return `${sym}${v.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }, [currencyCode, rates, currency]);

  const tokenUsdPrice = useCallback((t: SwapToken): number => {
    if (t.priceUsd && t.priceUsd > 0) return t.priceUsd;
    return getUsdPrice(t.symbol, rates);
  }, [rates]);

  const sellFiat = useMemo(() => {
    const amt = parseFloat(fromAmount || "0");
    if (!(amt > 0)) return null;
    const quoteUsd = isBridge
      ? parseFloat(bridgeRoutes[selBridge]?.fromAmountUSD || "0")
      : (routeOptions[selectedRoute]?.srcUsd ?? 0);
    return fiatLine(quoteUsd > 0 ? quoteUsd : amt * tokenUsdPrice(fromToken));
  }, [fromAmount, isBridge, bridgeRoutes, selBridge, routeOptions, selectedRoute, fromToken, tokenUsdPrice, fiatLine]);

  const buyFiat = useMemo(() => {
    const amt = parseFloat(receiveAmt || "0");
    if (!(amt > 0)) return null;
    const quoteUsd = isBridge
      ? parseFloat(bridgeRoutes[selBridge]?.toAmountUSD || "0")
      : (routeOptions[selectedRoute]?.destUsd ?? 0);
    return fiatLine(quoteUsd > 0 ? quoteUsd : amt * tokenUsdPrice(toToken));
  }, [receiveAmt, isBridge, bridgeRoutes, selBridge, routeOptions, selectedRoute, toToken, tokenUsdPrice, fiatLine]);

  const isLoading    = isBridge ? loadingBridge : loadingQuote;
  const routeError   = isBridge ? bridgeError   : quoteError;
  const activeTxHash = isBridge ? bridgeTxHash  : txHash;
  const activeExecErr= isBridge ? bridgeError   : swapError;
  const isExecuting  = isBridge ? bridging       : swapping;
  const hasRoutes    = isBridge ? bridgeRoutes.length > 0 : routeOptions.length > 0;

  // Picker data — always grouped by chain so every chain is visible up front
  const pickerChains = useMemo(() => {
    const seen = new Set<string>();
    const list = allTokens.reduce<Array<{ id: string; name: string; logo?: string }>>((acc, t) => {
      if (!seen.has(t.chainId)) { seen.add(t.chainId); acc.push({ id: t.chainId, name: t.chainName, logo: NETWORKS[t.chainId]?.logo }); }
      return acc;
    }, []);
    // Order by user base / activity (ETH, BNB, SOL, TRX, BASE, …), unlisted last.
    return list.sort((a, b) => chainRank(a.id) - chainRank(b.id));
  }, [allTokens]);

  const pickerGrouped = useMemo(() => {
    let list = allTokens;
    if (pickerChain) list = list.filter((t) => t.chainId === pickerChain);
    if (pickerSearch && !isAddress(pickerSearch)) {
      const q = pickerSearch.toLowerCase();
      list = list.filter((t) => t.symbol.toLowerCase().includes(q) || t.name.toLowerCase().includes(q));
    }

    // Group by chain
    const groups: Record<string, { chainId: string; chainName: string; tokens: SwapToken[] }> = {};
    for (const t of list) {
      if (!groups[t.chainId]) groups[t.chainId] = { chainId: t.chainId, chainName: t.chainName, tokens: [] };
      groups[t.chainId].tokens.push(t);
    }
    // Sort tokens within each chain: native first, then stablecoins, then by
    // fiat value. Raw quantity is NOT a rank key — airdrop spam mints
    // trillions of a worthless token precisely to game quantity sorts; with
    // no real price it carries zero value and sinks, and indexer-flagged spam
    // is pinned to the bottom outright. Among equally worthless rows an owned
    // token still beats a zero-balance default (so an unpriced holding stays
    // findable), but quantity magnitude never ranks; final ties keep
    // insertion order (held list before curated defaults).
    const STABLES = new Set(["USDT", "USDC", "DAI", "BUSD", "FDUSD", "TUSD", "USDD", "PYUSD", "USDE", "USD1"]);
    const tierOf = (t: SwapToken) =>
      t.possibleSpam ? 3 : !t.address ? 0 : STABLES.has(t.symbol.toUpperCase()) ? 1 : 2;
    const valueOf = (t: SwapToken) => (parseFloat(t.balance) || 0) * tokenUsdPrice(t);
    for (const g of Object.values(groups)) {
      g.tokens.sort((a, b) => {
        const tier = tierOf(a) - tierOf(b);
        if (tier) return tier;
        const val = valueOf(b) - valueOf(a);
        if (val) return val;
        return ((parseFloat(b.balance) || 0) > 0 ? 1 : 0) - ((parseFloat(a.balance) || 0) > 0 ? 1 : 0);
      });
    }
    // Sort chains: active network first, then by any nonzero balance, then rest
    return Object.values(groups).sort((a, b) => {
      if (a.chainId === network.id) return -1;
      if (b.chainId === network.id) return 1;
      const bA = a.tokens.reduce((s, t) => s + (parseFloat(t.balance) || 0), 0);
      const bB = b.tokens.reduce((s, t) => s + (parseFloat(t.balance) || 0), 0);
      return bB - bA;
    });
  }, [allTokens, pickerChain, pickerSearch, network.id, tokenUsdPrice]);

  const isSolMintSearch = isSolanaMint(pickerSearch.trim());
  const isAddrSearch = isAddress(pickerSearch.trim()) || isSolMintSearch;

  // ── Token picker overlay ──────────────────────────────────────────────────

  if (pickerMode) {
    const renderTokenRow = (t: SwapToken) => {
      const key   = `${t.chainId}:${t.symbol}:${t.address || ""}`;
      const isSel = pickerMode === "from"
        ? t.symbol === fromToken.symbol && t.chainId === fromToken.chainId && t.address === fromToken.address
        : t.symbol === toToken.symbol   && t.chainId === toToken.chainId   && t.address === toToken.address;
      const bal = parseFloat(t.balance) || 0;
      return (
        <button key={key} onClick={() => selectToken(t)}
          className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-surface-1 transition-colors mb-0.5 ${isSel ? "bg-brand-500/5" : ""}`}>
          <div className="flex-shrink-0"><AssetIcon symbol={t.symbol} logo={t.logo} chainId={t.chainId} address={t.address} size={36} /></div>
          <div className="text-left flex-1 min-w-0">
            <div className="flex items-center gap-1.5">
              <p className={`text-[13px] font-semibold truncate ${isSel ? "text-brand-400" : "text-text-primary"}`}>{t.symbol}</p>
              {t.custom && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-surface-3 text-muted flex-shrink-0">Custom</span>}
            </div>
            <p className="text-[11px] text-muted truncate">{t.name}</p>
          </div>
          {bal > 0 && (
            <p className="text-[12px] font-semibold text-text-primary tabular-nums flex-shrink-0">{bal.toFixed(Math.min(4, t.decimals))}</p>
          )}
          {isSel && <CheckIcon size={14} className="text-brand-400 flex-shrink-0" />}
        </button>
      );
    };

    return (
      <Layout showNav={false}>
        {/* Sticky header */}
        <div className="sticky top-0 z-10 bg-surface-0 px-4 pt-3 pb-2 border-b border-border">
          <div className="flex items-center gap-3 mb-3">
            <button onClick={() => { setPickerMode(null); setPickerSearch(""); setPickerChain(null); setImportState("idle"); setImportToken(null); setImportError(""); }}
              className="p-1.5 rounded-lg text-muted hover:text-text-primary hover:bg-surface-1 transition-colors">
              <ArrowLeftIcon size={16} />
            </button>
            <h3 className="text-[13px] font-semibold text-text-primary">
              {pickerMode === "from" ? "Sell" : "Buy"}: Select Token
            </h3>
          </div>
          <div className="relative mb-2.5">
            <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input value={pickerSearch} onChange={(e) => { setPickerSearch(e.target.value); setImportState("idle"); setImportToken(null); setImportError(""); }}
              placeholder="Search or paste contract address…" autoFocus
              className="w-full pl-9 pr-3 py-2.5 rounded-xl bg-surface-1 border border-border text-[13px] text-text-primary outline-none placeholder:text-muted/50 focus:border-brand-500 transition-colors" />
          </div>
          {/* Chain filter tabs */}
          <div className="flex gap-1.5 overflow-x-auto pb-1 scrollbar-none -mx-1 px-1">
            <button onClick={() => setPickerChain(null)}
              className={`flex-shrink-0 px-3 py-1 rounded-full text-[11px] font-semibold transition-colors ${!pickerChain ? "bg-brand-500 text-white" : "bg-surface-2 text-muted hover:text-text-secondary"}`}>
              All
            </button>
            {pickerChains.map((c) => (
              <button key={c.id} onClick={() => setPickerChain(c.id === pickerChain ? null : c.id)}
                className={`flex-shrink-0 flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold transition-colors ${pickerChain === c.id ? "bg-brand-500 text-white" : "bg-surface-2 text-muted hover:text-text-secondary"}`}>
                <ChainIcon chainId={c.id} logo={c.logo} size={11} />
                <span>{c.name.split(" ")[0]}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Token list — naturally scrolls via Layout's overflow-y-auto */}
        <div className="px-4 py-2 pb-6">

          {/* Import card (when search is a contract address) */}
          {isAddrSearch && (
            <div className="mb-3">
              {importState === "idle" && (
                <div className="premium-card p-3.5">
                  <p className="text-[11px] text-muted mb-2">
                    Import token on <span className="font-semibold text-text-primary">{isSolMintSearch ? "Solana" : (NETWORKS[importChainId]?.name || importChainId)}</span>
                    {!isSolMintSearch && " (select a chain above to change network)"}
                  </p>
                  <p className="text-[12px] text-text-secondary font-mono mb-3 break-all">
                    {pickerSearch.slice(0, 10)}…{pickerSearch.slice(-8)}
                  </p>
                  {importError && <InlineNotice message={importError} className="mb-2" />}
                  <button onClick={handleImport}
                    className="w-full py-2 rounded-xl bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 transition-colors">
                    Fetch Token Info
                  </button>
                </div>
              )}
              {importState === "loading" && (
                <div className="premium-card p-3.5 flex items-center gap-3">
                  <div className="w-4 h-4 border-2 border-brand-500/30 border-t-brand-500 rounded-full animate-spin flex-shrink-0" />
                  <p className="text-[12px] text-muted">Fetching token info…</p>
                </div>
              )}
              {importState === "preview" && importToken && (
                <div className="premium-card p-3.5">
                  <div className="flex items-center gap-3 mb-3">
                    <div className="relative flex-shrink-0">
                      <AssetIcon symbol={importToken.symbol} logo={importToken.logo} chainId={importToken.chainId} address={importToken.address} size={40} />
                      <ChainBadge chainId={importToken.chainId} logo={NETWORKS[importToken.chainId]?.logo} />
                    </div>
                    <div>
                      <p className="text-[14px] font-bold text-text-primary">{importToken.symbol}</p>
                      <p className="text-[11px] text-muted">{importToken.name} · {importToken.chainName}</p>
                      {parseFloat(importToken.balance) > 0 && (
                        <p className="text-[11px] text-accent-green font-semibold">Balance: {parseFloat(importToken.balance).toFixed(4)}</p>
                      )}
                    </div>
                  </div>
                  <p className="text-[10px] text-muted/60 font-mono break-all mb-3">{importToken.address}</p>
                  <div className="flex gap-2">
                    <button onClick={() => { setImportState("idle"); setImportToken(null); }}
                      className="flex-1 py-2 rounded-xl bg-surface-2 text-muted text-[12px] font-semibold hover:bg-surface-3 transition-colors">
                      Cancel
                    </button>
                    <button onClick={confirmImport}
                      className="flex-1 py-2 rounded-xl bg-brand-500 text-white text-[12px] font-semibold hover:bg-brand-600 transition-colors">
                      Add Token
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Chain-grouped token list */}
          {!isAddrSearch && pickerGrouped.length === 0 && (
            <div className="py-10 text-center">
              <p className="text-muted text-[13px] mb-1">No tokens found</p>
              <p className="text-muted/60 text-[11px]">Paste a contract address above to import</p>
            </div>
          )}

          {!isAddrSearch && pickerGrouped.map((section) => (
            <div key={section.chainId} className="mb-4">
              {/* Chain section header */}
              <div className="flex items-center gap-2 px-1 py-1.5 mb-1">
                <ChainIcon chainId={section.chainId} logo={NETWORKS[section.chainId]?.logo} size={14} />
                <p className="text-[11px] font-bold text-text-secondary uppercase tracking-wider">{section.chainName}</p>
              </div>
              {section.tokens.map(renderTokenRow)}
            </div>
          ))}
        </div>
      </Layout>
    );
  }

  // ── Main UI ───────────────────────────────────────────────────────────────

  const fromNetObj = NETWORKS[fromToken.chainId];
  const toNet      = NETWORKS[toToken.chainId];
  const explorerTxUrl = fromToken.chainId === "solana"
    ? `https://solscan.io/tx/${activeTxHash}`
    : `${fromNetObj?.explorer}/tx/${activeTxHash}`;

  return (
    <Layout>
      <div className="app-bg min-h-full">
        <div className="px-4 py-4">

          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <div>
              <h2 className="text-lg font-bold text-text-primary">{isBridge ? "Bridge" : "Swap"}</h2>
              <p className="text-[10px] text-muted">{isBridge ? "Powered by LI.FI" : (fromToken.chainId === "solana" ? "Powered by Jupiter" : "ParaSwap · KyberSwap · Relay")}</p>
            </div>
            <button onClick={() => setShowSettings(!showSettings)}
              className="p-2 rounded-lg text-muted hover:text-text-primary hover:bg-surface-1 transition-colors">
              <SettingsIcon size={16} />
            </button>
          </div>

          {/* Slippage settings */}
          {showSettings && (
            <div className="premium-card p-3 mb-4 animate-slide-up">
              <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-2">Slippage Tolerance</p>
              <div className="flex gap-2">
                {["0.1", "0.5", "1.0"].map((s) => (
                  <button key={s} onClick={() => setSlippage(s)}
                    className={`flex-1 py-1.5 rounded-lg text-xs font-medium transition-colors ${slippage === s ? "bg-brand-500 text-white" : "bg-surface-2 text-text-secondary hover:bg-surface-3"}`}>
                    {s}%
                  </button>
                ))}
                <input value={slippage} onChange={(e) => setSlippage(e.target.value)}
                  className="w-16 px-2 py-1.5 rounded-lg bg-surface-2 border border-border text-xs text-text-primary text-center outline-none focus:border-brand-500"
                  placeholder="%" />
              </div>
            </div>
          )}

          {/* SELL box */}
          <div className="premium-card p-4 mb-1.5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Sell</p>
              <p className="text-[11px] text-muted tabular-nums">
                {fromBalance > 0 ? fromBalance.toFixed(6) : "0"} {fromToken.symbol}
              </p>
            </div>
            <div className="flex items-center gap-3">
              <input value={fromAmount} onChange={(e) => handleFromAmountChange(e.target.value)}
                placeholder="0"
                className="flex-1 bg-transparent text-[26px] font-bold text-text-primary outline-none placeholder:text-muted/25 min-w-0 tracking-tight" />
              <button onClick={() => { setPickerSearch(""); setPickerChain(null); setPickerMode("from"); }}
                className="flex items-center gap-2 pl-2 pr-3 py-2 rounded-2xl bg-surface-2 hover:bg-surface-3 transition-colors flex-shrink-0">
                <div className="relative">
                  <AssetIcon symbol={fromToken.symbol} logo={fromToken.logo} chainId={fromToken.chainId} address={fromToken.address} size={26} />
                  {fromToken.address && (
                    <ChainBadge chainId={fromToken.chainId} logo={fromNetObj?.logo} />
                  )}
                </div>
                <div className="text-left">
                  <p className="text-[13px] font-bold text-text-primary leading-tight">{fromToken.symbol}</p>
                  <p className="text-[10px] text-muted leading-tight">{fromToken.chainName.split(" ")[0]}</p>
                </div>
                <ChevronDownIcon size={12} className="text-muted" />
              </button>
            </div>
            {sellFiat && <p className="text-[11px] text-muted tabular-nums mt-1">≈ {sellFiat}</p>}
            {fromBalance > 0 && (
              <div className="flex gap-2 mt-3">
                {[{ l: "25%", p: 0.25 }, { l: "50%", p: 0.5 }, { l: "75%", p: 0.75 }, { l: "MAX", p: 1 }].map(({ l, p }) => (
                  <button key={l}
                    onClick={async () => {
                      // Native input pays the fee from this same balance: SOL keeps
                      // its fee + ATA-rent cushion; a native EVM coin reserves the
                      // live estimated fee for an aggregator-sized tx (with zero
                      // headroom a MAX always failed at broadcast). Tokens need none.
                      const isNativeSol = fromToken.chainId === "solana" && !fromToken.address;
                      const isNativeEvm = !fromToken.address && !!NETWORKS[fromToken.chainId];
                      const reserve = isNativeSol ? SOL_FEE_RESERVE
                        : isNativeEvm ? await evmSwapReserve(fromToken.chainId, isBridge)
                        : 0;
                      const cap = Math.max(0, fromBalance - reserve);
                      const amt = Math.min(fromBalance * p, cap);
                      handleFromAmountChange(amt.toFixed(Math.min(fromToken.decimals, 8)));
                    }}
                    className="px-3 py-1 rounded-full text-[11px] font-bold bg-brand-500/10 text-brand-400 hover:bg-brand-500/20 transition-colors">
                    {l}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Swap / Bridge direction button */}
          <div className="flex justify-center -my-[14px] relative z-[2]">
            <button onClick={handleSwapDir}
              className={`flex items-center gap-1.5 px-3 py-2 rounded-xl border-[3px] border-surface-0 transition-all duration-150 ${
                isBridge
                  ? "bg-brand-500/15 text-brand-400 hover:bg-brand-500 hover:text-white"
                  : "bg-surface-2 text-muted hover:bg-brand-500 hover:text-white"
              }`}>
              {isBridge
                ? <><LayersIcon size={12} /><span className="text-[10px] font-bold uppercase tracking-wider">Bridge</span></>
                : <SwapIcon size={14} />}
            </button>
          </div>

          {/* BUY box */}
          <div className="premium-card p-4 mb-5">
            <div className="flex items-center justify-between mb-2">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Buy</p>
              {isLoading && <RefreshIcon size={12} className="text-brand-400 animate-spin" />}
            </div>
            <div className="flex items-center gap-3">
              <div className="flex-1 min-w-0">
                <p className="text-[26px] font-bold tracking-tight">
                  {receiveAmt
                    ? <span className="text-accent-green">{receiveAmt}</span>
                    : <span className="text-muted/25">0</span>}
                </p>
                {buyFiat && <p className="text-[11px] text-muted tabular-nums mt-0.5">≈ {buyFiat}</p>}
                {receiveAmt && fromAmount && !isBridge && routeOptions[selectedRoute] && (
                  <p className="text-[11px] text-muted tabular-nums mt-0.5">
                    1 {fromToken.symbol} ≈ {(parseFloat(receiveAmt) / parseFloat(fromAmount)).toFixed(4)} {toToken.symbol}
                  </p>
                )}
              </div>
              <button onClick={() => { setPickerSearch(""); setPickerChain(null); setPickerMode("to"); }}
                className="flex items-center gap-2 pl-2 pr-3 py-2 rounded-2xl bg-surface-2 hover:bg-surface-3 transition-colors flex-shrink-0">
                <div className="relative">
                  <AssetIcon symbol={toToken.symbol} logo={toToken.logo} chainId={toToken.chainId} address={toToken.address} size={26} />
                  {toToken.address && (
                    <ChainBadge chainId={toToken.chainId} logo={toNet?.logo} />
                  )}
                </div>
                <div className="text-left">
                  <p className="text-[13px] font-bold text-text-primary leading-tight">{toToken.symbol}</p>
                  <p className="text-[10px] text-muted leading-tight">{toToken.chainName.split(" ")[0]}</p>
                </div>
                <ChevronDownIcon size={12} className="text-muted" />
              </button>
            </div>
          </div>

          {/* Swap route cards */}
          {!isBridge && routeOptions.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] text-muted uppercase tracking-wider font-medium mb-2">Routes</p>
              <div className="space-y-1.5">
                {routeOptions.map((r, i) => (
                  <button key={r.provider} onClick={() => setSelectedRoute(i)}
                    className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${selectedRoute === i ? "border-brand-500/40 bg-brand-500/5" : "border-border bg-surface-1 hover:border-border/60"}`}>
                    <img src={r.logo} className="w-5 h-5 rounded-full flex-shrink-0"
                      onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                    <div className="flex-1 text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="text-[12px] font-semibold text-text-primary">{r.label}</span>
                        {r.tag && <span className="text-[9px] font-bold px-1.5 py-0.5 rounded-full bg-accent-green/15 text-accent-green">{r.tag}</span>}
                      </div>
                      <span className="text-[10px] text-muted">Gas ~{currency?.symbol || "$"}{usdToDisplayCurrency(parseFloat(r.gasCostUSD), currencyCode, rates).toFixed(2)}</span>
                    </div>
                    <div className="text-right flex-shrink-0">
                      <p className="text-[13px] font-bold text-text-primary tabular-nums">{r.destAmount}</p>
                      <p className="text-[10px] text-muted">{toToken.symbol}</p>
                    </div>
                    {selectedRoute === i && <CheckIcon size={14} className="text-brand-400 flex-shrink-0" />}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* Bridge route cards */}
          {isBridge && bridgeRoutes.length > 0 && (
            <div className="mb-4">
              <p className="text-[10px] text-muted uppercase tracking-wider font-medium mb-2">Bridge Routes</p>
              <div className="space-y-1.5">
                {bridgeRoutes.map((r, i) => {
                  const step     = r.steps[0];
                  const toolName = step?.toolDetails?.name || step?.tool || "Bridge";
                  const toolLogo = step?.toolDetails?.logoURI || "";
                  const dur      = step?.estimate?.executionDuration;
                  const mins     = dur ? Math.ceil(dur / 60) : null;
                  const toAmt    = (() => { try { return parseFloat(ethers.formatUnits(r.toAmount, toToken.decimals)).toFixed(Math.min(toToken.decimals, 6)); } catch { return "—"; } })();
                  return (
                    <button key={r.id} onClick={() => setSelBridge(i)}
                      className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl border transition-all ${selBridge === i ? "border-brand-500/40 bg-brand-500/5" : "border-border bg-surface-1 hover:border-border/60"}`}>
                      {toolLogo
                        ? <img src={toolLogo} className="w-5 h-5 rounded-full flex-shrink-0" onError={(e) => { (e.currentTarget as HTMLImageElement).style.display = "none"; }} />
                        : <div className="w-5 h-5 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0"><LayersIcon size={10} className="text-muted" /></div>}
                      <div className="flex-1 text-left">
                        <div className="flex items-center gap-1.5 flex-wrap">
                          <span className="text-[12px] font-semibold text-text-primary">{toolName}</span>
                          {r.tags.map((tag) => (
                            <span key={tag} className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full ${TAG_STYLE[tag] || "bg-surface-3 text-muted"}`}>{tag}</span>
                          ))}
                        </div>
                        <span className="text-[10px] text-muted">Gas ~{currency?.symbol || "$"}{usdToDisplayCurrency(parseFloat(r.gasCostUSD), currencyCode, rates).toFixed(2)}{mins ? ` · ~${mins} min` : ""}</span>
                      </div>
                      <div className="text-right flex-shrink-0">
                        <p className="text-[13px] font-bold text-text-primary tabular-nums">{toAmt}</p>
                        <p className="text-[10px] text-muted">{toToken.symbol}</p>
                      </div>
                      {selBridge === i && <CheckIcon size={14} className="text-brand-400 flex-shrink-0" />}
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {/* Loading */}
          {isLoading && (
            <div className="flex items-center gap-2 mb-4 px-3 py-2.5 rounded-xl bg-surface-1">
              <RefreshIcon size={13} className="text-brand-400 animate-spin flex-shrink-0" />
              <p className="text-[11px] text-muted">{isBridge ? "Searching bridge routes…" : "Getting quotes from ParaSwap, KyberSwap and Relay…"}</p>
            </div>
          )}

          {/* Route error */}
          {routeError && !isLoading && <SwapErrorCard message={routeError} tone="amber" kind={isBridge ? "Bridge" : "Swap"} />}

          {/* Execution error */}
          {activeExecErr && activeExecErr !== routeError && <SwapErrorCard message={activeExecErr} tone="danger" kind={isBridge ? "Bridge" : "Swap"} />}

          {/* Success */}
          {activeTxHash && (
            <div className="mb-4 premium-card p-3">
              <p className="text-accent-green text-xs font-semibold mb-1">{isBridge ? "Bridge submitted!" : "Swap submitted!"}</p>
              <a href={explorerTxUrl} target="_blank" rel="noopener noreferrer"
                className="flex items-center gap-1 text-brand-400 text-[11px] hover:underline break-all">
                {activeTxHash.slice(0, 20)}…{activeTxHash.slice(-8)} <ExternalLinkIcon size={10} />
              </a>
            </div>
          )}

          {/* CTA — opens a readable preview before anything is signed */}
          <button onClick={() => setShowConfirm(true)}
            disabled={!hasRoutes || !fromAmount || parseFloat(fromAmount || "0") <= 0 || isExecuting || isLoading || !!activeTxHash}
            className="btn-primary-premium text-[13px]">
            {isExecuting ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                {isBridge ? "Bridging…" : "Swapping…"}
              </span>
            ) : isLoading ? (
              <span className="flex items-center justify-center gap-2">
                <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Finding routes…
              </span>
            ) : !fromAmount || parseFloat(fromAmount) <= 0
              ? "Enter an amount"
              : !hasRoutes
                ? "No routes available"
                : isBridge
                  ? `Bridge ${fromToken.symbol} → ${toNet?.name || toToken.chainId}`
                  : `Swap ${fromToken.symbol} for ${toToken.symbol}`}
          </button>

          {/* Readable pre-sign preview. Shown before any signature so the user
              confirms exactly what the wallet is about to authorize. The values
              here are the same ones the execute path binds and simulates against
              before signing. */}
          {showConfirm && (() => {
            const providerLabel = isBridge
              ? (bridgeRoutes[selBridge]?.steps?.[0]?.toolDetails?.name
                 || bridgeRoutes[selBridge]?.steps?.[0]?.tool || "Bridge")
              : (routeOptions[selectedRoute]?.label || "—");
            const fromNetName = NETWORKS[fromToken.chainId]?.name || fromToken.chainId;
            const toNetName   = NETWORKS[toToken.chainId]?.name   || toToken.chainId;
            const isSolanaSide = isBridge
              ? toToken.chainId === "solana"
              : routeOptions[selectedRoute]?.provider === "jupiter";
            const recipient = (isSolanaSide ? nonEvmWallet?.solana?.address : wallet?.address) || "";
            const slipPct = parseFloat(slippage) || 0;
            const minReceived = !isBridge && receiveAmt
              ? (parseFloat(receiveAmt) * (1 - slipPct / 100)).toFixed(Math.min(toToken.decimals, 6))
              : "";
            const confirmAndRun = () => { setShowConfirm(false); isBridge ? executeBridge() : executeSwap(); };
            const row = (label: string, value: React.ReactNode) => (
              <div className="flex items-start justify-between gap-3 py-1.5">
                <span className="text-[11px] text-muted flex-shrink-0">{label}</span>
                <span className="text-[12px] font-semibold text-text-primary text-right break-all">{value}</span>
              </div>
            );
            return (
              <div className="fixed inset-0 z-[110] flex items-end justify-center bg-black/60 p-3"
                   onClick={() => setShowConfirm(false)}>
                <div className="w-full premium-card p-4" onClick={(e) => e.stopPropagation()}>
                  <p className="text-[14px] font-bold text-text-primary mb-3">
                    {isBridge ? "Confirm bridge" : "Confirm swap"}
                  </p>
                  <div className="divide-y divide-border">
                    {row("You pay", `${fromAmount} ${fromToken.symbol} · ${fromNetName}`)}
                    {row(isBridge ? "You receive (est.)" : "You receive (est.)",
                         `≈ ${receiveAmt || "—"} ${toToken.symbol} · ${toNetName}`)}
                    {minReceived && row("Minimum received", `${minReceived} ${toToken.symbol} (slippage ${slipPct}%)`)}
                    {row("Route", providerLabel)}
                    {row("Recipient", recipient ? `Your wallet · ${recipient.slice(0, 6)}…${recipient.slice(-4)}` : "Your wallet")}
                  </div>
                  <p className="text-[10px] text-muted mt-3 leading-relaxed">
                    The transaction is checked against this quote and simulated before it is signed.
                    Funds are sent to your own wallet.
                  </p>
                  <div className="flex gap-2 mt-4">
                    <button onClick={() => setShowConfirm(false)}
                      className="flex-1 py-2.5 rounded-xl bg-surface-1 text-text-primary text-[13px] font-semibold">
                      Cancel
                    </button>
                    <button onClick={confirmAndRun}
                      className="btn-primary-premium text-[13px] flex-1">
                      {isBridge ? "Confirm & bridge" : "Confirm & swap"}
                    </button>
                  </div>
                </div>
              </div>
            );
          })()}

        </div>
      </div>

      {txFx && (() => {
        const parsed = txFx === "error" && activeExecErr ? parseSwapError(activeExecErr, isBridge ? "Bridge" : "Swap") : null;
        return (
          <TxResultOverlay
            status={txFx}
            kind={isBridge ? "bridge" : "swap"}
            amountLabel={`${fromAmount} ${fromToken.symbol} → ${toToken.symbol}`}
            explorerUrl={explorerTxUrl}
            txHash={activeTxHash}
            errorTitle={parsed?.title}
            errorMessage={parsed ? (parsed.hint ? `${parsed.body} ${parsed.hint}` : parsed.body) : undefined}
            pendingDetail={txFxDetail || undefined}
            onClose={() => setTxFx(null)}
          />
        );
      })()}
    </Layout>
  );
}
