// Shared EVM native-balance sweep.
//
// One implementation used from two places: the popup's refreshMultiChain (live
// polling while open) and the background refresher (keeps the same caches warm
// while the popup is closed, so opening it lands on data seconds old). Reads
// only the public address — never key material — so it is safe to run without
// the wallet being unlocked.

import { ethers } from "ethers";
import { NETWORKS, type Network } from "./networks";
import { fetchRates, getUsdPrice, type Rates } from "./currency";

// Per-address cache keys, shared by the popup (boot preload + useWallet) and
// the background refresher so they can never disagree.
export const EVM_CACHE_PFX   = "numpay_balcache_";
export const NONEVMCACHE_PFX = "numpay_nonevmcache_";

export interface ChainBalance {
  networkId: string;
  name: string;
  symbol: string;
  logo: string;
  balance: string;
  balanceNum: number;
  usdValue: number;
}

export const AGGREGATE_CHAINS = [
  "ethereum", "polygon", "arbitrum", "optimism", "base",
  "avalanche", "bsc", "zksync", "scroll", "linea",
  "mantle", "blast", "polygonzkevm", "fantom", "sei",
];

// Last-resort price table, used only when the live CoinGecko rates (15-min
// cached via fetchRates) are unavailable. Dashboard overlays live rates for
// display; these values mostly affect chain sorting and the offline fallback.
export const NATIVE_USD_PRICES: Record<string, number> = {
  ETH: 1800, BTC: 65000, SOL: 140, SUI: 1.2, POL: 0.45,
  AVAX: 25, BNB: 300, FTM: 0.35, MNT: 0.55, SEI: 0.35,
  TRX: 0.12, XRP: 0.50, LTC: 80,
};

const EVM_TIMEOUT_MS = 5000;
// Pricing is secondary to showing the user's actual coin balances. CoinGecko
// and the wallet API can each take several seconds to fail on a restricted
// network; never let that hold the entire native-balance sweep hostage.
const QUICK_RATE_WAIT_MS = 1500;

export interface EvmSweepResult {
  results: ChainBalance[];
  portfolioUsd: number;
  /** False when every RPC failed (offline) — callers must not overwrite a good cache then. */
  anySuccess: boolean;
}

/**
 * Fetch native balances for every aggregate + custom chain in parallel, with
 * live USD pricing fetched alongside (never ahead of) the sweep. A chain whose
 * RPC fails keeps its last-known row from `prevByChain` instead of zeroing out.
 */
export async function sweepEvmNativeBalances(
  address: string,
  customNetMap: Record<string, Network>,
  prevByChain: Map<string, ChainBalance>,
): Promise<EvmSweepResult> {
  const allChainIds = [...AGGREGATE_CHAINS, ...Object.keys(customNetMap)];

  // Kick off live prices (15-min cached) IN PARALLEL with the balance sweep.
  // Balances don't need the price to fetch — only to compute their USD value —
  // so we apply prices once both resolve. Falls back to the static table when
  // rates are unavailable so the sweep still completes offline.
  const ratesPromise: Promise<Rates | null> = Promise.race([
    fetchRates().catch(() => null),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), QUICK_RATE_WAIT_MS)),
  ]);

  const promises = allChainIds.map(async (chainId) => {
    const net = NETWORKS[chainId] || customNetMap[chainId];
    if (!net) return null;
    // One-shot provider: pin the already-known chain and tear it down after
    // the read so failed endpoints cannot accumulate background retry timers.
    const provider = new ethers.JsonRpcProvider(net.rpcUrl, net.chainId, { staticNetwork: true });
    try {
      // staticNetwork: skip the eth_chainId auto-detect round-trip.
      const bal = await Promise.race([
        provider.getBalance(address),
        new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), EVM_TIMEOUT_MS)),
      ]) as bigint;
      const formatted = ethers.formatUnits(bal, net.decimals);
      const num = parseFloat(formatted);
      return {
        networkId: chainId, name: net.name, symbol: net.symbol, logo: net.logo,
        balance: formatted, balanceNum: num, usdValue: 0,
      } as ChainBalance;
    } catch {
      // Mark as failed so we can retain the last-known balance below.
      return {
        networkId: chainId, name: net.name, symbol: net.symbol, logo: net.logo,
        balance: "0", balanceNum: 0, usdValue: 0, failed: true,
      } as ChainBalance & { failed: boolean };
    } finally {
      provider.destroy?.();
    }
  });

  const [settled, liveRates] = await Promise.all([Promise.all(promises), ratesPromise]);
  const priceFor = (symbol: string) =>
    (liveRates ? getUsdPrice(symbol, liveRates) : 0) || NATIVE_USD_PRICES[symbol] || 0;
  const anySuccess = settled.some((r) => r && !(r as any).failed);

  const results: ChainBalance[] = [];
  for (const r of settled) {
    if (!r) continue;
    if ((r as any).failed) {
      // RPC failed (offline / flaky): keep the last-known balance if we have one,
      // otherwise fall back to the zero placeholder so the row still resolves.
      const prev = prevByChain.get(r.networkId);
      const { failed, ...zero } = r as ChainBalance & { failed: boolean };
      results.push(prev ?? (zero as ChainBalance));
    } else {
      r.usdValue = r.balanceNum * priceFor(r.symbol);
      results.push(r);
    }
  }
  results.sort((a, b) => b.usdValue - a.usdValue);
  const portfolioUsd = results.reduce((s, c) => s + c.usdValue, 0);

  return { results, portfolioUsd, anySuccess };
}
