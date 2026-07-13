// Build the swap/bridge token picker list for one EVM chain: the chain's
// native coin, the wallet's discovered (held) tokens, then the curated
// DEFAULT_TOKENS buy-side list, de-duplicated and spam-filtered. Shared by the
// Swap and Bridge screens.
import { NETWORKS } from "@numpay/core/networks";
import { DEFAULT_TOKENS } from "@numpay/core/tokens";
import { classifyToken } from "@numpay/core/tokenSpam";
import type { SwapToken } from "@numpay/core/swap";
import type { AutoToken } from "@numpay/core/autoTokens";
import type { AssetRow } from "./useMobileWallet";

export function buildChainTokenList(
  chainId: string,
  rows: AssetRow[],
  tokensByChain: Record<string, AutoToken[]>,
): SwapToken[] {
  const net = NETWORKS[chainId];
  if (!net) return [];
  const items: SwapToken[] = [];
  const seen = new Set<string>();

  const nativeBal = rows.find((r) => r.isNative && r.chainId === chainId)?.balanceNum ?? 0;
  items.push({
    symbol: net.symbol, name: net.name, logo: net.logo, decimals: net.decimals,
    balance: nativeBal > 0 ? String(nativeBal) : "0", chainId, chainName: net.name,
  });
  seen.add("");

  for (const t of (tokensByChain[chainId] ?? [])) {
    const key = t.address.toLowerCase();
    if (seen.has(key) || classifyToken(t).hidden) continue;
    seen.add(key);
    items.push({
      symbol: t.symbol, name: t.name, logo: t.logo, address: t.address,
      decimals: t.decimals, balance: t.balance, chainId, chainName: net.name,
      priceUsd: t.priceUsd, possibleSpam: t.possibleSpam,
    });
  }

  for (const t of (((DEFAULT_TOKENS as any)[String(net.chainId)] ?? []) as any[])) {
    const key = t.address.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    items.push({
      symbol: t.symbol, name: t.name, logo: t.logo, address: t.address,
      decimals: t.decimals, balance: "0", chainId, chainName: net.name,
    });
  }
  return items;
}
