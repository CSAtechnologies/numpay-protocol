import { ethers } from "ethers";

/**
 * Per-chain address format validation, shared by the Send page (validating
 * BPAN-resolved targets) and the BPAN mapping page (validating addresses
 * before they are written to the registry).
 */
export function isValidNonEvmAddress(addr: string, chainId: string): boolean {
  if (!addr) return false;
  if (chainId === "solana")   return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
  if (chainId === "bitcoin")  return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr);
  if (chainId === "sui")      return /^0x[0-9a-fA-F]{64}$/.test(addr);
  if (chainId === "tron")     return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr);
  if (chainId === "xrp")      return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(addr);
  if (chainId === "litecoin") return /^(ltc1|[LM])[a-zA-HJ-NP-Z0-9]{26,90}$/.test(addr);
  return false;
}

/** Validate an address for any BPAN chain (EVM or non-EVM). */
export function isValidChainAddress(addr: string, chainId: string, isEVM: boolean): boolean {
  return isEVM ? ethers.isAddress(addr) : isValidNonEvmAddress(addr, chainId);
}
