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
import { fetchJupiterQuote, executeJupiterSwap, signSimulateSendSolanaTx, resolveSolanaToken, hasTokenAccount, WSOL_MINT, SOLANA_SWAP_TOKENS } from "@numpay/core/chains/solana";
import { getSigner, isLocked } from "@numpay/core/wallet";
import { getCustomTokens, upsertCustomToken } from "@numpay/core/customTokens";
import {
  assertTrustedSpender, assertTrustedRouter, assertChainId,
  assertIsContract, assertNativeValue, simulateOrThrow,
} from "@numpay/core/swapGuards";
import Layout from "../components/Layout";
import AlertCard from "../components/AlertCard";
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
  PARASWAP_API, LIFI_API, LIFI_ROUTES_URL, NATIVE_ADDR, LIFI_NATIVE,
  PARASWAP_PARTNER, PARASWAP_FEE_BPS, PARASWAP_FEE_RECIPIENT, PARASWAP_DIRECT_TRANSFER, paraswapFeeActive,
  LIFI_INTEGRATOR, LIFI_FEE, lifiFeeActive,
  ERC20_ABI, KYBERSWAP_CHAIN, LIFI_CHAIN_ID, LIFI_NATIVE_TOKEN, chainRank,
  isAddress, isSolanaMint, SOL_FEE_RESERVE, BRIDGE_FEE_CAP_USD,
  evmSwapReserve, assertUpfrontAffordable, sanitizeSlippagePct, approveErc20Exact,
  buildAllSwapTokens, fetchParaswapQuote, fetchKyberQuote, fetchRelayQuote, parseSwapError,
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
      safe={e.preSend}
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
      const fromLifiId = LIFI_CHAIN_ID[from.chainId];
      const toLifiId   = LIFI_CHAIN_ID[to.chainId];
      if (!fromLifiId || !toLifiId) {
        setBridgeError(`Bridge not supported for ${from.chainName} → ${to.chainName} yet`);
        return;
      }
      // Resolve the correct wallet address for each side (EVM vs Solana)
      const fromAddr = from.chainId === "solana" ? (nonEvmWallet?.solana.address || "") : wallet.address;
      const toAddr   = to.chainId   === "solana" ? (nonEvmWallet?.solana.address || "") : wallet.address;
      const fromTokenAddr = from.address || LIFI_NATIVE_TOKEN[from.chainId] || LIFI_NATIVE;
      const toTokenAddr   = to.address   || LIFI_NATIVE_TOKEN[to.chainId]   || LIFI_NATIVE;

      setLoadingBridge(true); setBridgeError(""); setBridgeRoutes([]); setSelBridge(0);
      try {
        const res = await fetch(LIFI_ROUTES_URL, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fromChainId:      fromLifiId,
            toChainId:        toLifiId,
            fromTokenAddress: fromTokenAddr,
            toTokenAddress:   toTokenAddr,
            fromAmount:       ethers.parseUnits(amt, from.decimals).toString(),
            fromAddress: fromAddr, toAddress: toAddr,
            options: {
              slippage: sanitizeSlippagePct(slippage) / 100, order: "RECOMMENDED",
              integrator: LIFI_INTEGRATOR,
              // Fee baked into the routes so the shown bridge receive is post-fee.
              ...(lifiFeeActive() ? { fee: parseFloat(LIFI_FEE) } : {}),
            },
          }),
        });
        if (!res.ok) {
          const errBody = await res.text().catch(() => "");
          throw new Error(`Bridge API error (${res.status})${errBody ? ": " + errBody.slice(0, 120) : ""}`);
        }
        const data = await res.json();
        if (!data?.routes?.length) {
          setBridgeError("No bridge routes found. Try a larger amount or different token pair.");
          return;
        }
        setBridgeRoutes(data.routes.slice(0, 4).map((r: any) => ({
          id: r.id, gasCostUSD: r.gasCostUSD || "0", tags: r.tags || [],
          toAmount: r.toAmountMin || r.toAmount || "0", steps: r.steps || [],
          fromAmountUSD: r.fromAmountUSD, toAmountUSD: r.toAmountUSD,
        })));
      } catch (e: any) {
        setBridgeError(e.message || "Failed to fetch bridge routes");
      } finally {
        setLoadingBridge(false);
      }
    } else if (from.chainId === "solana" && to.chainId === "solana") {
      // ── Solana same-chain swap via Jupiter ──────────────────────────────
      setLoadingQuote(true); setQuoteError(""); setRouteOptions([]); setSelectedRoute(0);
      try {
        const inMint  = from.address || WSOL_MINT;
        const outMint = to.address   || WSOL_MINT;
        const amountRaw = ethers.parseUnits(amt, from.decimals).toString();
        const q = await fetchJupiterQuote(inMint, outMint, amountRaw, Math.round(sanitizeSlippagePct(slippage) * 100));
        if (q) {
          setRouteOptions([{
            provider: "jupiter", label: "Jupiter",
            logo: "https://assets.coingecko.com/coins/images/34188/small/jup.png",
            destAmount: parseFloat(ethers.formatUnits(q.outAmount, to.decimals)).toFixed(Math.min(to.decimals, 6)),
            destAmountRaw: q.outAmount, gasCostUSD: "0", tag: "Best",
            priceRoute: q.raw, // carry the Jupiter quote for the swap build
            // Jupiter reports one USD value for the trade; the per-side split
            // falls back to held-token prices when this is absent.
            srcUsd: parseFloat(q.raw?.swapUsdValue) || undefined,
          }]);
        } else {
          setQuoteError("No Jupiter route found for this pair");
        }
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

    // ── Solana swap via Jupiter ─────────────────────────────────────────────
    if (route.provider === "jupiter") {
      if (!nonEvmWallet?.solana) { setSwapError("Solana wallet not ready"); return; }
      setSwapping(true); setSwapError(""); setTxHash(""); setTxFxDetail(""); setTxFx("pending");
      try {
        // Compute what THIS swap actually needs in SOL (Jupiter 6024 fails
        // otherwise): a bounded fee (base + priority capped at 0.001 SOL),
        // plus ~0.002 SOL rent per token account that must be created — the
        // temporary wrapped-SOL account when SOL is on either side (refunded
        // after the swap), and the output token account if it doesn't exist.
        const FEE_HEADROOM = 0.0015;
        const ATA_RENT     = 0.00204;
        const solBal = nonEvmChains.find((c) => c.id === "solana")?.balance ?? 0;
        let requiredSol = FEE_HEADROOM;
        if (!fromToken.address || !toToken.address) requiredSol += ATA_RENT;
        if (toToken.address) {
          const exists = await hasTokenAccount(nonEvmWallet.solana.address, toToken.address);
          if (exists === false) requiredSol += ATA_RENT;
        }
        const totalNeeded = (!fromToken.address ? parseFloat(fromAmount) : 0) + requiredSol;
        // solBal of 0 may just mean the balance fetch failed; in that case let
        // the pre-broadcast simulation be the judge instead of false-blocking.
        if (solBal > 0 && totalNeeded > solBal) {
          throw new Error(
            `This swap needs ~${requiredSol.toFixed(4)} SOL for the network fee and account rent` +
            (!fromToken.address ? ` on top of the ${fromAmount} SOL being swapped` : "") +
            `, but the wallet has ${solBal.toFixed(4)} SOL. Lower the amount or add a little SOL.`
          );
        }

        // Jupiter quotes go stale within seconds; a stale quote fails the
        // pre-broadcast simulation (slippage/blockhash). Re-quote now and use
        // the fresh route — but abort if the price dropped more than the
        // user's slippage versus what was on screen.
        const inMint    = fromToken.address || WSOL_MINT;
        const outMint   = toToken.address   || WSOL_MINT;
        const amountRaw = ethers.parseUnits(fromAmount, fromToken.decimals).toString();
        const slipBps   = Math.round(sanitizeSlippagePct(slippage) * 100);
        let quoteToUse  = route.priceRoute;
        const fresh = await fetchJupiterQuote(inMint, outMint, amountRaw, slipBps);
        if (fresh) {
          const shown = BigInt(route.destAmountRaw || "0");
          const now   = BigInt(fresh.outAmount);
          if (shown > 0n && now < shown - (shown * BigInt(slipBps)) / 10000n) {
            scheduleQuote(fromAmount, fromToken, toToken); // refresh the displayed rate
            throw new Error("The price moved since this quote was shown. Review the updated rate and try again.");
          }
          quoteToUse = fresh.raw;
        }
        const txid = await executeJupiterSwap(
          nonEvmWallet.solana.secretKey,
          nonEvmWallet.solana.address,
          quoteToUse,
        );
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
    let outHash = "";
    try {
      const signer    = getSigner(wallet.privateKey, net.rpcUrl);
      // Receipts are detected by polling; the 4s default adds up to ~8s of
      // dead time across the approval + swap waits. This signer is created
      // fresh per swap, so the faster cadence affects nothing else.
      (signer.provider as ethers.JsonRpcProvider).pollingInterval = 1000;
      const srcAmount = ethers.parseUnits(fromAmount, fromToken.decimals).toString();
      const srcAmountBn = BigInt(srcAmount);
      const isNativeSwap = !fromToken.address;

      // Guard 1: confirm the RPC serves the chain we built the route for.
      await assertChainId(signer, net.chainId);

      if (route.provider === "paraswap") {
        const txRes = await fetch(`${PARASWAP_API}/transactions/${net.chainId}?ignoreChecks=true`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            srcToken: fromToken.address || NATIVE_ADDR, destToken: toToken.address || NATIVE_ADDR,
            srcAmount,
            slippage: Math.round(sanitizeSlippagePct(slippage) * 100),
            userAddress: wallet.address, priceRoute: route.priceRoute, partner: PARASWAP_PARTNER,
            // Partner fee must match the values baked into the quoted priceRoute.
            ...(paraswapFeeActive() ? {
              partnerAddress: PARASWAP_FEE_RECIPIENT,
              partnerFeeBps: PARASWAP_FEE_BPS,
              isDirectFeeTransfer: PARASWAP_DIRECT_TRANSFER,
            } : {}),
          }),
        });
        if (!txRes.ok) { const e = await txRes.json().catch(() => ({})); throw new Error(e.error || `Build failed (${txRes.status})`); }
        const txData = await txRes.json();

        const value = txData.value ? BigInt(txData.value) : 0n;
        // Augustus varies per chain, so bind the send target to the swapper the
        // signed quote (priceRoute) declared, rather than trusting whatever the
        // /transactions response returns (SWAP-1). A tampered build that points
        // `to` at an attacker contract no longer passes the bare contract-code
        // check. Fall back to contract-code + value + sim where the quote did
        // not declare a contractAddress.
        const augustus: string | undefined = route.priceRoute?.contractAddress;
        if (augustus) {
          if (txData.to?.toLowerCase() !== augustus.toLowerCase()) {
            throw new Error(`Blocked for safety: swap target ${txData.to} does not match the quoted ParaSwap contract ${augustus}.`);
          }
        }
        await assertIsContract(signer.provider!, txData.to);
        assertNativeValue(isNativeSwap, value, srcAmountBn);
        // ParaSwap is the one swap branch that passes its quoted gasLimit
        // straight through (no estimateGas), so verify the upfront hold fits.
        await assertUpfrontAffordable(
          signer.provider!, wallet.address, value,
          txData.gas ? BigInt(txData.gas) : 0n, net.symbol, "swap",
        );

        const psApproval = !!(fromToken.address && route.priceRoute?.tokenTransferProxy);
        if (fromToken.address && route.priceRoute?.tokenTransferProxy) {
          // Gate the approval to ParaSwap's proxy for THIS chain (Base differs
          // from the others). Exact amount only.
          assertTrustedSpender("paraswap", route.priceRoute.tokenTransferProxy, net.chainId);
          setTxFxDetail(`Approving ${fromToken.symbol} (1 of 2)…`);
          await approveErc20Exact(signer, fromToken.address, wallet.address, route.priceRoute.tokenTransferProxy, srcAmount);
        }
        setTxFxDetail(psApproval ? "Swapping (2 of 2)…" : "Swapping…");
        await simulateOrThrow(signer, { to: txData.to, data: txData.data, value });
        const tx = await signer.sendTransaction({
          to: txData.to, data: txData.data, value,
          gasLimit: txData.gas ? BigInt(txData.gas) : undefined,
        });
        setTxHash(outHash = tx.hash);
        // Refresh the instant the receipt lands so the received token appears
        // without waiting out the poll cadence.
        void tx.wait().then(() => markBalancesDirty()).catch(() => {});
      } else if (route.provider === "relay") {
        // Relay returns ready-to-sign steps (an approval step for ERC-20 input,
        // then the swap/deposit step). Its router/spender is dynamic per quote,
        // so it cannot use the chain-constant whitelist that Kyber/ParaSwap do.
        // Each step is instead bound by: chain-id match, contract-code, a native
        // value bound, and a pre-broadcast simulation — and steps run in order so
        // an approval is mined before the swap step is simulated.
        const steps = route.relaySteps || [];
        if (!steps.length) throw new Error("Relay returned no execution steps");
        const relayTotal = steps.reduce(
          (n: number, s: any) =>
            n + (s.items || []).filter((it: any) => it?.data?.to && it?.data?.data && it.status !== "complete").length,
          0,
        );
        let relayDone = 0;
        let lastHash = "";
        for (const step of steps) {
          for (const item of (step.items || [])) {
            const d = item?.data;
            if (!d?.to || !d?.data) continue;
            if (item.status === "complete") continue;
            relayDone++;
            setTxFxDetail(relayTotal > 1 ? `Confirming step ${relayDone} of ${relayTotal} on-chain…` : "Confirming on-chain…");
            if (d.chainId != null && Number(d.chainId) !== net.chainId) {
              throw new Error(`Blocked for safety: Relay step targets chain ${d.chainId}, expected ${net.chainId}.`);
            }
            const value = d.value ? BigInt(d.value) : 0n;
            // Native input: only the deposit step may carry value, never more than
            // the amount being swapped. ERC-20 input: every step must carry zero.
            if (isNativeSwap) {
              if (value > srcAmountBn) {
                throw new Error(`Blocked for safety: Relay step sends ${value} wei, more than the ${srcAmountBn} wei being swapped.`);
              }
            } else if (value !== 0n) {
              throw new Error(`Blocked for safety: ERC-20 swap step should not send native value, but ${value} wei is attached.`);
            }
            // A step that calls the SOURCE TOKEN's contract may only be a
            // bounded approve/transfer. Relay's spender/solver is dynamic (no
            // allowlist is possible, unlike Kyber/ParaSwap/LI.FI), so cap what
            // a tampered step could authorize or move at the amount being
            // swapped — the user already intends to spend that much. Any other
            // selector on the token contract is blocked outright.
            if (fromToken.address && d.to.toLowerCase() === fromToken.address.toLowerCase()) {
              const sel = String(d.data).slice(0, 10).toLowerCase();
              const APPROVE = "0x095ea7b3", TRANSFER = "0xa9059cbb";
              if (sel !== APPROVE && sel !== TRANSFER) {
                throw new Error("Blocked for safety: unexpected Relay call on the source token contract.");
              }
              let amt: bigint;
              try {
                const [, rawAmt] = ethers.AbiCoder.defaultAbiCoder().decode(
                  ["address", "uint256"], "0x" + String(d.data).slice(10),
                );
                amt = BigInt(rawAmt);
              } catch {
                throw new Error("Blocked for safety: could not decode the Relay token-contract step.");
              }
              if (amt > srcAmountBn) {
                throw new Error("Blocked for safety: Relay step approves/moves more of the token than the amount being swapped.");
              }
            }
            await assertIsContract(signer.provider!, d.to);
            await simulateOrThrow(signer, { to: d.to, data: d.data, value });
            const tx = await signer.sendTransaction({ to: d.to, data: d.data, value });
            await tx.wait();
            lastHash = tx.hash;
          }
        }
        if (!lastHash) throw new Error("Relay produced no signable transaction");
        setTxHash(outHash = lastHash);
      } else {
        const kyberChain = KYBERSWAP_CHAIN[net.chainId];
        const buildRes = await fetch(`https://aggregator-api.kyberswap.com/${kyberChain}/api/v1/route/build`, {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            routeSummary: route.routeSummary, sender: wallet.address, recipient: wallet.address,
            slippageTolerance: Math.round(sanitizeSlippagePct(slippage) * 100),
            deadline: Math.floor(Date.now() / 1000) + 1800, source: "numpay",
          }),
        });
        if (!buildRes.ok) throw new Error(`KyberSwap build failed (${buildRes.status})`);
        const bd = await buildRes.json();
        if (!bd?.data) throw new Error("No transaction data from KyberSwap");
        const { routerAddress, data } = bd.data;

        // Router + approval spender are the same chain-constant address — gate both.
        assertTrustedRouter("kyberswap", routerAddress);
        const value = !fromToken.address ? srcAmountBn : 0n;
        assertNativeValue(isNativeSwap, value, srcAmountBn);

        if (fromToken.address) {
          assertTrustedSpender("kyberswap", routerAddress);
          setTxFxDetail(`Approving ${fromToken.symbol} (1 of 2)…`);
          await approveErc20Exact(signer, fromToken.address, wallet.address, routerAddress, srcAmount);
        }
        setTxFxDetail(fromToken.address ? "Swapping (2 of 2)…" : "Swapping…");
        await simulateOrThrow(signer, { to: routerAddress, data, value });
        const tx = await signer.sendTransaction({ to: routerAddress, data, value });
        setTxHash(outHash = tx.hash);
        void tx.wait().then(() => markBalancesDirty()).catch(() => {});
      }
      if (outHash) void logTx({
        owner: wallet?.address,
        hash: outHash, chainId: fromToken.chainId, kind: "swap", timestamp: Date.now(),
        symbol: fromToken.symbol, value: fromAmount, assetAddr: fromToken.address?.toLowerCase(), logo: fromToken.logo,
        toSymbol: toToken.symbol, toValue: receiveAmt, toAssetAddr: toToken.address?.toLowerCase(), toLogo: toToken.logo, toChainId: toToken.chainId,
      });
      // Overlay the spent side immediately (relay already waited for its
      // receipts above; paraswap/kyber refresh again when theirs land).
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
    if (!fromNet && !isSolanaSource) { setBridgeError("Bridge execution is only supported from EVM chains and Solana"); return; }
    if (isSolanaSource && !nonEvmWallet?.solana) { setBridgeError("Solana wallet not ready"); return; }
    setBridging(true); setBridgeError(""); setBridgeTxHash(""); setTxFxDetail(""); setTxFx("pending");
    try {
      // /advanced/routes gives display data only; /quote gives the actual transactionRequest
      const fromLifiId  = LIFI_CHAIN_ID[fromToken.chainId];
      const toLifiId    = LIFI_CHAIN_ID[toToken.chainId];
      const fromAddr    = fromToken.chainId === "solana" ? (nonEvmWallet?.solana.address || "") : wallet.address;
      const toAddr      = toToken.chainId   === "solana" ? (nonEvmWallet?.solana.address || "") : wallet.address;
      const fromTokAddr = fromToken.address || LIFI_NATIVE_TOKEN[fromToken.chainId] || LIFI_NATIVE;
      const toTokAddr   = toToken.address   || LIFI_NATIVE_TOKEN[toToken.chainId]   || LIFI_NATIVE;
      const fromAmtRaw  = ethers.parseUnits(fromAmount, fromToken.decimals).toString();

      let quoteUrl = `${LIFI_API}/quote?fromChain=${fromLifiId}&toChain=${toLifiId}` +
        `&fromToken=${encodeURIComponent(fromTokAddr)}&toToken=${encodeURIComponent(toTokAddr)}` +
        `&fromAmount=${fromAmtRaw}&fromAddress=${fromAddr}&toAddress=${toAddr}&integrator=${LIFI_INTEGRATOR}`;
      // Must match the fee used when the routes were fetched above.
      if (lifiFeeActive()) quoteUrl += `&fee=${LIFI_FEE}`;
      const qRes = await fetch(quoteUrl);
      if (!qRes.ok) {
        const err = await qRes.text().catch(() => "");
        throw new Error(`Could not build transaction (${qRes.status})${err ? ": " + err.slice(0, 120) : ""}`);
      }
      const qData = await qRes.json();
      const txReq = qData?.transactionRequest;

      // ── Solana source: LI.FI returns a pre-built base64 v0 transaction (no
      // to/value fields — the SVM equivalent of the EVM calldata). The shared
      // signer enforces sole-signer + fee-payer binding and simulates locally
      // before broadcast, same guards as Jupiter swaps. No approval step:
      // SPL transfers are moved directly by the transaction itself.
      if (isSolanaSource) {
        if (!txReq?.data) throw new Error("Bridge provider returned incomplete transaction data");
        setTxFxDetail("Bridging…");
        const sig = await signSimulateSendSolanaTx(
          nonEvmWallet!.solana.secretKey, nonEvmWallet!.solana.address, txReq.data,
        );
        setBridgeTxHash(sig);
        void logTx({
          owner: wallet?.address,
          hash: sig, chainId: "solana", kind: "bridge", timestamp: Date.now(),
          symbol: fromToken.symbol, value: fromAmount, assetAddr: fromToken.address?.toLowerCase(), logo: fromToken.logo,
          toSymbol: toToken.symbol, toValue: receiveAmt, toAssetAddr: toToken.address?.toLowerCase(), toLogo: toToken.logo, toChainId: toToken.chainId,
        });
        // Overlay the spent side; destination-chain arrival is minutes away.
        markBalancesDirty([{ chainId: "solana", tokenAddress: fromToken.address || undefined, delta: -parseFloat(fromAmount) }]);
        setTxFx("success");
        return;
      }

      if (!txReq?.to || !txReq?.data) throw new Error("Bridge provider returned incomplete transaction data");

      const signer = getSigner(wallet.privateKey, fromNet.rpcUrl);
      (signer.provider as ethers.JsonRpcProvider).pollingInterval = 1000;
      await assertChainId(signer, fromNet.chainId);

      // The LI.FI diamond (router + approval target) is chain-constant — gate it.
      assertTrustedRouter("lifi", txReq.to);
      const value = txReq.value ? BigInt(txReq.value) : 0n;
      // Bound the native value the same way swaps are (SWAP-1): a native-token
      // bridge must attach exactly the bridged amount, an ERC-20 bridge zero.
      // Previously executeBridge omitted this, leaving the LI.FI native value
      // unbounded.
      const srcAmountBn = BigInt(fromAmtRaw);
      const isNativeBridge = !fromToken.address;
      // Keep the strict zero-native bound for ERC-20 bridges (loosening it
      // would let a tampered route response attach and drain native), but name
      // the actual situation when a route legitimately wants a native
      // messaging fee (some LayerZero/Axelar-style routes) instead of the
      // generic swap wording.
      if (!isNativeBridge && value > 0n) {
        throw new Error(
          "This route attaches a native-coin fee to the transaction, which NumPay doesn't support yet. Try a different route.",
        );
      }
      if (isNativeBridge) {
        if (value < srcAmountBn) {
          throw new Error(
            `Blocked for safety: transaction sends ${value} wei but the bridge amount is ${srcAmountBn} wei.`,
          );
        }
        const excess = value - srcAmountBn;
        if (excess > 0n) {
          // Some routes (Stargate/LayerZero style) charge a messaging fee ON
          // TOP of the bridged amount: value = amount + fee, itemized in the
          // quote's feeCosts with included:false. Accept the excess only when
          // it exactly matches those quoted native fees AND stays under an
          // independent USD cap, so a tampered response can neither invent an
          // unquoted fee nor inflate a quoted one beyond a bounded loss.
          const isNativeAddr = (a?: string) =>
            !a || /^0x0{40}$/i.test(a) || /^0xe{40}$/i.test(a);
          const quotedFee = ((qData?.estimate?.feeCosts ?? []) as any[])
            .filter((f) => f?.included === false && isNativeAddr(f?.token?.address))
            .reduce((s: bigint, f: any) => s + BigInt(f?.amount ?? 0), 0n);
          if (excess !== quotedFee) {
            throw new Error(
              `Blocked for safety: transaction attaches ${excess} wei above the bridge amount, ` +
              `but the route quotes ${quotedFee} wei of native fees.`,
            );
          }
          const px = tokenUsdPrice(fromToken);
          const capWei = px > 0
            ? ethers.parseUnits((BRIDGE_FEE_CAP_USD / px).toFixed(8), 18)
            : srcAmountBn / 4n;
          if (excess > capWei) {
            throw new Error(
              `Blocked for safety: this route's native messaging fee ` +
              `(${ethers.formatEther(excess)} ${fromNet.symbol}) is unusually high. Try a different route.`,
            );
          }
        }
      }

      // LI.FI quotes the gasLimit, so ethers never estimates: check the
      // upfront gas hold ourselves (a near-MAX Arbitrum bridge died at
      // broadcast with an unreadable dRPC error before this existed).
      await assertUpfrontAffordable(
        signer.provider!, wallet.address, value,
        txReq.gasLimit ? BigInt(txReq.gasLimit) : 0n, fromNet.symbol, "bridge",
      );

      // Approve the bridge contract if spending an ERC-20 (exact amount only).
      const approvalAddr = qData?.estimate?.approvalAddress;
      const bridgeApproval = !!(fromToken.address && approvalAddr);
      if (fromToken.address && approvalAddr) {
        assertTrustedSpender("lifi", approvalAddr);
        setTxFxDetail(`Approving ${fromToken.symbol} (1 of 2)…`);
        await approveErc20Exact(signer, fromToken.address, wallet.address, approvalAddr, fromAmtRaw);
      }
      setTxFxDetail(bridgeApproval ? "Bridging (2 of 2)…" : "Bridging…");
      // Best-effort pre-flight ONLY (do not block). Cross-chain bridge calldata
      // is frequently not eth_call-simulatable on the source chain — messaging-
      // layer fees, executor/msg.sender checks and deadlines make a naive static
      // call revert ("missing revert data") even when the real bridge would
      // succeed — so hard-blocking on it stranded legitimate routes. A same-chain
      // swap simulates cleanly and keeps its hard block; a bridge relies on the
      // deterministic guards above (trusted router + approval spender, exact
      // native-value bound, chain-id assertion), which are the real protection.
      try {
        await simulateOrThrow(signer, { to: txReq.to, data: txReq.data, value });
      } catch (simErr) {
        console.warn(
          "[bridge] source-chain pre-flight reverted; proceeding (bridges are often not eth_call-simulatable):",
          (simErr as Error)?.message,
        );
      }
      const tx = await signer.sendTransaction({
        to:       txReq.to,
        data:     txReq.data,
        value,
        gasLimit: txReq.gasLimit ? BigInt(txReq.gasLimit) : undefined,
      });
      setBridgeTxHash(tx.hash);
      void logTx({
        owner: wallet.address,
        hash: tx.hash, chainId: fromToken.chainId, kind: "bridge", timestamp: Date.now(),
        symbol: fromToken.symbol, value: fromAmount, assetAddr: fromToken.address?.toLowerCase(), logo: fromToken.logo,
        toSymbol: toToken.symbol, toValue: receiveAmt, toAssetAddr: toToken.address?.toLowerCase(), toLogo: toToken.logo, toChainId: toToken.chainId,
      });
      // Overlay the spent side; the destination-chain arrival is minutes away
      // (bridge latency), so only the source side is shown as spent.
      markBalancesDirty([{ chainId: fromToken.chainId, tokenAddress: fromToken.address || undefined, delta: -parseFloat(fromAmount) }]);
      void tx.wait().then(() => markBalancesDirty()).catch(() => {});
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
                  {importError && <p className="text-[11px] mb-2" style={{ color: "var(--danger)" }}>{importError}</p>}
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
