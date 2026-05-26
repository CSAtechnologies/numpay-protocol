export interface WalletMapping {
  chain: string;
  wallet: string;
}

export interface AccountInfo {
  number: bigint;
  owner: string;
  mappings: WalletMapping[];
}

export interface RegistrationResult {
  txHash: string;
  number: bigint;
  owner: string;
}

export interface BANPClientConfig {
  contractAddress: string;
  rpcUrl?: string;
  provider?: import("ethers").Provider;
  signer?: import("ethers").Signer;
}

export const SUPPORTED_CHAINS = [
  "ethereum",
  "solana",
  "bitcoin",
  "sui",
  "aptos",
  "polygon",
  "arbitrum",
  "optimism",
  "avalanche",
  "base",
] as const;

export type SupportedChain = (typeof SUPPORTED_CHAINS)[number];

export const MIN_BANP_NUMBER = 10_000_000_000n;
export const MAX_BANP_NUMBER = 99_999_999_999n;
