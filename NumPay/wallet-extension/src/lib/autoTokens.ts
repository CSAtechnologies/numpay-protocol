/**
 * Auto-detect all ERC-20 tokens across every chain.
 * Layer 1: Alchemy (ETH/POL/ARB/OPT/BASE) — rich metadata.
 * Layer 2: Ankr multichain batch — free, no key, covers BSC etc.
 * Layer 3: Multicall3 balanceOf — guaranteed fallback for known tokens.
 */
import { ethers } from "ethers";
import { getItem, setItem } from "./storage";
import { NETWORKS } from "./networks";
import { DEFAULT_TOKENS, getTokenBalance } from "./tokens";

const ALCHEMY_KEY = "REDACTED_ROTATE_ME";

export const ALCHEMY_CHAINS: Record<string, string> = {
  ethereum: "eth-mainnet",
  polygon:  "polygon-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
  base:     "base-mainnet",
};

// Ankr blockchain slugs for non-Alchemy chains
const ANKR_CHAINS: Record<string, string> = {
  bsc:          "bsc",
  avalanche:    "avalanche",
  fantom:       "fantom",
  gnosis:       "gnosis",
  moonbeam:     "moonbeam",
  celo:         "celo",
  scroll:       "scroll",
  linea:        "linea",
  mantle:       "mantle",
  blast:        "blast",
  zksync:       "zksync_era",
  polygonzkevm: "polygon_zkevm",
  cronos:       "cronos",
};

// Kept for legacy reference — scan APIs now only used as fallback
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

// Multicall3 — deployed at the same address on all major EVM chains
const MC3_ADDR = "0xcA11bde05977b3631167028862bE2a173976CA11";
// zkSync Era uses a different deployment address
const MC3_ZKSYNC = "0xF9cda624FBC7e059355ce98a31693d299FACd963";

const MC3_IFACE = new ethers.Interface([
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) returns (tuple(bool success, bytes returnData)[] results)",
]);
const ERC20_IFACE = new ethers.Interface([
  "function balanceOf(address owner) view returns (uint256)",
]);

// Alchemy chain IDs — Layer 1 handles these, but Layer 3 still runs as fallback
// so DEFAULT_TOKENS are found even when Alchemy returns 403 / rate-limits
const ALCHEMY_CHAIN_IDS = new Set(["ethereum", "polygon", "arbitrum", "optimism", "base"]);

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
    if (!balResp.ok) {
      console.log(`[NumPay] Alchemy ${chainId}: HTTP ${balResp.status} — Layer 3 fallback will cover DEFAULT_TOKENS`);
      return [];
    }
    const balData = await balResp.json();
    if (balData.error) {
      console.log(`[NumPay] Alchemy ${chainId}: API error`, balData.error.message ?? balData.error);
      return [];
    }
    const balances: Array<{ contractAddress: string; tokenBalance: string }> =
      balData.result?.tokenBalances ?? [];

    const nonZero = balances.filter((b) => {
      if (!b.tokenBalance || b.tokenBalance === "0x") return false;
      try { return BigInt(b.tokenBalance) > 0n; } catch { return false; }
    });
    console.log(`[NumPay] Alchemy ${chainId}: ${balances.length} tokens, ${nonZero.length} non-zero`);
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

    const found = results.filter((t): t is AutoToken => t !== null);
    console.log(`[NumPay] Alchemy ${chainId}: resolved ${found.length} tokens with metadata`);
    return found;
  } catch (e) {
    console.error(`[NumPay] Alchemy ${chainId}: exception`, e);
    return [];
  }
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

/** Fetch all ERC-20 tokens for one Alchemy chain. */
export async function fetchERC20sForChain(chainId: string, walletAddress: string): Promise<AutoToken[]> {
  if (ALCHEMY_CHAINS[chainId]) return fetchAlchemyERC20s(chainId, walletAddress);
  if (SCAN_CHAINS[chainId])   return fetchScanERC20s(chainId, walletAddress);
  return [];
}

/**
 * Fetch ERC-20 tokens across multiple chains in ONE Ankr multichain call.
 * Returns a map of chainId → tokens.
 */
async function fetchAnkrBatch(
  address: string,
  chainIds: string[],
): Promise<Record<string, AutoToken[]>> {
  const blockchains = chainIds.map((id) => ANKR_CHAINS[id]).filter(Boolean);
  if (blockchains.length === 0) return {};

  console.log("[NumPay] Ankr batch: querying", blockchains.length, "chains");

  try {
    const resp = await fetch("https://rpc.ankr.com/multichain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "ankr_getAccountBalance",
        params: { walletAddress: address, blockchain: blockchains, onlyWhitelisted: false },
      }),
    });
    if (!resp.ok) {
      console.warn("[NumPay] Ankr batch: HTTP", resp.status);
      return {};
    }
    const data = await resp.json();

    if (data.error) {
      console.warn("[NumPay] Ankr batch: API error", data.error);
      return {};
    }

    const assets: any[] = data?.result?.assets ?? [];
    console.log("[NumPay] Ankr batch: received", assets.length, "assets");

    // Reverse-map Ankr blockchain slug → our chainId
    const ankrToChain: Record<string, string> = {};
    for (const [chainId, slug] of Object.entries(ANKR_CHAINS)) ankrToChain[slug] = chainId;

    const result: Record<string, AutoToken[]> = {};
    for (const asset of assets) {
      if (asset.tokenType === "NATIVE" || !asset.contractAddress) continue;
      const chainId = ankrToChain[asset.blockchain];
      if (!chainId) continue;
      const balance = parseFloat(asset.balance || "0");
      if (balance <= 0) continue;
      if (!result[chainId]) result[chainId] = [];
      result[chainId].push({
        symbol:   String(asset.tokenSymbol  || "").trim(),
        name:     String(asset.tokenName    || asset.tokenSymbol || "").trim(),
        address:  String(asset.contractAddress).toLowerCase(),
        decimals: Number(asset.tokenDecimals ?? 18),
        balance:  String(asset.balance || "0"),
        logo:     asset.thumbnail || undefined,
      });
    }

    const chainCount = Object.keys(result).length;
    const tokenTotal = Object.values(result).reduce((s, t) => s + t.length, 0);
    console.log(`[NumPay] Ankr batch: ${chainCount} chains with tokens, ${tokenTotal} total`);
    return result;
  } catch (e) {
    console.error("[NumPay] Ankr batch: exception", e);
    return {};
  }
}

/**
 * Build a networkId → RPC map for all chains that have DEFAULT_TOKENS.
 * Includes Alchemy chains so Layer 3 acts as guaranteed fallback when Alchemy 403s.
 */
function buildChainRpcMap(): Record<string, { rpc: string; tokens: typeof DEFAULT_TOKENS[number]; mc3: string }> {
  const map: Record<string, { rpc: string; tokens: typeof DEFAULT_TOKENS[number]; mc3: string }> = {};
  for (const [networkId, net] of Object.entries(NETWORKS)) {
    const tokens = DEFAULT_TOKENS[net.chainId];
    if (tokens && tokens.length > 0) {
      map[networkId] = {
        rpc: net.rpcUrl,
        tokens,
        mc3: networkId === "zksync" ? MC3_ZKSYNC : MC3_ADDR,
      };
    }
  }
  return map;
}

/**
 * Check DEFAULT_TOKENS balances via Multicall3 for every non-Alchemy chain.
 * Falls back to individual balanceOf calls if Multicall3 is unavailable.
 */
async function sweepTokensByRPC(
  address: string,
  onUpdate: (chainId: string, tokens: AutoToken[]) => void,
): Promise<void> {
  const chainMap = buildChainRpcMap();
  console.log("[NumPay] RPC sweep: checking chains:", Object.keys(chainMap).join(", "));

  await Promise.all(
    Object.entries(chainMap).map(async ([networkId, { rpc, tokens, mc3 }]) => {
      console.log(`[NumPay] RPC sweep ${networkId}: ${tokens.length} known tokens to check`);
      try {
        const provider = new ethers.JsonRpcProvider(rpc);
        const found: AutoToken[] = [];

        // Try Multicall3 aggregate3 — 1 eth_call per chain
        let multicallOk = false;
        try {
          const calls = tokens.map((t) => ({
            target: t.address,
            allowFailure: true,
            callData: ERC20_IFACE.encodeFunctionData("balanceOf", [address]),
          }));
          const encoded = MC3_IFACE.encodeFunctionData("aggregate3", [calls]);

          const raw = await Promise.race([
            provider.call({ to: mc3, data: encoded }),
            new Promise<never>((_, r) => setTimeout(() => r(new Error("mc3 timeout")), 8000)),
          ]);

          const decoded = MC3_IFACE.decodeFunctionResult("aggregate3", raw)[0] as Array<{
            success: boolean; returnData: string;
          }>;

          for (let i = 0; i < tokens.length; i++) {
            const r = decoded[i];
            if (!r.success || !r.returnData || r.returnData === "0x") continue;
            let raw256: bigint;
            try {
              // returnData is 32 bytes (64 hex chars) for uint256
              raw256 = BigInt(r.returnData);
            } catch { continue; }
            if (raw256 <= 0n) continue;
            const token = tokens[i];
            const balance = ethers.formatUnits(raw256, token.decimals);
            if (parseFloat(balance) <= 0) continue;
            found.push({
              symbol:   token.symbol,
              name:     token.name,
              address:  token.address.toLowerCase(),
              decimals: token.decimals,
              balance,
              logo:     token.logo,
            });
          }

          multicallOk = true;
          console.log(`[NumPay] RPC sweep ${networkId}: multicall3 OK → ${found.length} tokens`);
        } catch (mcErr) {
          console.warn(`[NumPay] RPC sweep ${networkId}: multicall3 failed (${(mcErr as Error).message}), trying individual calls`);
        }

        // Fallback: individual balanceOf calls if multicall3 unavailable
        if (!multicallOk) {
          const results = await Promise.all(
            tokens.map(async (token) => {
              try {
                const balance = await Promise.race([
                  getTokenBalance(token.address, address, provider),
                  new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), 5000)),
                ]);
                if (parseFloat(balance) <= 0) return null;
                return {
                  symbol:   token.symbol,
                  name:     token.name,
                  address:  token.address.toLowerCase(),
                  decimals: token.decimals,
                  balance,
                  logo:     token.logo,
                } as AutoToken;
              } catch { return null; }
            }),
          );
          for (const t of results) if (t) found.push(t);
          console.log(`[NumPay] RPC sweep ${networkId}: individual calls → ${found.length} tokens`);
        }

        if (found.length > 0) onUpdate(networkId, found);
      } catch (e) {
        console.error(`[NumPay] RPC sweep ${networkId}: fatal error`, e);
      }
    }),
  );
}

const CACHE_PFX = "numpay_autotok3_";
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

/**
 * Sweep every supported EVM chain for ERC-20 tokens.
 * Alchemy (5 chains) + Ankr batch + Multicall3 fallback, all in parallel.
 * Serves stale cache immediately, then re-fetches in the background.
 */
export async function sweepAllChainTokens(
  address: string,
  onUpdate: (chainId: string, tokens: AutoToken[]) => void,
): Promise<void> {
  const cacheKey = CACHE_PFX + address.toLowerCase();
  console.log("[NumPay] sweepAllChainTokens for", address);

  // Serve cache immediately (stale-while-revalidate)
  let cacheIsFresh = false;
  try {
    const raw = await getItem(cacheKey);
    if (raw) {
      const { ts, data } = JSON.parse(raw) as { ts: number; data: Record<string, AutoToken[]> };
      for (const [chainId, tokens] of Object.entries(data)) onUpdate(chainId, tokens);
      if (Date.now() - ts < CACHE_TTL) {
        console.log("[NumPay] cache fresh, skipping re-fetch");
        cacheIsFresh = true;
      } else {
        console.log("[NumPay] stale cache served, re-fetching");
      }
    } else {
      console.log("[NumPay] no cache, fetching fresh");
    }
  } catch {}

  if (cacheIsFresh) return;

  const freshData: Record<string, AutoToken[]> = {};

  const merge = (chainId: string, incoming: AutoToken[]) => {
    if (incoming.length === 0) return;
    const existing = freshData[chainId] ?? [];
    const existingAddrs = new Set(existing.map((t) => t.address.toLowerCase()));
    const toAdd = incoming.filter((t) => !existingAddrs.has(t.address.toLowerCase()));
    freshData[chainId] = [...existing, ...toAdd];
    onUpdate(chainId, freshData[chainId]);
  };

  const alchemyChains = Object.keys(ALCHEMY_CHAINS);
  const ankrChainIds  = Object.keys(ANKR_CHAINS);

  await Promise.all([
    // Layer 1: Alchemy (ETH, Polygon, Arbitrum, Optimism, Base)
    Promise.all(
      alchemyChains.map(async (chainId) => {
        const tokens = await fetchAlchemyERC20s(chainId, address);
        merge(chainId, tokens);
      }),
    ),
    // Layer 2: Ankr batch (BSC, Avalanche, Fantom, etc.)
    fetchAnkrBatch(address, ankrChainIds).then((ankrResults) => {
      for (const [chainId, tokens] of Object.entries(ankrResults)) merge(chainId, tokens);
    }),
    // Layer 3: Multicall3 balanceOf for all non-Alchemy chains with known tokens
    sweepTokensByRPC(address, (chainId, tokens) => merge(chainId, tokens)),
  ]);

  const summary = Object.entries(freshData)
    .filter(([, t]) => t.length > 0)
    .map(([k, v]) => `${k}:${v.length}`)
    .join(", ");
  console.log("[NumPay] sweep complete:", summary || "no tokens found");

  try {
    await setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: freshData }));
  } catch {}
}
