import {
  defineChain,
  createPublicClient,
  createWalletClient,
  http,
  type PrivateKeyAccount,
} from "viem";

/**
 * Chain config is driven by env so the wallet can point at local hardhat,
 * Sepolia, or any EVM RPC without code changes:
 *
 *   NEXT_PUBLIC_CHAIN_ID    e.g. 11155111 (Sepolia) or 31337 (hardhat)
 *   NEXT_PUBLIC_RPC_URL     JSON-RPC endpoint
 *   NEXT_PUBLIC_CHAIN_NAME  display name (optional)
 *   NEXT_PUBLIC_EXPLORER    block explorer base URL (optional)
 *
 * Defaults to local hardhat when unset.
 */
const CHAIN_ID = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? 31337);
const RPC_URL = process.env.NEXT_PUBLIC_RPC_URL ?? "http://127.0.0.1:8545";
const CHAIN_NAME =
  process.env.NEXT_PUBLIC_CHAIN_NAME ??
  (CHAIN_ID === 11155111
    ? "Sepolia"
    : CHAIN_ID === 1
      ? "Ethereum"
      : CHAIN_ID === 31337
        ? "Hardhat"
        : `Chain ${CHAIN_ID}`);
const EXPLORER = process.env.NEXT_PUBLIC_EXPLORER ?? "";

export const CHAIN = defineChain({
  id: CHAIN_ID,
  name: CHAIN_NAME,
  nativeCurrency: { name: "Ether", symbol: "ETH", decimals: 18 },
  rpcUrls: { default: { http: [RPC_URL] } },
  ...(EXPLORER
    ? { blockExplorers: { default: { name: "Explorer", url: EXPLORER } } }
    : {}),
});

export const CHAIN_LABEL = CHAIN_NAME;
export const EXPLORER_URL = EXPLORER;

export const publicClient = createPublicClient({
  chain: CHAIN,
  transport: http(RPC_URL),
});

export function makeWalletClient(account: PrivateKeyAccount) {
  return createWalletClient({
    account,
    chain: CHAIN,
    transport: http(RPC_URL),
  });
}
