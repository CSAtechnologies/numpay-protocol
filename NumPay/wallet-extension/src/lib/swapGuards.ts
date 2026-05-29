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
 * Addresses below were verified against block explorers (May 2026):
 *  - ParaSwap v5 TokenTransferProxy and the KyberSwap / LI.FI routers are
 *    deployed at the SAME address on every chain, so they can be whitelisted.
 *  - ParaSwap's Augustus swapper (the swap `to` target) varies per chain, so it
 *    is NOT whitelisted here; it is validated by contract-code + simulation.
 */

// Approval spenders — the address that receives an ERC-20 allowance. This is
// the highest-risk action (a wrong spender can later drain the token), and all
// three are chain-constant, so we gate approvals to exactly these.
const TRUSTED_SPENDERS: Record<string, string[]> = {
  paraswap:  ["0x216b4b4ba9f3e719726886d34a177484278bfcae"], // v5 TokenTransferProxy
  kyberswap: ["0x6131b5fae19ea4f9d964eac0408e4408b66337b5"], // MetaAggregationRouterV2
  lifi:      ["0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae"], // LiFi Diamond
};

// Transaction targets that are also chain-constant. ParaSwap is intentionally
// absent (its Augustus router differs per chain).
const TRUSTED_ROUTERS: Record<string, string[]> = {
  kyberswap: ["0x6131b5fae19ea4f9d964eac0408e4408b66337b5"],
  lifi:      ["0x1231deb6f5749ef6ce6943a275a1d3e7486f4eae"],
};

/** Block an ERC-20 approval to any spender that is not a known aggregator contract. */
export function assertTrustedSpender(provider: string, spender: string): void {
  const allow = TRUSTED_SPENDERS[provider] ?? [];
  if (!spender || !allow.includes(spender.toLowerCase())) {
    throw new Error(`Blocked for safety: approval target ${spender} is not a recognized ${provider} contract.`);
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

/** Dry-run the transaction against current chain state; abort if it would revert. */
export async function simulateOrThrow(
  signer: ethers.Signer,
  tx: { to: string; data: string; value?: bigint },
): Promise<void> {
  try {
    await signer.call({ to: tx.to, data: tx.data, value: tx.value ?? 0n });
  } catch (e: any) {
    const detail = e?.shortMessage || e?.reason || e?.message || "";
    throw new Error(`Swap simulation failed — the transaction would revert, so it was not sent. ${detail}`.trim());
  }
}
