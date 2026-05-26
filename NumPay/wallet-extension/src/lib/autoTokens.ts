/**
 * Auto-detect all ERC-20 tokens across every chain.
 * Uses Alchemy's token balance API for Alchemy-supported chains,
 * and block explorer "tokenlist" endpoints for the rest.
 */
import { ethers } from "ethers";
import { getItem, setItem } from "./storage";

const ALCHEMY_KEY = "REDACTED_ROTATE_ME";

export const ALCHEMY_CHAINS: Record<string, string> = {
  ethereum: "eth-mainnet",
  polygon:  "polygon-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
  base:     "base-mainnet",
};

export const SCAN_CHAINS: Record<string, string> = {
  bsc:         "https://api.bscscan.com/api",
  avalanche:   "https://api.snowscan.xyz/api",
  fantom:      "https://api.ftmscan.com/api",
  cronos:      "https://api.cronoscan.com/api",
  gnosis:      "https://api.gnosisscan.io/api",
  moonbeam:    "https://api-moonbeam.moonscan.io/api",
  celo:        "https://api.celoscan.io/api",
  scroll:      "https://api.scrollscan.com/api",
  linea:       "https://api.lineascan.build/api",
  mantle:      "https://api.mantlescan.xyz/api",
  blast:       "https://api.blastscan.io/api",
};

export interface AutoToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  balance: string;
  logo?: string;
}

async function fetchAlchemyERC20s(chainId: string, address: string): Promise<AutoToken[]> {
  const sub = ALCHEMY_CHAINS[chainId];
  if (!sub) return [];
  const url = `https://${sub}.g.alchemy.com/v2/${ALCHEMY_KEY}`;

  try {
    const balResp = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "alchemy_getTokenBalances",
        params: [address, "erc20"],
      }),
    });
    if (!balResp.ok) return [];
    const balData = await balResp.json();
    const balances: Array<{ contractAddress: string; tokenBalance: string }> =
      balData.result?.tokenBalances ?? [];

    const nonZero = balances.filter((b) => {
      if (!b.tokenBalance || b.tokenBalance === "0x") return false;
      try { return BigInt(b.tokenBalance) > 0n; } catch { return false; }
    });
    if (nonZero.length === 0) return [];

    // Parallel metadata fetch for all non-zero tokens (cap 80)
    const results = await Promise.all(nonZero.slice(0, 80).map(async (b) => {
      try {
        const metaResp = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1,
            method: "alchemy_getTokenMetadata",
            params: [b.contractAddress],
          }),
        });
        const metaData = await metaResp.json();
        const meta = metaData.result;
        if (!meta?.symbol) return null;
        const decimals = Number(meta.decimals ?? 18);
        const balance = ethers.formatUnits(BigInt(b.tokenBalance), decimals);
        if (parseFloat(balance) <= 0) return null;
        return {
          symbol: String(meta.symbol).trim(),
          name: String(meta.name || meta.symbol).trim(),
          address: b.contractAddress.toLowerCase(),
          decimals,
          balance,
          logo: meta.logo || undefined,
        } as AutoToken;
      } catch { return null; }
    }));

    return results.filter((t): t is AutoToken => t !== null);
  } catch { return []; }
}

async function fetchScanERC20s(chainId: string, address: string): Promise<AutoToken[]> {
  const base = SCAN_CHAINS[chainId];
  if (!base) return [];
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 8000);
    const resp = await fetch(
      `${base}?module=account&action=tokenlist&address=${address}`,
      { signal: controller.signal }
    ).finally(() => clearTimeout(timer));

    const data = await resp.json();
    if (data.status !== "1" || !Array.isArray(data.result)) return [];

    const tokens: AutoToken[] = [];
    for (const t of data.result) {
      if (t.type && t.type !== "ERC-20") continue;
      try {
        const decimals = parseInt(t.decimals ?? "18", 10);
        const raw = BigInt(t.balance ?? "0");
        if (raw <= 0n) continue;
        const balance = ethers.formatUnits(raw, decimals);
        if (parseFloat(balance) <= 0) continue;
        tokens.push({
          symbol: String(t.symbol || "").trim(),
          name: String(t.name || t.symbol || "").trim(),
          address: String(t.contractAddress).toLowerCase(),
          decimals,
          balance,
        });
      } catch {}
    }
    return tokens;
  } catch { return []; }
}

/** Fetch all ERC-20 tokens for one chain, choosing the best available method. */
export async function fetchERC20sForChain(chainId: string, walletAddress: string): Promise<AutoToken[]> {
  if (ALCHEMY_CHAINS[chainId]) return fetchAlchemyERC20s(chainId, walletAddress);
  if (SCAN_CHAINS[chainId])   return fetchScanERC20s(chainId, walletAddress);
  return [];
}

const CACHE_PFX = "numpay_autotok_";
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

/**
 * Sweep every supported EVM chain for ERC-20 tokens.
 * Calls onUpdate(chainId, tokens) for each chain as results arrive.
 * Serves stale cache immediately, then re-fetches in the background.
 */
export async function sweepAllChainTokens(
  address: string,
  onUpdate: (chainId: string, tokens: AutoToken[]) => void,
): Promise<void> {
  const cacheKey = CACHE_PFX + address.toLowerCase();

  // Serve cache immediately (stale-while-revalidate)
  let cacheIsFresh = false;
  try {
    const raw = await getItem(cacheKey);
    if (raw) {
      const { ts, data } = JSON.parse(raw) as { ts: number; data: Record<string, AutoToken[]> };
      for (const [chainId, tokens] of Object.entries(data)) onUpdate(chainId, tokens);
      if (Date.now() - ts < CACHE_TTL) cacheIsFresh = true;
    }
  } catch {}

  if (cacheIsFresh) return;

  // Background refresh
  const allChains = [...Object.keys(ALCHEMY_CHAINS), ...Object.keys(SCAN_CHAINS)];
  const freshData: Record<string, AutoToken[]> = {};

  await Promise.all(allChains.map(async (chainId) => {
    try {
      const tokens = await fetchERC20sForChain(chainId, address);
      freshData[chainId] = tokens;
      if (tokens.length > 0) onUpdate(chainId, tokens);
    } catch {}
  }));

  try {
    await setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: freshData }));
  } catch {}
}
