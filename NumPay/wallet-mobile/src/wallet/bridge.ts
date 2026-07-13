/**
 * Mobile bridge primitive — cross-chain transfers through the shared core
 * engine (@numpay/core/swap): LI.FI routes and guard-checked execution. EVM
 * source only in this slice (Solana source needs the SPL keypair path, later).
 * Key material is derived from the vault mnemonic per call and drops out of
 * scope after signing.
 */
import { ethers } from "ethers";
import { importFromMnemonic, getSigner } from "@numpay/core/wallet";
import { NETWORKS } from "@numpay/core/networks";
import { executeBridge, type SwapToken } from "@numpay/core/swap";
import { logTx } from "@numpay/core/txLog";

export { fetchBridgeRoutes } from "@numpay/core/swap";

/**
 * Execute an EVM-source cross-chain bridge. Returns the source-chain tx hash
 * after writing the txLog entry (kind "bridge") the Activity page renders.
 */
export async function bridgeEvm(
  mnemonic: string,
  fromChainId: string,
  fromToken: SwapToken,
  toToken: SwapToken,
  fromAmount: string,
  receiveAmt: string,
  fromTokenUsdPrice: number,
  onProgress?: (label: string) => void,
  onMined?: () => void,
): Promise<string> {
  const net = NETWORKS[fromChainId];
  if (!net) throw new Error(`Unknown network: ${fromChainId}`);
  const w = importFromMnemonic(mnemonic);
  const signer = getSigner(w.privateKey, net.rpcUrl);
  (signer.provider as ethers.JsonRpcProvider).pollingInterval = 1000;

  const hash = await executeBridge({
    fromToken, toToken, fromAmount, evmAddress: w.address,
    evmSigner: signer,
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
