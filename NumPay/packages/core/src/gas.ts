/**
 * Gas tiers (EVM) — platform-free.
 *
 * Extracted verbatim from the extension Send page so the extension popup and
 * the mobile app label their speed selector and build their send overrides the
 * exact same way. "normal" defers to the node's own suggestion; "slow" lowers
 * the tip but keeps the fee cap so the tx still confirms (just with less
 * priority); "fast" raises the tip and lifts the cap to make room for it.
 * Legacy (non-EIP-1559) chains scale gasPrice instead.
 */
import { ethers } from "ethers";

export type GasTier = "slow" | "normal" | "fast";

export interface FeeInfo {
  maxFee?: bigint;
  prio?: bigint;
  gasPrice?: bigint;
}

const scaleWei = (v: bigint, num: number, den: number) => (v * BigInt(num)) / BigInt(den);

// Ethers overrides for a chosen speed. "normal" returns {} so ethers uses the
// node's own suggestion. Slow lowers the tip (keeps the fee cap so it still
// confirms, just with less priority); fast raises the tip and lifts the cap to
// make room for it. Legacy chains scale gasPrice.
export function tierOverrides(tier: GasTier, f: FeeInfo | null): ethers.Overrides {
  if (!f || tier === "normal") return {};
  if (f.maxFee != null && f.prio != null) {
    if (tier === "slow") return { maxFeePerGas: f.maxFee, maxPriorityFeePerGas: scaleWei(f.prio, 60, 100) };
    const prio = scaleWei(f.prio, 175, 100);
    return { maxFeePerGas: f.maxFee + (prio - f.prio), maxPriorityFeePerGas: prio };
  }
  if (f.gasPrice != null) {
    return { gasPrice: tier === "slow" ? scaleWei(f.gasPrice, 85, 100) : scaleWei(f.gasPrice, 130, 100) };
  }
  return {};
}

// The effective per-gas price for a tier, in gwei, for the selector labels.
export function tierGwei(tier: GasTier, f: FeeInfo | null): string {
  if (!f) return "";
  const ov = tierOverrides(tier, f);
  const wei = (ov.maxFeePerGas ?? ov.gasPrice ?? f.maxFee ?? f.gasPrice) as bigint | undefined;
  if (wei == null) return "";
  const g = Number(wei) / 1e9;
  return g < 1 ? g.toFixed(3) : g.toFixed(1);
}

// Fetch the node's fee suggestion for an EVM chain, shaped into FeeInfo. Both
// platforms call this to drive the selector; returns null on any RPC failure
// so callers fall back to sending at the node default (tier => {}).
export async function fetchFeeInfo(rpcUrl: string, chainId: number): Promise<FeeInfo | null> {
  try {
    const provider = new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
    const fd = await provider.getFeeData();
    return {
      maxFee: fd.maxFeePerGas ?? undefined,
      prio: fd.maxPriorityFeePerGas ?? undefined,
      gasPrice: fd.gasPrice ?? undefined,
    };
  } catch {
    return null;
  }
}
