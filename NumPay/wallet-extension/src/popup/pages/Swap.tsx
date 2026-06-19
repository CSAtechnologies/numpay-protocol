import { useState, useMemo, useCallback, useRef, useEffect } from "react";
import { useLocation } from "react-router-dom";
import { ethers } from "ethers";
import { useWallet } from "../hooks/useWallet";
import { useCurrency } from "../hooks/useCurrency";
import { usdToDisplayCurrency } from "@/lib/currency";
import { NETWORKS } from "@/lib/networks";
import { DEFAULT_TOKENS } from "@/lib/tokens";
import { type NonEvmChain } from "@/lib/chains";
import { fetchJupiterQuote, executeJupiterSwap, resolveSolanaToken, hasTokenAccount, WSOL_MINT, SOLANA_SWAP_TOKENS } from "@/lib/chains/solana";
import { getSigner, isLocked } from "@/lib/wallet";
import { getItem, setItem } from "@/lib/storage";
import {
  assertTrustedSpender, assertTrustedRouter, assertChainId,
  assertIsContract, assertNativeValue, simulateOrThrow,
} from "@/lib/swapGuards";
import Layout from "../components/Layout";
import {
  SwapIcon, ChevronDownIcon, SettingsIcon, TokenIcon, ChainIcon,
  SearchIcon, ArrowLeftIcon, AlertIcon, ExternalLinkIcon, RefreshIcon, CheckIcon,
  LayersIcon, ShieldIcon,
} from "../components/Icons";

// ── Types ─────────────────────────────────────────────────────────────────────

interface SwapToken {
  symbol: string;
  name: string;
  logo?: string;
  address?: string;
  decimals: number;
  balance: string;
  chainId: string;
  chainName: string;
  custom?: boolean;
}

interface RouteOption {
  provider: "paraswap" | "kyberswap" | "jupiter";
  label: string;
  logo: string;
  destAmount: string;
  destAmountRaw: string;
  gasCostUSD: string;
  tag?: string;
  priceRoute?: any;
  routeSummary?: any;
  kyberRouterAddress?: string;
}

interface BridgeRoute {
  id: string;
  gasCostUSD: string;
  tags: string[];
  toAmount: string;
  steps: Array<{
    tool?: string;
    toolDetails?: { name: string; logoURI: string };
    estimate?: { executionDuration?: number; approvalAddress?: string };
    transactionRequest?: { to: string; data: string; value: string; gasLimit?: string };
  }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PARASWAP_API     = "https://apiv5.paraswap.io";
const LIFI_API         = "https://li.quest/v1";
const LIFI_ROUTES_URL  = `${LIFI_API}/advanced/routes`;
const NATIVE_ADDR      = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
const LIFI_NATIVE      = "0x0000000000000000000000000000000000000000";
const CUSTOM_TOKENS_KEY = "numpay_custom_tokens";

const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

const KYBERSWAP_CHAIN: Record<number, string> = {
  1: "ethereum", 137: "polygon", 42161: "arbitrum", 10: "optimism",
  8453: "base", 43114: "avalanche", 56: "bsc", 534352: "scroll",
  59144: "linea", 5000: "mantle", 81457: "blast", 250: "fantom",
  324: "zksync", 1101: "polygon-zkevm", 25: "cronos",
};

// LI.FI chain IDs — EVM chains use their numeric chainId, non-EVM use LI.FI's own IDs
const LIFI_CHAIN_ID: Record<string, number> = {
  ethereum: 1, polygon: 137, arbitrum: 42161, optimism: 10,
  base: 8453, avalanche: 43114, bsc: 56, zksync: 324,
  scroll: 534352, linea: 59144, mantle: 5000, blast: 81457,
  polygonzkevm: 1101, fantom: 250, cronos: 25, celo: 42220,
  gnosis: 100, moonbeam: 1284, aurora: 1313161554, sei: 1329,
  klaytn: 8217, metis: 1088, sepolia: 11155111,
  solana: 1151111081099710,
};

// Native token address LI.FI uses for each chain (EVM chains share 0x0000...)
const LIFI_NATIVE_TOKEN: Record<string, string> = {
  solana: "So11111111111111111111111111111111111111112",
};

const TAG_STYLE: Record<string, string> = {
  RECOMMENDED: "bg-brand-500/15 text-brand-400",
  CHEAPEST:    "bg-accent-green/15 text-accent-green",
  FASTEST:     "bg-amber/15 text-amber",
};

// Chain filter ordering by user base / activity (lower = shown first).
// Unlisted chains fall after these, keeping their natural order.
const CHAIN_RANK: Record<string, number> = {
  ethereum: 0, bsc: 1, solana: 2, tron: 3, base: 4, arbitrum: 5,
  polygon: 6, optimism: 7, avalanche: 8, bitcoin: 9, xrp: 10,
  litecoin: 11, sui: 12, linea: 13, scroll: 14, zksync: 15,
  fantom: 16, cronos: 17, mantle: 18, blast: 19, gnosis: 20,
};
const chainRank = (id: string) => CHAIN_RANK[id] ?? 99;

// ── Helpers ───────────────────────────────────────────────────────────────────

const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());
// Solana mint = base58, 32-44 chars (no 0x, excludes 0/O/I/l per base58 alphabet)
const isSolanaMint = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
// SOL left untouched on a max swap so the network fee + any ATA rent can be paid.
const SOL_FEE_RESERVE = 0.01;

// The slippage field is free text; sanitize before it reaches any aggregator.
// NaN/zero falls back to 0.5%, and the cap stops fat-fingered values (e.g. 50)
// from authorizing a sandwich-sized tolerance.
function sanitizeSlippagePct(raw: string): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0.5;
  return Math.min(n, 5);
}

// Approve `spender` for exactly `amount` of an ERC-20, resetting to zero first
// when an allowance is already set (SWAP-5). Reset-to-zero tokens (e.g. USDT)
// revert if a non-zero allowance is changed directly; the prior code always
// called approve(amount) which would break re-approval for those tokens. Exact
// amount (never unlimited) keeps any residual allowance bounded to this swap.
async function approveErc20Exact(
  signer: ethers.Signer, token: string, owner: string, spender: string, amount: string,
): Promise<void> {
  const erc20 = new ethers.Contract(token, [
    "function approve(address,uint256) returns (bool)",
    "function allowance(address,address) view returns (uint256)",
  ], signer);
  const needed = BigInt(amount);
  let current = 0n;
  try { current = BigInt(await erc20.allowance(owner, spender)); } catch { /* treat as 0 */ }
  if (current === needed) return; // already exactly approved
  if (current > 0n) {
    await (await erc20.approve(spender, 0n)).wait();
  }
  await (await erc20.approve(spender, needed)).wait();
}

function buildAllSwapTokens(
  chainBals: any[], currentTokens: any[], currentNetId: string,
  customTokens: SwapToken[], nonEvmChains: NonEvmChain[], solanaHeld: SwapToken[],
  evmHeld: SwapToken[],
): SwapToken[] {
  const items: SwapToken[] = [];
  const seen = new Set<string>();

  // Native token for every EVM mainnet
  for (const net of Object.values(NETWORKS)) {
    if (net.id === "sepolia") continue;
    const key = `${net.id}::`;
    if (seen.has(key)) continue;
    seen.add(key);
    const cb = chainBals.find((c: any) => c.networkId === net.id);
    items.push({
      symbol: net.symbol, name: net.name, logo: net.logo, decimals: net.decimals,
      balance: cb?.balance || "0", chainId: net.id, chainName: net.name,
    });
  }

  // Native token for every non-EVM chain (Solana, Bitcoin, Tron, XRP, Sui, Litecoin)
  for (const nev of nonEvmChains) {
    const key = `${nev.id}::`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      symbol: nev.symbol, name: nev.name, logo: nev.logo,
      decimals: nev.decimals, balance: nev.balance > 0 ? nev.balance.toFixed(nev.decimals > 6 ? 6 : nev.decimals) : "0",
      chainId: nev.id, chainName: nev.name,
    });
  }

  // Solana SPL tokens: the user's held tokens first (so balances win on dedupe),
  // then a curated popular set for the buy side.
  const solList: SwapToken[] = [
    ...solanaHeld,
    ...SOLANA_SWAP_TOKENS.map((t) => ({
      symbol: t.symbol, name: t.name, address: t.address, decimals: t.decimals,
      balance: "0", chainId: "solana", chainName: "Solana",
    })),
  ];
  for (const t of solList) {
    if (!t.address) continue;
    const key = `solana:${t.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(t);
  }

  // The user's held EVM tokens (memecoins/alts on any chain) — added before the
  // default list so their real balances win on dedupe.
  for (const t of evmHeld) {
    if (!t.address) continue;
    const key = `${t.chainId}:${t.address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    items.push(t);
  }

  // ERC-20 tokens from DEFAULT_TOKENS for each chain
  for (const [chainIdStr, tokenArr] of Object.entries(DEFAULT_TOKENS)) {
    const numId = parseInt(chainIdStr);
    const net = Object.values(NETWORKS).find((n) => n.chainId === numId && n.id !== "sepolia");
    if (!net) continue;
    for (const t of tokenArr as any[]) {
      const key = `${net.id}:${t.address.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const bal = net.id === currentNetId
        ? currentTokens.find((tk: any) => tk.address?.toLowerCase() === t.address.toLowerCase())?.balance || "0"
        : "0";
      items.push({
        symbol: t.symbol, name: t.name, logo: t.logo, address: t.address,
        decimals: t.decimals, balance: bal, chainId: net.id, chainName: net.name,
      });
    }
  }

  // Custom imported tokens (skip if already present)
  for (const ct of customTokens) {
    const key = ct.address ? `${ct.chainId}:${ct.address.toLowerCase()}` : `${ct.chainId}::`;
    if (seen.has(key)) continue;
    seen.add(key);
    const bal = ct.chainId === currentNetId && ct.address
      ? currentTokens.find((tk: any) => tk.address?.toLowerCase() === ct.address!.toLowerCase())?.balance || ct.balance
      : ct.balance;
    items.push({ ...ct, balance: bal });
  }

  return items;
}

// ── Quote fetchers ────────────────────────────────────────────────────────────

async function fetchParaswapQuote(chainId: number, from: SwapToken, to: SwapToken, amt: string): Promise<RouteOption | null> {
  try {
    const url = `${PARASWAP_API}/prices?srcToken=${from.address || NATIVE_ADDR}&srcDecimals=${from.decimals}` +
      `&destToken=${to.address || NATIVE_ADDR}&destDecimals=${to.decimals}` +
      `&amount=${ethers.parseUnits(amt, from.decimals)}&network=${chainId}&partner=numpay`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.priceRoute) return null;
    const pr = data.priceRoute;
    return {
      provider: "paraswap", label: "ParaSwap",
      logo: "https://assets.coingecko.com/coins/images/14929/small/paraswap.png",
      destAmount: parseFloat(ethers.formatUnits(pr.destAmount, to.decimals)).toFixed(Math.min(to.decimals, 6)),
      destAmountRaw: pr.destAmount, gasCostUSD: pr.gasCostUSD || "0", priceRoute: pr,
    };
  } catch { return null; }
}

async function fetchKyberQuote(chainId: number, from: SwapToken, to: SwapToken, amt: string): Promise<RouteOption | null> {
  const chain = KYBERSWAP_CHAIN[chainId];
  if (!chain) return null;
  try {
    const url = `https://aggregator-api.kyberswap.com/${chain}/api/v1/routes` +
      `?tokenIn=${from.address || NATIVE_ADDR}&tokenOut=${to.address || NATIVE_ADDR}` +
      `&amountIn=${ethers.parseUnits(amt, from.decimals)}&saveGas=0&gasInclude=1`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.code !== 0 || !data?.data?.routeSummary) return null;
    const rs = data.data.routeSummary;
    return {
      provider: "kyberswap", label: "KyberSwap",
      logo: "https://assets.coingecko.com/coins/images/14899/small/RwdVsGcw_400x400.jpg",
      destAmount: parseFloat(ethers.formatUnits(rs.amountOut, to.decimals)).toFixed(Math.min(to.decimals, 6)),
      destAmountRaw: rs.amountOut, gasCostUSD: rs.gasUsd || "0",
      routeSummary: rs, kyberRouterAddress: data.data.routerAddress,
    };
  } catch { return null; }
}

// ── Error card ────────────────────────────────────────────────────────────────

interface ParsedSwapError {
  title: string;
  body: string;
  hint?: string;
  // Required vs available SOL, when the message carries exact figures.
  figures?: { required: string; available: string };
  preSend: boolean; // true when we know nothing left the wallet
}

// Map raw error strings from the swap/bridge paths to a titled, actionable
// card. Unrecognized messages fall through to a generic "Swap Failed".
function parseSwapError(msg: string): ParsedSwapError {
  const solFigures = msg.match(/needs ~?([\d.]+) SOL[\s\S]*?has ([\d.]+) SOL/i);
  if (solFigures || /not enough sol|keep at least .* sol/i.test(msg)) {
    return {
      title: "Not Enough SOL for Fees",
      body: "Every Solana swap needs a little SOL on top of the amount: the network fee, plus rent when a token account has to be created.",
      hint: "Top up a little SOL or lower the swap amount, then try again.",
      figures: solFigures ? { required: solFigures[1], available: solFigures[2] } : undefined,
      preSend: true,
    };
  }
  if (/insufficient funds|insufficient balance/i.test(msg)) {
    return {
      title: "Insufficient Balance",
      body: msg,
      hint: "Fees and rent count against your balance too — lower the amount slightly.",
      preSend: true,
    };
  }
  if (/price moved|slippage/i.test(msg)) {
    return {
      title: "Price Moved",
      body: msg,
      hint: "Markets move fast. Review the refreshed rate and confirm again.",
      preSend: true,
    };
  }
  if (/quote expired|blockhash/i.test(msg)) {
    return {
      title: "Quote Expired",
      body: msg,
      hint: "Re-enter the amount to fetch a fresh quote.",
      preSend: true,
    };
  }
  if (/simulation failed/i.test(msg)) {
    return {
      title: "Transaction Blocked",
      body: msg,
      hint: "The pre-flight check stops anything that would fail on-chain before it can cost you fees.",
      preSend: true,
    };
  }
  if (/no .*routes? found|no jupiter route|bridge not supported/i.test(msg)) {
    return {
      title: "No Route Found",
      body: msg,
      hint: "Try a different amount, token pair, or chain.",
      preSend: true,
    };
  }
  if (/blocked for safety/i.test(msg)) {
    return {
      title: "Blocked for Safety",
      body: msg,
      hint: "The aggregator response failed a local security check, so it was never signed.",
      preSend: true,
    };
  }
  return { title: "Swap Failed", body: msg, preSend: false };
}

function SwapErrorCard({ message, tone }: { message: string; tone: "danger" | "amber" }) {
  const e = parseSwapError(message);
  const color = tone === "danger" ? "var(--danger)" : "var(--amber)";
  const iconBg = tone === "danger" ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)";
  return (
    <div className="premium-card overflow-hidden mb-4 animate-slide-up">
      <div className="h-[2px] w-full" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)`, opacity: 0.7 }} />
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
            <AlertIcon size={16} style={{ color }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold mb-0.5" style={{ color }}>{e.title}</p>
            <p className="text-[11px] text-text-secondary leading-relaxed break-words">{e.body}</p>
          </div>
        </div>
        {e.figures && (
          <div className="flex gap-2 mt-3">
            <div className="flex-1 rounded-xl bg-surface-2 px-3 py-2">
              <p className="text-[9px] uppercase tracking-wider text-muted mb-0.5">Required</p>
              <p className="text-[13px] font-bold text-text-primary tabular-nums">
                ~{e.figures.required} <span className="text-[10px] text-muted font-semibold">SOL</span>
              </p>
            </div>
            <div className="flex-1 rounded-xl bg-surface-2 px-3 py-2">
              <p className="text-[9px] uppercase tracking-wider text-muted mb-0.5">Available</p>
              <p className="text-[13px] font-bold tabular-nums" style={{ color }}>
                {e.figures.available} <span className="text-[10px] text-muted font-semibold">SOL</span>
              </p>
            </div>
          </div>
        )}
        {e.hint && (
          <div className="mt-3 px-3 py-2 rounded-xl bg-surface-1 border border-border">
            <p className="text-[10.5px] text-muted leading-relaxed">{e.hint}</p>
          </div>
        )}
        {e.preSend && (
          <div className="flex items-center gap-1.5 mt-3">
            <ShieldIcon size={11} className="text-accent-green flex-shrink-0" />
            <p className="text-[10px] text-accent-green font-medium">Nothing was sent — your funds are safe.</p>
          </div>
        )}
      </div>
    </div>
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
        });
      }
    }
    return out;
  }, [tokensByChain]);

  // Custom tokens (persisted)
  const [customTokens, setCustomTokens] = useState<SwapToken[]>([]);
  useEffect(() => {
    getItem(CUSTOM_TOKENS_KEY).then((raw) => {
      if (raw) try { setCustomTokens(JSON.parse(raw)); } catch {}
    });
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
            options: { slippage: sanitizeSlippagePct(slippage) / 100, order: "RECOMMENDED", integrator: "numpay" },
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
        const [ps, ky] = await Promise.all([
          fetchParaswapQuote(net.chainId, from, to, amt),
          fetchKyberQuote(net.chainId, from, to, amt),
        ]);
        const routes = [ps, ky].filter(Boolean) as RouteOption[];
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
    if (!importToken) return;
    const raw = await getItem(CUSTOM_TOKENS_KEY);
    const existing: SwapToken[] = raw ? JSON.parse(raw) : [];
    const deduped = existing.filter(
      (t) => !(t.address?.toLowerCase() === importToken.address?.toLowerCase() && t.chainId === importToken.chainId),
    );
    const updated = [...deduped, importToken];
    await setItem(CUSTOM_TOKENS_KEY, JSON.stringify(updated));
    setCustomTokens(updated);
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
      setSwapping(true); setSwapError(""); setTxHash("");
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
      } catch (e: any) {
        setSwapError(e.message || "Swap failed");
      } finally {
        setSwapping(false);
      }
      return;
    }

    const net = NETWORKS[fromToken.chainId];
    if (!net) return;
    setSwapping(true); setSwapError(""); setTxHash("");
    try {
      const signer    = getSigner(wallet.privateKey, net.rpcUrl);
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
            userAddress: wallet.address, priceRoute: route.priceRoute, partner: "numpay",
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

        if (fromToken.address && route.priceRoute?.tokenTransferProxy) {
          // Approval spender is chain-constant — gate it hard. Exact amount only.
          assertTrustedSpender("paraswap", route.priceRoute.tokenTransferProxy);
          await approveErc20Exact(signer, fromToken.address, wallet.address, route.priceRoute.tokenTransferProxy, srcAmount);
        }
        await simulateOrThrow(signer, { to: txData.to, data: txData.data, value });
        const tx = await signer.sendTransaction({
          to: txData.to, data: txData.data, value,
          gasLimit: txData.gas ? BigInt(txData.gas) : undefined,
        });
        setTxHash(tx.hash);
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
          await approveErc20Exact(signer, fromToken.address, wallet.address, routerAddress, srcAmount);
        }
        await simulateOrThrow(signer, { to: routerAddress, data, value });
        const tx = await signer.sendTransaction({ to: routerAddress, data, value });
        setTxHash(tx.hash);
      }
    } catch (e: any) { setSwapError(e.message || "Swap failed"); }
    finally { setSwapping(false); }
  }

  // ── Bridge execute ────────────────────────────────────────────────────────

  async function executeBridge() {
    if (!wallet || !bridgeRoutes[selBridge] || !fromAmount) return;
    if (await isLocked()) { setBridgeError("Wallet is locked. Reopen NumPay to unlock, then try again."); return; }
    const fromNet = NETWORKS[fromToken.chainId];
    if (!fromNet) { setBridgeError("Bridge execution only supported from EVM chains"); return; }
    setBridging(true); setBridgeError(""); setBridgeTxHash("");
    try {
      // /advanced/routes gives display data only; /quote gives the actual transactionRequest
      const fromLifiId  = LIFI_CHAIN_ID[fromToken.chainId];
      const toLifiId    = LIFI_CHAIN_ID[toToken.chainId];
      const fromAddr    = fromToken.chainId === "solana" ? (nonEvmWallet?.solana.address || "") : wallet.address;
      const toAddr      = toToken.chainId   === "solana" ? (nonEvmWallet?.solana.address || "") : wallet.address;
      const fromTokAddr = fromToken.address || LIFI_NATIVE_TOKEN[fromToken.chainId] || LIFI_NATIVE;
      const toTokAddr   = toToken.address   || LIFI_NATIVE_TOKEN[toToken.chainId]   || LIFI_NATIVE;
      const fromAmtRaw  = ethers.parseUnits(fromAmount, fromToken.decimals).toString();

      const quoteUrl = `${LIFI_API}/quote?fromChain=${fromLifiId}&toChain=${toLifiId}` +
        `&fromToken=${encodeURIComponent(fromTokAddr)}&toToken=${encodeURIComponent(toTokAddr)}` +
        `&fromAmount=${fromAmtRaw}&fromAddress=${fromAddr}&toAddress=${toAddr}&integrator=numpay`;
      const qRes = await fetch(quoteUrl);
      if (!qRes.ok) {
        const err = await qRes.text().catch(() => "");
        throw new Error(`Could not build transaction (${qRes.status})${err ? ": " + err.slice(0, 120) : ""}`);
      }
      const qData = await qRes.json();
      const txReq = qData?.transactionRequest;
      if (!txReq?.to || !txReq?.data) throw new Error("Bridge provider returned incomplete transaction data");

      const signer = getSigner(wallet.privateKey, fromNet.rpcUrl);
      await assertChainId(signer, fromNet.chainId);

      // The LI.FI diamond (router + approval target) is chain-constant — gate it.
      assertTrustedRouter("lifi", txReq.to);
      const value = txReq.value ? BigInt(txReq.value) : 0n;
      // Bound the native value the same way swaps are (SWAP-1): a native-token
      // bridge must attach exactly the bridged amount, an ERC-20 bridge zero.
      // Previously executeBridge omitted this, leaving the LI.FI native value
      // unbounded.
      const isNativeBridge = !fromToken.address;
      assertNativeValue(isNativeBridge, value, BigInt(fromAmtRaw));

      // Approve the bridge contract if spending an ERC-20 (exact amount only).
      const approvalAddr = qData?.estimate?.approvalAddress;
      if (fromToken.address && approvalAddr) {
        assertTrustedSpender("lifi", approvalAddr);
        await approveErc20Exact(signer, fromToken.address, wallet.address, approvalAddr, fromAmtRaw);
      }
      await simulateOrThrow(signer, { to: txReq.to, data: txReq.data, value });
      const tx = await signer.sendTransaction({
        to:       txReq.to,
        data:     txReq.data,
        value,
        gasLimit: txReq.gasLimit ? BigInt(txReq.gasLimit) : undefined,
      });
      setBridgeTxHash(tx.hash);
    } catch (e: any) { setBridgeError(e.message || "Bridge failed"); }
    finally { setBridging(false); }
  }

  // ── Derived values ────────────────────────────────────────────────────────

  const fromBalance = useMemo(() => {
    if (!fromToken.address) {
      const cb = chainBalances.find((c) => c.networkId === fromToken.chainId);
      const multiChainBal = parseFloat(cb?.balance || "0");
      // When the from-token is on the currently active network, also check the
      // direct single-network balance (fetched without a race timeout), and use
      // whichever is larger — avoids showing 0 when multiChain fetch timed out.
      const directBal = fromToken.chainId === network.id ? parseFloat(balance) : 0;
      return Math.max(multiChainBal, directBal) || parseFloat(fromToken.balance) || 0;
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
    // Sort tokens within each chain: highest balance first
    for (const g of Object.values(groups)) {
      g.tokens.sort((a, b) => (parseFloat(b.balance) || 0) - (parseFloat(a.balance) || 0));
    }
    // Sort chains: active network first, then by any nonzero balance, then rest
    return Object.values(groups).sort((a, b) => {
      if (a.chainId === network.id) return -1;
      if (b.chainId === network.id) return 1;
      const bA = a.tokens.reduce((s, t) => s + (parseFloat(t.balance) || 0), 0);
      const bB = b.tokens.reduce((s, t) => s + (parseFloat(t.balance) || 0), 0);
      return bB - bA;
    });
  }, [allTokens, pickerChain, pickerSearch, network.id]);

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
          <div className="flex-shrink-0"><TokenIcon symbol={t.symbol} logo={t.logo} size={36} /></div>
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
              {pickerMode === "from" ? "Sell" : "Buy"} — Select Token
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
                    {!isSolMintSearch && " — select a chain above to change network"}
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
                      <TokenIcon symbol={importToken.symbol} logo={importToken.logo} size={40} />
                      <div className="absolute -bottom-0.5 -right-0.5">
                        <ChainIcon chainId={importToken.chainId} logo={NETWORKS[importToken.chainId]?.logo} size={14} />
                      </div>
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
              <p className="text-[10px] text-muted">{isBridge ? "Powered by LI.FI" : (fromToken.chainId === "solana" ? "Powered by Jupiter" : "ParaSwap · KyberSwap")}</p>
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
                  <TokenIcon symbol={fromToken.symbol} logo={fromToken.logo} size={26} />
                  <div className="absolute -bottom-0.5 -right-0.5">
                    <ChainIcon chainId={fromToken.chainId} logo={fromNetObj?.logo} size={13} />
                  </div>
                </div>
                <div className="text-left">
                  <p className="text-[13px] font-bold text-text-primary leading-tight">{fromToken.symbol}</p>
                  <p className="text-[10px] text-muted leading-tight">{fromToken.chainName.split(" ")[0]}</p>
                </div>
                <ChevronDownIcon size={12} className="text-muted" />
              </button>
            </div>
            {fromBalance > 0 && (
              <div className="flex gap-2 mt-3">
                {[{ l: "25%", p: 0.25 }, { l: "50%", p: 0.5 }, { l: "75%", p: 0.75 }, { l: "MAX", p: 1 }].map(({ l, p }) => (
                  <button key={l}
                    onClick={() => {
                      // Native SOL must keep headroom for the network fee + any ATA rent.
                      const isNativeSol = fromToken.chainId === "solana" && !fromToken.address;
                      const cap = isNativeSol ? Math.max(0, fromBalance - SOL_FEE_RESERVE) : fromBalance;
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
                {receiveAmt && fromAmount && !isBridge && routeOptions[selectedRoute] && (
                  <p className="text-[11px] text-muted tabular-nums mt-0.5">
                    1 {fromToken.symbol} ≈ {(parseFloat(receiveAmt) / parseFloat(fromAmount)).toFixed(4)} {toToken.symbol}
                  </p>
                )}
              </div>
              <button onClick={() => { setPickerSearch(""); setPickerChain(null); setPickerMode("to"); }}
                className="flex items-center gap-2 pl-2 pr-3 py-2 rounded-2xl bg-surface-2 hover:bg-surface-3 transition-colors flex-shrink-0">
                <div className="relative">
                  <TokenIcon symbol={toToken.symbol} logo={toToken.logo} size={26} />
                  <div className="absolute -bottom-0.5 -right-0.5">
                    <ChainIcon chainId={toToken.chainId} logo={toNet?.logo} size={13} />
                  </div>
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
              <p className="text-[11px] text-muted">{isBridge ? "Searching bridge routes…" : "Getting quotes from ParaSwap and KyberSwap…"}</p>
            </div>
          )}

          {/* Route error */}
          {routeError && !isLoading && <SwapErrorCard message={routeError} tone="amber" />}

          {/* Execution error */}
          {activeExecErr && activeExecErr !== routeError && <SwapErrorCard message={activeExecErr} tone="danger" />}

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
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-3"
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
    </Layout>
  );
}
