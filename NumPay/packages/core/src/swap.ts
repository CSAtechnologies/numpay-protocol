/**
 * Swap/bridge engine shared by the extension Swap page and the mobile swap
 * screen: quote fetchers (ParaSwap, KyberSwap, Relay), fee configuration,
 * gas reserves + upfront-affordability, the exact-amount ERC-20 approval,
 * the cross-surface token-list builder, and the swap error parser. Extracted
 * verbatim from wallet-extension Swap.tsx (2026-07-13, Phase 2 slice 1);
 * execution flows and all React stay per-surface. Aggregator responses are
 * validated by swapGuards before anything is signed.
 */
import { ethers } from "ethers";
import { NETWORKS } from "./networks";
import { DEFAULT_TOKENS } from "./tokens";
import {
  SOLANA_SWAP_TOKENS, signSimulateSendSolanaTx,
  fetchJupiterQuote, executeJupiterSwap, hasTokenAccount, WSOL_MINT,
} from "./chains/solana";
import type { NonEvmChain } from "./chains";
import {
  assertTrustedSpender, assertTrustedRouter, assertChainId,
  assertIsContract, assertNativeValue, simulateOrThrow,
} from "./swapGuards";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface SwapToken {
  symbol: string;
  name: string;
  logo?: string;
  address?: string;
  decimals: number;
  balance: string;
  chainId: string;
  chainName: string;
  custom?: boolean;
  // Live USD price carried from the held-token fetchers when known. Fallback
  // fiat pricing only; quote-provided USD values take precedence.
  priceUsd?: number;
  // Indexer spam flag carried from the held-token fetchers; sinks the token
  // to the bottom of the picker regardless of its (usually fake) quantity.
  possibleSpam?: boolean;
}

export interface RouteOption {
  provider: "paraswap" | "kyberswap" | "jupiter" | "relay";
  label: string;
  logo: string;
  destAmount: string;
  destAmountRaw: string;
  gasCostUSD: string;
  // Quote-reported fiat value of each side (post-fee), used for the ≈ $ lines.
  srcUsd?: number;
  destUsd?: number;
  tag?: string;
  priceRoute?: any;
  routeSummary?: any;
  kyberRouterAddress?: string;
  // Relay returns ready-to-sign steps with the quote (no separate build call).
  relaySteps?: any[];
}

export interface BridgeRoute {
  id: string;
  gasCostUSD: string;
  tags: string[];
  toAmount: string;
  fromAmountUSD?: string;
  toAmountUSD?: string;
  steps: Array<{
    tool?: string;
    toolDetails?: { name: string; logoURI: string };
    estimate?: { executionDuration?: number; approvalAddress?: string };
    transactionRequest?: { to: string; data: string; value: string; gasLimit?: string };
  }>;
}

// ── Constants ─────────────────────────────────────────────────────────────────

// Aggregator brand marks for the route rows. Kept together because they are
// third-party hotlinks that rot: the two CoinGecko/Relay URLs used until
// 2026-07-27 had gone to HTTP 403 and 404 respectively, and both clients had
// been drawing a broken image (extension) or a monogram disc (mobile) ever
// since, with nothing failing loudly. Every URL below was fetched and confirmed
// 200 with an image content-type on 2026-07-27. Re-check them if a route row
// loses its mark; do NOT assume the renderer is at fault first.
export const PROVIDER_LOGO = {
  // PSP is ParaSwap's own token, so its Trust Wallet asset is the brand mark.
  // CoinGecko now 403s hotlinks to its asset paths, so it is not usable here.
  paraswap: "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains/ethereum/assets/0xcAfE001067cDEF266AfB7Eb5A286dCFD277f3dE5/logo.png",
  kyberswap: "https://assets.coingecko.com/coins/images/14899/small/RwdVsGcw_400x400.jpg",
  // assets.relay.link/icon.png is gone (404). LI.FI ships Relay's mark in the
  // same icon set that feeds the bridge rows, so swap-side and bridge-side
  // Relay now render the identical logo.
  relay: "https://raw.githubusercontent.com/lifinance/types/main/src/assets/icons/bridges/relay.svg",
  jupiter: "https://assets.coingecko.com/coins/images/34188/small/jup.png",
} as const;

export const PARASWAP_API     = "https://apiv5.paraswap.io";
export const LIFI_API         = "https://li.quest/v1";
export const LIFI_ROUTES_URL  = `${LIFI_API}/advanced/routes`;
export const NATIVE_ADDR      = "0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE";
export const LIFI_NATIVE      = "0x0000000000000000000000000000000000000000";

// Shared fee-collection wallet (EVM). One address works across every EVM
// aggregator and chain — used by ParaSwap, KyberSwap and Relay app fees.
export const FEE_RECIPIENT: string = "0x68870B4CA1b586Da2E8977dAaA18DF00514e52A1"; // NumPay fee wallet

// Relay (relay.link) — a third same-chain EVM quote source. The /quote response
// already carries the ready-to-sign `steps`, so there is no separate build call.
export const RELAY_API        = "https://api.relay.link";
export const RELAY_NATIVE     = "0x0000000000000000000000000000000000000000"; // native coin
// EVM chains Relay supports for same-chain swaps (others fall back to PS/Kyber).
export const RELAY_CHAINS = new Set<number>([
  1, 10, 56, 137, 8453, 42161, 43114, 534352, 59144, 5000, 81457, 324, 1101, 250,
]);
// App fee (revenue). Disabled until BOTH are set, so users are never charged
// against an unset recipient. Keep the bps at or under competitors (~25 = 0.25%).
// RELAY_FEE_RECIPIENT must be an EVM wallet you control; fee accrues off-chain
// and is withdrawn via Relay's integrator endpoints.
export const RELAY_APP_FEE_BPS: string   = "50";          // 0.5%
export const RELAY_FEE_RECIPIENT: string = FEE_RECIPIENT;

// ParaSwap / Velora partner fee. Taken from the destination token. The fee is
// applied on BOTH the /prices quote and the /transactions build, so the receive
// amount shown to the user already reflects it. Disabled until a recipient is
// set, so nothing is charged before then. A single EVM address works as the
// claim wallet across every ParaSwap chain; with isDirectFeeTransfer=false the
// fee accrues in ParaSwap's Fee Vault and is withdrawn per chain later.
export const PARASWAP_PARTNER         = "numpay";
export const PARASWAP_FEE_BPS: string         = "50";   // 0.5%
export const PARASWAP_FEE_RECIPIENT: string   = FEE_RECIPIENT;
export const PARASWAP_DIRECT_TRANSFER = false;  // false = Fee Vault accrual (claim later)
export const paraswapFeeActive = () => Boolean(PARASWAP_FEE_RECIPIENT) && PARASWAP_FEE_BPS !== "0";

// KyberSwap integrator fee. Charged from the INPUT token (chargeFeeBy=currency_in)
// so the quoted receive amount is exactly what the user gets regardless of how
// Kyber reports amountOut. The fee params ride on the GET /routes call and come
// back inside routeSummary.extraFee, which /route/build already passes through —
// so the router sends the fee to FEE_RECIPIENT on-chain per swap (no later claim).
// isInBps=true with feeAmount out of 10000, so 50 = 0.5%. Disabled if unset.
export const KYBER_FEE_BPS: string  = "50";
export const KYBER_CHARGE_BY        = "currency_in";
export const kyberFeeActive = () => Boolean(FEE_RECIPIENT) && KYBER_FEE_BPS !== "0";

// LI.FI bridge fee. Unlike the others, the fee wallet is NOT sent in the request:
// LI.FI maps the integrator string to a wallet registered on their side, so this
// stays "0" (disabled) until LI.FI registers `numpay` + FEE_RECIPIENT. Passing a
// fee before then is rejected. `fee` is a FRACTION (0.005 = 0.5%), not bps. To go
// live after they confirm: set LIFI_FEE to "0.005".
export const LIFI_INTEGRATOR = "numpay";
export const LIFI_FEE: string = "0";
export const lifiFeeActive = () => parseFloat(LIFI_FEE) > 0;

export const ERC20_ABI = [
  "function name() view returns (string)",
  "function symbol() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

export const KYBERSWAP_CHAIN: Record<number, string> = {
  1: "ethereum", 137: "polygon", 42161: "arbitrum", 10: "optimism",
  8453: "base", 43114: "avalanche", 56: "bsc", 534352: "scroll",
  59144: "linea", 5000: "mantle", 81457: "blast", 250: "fantom",
  324: "zksync", 1101: "polygon-zkevm", 25: "cronos",
};

// LI.FI chain IDs — EVM chains use their numeric chainId, non-EVM use LI.FI's own IDs
export const LIFI_CHAIN_ID: Record<string, number> = {
  ethereum: 1, polygon: 137, arbitrum: 42161, optimism: 10,
  base: 8453, avalanche: 43114, bsc: 56, zksync: 324,
  scroll: 534352, linea: 59144, mantle: 5000, blast: 81457,
  polygonzkevm: 1101, fantom: 250, cronos: 25, celo: 42220,
  gnosis: 100, moonbeam: 1284, aurora: 1313161554, sei: 1329,
  klaytn: 8217, metis: 1088, sepolia: 11155111,
  solana: 1151111081099710,
};

// Native token address LI.FI uses for each chain (EVM chains share 0x0000...).
// Solana is the system program address (32 ones), verified against
// li.quest/v1/token 2026-07-06 — NOT the wSOL mint So111…112 (that is
// Jupiter's convention); passing the wSOL mint makes bridges deliver
// wrapped SOL as an SPL token instead of native SOL.
export const LIFI_NATIVE_TOKEN: Record<string, string> = {
  solana: "11111111111111111111111111111111",
};

// Chain filter ordering by user base / activity (lower = shown first).
// Unlisted chains fall after these, keeping their natural order.
export const CHAIN_RANK: Record<string, number> = {
  ethereum: 0, bsc: 1, solana: 2, tron: 3, base: 4, arbitrum: 5,
  polygon: 6, optimism: 7, avalanche: 8, bitcoin: 9, xrp: 10,
  litecoin: 11, sui: 12, linea: 13, scroll: 14, zksync: 15,
  fantom: 16, cronos: 17, mantle: 18, blast: 19, gnosis: 20,
};
export const chainRank = (id: string) => CHAIN_RANK[id] ?? 99;

// ── Helpers ───────────────────────────────────────────────────────────────────

export const isAddress = (s: string) => /^0x[0-9a-fA-F]{40}$/.test(s.trim());
// Solana mint = base58, 32-44 chars (no 0x, excludes 0/O/I/l per base58 alphabet)
export const isSolanaMint = (s: string) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(s.trim());
// SOL left untouched on a max swap so the network fee + transient wrapped-SOL
// rent can be paid. The wrapped-SOL account is created and closed inside the
// same transaction, so its ~0.00204 SOL rent is refunded — we only need it
// available momentarily. 0.005 covers the base fee, a generous priority-fee
// headroom, and that transient rent, without stranding most of a small balance
// (the old 0.01, ~$1.80 at $180/SOL, left a $1 wallet almost nothing to swap).
// Covers the swap fee, priority margin, and one output-token ATA rent (~0.00204
// SOL) that a Jupiter route may open on the buy side. Trimmed from 0.005 (~$0.90)
// so a small SOL balance is not over-reserved; the pre-broadcast guard +
// simulation are the real safety net if this is ever short.
export const SOL_FEE_RESERVE = 0.003;

// Native EVM input needs gas headroom too: a MAX swap/bridge attached the full
// balance as `value`, leaving nothing for gas, so it always failed at broadcast
// ("insufficient funds for gas * price + value"). Reserve the live estimated
// fee for an aggregator-sized tx (~350k gas — a swap through a router costs
// far more than a 21k transfer), +20% margin. Fee data is fetched on first use
// and cached per chain for the popup session; if the fetch fails, fall back to
// a small flat cushion. Over-reserving a hair only trims MAX; the guard +
// simulation still protect the actual send.
// Same-chain aggregator swaps cost ~350k gas units on most chains, but
// Arbitrum prices L1 data in gas units too, so the identical swap quotes
// 1-3M there — the same inflation that bit bridges (below).
export const SWAP_GAS_UNITS: Record<string, bigint> = { arbitrum: 2_500_000n };
export const SWAP_GAS_UNITS_DEFAULT = 350_000n;
// A cross-chain bridge needs a much larger reserve than a same-chain swap: the
// node's admission check holds gasLimit × maxFeePerGas up front (refunding the
// unused part after mining), and LI.FI quotes ~5.3M gas units on Arbitrum
// because Arbitrum prices L1 data in gas units. 350k-worth of reserve left a
// near-MAX native bridge unsendable there. Other chains quote far less.
export const BRIDGE_GAS_UNITS: Record<string, bigint> = { arbitrum: 6_000_000n };
export const BRIDGE_GAS_UNITS_DEFAULT = 800_000n;
// Ceiling for a route's fee-on-top native messaging fee (Stargate/LayerZero
// style). Real fees are cents on L2s and at most a couple of dollars from L1,
// so $5 bounds the worst-case loss from a tampered/inflated quote while
// clearing every legitimate route.
export const BRIDGE_FEE_CAP_USD = 5;
// Flat fallback when live fee data is unreachable. Ethereum L1 gas is real
// money; everywhere else a one-size 0.0005 (~$1.25 in ETH) dwarfed the true
// cost and zeroed MAX for small L2 balances. Under-reserving on the fallback
// path only means MAX fails at broadcast with an honest insufficient-funds
// message and the user lowers the amount.
export const EVM_SWAP_FLAT_RESERVE_L1 = 0.0005;
export const EVM_SWAP_FLAT_RESERVE = 0.00005;
export const flatSwapReserve = (chainId: string) =>
  chainId === "ethereum" ? EVM_SWAP_FLAT_RESERVE_L1 : EVM_SWAP_FLAT_RESERVE;
const _gasPriceCache = new Map<string, bigint>(); // chainId -> wei per gas
export async function evmSwapReserve(chainId: string, forBridge = false): Promise<number> {
  const net = NETWORKS[chainId];
  if (!net) return flatSwapReserve(chainId);
  let gp = _gasPriceCache.get(chainId);
  if (gp == null) {
    try {
      const provider = new ethers.JsonRpcProvider(net.rpcUrl, net.chainId, { staticNetwork: true });
      const fd = await provider.getFeeData();
      gp = fd.maxFeePerGas ?? fd.gasPrice ?? 0n;
    } catch { gp = 0n; }
    if (gp > 0n) _gasPriceCache.set(chainId, gp);
  }
  if (!gp || gp <= 0n) return flatSwapReserve(chainId);
  const units = forBridge
    ? (BRIDGE_GAS_UNITS[chainId] ?? BRIDGE_GAS_UNITS_DEFAULT)
    : (SWAP_GAS_UNITS[chainId] ?? SWAP_GAS_UNITS_DEFAULT);
  const feeWei = (units * gp * 12n) / 10n; // +20% headroom
  const v = Number(ethers.formatUnits(feeWei, net.decimals));
  return Number.isFinite(v) && v > 0 ? v : flatSwapReserve(chainId);
}

// EVM nodes admit a tx only when balance >= value + gasLimit × maxFeePerGas,
// holding the full limit up front even though the actual charge is far lower
// (the unused hold is refunded). When we pass an aggregator-quoted gasLimit we
// skip ethers' estimateGas — the step that would otherwise surface
// "insufficient funds" readably — so check affordability here and fail with
// the exact shortfall before anything is signed. Some RPCs (dRPC) masked this
// rejection as "temporary internal error" garbage.
export async function assertUpfrontAffordable(
  provider: ethers.Provider, owner: string, value: bigint,
  quotedGas: bigint, symbol: string, kind: "swap" | "bridge",
): Promise<void> {
  if (quotedGas <= 0n) return;
  const [bal, fd] = await Promise.all([provider.getBalance(owner), provider.getFeeData()]);
  const gasPrice = fd.maxFeePerGas ?? fd.gasPrice ?? 0n;
  if (gasPrice <= 0n) return;
  const upfront = value + quotedGas * gasPrice;
  if (bal >= upfront) return;
  const fmt = (w: bigint) =>
    Number(ethers.formatEther(w)).toFixed(8).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
  throw new Error(
    `Insufficient balance for gas: the network holds ${fmt(quotedGas * gasPrice)} ${symbol} for gas up front ` +
    `(most is refunded after the ${kind} mines), so this ${kind} needs ${fmt(upfront)} ${symbol} available ` +
    `but the wallet has ${fmt(bal)}. Lower the amount by about ${fmt(upfront - bal)} ${symbol} and try again.`,
  );
}

// The slippage field is free text; sanitize before it reaches any aggregator.
// NaN/zero falls back to 0.5%, and the cap stops fat-fingered values (e.g. 50)
// from authorizing a sandwich-sized tolerance.
export function sanitizeSlippagePct(raw: string): number {
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) return 0.5;
  return Math.min(n, 5);
}

// Approve `spender` for exactly `amount` of an ERC-20, resetting to zero first
// when an allowance is already set (SWAP-5). Reset-to-zero tokens (e.g. USDT)
// revert if a non-zero allowance is changed directly; the prior code always
// called approve(amount) which would break re-approval for those tokens. Exact
// amount (never unlimited) keeps any residual allowance bounded to this swap.
export async function approveErc20Exact(
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

export function buildAllSwapTokens(
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

export async function fetchParaswapQuote(chainId: number, from: SwapToken, to: SwapToken, amt: string): Promise<RouteOption | null> {
  try {
    let url = `${PARASWAP_API}/prices?srcToken=${from.address || NATIVE_ADDR}&srcDecimals=${from.decimals}` +
      `&destToken=${to.address || NATIVE_ADDR}&destDecimals=${to.decimals}` +
      `&amount=${ethers.parseUnits(amt, from.decimals)}&network=${chainId}&partner=${PARASWAP_PARTNER}`;
    // Bake the partner fee into the quote so the shown receive amount is post-fee.
    if (paraswapFeeActive()) {
      url += `&partnerFeeBps=${PARASWAP_FEE_BPS}&partnerAddress=${PARASWAP_FEE_RECIPIENT}`;
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (!data?.priceRoute) return null;
    const pr = data.priceRoute;
    return {
      provider: "paraswap", label: "ParaSwap",
      logo: PROVIDER_LOGO.paraswap,
      destAmount: parseFloat(ethers.formatUnits(pr.destAmount, to.decimals)).toFixed(Math.min(to.decimals, 6)),
      destAmountRaw: pr.destAmount, gasCostUSD: pr.gasCostUSD || "0", priceRoute: pr,
      srcUsd: parseFloat(pr.srcUSD) || undefined, destUsd: parseFloat(pr.destUSD) || undefined,
    };
  } catch { return null; }
}

export async function fetchKyberQuote(chainId: number, from: SwapToken, to: SwapToken, amt: string): Promise<RouteOption | null> {
  const chain = KYBERSWAP_CHAIN[chainId];
  if (!chain) return null;
  try {
    let url = `https://aggregator-api.kyberswap.com/${chain}/api/v1/routes` +
      `?tokenIn=${from.address || NATIVE_ADDR}&tokenOut=${to.address || NATIVE_ADDR}` +
      `&amountIn=${ethers.parseUnits(amt, from.decimals)}&saveGas=0&gasInclude=1`;
    // Bake the integrator fee into the route; it returns inside routeSummary.extraFee
    // and is enforced on-chain at build time. currency_in keeps the quote honest.
    if (kyberFeeActive()) {
      url += `&feeAmount=${KYBER_FEE_BPS}&chargeFeeBy=${KYBER_CHARGE_BY}&isInBps=true&feeReceiver=${FEE_RECIPIENT}`;
    }
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    if (data?.code !== 0 || !data?.data?.routeSummary) return null;
    const rs = data.data.routeSummary;
    return {
      provider: "kyberswap", label: "KyberSwap",
      logo: PROVIDER_LOGO.kyberswap,
      destAmount: parseFloat(ethers.formatUnits(rs.amountOut, to.decimals)).toFixed(Math.min(to.decimals, 6)),
      destAmountRaw: rs.amountOut, gasCostUSD: rs.gasUsd || "0",
      routeSummary: rs, kyberRouterAddress: data.data.routerAddress,
      srcUsd: parseFloat(rs.amountInUsd) || undefined, destUsd: parseFloat(rs.amountOutUsd) || undefined,
    };
  } catch { return null; }
}

export async function fetchRelayQuote(
  chainId: number, from: SwapToken, to: SwapToken, amt: string,
  userAddr: string, slippagePct: number,
): Promise<RouteOption | null> {
  if (!RELAY_CHAINS.has(chainId) || !userAddr) return null;
  try {
    const body: any = {
      user: userAddr,
      recipient: userAddr,
      originChainId: chainId,
      destinationChainId: chainId,
      originCurrency: from.address || RELAY_NATIVE,
      destinationCurrency: to.address || RELAY_NATIVE,
      amount: ethers.parseUnits(amt, from.decimals).toString(),
      tradeType: "EXACT_INPUT",
      slippageTolerance: String(Math.round(slippagePct * 100)), // bps
      referrer: "numpay",
    };
    // Only attach the app fee when a collection wallet is configured.
    if (RELAY_FEE_RECIPIENT && RELAY_APP_FEE_BPS !== "0") {
      body.appFees = [{ recipient: RELAY_FEE_RECIPIENT, fee: RELAY_APP_FEE_BPS }];
    }
    const res = await fetch(`${RELAY_API}/quote`, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const out = data?.details?.currencyOut?.amount;
    if (!out || !data?.steps?.length) return null;
    const gasUsd = data?.fees?.gas?.amountUsd ?? "0";
    return {
      provider: "relay", label: "Relay",
      logo: PROVIDER_LOGO.relay,
      destAmount: parseFloat(ethers.formatUnits(out, to.decimals)).toFixed(Math.min(to.decimals, 6)),
      destAmountRaw: String(out), gasCostUSD: String(gasUsd || "0"),
      relaySteps: data.steps,
      srcUsd:  parseFloat(data?.details?.currencyIn?.amountUsd)  || undefined,
      destUsd: parseFloat(data?.details?.currencyOut?.amountUsd) || undefined,
    };
  } catch { return null; }
}

// ── EVM same-chain swap execution ─────────────────────────────────────────────
// Extracted from the extension's executeSwap EVM branches; both surfaces call
// these with their own signer. Every branch runs the swapGuards sequence
// (chain-id, trusted router/spender, contract-code, native-value bound,
// pre-broadcast simulation) before anything is signed. Returns the broadcast
// tx hash; receipt-driven refreshes ride the onMined callback (Relay waits
// for its receipts inline, so onMined fires before it returns).

export interface EvmSwapContext {
  signer: ethers.Signer;          // connected to the route's chain RPC
  owner: string;                  // the wallet address (sender + recipient)
  chainId: number;                // numeric EVM chain id the route was quoted for
  symbol: string;                 // native symbol, for error copy
  fromToken: SwapToken;
  toToken: SwapToken;
  fromAmount: string;             // human units of fromToken
  slippage: string;               // free-text slippage %, sanitized here
  onProgress?: (label: string) => void;
  onMined?: () => void;           // a receipt landed (balances can refresh)
}

export async function executeEvmSwap(route: RouteOption, ctx: EvmSwapContext): Promise<string> {
  if (route.provider === "paraswap") return executeParaswapSwap(route, ctx);
  if (route.provider === "relay") return executeRelaySwap(route, ctx);
  if (route.provider === "kyberswap") return executeKyberSwap(route, ctx);
  throw new Error(`Not an EVM swap route: ${route.provider}`);
}

async function executeParaswapSwap(route: RouteOption, ctx: EvmSwapContext): Promise<string> {
  const { signer, owner, chainId, symbol, fromToken, toToken, fromAmount } = ctx;
  const srcAmount = ethers.parseUnits(fromAmount, fromToken.decimals).toString();
  const srcAmountBn = BigInt(srcAmount);
  const isNativeSwap = !fromToken.address;

  // Guard 1: confirm the RPC serves the chain we built the route for.
  await assertChainId(signer, chainId);

  const txRes = await fetch(`${PARASWAP_API}/transactions/${chainId}?ignoreChecks=true`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      srcToken: fromToken.address || NATIVE_ADDR, destToken: toToken.address || NATIVE_ADDR,
      srcAmount,
      slippage: Math.round(sanitizeSlippagePct(ctx.slippage) * 100),
      userAddress: owner, priceRoute: route.priceRoute, partner: PARASWAP_PARTNER,
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
    signer.provider!, owner, value,
    txData.gas ? BigInt(txData.gas) : 0n, symbol, "swap",
  );

  const psApproval = !!(fromToken.address && route.priceRoute?.tokenTransferProxy);
  if (fromToken.address && route.priceRoute?.tokenTransferProxy) {
    // Gate the approval to ParaSwap's proxy for THIS chain (Base differs
    // from the others). Exact amount only.
    assertTrustedSpender("paraswap", route.priceRoute.tokenTransferProxy, chainId);
    ctx.onProgress?.(`Approving ${fromToken.symbol} (1 of 2)…`);
    await approveErc20Exact(signer, fromToken.address, owner, route.priceRoute.tokenTransferProxy, srcAmount);
  }
  ctx.onProgress?.(psApproval ? "Swapping (2 of 2)…" : "Swapping…");
  await simulateOrThrow(signer, { to: txData.to, data: txData.data, value });
  const tx = await signer.sendTransaction({
    to: txData.to, data: txData.data, value,
    gasLimit: txData.gas ? BigInt(txData.gas) : undefined,
  });
  // Refresh the instant the receipt lands so the received token appears
  // without waiting out the poll cadence.
  void tx.wait().then(() => ctx.onMined?.()).catch(() => {});
  return tx.hash;
}

async function executeRelaySwap(route: RouteOption, ctx: EvmSwapContext): Promise<string> {
  const { signer, chainId, fromToken, fromAmount } = ctx;
  const srcAmountBn = BigInt(ethers.parseUnits(fromAmount, fromToken.decimals).toString());
  const isNativeSwap = !fromToken.address;

  await assertChainId(signer, chainId);

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
      ctx.onProgress?.(relayTotal > 1 ? `Confirming step ${relayDone} of ${relayTotal} on-chain…` : "Confirming on-chain…");
      if (d.chainId != null && Number(d.chainId) !== chainId) {
        throw new Error(`Blocked for safety: Relay step targets chain ${d.chainId}, expected ${chainId}.`);
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
  ctx.onMined?.(); // every Relay receipt was awaited inline above
  return lastHash;
}

async function executeKyberSwap(route: RouteOption, ctx: EvmSwapContext): Promise<string> {
  const { signer, owner, chainId, fromToken, fromAmount } = ctx;
  const srcAmount = ethers.parseUnits(fromAmount, fromToken.decimals).toString();
  const srcAmountBn = BigInt(srcAmount);
  const isNativeSwap = !fromToken.address;

  await assertChainId(signer, chainId);

  const kyberChain = KYBERSWAP_CHAIN[chainId];
  const buildRes = await fetch(`https://aggregator-api.kyberswap.com/${kyberChain}/api/v1/route/build`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      routeSummary: route.routeSummary, sender: owner, recipient: owner,
      slippageTolerance: Math.round(sanitizeSlippagePct(ctx.slippage) * 100),
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
    ctx.onProgress?.(`Approving ${fromToken.symbol} (1 of 2)…`);
    await approveErc20Exact(signer, fromToken.address, owner, routerAddress, srcAmount);
  }
  ctx.onProgress?.(fromToken.address ? "Swapping (2 of 2)…" : "Swapping…");
  await simulateOrThrow(signer, { to: routerAddress, data, value });
  const tx = await signer.sendTransaction({ to: routerAddress, data, value });
  void tx.wait().then(() => ctx.onMined?.()).catch(() => {});
  return tx.hash;
}

// ── Solana same-chain swap (Jupiter) ──────────────────────────────────────────
// Extracted from the extension's Jupiter quote + executeSwap branches. Shared
// with mobile. Execution keeps the SOL-affordability pre-check (fee headroom +
// per-account rent) and the staleness re-quote, then signs via the shared
// simulate-and-send Solana path inside executeJupiterSwap.

/** Fetch a Jupiter quote and shape it as a RouteOption (native = WSOL_MINT). */
export async function fetchJupiterSwapQuote(
  from: SwapToken, to: SwapToken, amount: string, slippagePct: number,
): Promise<RouteOption | null> {
  const inMint  = from.address || WSOL_MINT;
  const outMint = to.address   || WSOL_MINT;
  const amountRaw = ethers.parseUnits(amount, from.decimals).toString();
  const q = await fetchJupiterQuote(inMint, outMint, amountRaw, Math.round(slippagePct * 100));
  if (!q) return null;
  return {
    provider: "jupiter", label: "Jupiter",
    logo: PROVIDER_LOGO.jupiter,
    destAmount: parseFloat(ethers.formatUnits(q.outAmount, to.decimals)).toFixed(Math.min(to.decimals, 6)),
    destAmountRaw: q.outAmount, gasCostUSD: "0", tag: "Best",
    priceRoute: q.raw, // carry the Jupiter quote for the swap build
    // Jupiter reports one USD value for the trade; the per-side split falls
    // back to held-token prices when this is absent.
    srcUsd: parseFloat(q.raw?.swapUsdValue) || undefined,
  };
}

export interface SolanaSwapContext {
  fromToken: SwapToken;
  toToken: SwapToken;
  fromAmount: string;
  solanaSecretKey: Uint8Array;
  solanaAddress: string;
  /** Known SOL balance; 0 means "unknown" and skips the pre-block (sim decides). */
  solBalance: number;
  slippage: string;
  /** Called when the quote is re-priced past slippage, so the UI can refresh. */
  onRepriceNeeded?: () => void;
}

/**
 * Execute a Solana same-chain swap via Jupiter and return the tx signature.
 * Runs the SOL-affordability pre-check and a fresh staleness re-quote before
 * signing (executeJupiterSwap simulates locally before broadcast).
 */
export async function executeSolanaSwap(route: RouteOption, ctx: SolanaSwapContext): Promise<string> {
  const { fromToken, toToken, fromAmount, solBalance } = ctx;

  // Compute what THIS swap actually needs in SOL (Jupiter 6024 fails
  // otherwise): a bounded fee (base + priority capped at 0.001 SOL), plus
  // ~0.002 SOL rent per token account that must be created — the temporary
  // wrapped-SOL account when SOL is on either side (refunded after the swap),
  // and the output token account if it doesn't exist.
  const FEE_HEADROOM = 0.0015;
  const ATA_RENT     = 0.00204;
  let requiredSol = FEE_HEADROOM;
  if (!fromToken.address || !toToken.address) requiredSol += ATA_RENT;
  if (toToken.address) {
    const exists = await hasTokenAccount(ctx.solanaAddress, toToken.address);
    if (exists === false) requiredSol += ATA_RENT;
  }
  const totalNeeded = (!fromToken.address ? parseFloat(fromAmount) : 0) + requiredSol;
  // solBalance of 0 may just mean the balance fetch failed; in that case let
  // the pre-broadcast simulation be the judge instead of false-blocking.
  if (solBalance > 0 && totalNeeded > solBalance) {
    throw new Error(
      `This swap needs ~${requiredSol.toFixed(4)} SOL for the network fee and account rent` +
      (!fromToken.address ? ` on top of the ${fromAmount} SOL being swapped` : "") +
      `, but the wallet has ${solBalance.toFixed(4)} SOL. Lower the amount or add a little SOL.`
    );
  }

  // Jupiter quotes go stale within seconds; a stale quote fails the
  // pre-broadcast simulation (slippage/blockhash). Re-quote now and use the
  // fresh route — but abort if the price dropped more than the user's slippage
  // versus what was on screen.
  const inMint    = fromToken.address || WSOL_MINT;
  const outMint   = toToken.address   || WSOL_MINT;
  const amountRaw = ethers.parseUnits(fromAmount, fromToken.decimals).toString();
  const slipBps   = Math.round(sanitizeSlippagePct(ctx.slippage) * 100);
  let quoteToUse  = route.priceRoute;
  const fresh = await fetchJupiterQuote(inMint, outMint, amountRaw, slipBps);
  if (fresh) {
    const shown = BigInt(route.destAmountRaw || "0");
    const now   = BigInt(fresh.outAmount);
    if (shown > 0n && now < shown - (shown * BigInt(slipBps)) / 10000n) {
      ctx.onRepriceNeeded?.();
      throw new Error("The price moved since this quote was shown. Review the updated rate and try again.");
    }
    quoteToUse = fresh.raw;
  }
  return executeJupiterSwap(ctx.solanaSecretKey, ctx.solanaAddress, quoteToUse);
}

// ── LI.FI cross-chain bridge ──────────────────────────────────────────────────
// Extracted from the extension's fetchQuotesForPair (bridge branch) and
// executeBridge. Shared with mobile. The /advanced/routes list is display
// data; execution re-fetches /quote for the actual transactionRequest and
// runs the deterministic guards (trusted diamond router + approval spender,
// exact native-value bound with a quoted+capped messaging-fee allowance,
// chain-id assertion, upfront gas hold). Bridge calldata is often not
// eth_call-simulatable on the source chain, so simulation is best-effort only.

/**
 * Resolve the correct wallet address and LI.FI token address for one side of a
 * bridge. `solanaAddress` is required only when either side is Solana.
 */
export function lifiSide(token: SwapToken, evmAddress: string, solanaAddress?: string): {
  lifiChainId: number | undefined; address: string; tokenAddress: string;
} {
  const isSol = token.chainId === "solana";
  return {
    lifiChainId: LIFI_CHAIN_ID[token.chainId],
    address: isSol ? (solanaAddress ?? "") : evmAddress,
    tokenAddress: token.address || LIFI_NATIVE_TOKEN[token.chainId] || LIFI_NATIVE,
  };
}

/**
 * Fetch up to 4 display routes for a cross-chain bridge (/advanced/routes).
 * Returns [] with no throw when the pair is unsupported or nothing routes, so
 * callers can show an inline message.
 */
export async function fetchBridgeRoutes(
  from: SwapToken, to: SwapToken, amount: string,
  evmAddress: string, slippagePct: number, solanaAddress?: string,
): Promise<{ routes: BridgeRoute[]; error?: string }> {
  const f = lifiSide(from, evmAddress, solanaAddress);
  const t = lifiSide(to, evmAddress, solanaAddress);
  if (!f.lifiChainId || !t.lifiChainId) {
    return { routes: [], error: `Bridge not supported for ${from.chainName} → ${to.chainName} yet` };
  }
  try {
    const res = await fetch(LIFI_ROUTES_URL, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        fromChainId:      f.lifiChainId,
        toChainId:        t.lifiChainId,
        fromTokenAddress: f.tokenAddress,
        toTokenAddress:   t.tokenAddress,
        fromAmount:       ethers.parseUnits(amount, from.decimals).toString(),
        fromAddress: f.address, toAddress: t.address,
        options: {
          slippage: slippagePct / 100, order: "RECOMMENDED",
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
      return { routes: [], error: "No bridge routes found. Try a larger amount or different token pair." };
    }
    return {
      routes: data.routes.slice(0, 4).map((r: any) => ({
        id: r.id, gasCostUSD: r.gasCostUSD || "0", tags: r.tags || [],
        toAmount: r.toAmountMin || r.toAmount || "0", steps: r.steps || [],
        fromAmountUSD: r.fromAmountUSD, toAmountUSD: r.toAmountUSD,
      })),
    };
  } catch (e: any) {
    return { routes: [], error: e?.message || "Failed to fetch bridge routes" };
  }
}

export interface BridgeContext {
  fromToken: SwapToken;
  toToken: SwapToken;
  fromAmount: string;
  evmAddress: string;         // EVM wallet address (used for EVM sides + logging)
  // EVM source: a signer on the source chain. Solana source: the keypair.
  evmSigner?: ethers.Signer;
  solanaSecretKey?: Uint8Array;
  solanaAddress?: string;
  // Live USD price of the source token, for the native messaging-fee cap.
  fromTokenUsdPrice: number;
  onProgress?: (label: string) => void;
  onMined?: () => void;
}

/**
 * Execute a cross-chain bridge and return the source-chain tx hash / signature.
 * EVM and Solana source paths, guard-checked. The caller writes the txLog
 * entry (kind "bridge") — this returns only the hash.
 */
export async function executeBridge(ctx: BridgeContext): Promise<string> {
  const { fromToken, toToken, fromAmount, evmAddress } = ctx;
  const fromNet = NETWORKS[fromToken.chainId];
  const isSolanaSource = fromToken.chainId === "solana";
  if (!fromNet && !isSolanaSource) throw new Error("Bridge execution is only supported from EVM chains and Solana");
  if (isSolanaSource && (!ctx.solanaSecretKey || !ctx.solanaAddress)) throw new Error("Solana wallet not ready");

  // /advanced/routes gives display data only; /quote gives the actual transactionRequest
  const f = lifiSide(fromToken, evmAddress, ctx.solanaAddress);
  const t = lifiSide(toToken, evmAddress, ctx.solanaAddress);
  const fromAmtRaw = ethers.parseUnits(fromAmount, fromToken.decimals).toString();

  let quoteUrl = `${LIFI_API}/quote?fromChain=${f.lifiChainId}&toChain=${t.lifiChainId}` +
    `&fromToken=${encodeURIComponent(f.tokenAddress)}&toToken=${encodeURIComponent(t.tokenAddress)}` +
    `&fromAmount=${fromAmtRaw}&fromAddress=${f.address}&toAddress=${t.address}&integrator=${LIFI_INTEGRATOR}`;
  // Must match the fee used when the routes were fetched.
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
    ctx.onProgress?.("Bridging…");
    const sig = await signSimulateSendSolanaTx(ctx.solanaSecretKey!, ctx.solanaAddress!, txReq.data);
    ctx.onMined?.();
    return sig;
  }

  if (!txReq?.to || !txReq?.data) throw new Error("Bridge provider returned incomplete transaction data");
  const signer = ctx.evmSigner;
  if (!signer) throw new Error("EVM signer not provided for bridge");
  await assertChainId(signer, fromNet.chainId);

  // The LI.FI diamond (router + approval target) is chain-constant — gate it.
  assertTrustedRouter("lifi", txReq.to);
  const value = txReq.value ? BigInt(txReq.value) : 0n;
  // Bound the native value the same way swaps are (SWAP-1): a native-token
  // bridge must attach exactly the bridged amount, an ERC-20 bridge zero.
  const srcAmountBn = BigInt(fromAmtRaw);
  const isNativeBridge = !fromToken.address;
  // Keep the strict zero-native bound for ERC-20 bridges (loosening it would
  // let a tampered route response attach and drain native), but name the
  // actual situation when a route legitimately wants a native messaging fee
  // (some LayerZero/Axelar-style routes) instead of the generic swap wording.
  if (!isNativeBridge && value > 0n) {
    throw new Error(
      "This route attaches a native-coin fee to the transaction, which NumPay doesn't support yet. Try a different route.",
    );
  }
  if (isNativeBridge) {
    if (value < srcAmountBn) {
      throw new Error(`Blocked for safety: transaction sends ${value} wei but the bridge amount is ${srcAmountBn} wei.`);
    }
    const excess = value - srcAmountBn;
    if (excess > 0n) {
      // Some routes (Stargate/LayerZero style) charge a messaging fee ON TOP
      // of the bridged amount: value = amount + fee, itemized in the quote's
      // feeCosts with included:false. Accept the excess only when it exactly
      // matches those quoted native fees AND stays under an independent USD
      // cap, so a tampered response can neither invent an unquoted fee nor
      // inflate a quoted one beyond a bounded loss.
      const isNativeAddr = (a?: string) => !a || /^0x0{40}$/i.test(a) || /^0xe{40}$/i.test(a);
      const quotedFee = ((qData?.estimate?.feeCosts ?? []) as any[])
        .filter((c) => c?.included === false && isNativeAddr(c?.token?.address))
        .reduce((s: bigint, c: any) => s + BigInt(c?.amount ?? 0), 0n);
      if (excess !== quotedFee) {
        throw new Error(
          `Blocked for safety: transaction attaches ${excess} wei above the bridge amount, ` +
          `but the route quotes ${quotedFee} wei of native fees.`,
        );
      }
      const px = ctx.fromTokenUsdPrice;
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

  // LI.FI quotes the gasLimit, so ethers never estimates: check the upfront
  // gas hold ourselves (a near-MAX Arbitrum bridge died at broadcast with an
  // unreadable dRPC error before this existed).
  await assertUpfrontAffordable(
    signer.provider!, evmAddress, value,
    txReq.gasLimit ? BigInt(txReq.gasLimit) : 0n, fromNet.symbol, "bridge",
  );

  // Approve the bridge contract if spending an ERC-20 (exact amount only).
  const approvalAddr = qData?.estimate?.approvalAddress;
  const bridgeApproval = !!(fromToken.address && approvalAddr);
  if (fromToken.address && approvalAddr) {
    assertTrustedSpender("lifi", approvalAddr);
    ctx.onProgress?.(`Approving ${fromToken.symbol} (1 of 2)…`);
    await approveErc20Exact(signer, fromToken.address, evmAddress, approvalAddr, fromAmtRaw);
  }
  ctx.onProgress?.(bridgeApproval ? "Bridging (2 of 2)…" : "Bridging…");
  // Best-effort pre-flight ONLY (do not block). Cross-chain bridge calldata is
  // frequently not eth_call-simulatable on the source chain — messaging-layer
  // fees, executor/msg.sender checks and deadlines make a naive static call
  // revert ("missing revert data") even when the real bridge would succeed —
  // so hard-blocking on it stranded legitimate routes. A same-chain swap
  // simulates cleanly and keeps its hard block; a bridge relies on the
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
    to: txReq.to, data: txReq.data, value,
    gasLimit: txReq.gasLimit ? BigInt(txReq.gasLimit) : undefined,
  });
  void tx.wait().then(() => ctx.onMined?.()).catch(() => {});
  return tx.hash;
}

// ── Error parsing ─────────────────────────────────────────────────────────────

export interface ParsedSwapError {
  title: string;
  body: string;
  hint?: string;
  // Required vs available SOL, when the message carries exact figures.
  figures?: { required: string; available: string };
  preSend: boolean; // true when we know nothing left the wallet
}

// Map raw error strings from the swap/bridge paths to a titled, actionable
// card. Unrecognized messages fall through to a generic "<kind> Failed".
export function parseSwapError(msg: string, kind: "Swap" | "Bridge" = "Swap"): ParsedSwapError {
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
      hint: "Fees and rent count against your balance too, so lower the amount slightly.",
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
  // ethers "could not coalesce error" dumps the whole raw tx + RPC payload into
  // the message when a node returns a nonstandard error (dRPC wraps rejections
  // as code 19 "Temporary internal error"). Never show that blob to the user.
  if (/could not coalesce error|temporary internal error/i.test(msg)) {
    return {
      title: "Network Node Error",
      body: "The network node reported a temporary error while broadcasting the transaction. This is usually a node-side hiccup, not a problem with the transaction itself.",
      hint: "Check your balance or activity before retrying. If it keeps failing, the balance may not cover the amount plus the full gas hold.",
      preSend: false,
    };
  }
  return { title: `${kind} Failed`, body: msg, preSend: false };
}
