/**
 * Mobile bridge primitive — cross-chain transfers through the shared core
 * engine (@numpay/core/swap): LI.FI routes and guard-checked execution.
 * Source can be any EVM chain in LIFI_CHAIN_ID or Solana; the destination is
 * whatever LI.FI routes to, so the screen never has to keep its own chain
 * list. Key material is derived from the vault mnemonic per call and drops
 * out of scope after signing.
 */
import { ethers } from "ethers";
import { importFromMnemonic, getSigner } from "@numpay/core/wallet";
import { NETWORKS } from "@numpay/core/networks";
import { deriveNonEvmAddresses } from "@numpay/core/chains";
import { executeBridge, LIFI_CHAIN_ID, type SwapToken } from "@numpay/core/swap";
import { logTx } from "@numpay/core/txLog";

export { fetchBridgeRoutes } from "@numpay/core/swap";

/** Chains LI.FI can route to or from AND the wallet knows how to hold. */
export function bridgeableChains(): string[] {
  return Object.keys(LIFI_CHAIN_ID).filter(
    (id) => id !== "sepolia" && (id === "solana" || !!NETWORKS[id]),
  );
}

export const canBridge = (chainId: string) =>
  chainId !== "sepolia" && !!LIFI_CHAIN_ID[chainId] && (chainId === "solana" || !!NETWORKS[chainId]);

/**
 * Execute a cross-chain bridge from an EVM chain or from Solana. Returns the
 * source-chain tx hash after writing the txLog entry (kind "bridge") the
 * Activity page renders.
 */
export async function bridgeTokens(
  mnemonic: string,
  fromToken: SwapToken,
  toToken: SwapToken,
  fromAmount: string,
  receiveAmt: string,
  fromTokenUsdPrice: number,
  onProgress?: (label: string) => void,
  onMined?: () => void,
): Promise<string> {
  const fromChainId = fromToken.chainId;
  const isSolanaSource = fromChainId === "solana";
  const net = NETWORKS[fromChainId];
  if (!net && !isSolanaSource) throw new Error(`Unknown network: ${fromChainId}`);

  const w = importFromMnemonic(mnemonic);

  // EVM source signs with the source chain's signer; Solana source needs the
  // derived keypair instead (core picks the path off fromToken.chainId).
  let evmSigner: ethers.Signer | undefined;
  if (!isSolanaSource) {
    evmSigner = getSigner(w.privateKey, net!.rpcUrl);
    (evmSigner.provider as ethers.JsonRpcProvider).pollingInterval = 1000;
  }
  const derived = isSolanaSource ? await deriveNonEvmAddresses(mnemonic) : null;

  const hash = await executeBridge({
    fromToken, toToken, fromAmount, evmAddress: w.address,
    evmSigner,
    solanaSecretKey: derived?.solana.secretKey,
    solanaAddress: derived?.solana.address,
    fromTokenUsdPrice,
    onProgress, onMined,
  });

  void logTx({
    owner: w.address,
    hash, chainId: fromChainId, kind: "bridge", timestamp: Date.now(),
    symbol: fromToken.symbol, value: fromAmount, assetAddr: fromToken.address?.toLowerCase(), logo: fromToken.logo,
    toSymbol: toToken.symbol, toValue: receiveAmt, toAssetAddr: toToken.address?.toLowerCase(), toLogo: toToken.logo, toChainId: toToken.chainId,
  });
  return hash;
}
