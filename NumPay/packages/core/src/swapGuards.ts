import { ethers } from "ethers";

/**
 * Local safety checks for aggregator-built swap/bridge transactions.
 *
 * We sign transactions whose calldata is built remotely by ParaSwap, KyberSwap
 * and LI.FI. If one of those responses were tampered with (compromised API,
 * intercepted TLS, malicious route), the wallet could approve or execute a
 * transaction the user never intended. These guards validate the response
 * locally before anything is signed.
 *
 * Addresses below were verified against ParaSwap's own contracts registry and
 * block explorers (proxies re-verified July 2026):
 *  - The KyberSwap / LI.FI routers are deployed at the SAME address on every
 *    chain, so they can be whitelisted as flat lists.
 *  - ParaSwap's TokenTransferProxy (the approval spender) is NOT chain-constant:
 *    Base uses a different deployment than Ethereum/Polygon/etc. It is gated per
 *    chain via PARASWAP_TOKEN_TRANSFER_PROXY below.
 *  - ParaSwap's Augustus swapper (the swap `to` target) varies per chain, so it
 *    is NOT whitelisted here; it is bound to the quote's own contractAddress and
 *    validated by contract-code + simulation at the call site.
 */

// ParaSwap TokenTransferProxy (the ERC-20 approval spender) per chain. This is
// the highest-risk address — a wrong spender can later drain the token — so we
// gate the approval to exactly the proxy ParaSwap deploys on that chain. Values
// are ParaSwap's own, from GET apiv5.paraswap.io/adapters/contracts?network=<id>
// (re-verified July 2026). Chains where ParaSwap has no v5 Augustus (Gnosis 100,
// Unichain 130 return the zero address) never produce a route, so they never
// reach approval and are intentionally absent. To add a chain, look up its proxy
// from that endpoint and paste it here — do not trust the value the API returns
// at swap time, or this guard is pointless.
const PARASWAP_TOKEN_TRANSFER_PROXY: Record<number, string> = {
  1:     "0x216b4b4ba9f3e719726886d34a177484278bfcae", // Ethereum
  10:    "0x216b4b4ba9f3e719726886d34a177484278bfcae", // Optimism
  56:    "0x216b4b4ba9f3e719726886d34a177484278bfcae", // BNB Chain
  137:   "0x216b4b4ba9f3e719726886d34a177484278bfcae", // Polygon
  8453:  "0x93aaae79a53759cd164340e4c8766e4db5331cd7", // Base
  42161: "0x216b4b4ba9f3e719726886d34a177484278bfcae", // Arbitrum
  43114: "0x216b4b4ba9f3e719726886d34a177484278bfcae", // Avalanche
};

// Approval spenders for aggregators whose spender IS chain-constant.
const TRUSTED_SPENDERS: Record<string, string[]> = {
  kyberswap: ["0x6131b5fae19ea4f9d964eac0408e4408b66337b5"], // MetaAggregationRouterV2
  lifi:      ["0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae"], // LiFi Diamond
};

// Transaction targets that are also chain-constant. ParaSwap is intentionally
// absent (its Augustus router differs per chain).
const TRUSTED_ROUTERS: Record<string, string[]> = {
  kyberswap: ["0x6131b5fae19ea4f9d964eac0408e4408b66337b5"],
  lifi:      ["0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae"],
};

/**
 * Block an ERC-20 approval to any spender that is not a known aggregator contract.
 * ParaSwap's proxy varies per chain, so pass the active chainId for that provider.
 */
export function assertTrustedSpender(provider: string, spender: string, chainId?: number): void {
  let allow: string[];
  if (provider === "paraswap") {
    const proxy = chainId != null ? PARASWAP_TOKEN_TRANSFER_PROXY[chainId] : undefined;
    allow = proxy ? [proxy] : [];
  } else {
    allow = TRUSTED_SPENDERS[provider] ?? [];
  }
  if (!spender || !allow.includes(spender.toLowerCase())) {
    throw new Error(`Blocked for safety: approval target ${spender} is not a recognized ${provider} contract on this chain.`);
  }
}

/** Block sending to a target that is not a known router (no-op for providers whose router varies per chain). */
export function assertTrustedRouter(provider: string, to: string): void {
  const allow = TRUSTED_ROUTERS[provider];
  if (!allow) return;
  if (!to || !allow.includes(to.toLowerCase())) {
    throw new Error(`Blocked for safety: transaction target ${to} is not a recognized ${provider} router.`);
  }
}

/** Confirm the RPC actually serves the chain we intend to transact on. */
export async function assertChainId(signer: ethers.Signer, expected: number): Promise<void> {
  const net = await signer.provider!.getNetwork();
  if (Number(net.chainId) !== expected) {
    throw new Error(`Network mismatch: RPC reports chain ${net.chainId}, expected ${expected}. Cancelled.`);
  }
}

/** The transaction target must be a deployed contract, never an EOA or empty address. */
export async function assertIsContract(provider: ethers.Provider, addr: string): Promise<void> {
  if (!ethers.isAddress(addr)) throw new Error(`Blocked for safety: invalid target address ${addr}.`);
  const code = await provider.getCode(addr);
  if (!code || code === "0x") throw new Error(`Blocked for safety: target ${addr} is not a contract.`);
}

/**
 * Enforce the native value attached to a swap.
 *  - Native-token swaps: value must equal the amount being swapped (never more).
 *  - ERC-20 swaps: value must be zero.
 */
export function assertNativeValue(isNativeSwap: boolean, value: bigint, srcAmount: bigint): void {
  if (isNativeSwap) {
    if (value !== srcAmount) {
      throw new Error(`Blocked for safety: transaction sends ${value} wei but the swap amount is ${srcAmount} wei.`);
    }
  } else if (value !== 0n) {
    throw new Error(`Blocked for safety: ERC-20 swap should not send native value, but ${value} wei is attached.`);
  }
}

/** Pull the raw revert payload (selector + data) out of an ethers CALL_EXCEPTION. */
function revertData(e: any): string {
  const raw =
    (typeof e?.data === "string" && e.data) ||
    (typeof e?.info?.error?.data === "string" && e.info.error.data) ||
    (typeof e?.error?.data === "string" && e.error.data) ||
    "";
  return raw && raw.startsWith("0x") && raw.length >= 10 ? raw : "";
}

/** Dry-run the transaction against current chain state; abort if it would revert. */
export async function simulateOrThrow(
  signer: ethers.Signer,
  tx: { to: string; data: string; value?: bigint },
): Promise<void> {
  try {
    await signer.call({ to: tx.to, data: tx.data, value: tx.value ?? 0n });
  } catch (e: any) {
    const detail = e?.shortMessage || e?.reason || e?.message || "";
    // ethers reports undecodable custom errors as "unknown custom error" and hides
    // the selector. Surface the 4-byte selector (and any revert bytes) so the exact
    // failure can be identified instead of guessed at.
    const raw = revertData(e);
    const selector = raw ? ` [revert ${raw.slice(0, 10)}${raw.length > 10 ? ` data=${raw}` : ""}]` : "";
    throw new Error(`Swap simulation failed — the transaction would revert, so it was not sent. ${detail}${selector}`.trim());
  }
}
