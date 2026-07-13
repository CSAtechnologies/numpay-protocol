/**
 * Mobile swap primitive — same core engine the extension Swap page uses
 * (@numpay/core/swap): quotes come from the three keyless aggregator APIs and
 * execution runs through executeEvmSwap with the full swapGuards sequence.
 * Key material is derived from the vault mnemonic per call and goes out of
 * scope immediately after signing.
 *
 * Slice scope: EVM same-chain swaps. Jupiter/Solana follows.
 */
import { ethers } from "ethers";
import { importFromMnemonic, getSigner } from "@numpay/core/wallet";
import { NETWORKS } from "@numpay/core/networks";
import {
  executeEvmSwap, fetchParaswapQuote, fetchKyberQuote, fetchRelayQuote,
  type RouteOption, type SwapToken,
} from "@numpay/core/swap";
import { logTx } from "@numpay/core/txLog";

/** Fetch same-chain quotes from all three EVM aggregators, best first. */
export async function fetchEvmQuotes(
  chainId: string, from: SwapToken, to: SwapToken, amount: string,
  userAddr: string, slippagePct: number,
): Promise<RouteOption[]> {
  const net = NETWORKS[chainId];
  if (!net) return [];
  const results = await Promise.all([
    fetchParaswapQuote(net.chainId, from, to, amount),
    fetchKyberQuote(net.chainId, from, to, amount),
    fetchRelayQuote(net.chainId, from, to, amount, userAddr, slippagePct),
  ]);
  const routes = results.filter((r): r is RouteOption => !!r);
  routes.sort((a, b) => (BigInt(b.destAmountRaw || "0") > BigInt(a.destAmountRaw || "0") ? 1 : -1));
  if (routes[0]) routes[0].tag = "Best";
  return routes;
}

/**
 * Execute a quoted EVM same-chain swap. Returns the broadcast tx hash after
 * writing the txLog entry (kind "swap") the Activity page renders.
 */
export async function swapEvm(
  mnemonic: string,
  chainId: string,
  route: RouteOption,
  fromToken: SwapToken,
  toToken: SwapToken,
  fromAmount: string,
  receiveAmt: string,
  slippage: string,
  onProgress?: (label: string) => void,
  onMined?: () => void,
): Promise<string> {
  const net = NETWORKS[chainId];
  if (!net) throw new Error(`Unknown network: ${chainId}`);
  const w = importFromMnemonic(mnemonic);
  const signer = getSigner(w.privateKey, net.rpcUrl);
  (signer.provider as ethers.JsonRpcProvider).pollingInterval = 1000;

  const hash = await executeEvmSwap(route, {
    signer, owner: w.address, chainId: net.chainId, symbol: net.symbol,
    fromToken, toToken, fromAmount, slippage,
    onProgress, onMined,
  });

  void logTx({
    owner: w.address,
    hash, chainId, kind: "swap", timestamp: Date.now(),
    symbol: fromToken.symbol, value: fromAmount, assetAddr: fromToken.address?.toLowerCase(), logo: fromToken.logo,
    toSymbol: toToken.symbol, toValue: receiveAmt, toAssetAddr: toToken.address?.toLowerCase(), toLogo: toToken.logo, toChainId: toToken.chainId,
  });
  return hash;
}
