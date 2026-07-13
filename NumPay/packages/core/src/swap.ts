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
import { SOLANA_SWAP_TOKENS } from "./chains/solana";
import type { NonEvmChain } from "./chains";

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
      logo: "https://assets.coingecko.com/coins/images/14929/small/paraswap.png",
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
      logo: "https://assets.coingecko.com/coins/images/14899/small/RwdVsGcw_400x400.jpg",
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
      logo: "https://assets.relay.link/icon.png",
      destAmount: parseFloat(ethers.formatUnits(out, to.decimals)).toFixed(Math.min(to.decimals, 6)),
      destAmountRaw: String(out), gasCostUSD: String(gasUsd || "0"),
      relaySteps: data.steps,
      srcUsd:  parseFloat(data?.details?.currencyIn?.amountUsd)  || undefined,
      destUsd: parseFloat(data?.details?.currencyOut?.amountUsd) || undefined,
    };
  } catch { return null; }
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
