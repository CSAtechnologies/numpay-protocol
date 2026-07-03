/**
 * Auto-detect ERC-20 tokens across every supported EVM chain.
 *
 * Layer 1: Alchemy `alchemy_getTokenBalances` — full auto-detect of ANY held
 *          token. Only the networks enabled in our Alchemy app actually work
 *          (ETH + Polygon today); the rest 403 and are covered by Layer 2.
 * Layer 2: Multicall3 `aggregate3` over DEFAULT_TOKENS — one eth_call per chain,
 *          guaranteed fallback for known tokens on every chain. Falls back to
 *          individual balanceOf calls if Multicall3 is unavailable on a chain.
 */
import { ethers } from "ethers";
import { getItem, setItem } from "./storage";
import { NETWORKS } from "./networks";
import { DEFAULT_TOKENS, getTokenBalance } from "./tokens";
import { ALCHEMY_KEY, MORALIS_KEY, GOLDRUSH_KEY } from "./env";

// Alchemy network sub-domains. Only networks enabled in our Alchemy app return
// data; others return 403 and rely on the Layer 2 Multicall3 sweep instead.
export const ALCHEMY_CHAINS: Record<string, string> = {
  ethereum: "eth-mainnet",
  polygon:  "polygon-mainnet",
  arbitrum: "arb-mainnet",
  optimism: "opt-mainnet",
  base:     "base-mainnet",
};

// Moralis covers held-token auto-detection + USD price on chains Alchemy can't
// (BSC etc.) and enriches the rest with prices. networkId → hex chainId.
// MORALIS_KEY comes from .env via lib/env — never committed.
const MORALIS_CHAINS: Record<string, string> = {
  ethereum:     "0x1",
  polygon:      "0x89",
  bsc:          "0x38",
  avalanche:    "0xa86a",
  fantom:       "0xfa",
  cronos:       "0x19",
  arbitrum:     "0xa4b1",
  optimism:     "0xa",
  base:         "0x2105",
  gnosis:       "0x64",
  linea:        "0xe708",
  moonbeam:     "0x504",
  zksync:       "0x144",
  mantle:       "0x1388",
  blast:        "0x13e31",
  scroll:       "0x82750",
  polygonzkevm: "0x44d",
};

// GoldRush (Covalent) fallback indexer. Uses decimal chain ids. Mirrors the
// Moralis set so the two back each other up when one hits its free-tier quota.
// networkId → decimal chainId string. GOLDRUSH_KEY from .env (optional).
const GOLDRUSH_CHAINS: Record<string, string> = {
  ethereum: "1",     polygon: "137",   bsc: "56",        avalanche: "43114",
  fantom: "250",     cronos: "25",     arbitrum: "42161", optimism: "10",
  base: "8453",      gnosis: "100",    linea: "59144",   moonbeam: "1284",
  zksync: "324",     mantle: "5000",   blast: "81457",   scroll: "534352",
  polygonzkevm: "1101",
};

export interface AutoToken {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  balance: string;
  logo?: string;
  priceUsd?: number;
  possibleSpam?: boolean;
  securityScore?: number;
  verifiedContract?: boolean;
  liquidityUsd?: number;
  marketCapUsd?: number;
}

// Indexers (Moralis/GoldRush) occasionally return a chain's native coin as a
// pseudo-token. Such a row would duplicate the real native-balance row already
// shown for the chain (and double-count in the portfolio total), so strip it.
// Catches the EIP-7528 / zero native placeholder address, and any token whose
// symbol matches the chain's own native symbol (e.g. BNB on BNB Chain, ETH on
// Ethereum). Wrapped natives keep their own symbol (WBNB, WETH) and are kept.
const NATIVE_PLACEHOLDER_ADDRS = new Set([
  "0x0000000000000000000000000000000000000000",
  "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
]);

function stripNativeToken(chainId: string, tokens: AutoToken[]): AutoToken[] {
  const nativeSym = NETWORKS[chainId]?.symbol?.toUpperCase();
  return tokens.filter((t) => {
    const addr = (t.address || "").toLowerCase();
    if (NATIVE_PLACEHOLDER_ADDRS.has(addr)) return false;
    if (nativeSym && t.symbol.toUpperCase() === nativeSym) return false;
    return true;
  });
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
// On-chain metadata reads — fallback when Alchemy has no indexed metadata
// (common for fresh memecoins). string symbol/name; uint8 decimals.
const ERC20_META_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
];

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
    // 403 here is expected for networks not enabled in our Alchemy app —
    // Layer 2 covers DEFAULT_TOKENS for those chains, so fail quietly.
    if (!balResp.ok) return [];
    const balData = await balResp.json();
    if (balData.error) return [];
    const balances: Array<{ contractAddress: string; tokenBalance: string }> =
      balData.result?.tokenBalances ?? [];

    const nonZero = balances.filter((b) => {
      if (!b.tokenBalance || b.tokenBalance === "0x") return false;
      try { return BigInt(b.tokenBalance) > 0n; } catch { return false; }
    });
    if (nonZero.length === 0) return [];

    // Provider for on-chain metadata fallback (Alchemy URL also serves eth_call)
    const provider = new ethers.JsonRpcProvider(url);

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
        const meta = metaData.result ?? {};

        let symbol   = meta.symbol ? String(meta.symbol).trim() : "";
        let name     = meta.name   ? String(meta.name).trim()   : "";
        let decimals = meta.decimals != null ? Number(meta.decimals) : null;
        const logo   = meta.logo || undefined;

        // Alchemy returns empty metadata for un-indexed tokens (most fresh
        // memecoins). Read symbol/name/decimals on-chain instead of dropping.
        if (!symbol || decimals == null) {
          try {
            const c = new ethers.Contract(b.contractAddress, ERC20_META_ABI, provider);
            const [onSym, onDec, onName] = await Promise.all([
              c.symbol().catch(() => ""),
              c.decimals().catch(() => null),
              c.name().catch(() => ""),
            ]);
            if (!symbol)        symbol   = String(onSym || "").trim();
            if (!name)          name     = String(onName || "").trim();
            if (decimals == null && onDec != null) decimals = Number(onDec);
          } catch {}
        }

        if (decimals == null) decimals = 18;
        // Last resort so the token is never invisible: show truncated address
        if (!symbol) symbol = b.contractAddress.slice(0, 8);
        if (!name)   name   = symbol;

        const balance = ethers.formatUnits(BigInt(b.tokenBalance), decimals);
        if (parseFloat(balance) <= 0) return null;
        return {
          symbol,
          name,
          address: b.contractAddress.toLowerCase(),
          decimals,
          balance,
          logo,
        } as AutoToken;
      } catch { return null; }
    }));

    return results.filter((t): t is AutoToken => t !== null);
  } catch (e) {
    console.warn(`[NumPay] Alchemy ${chainId}: token fetch failed`, e);
    return [];
  }
}

/**
 * Fetch all held ERC-20 tokens for one chain via Moralis, with USD price.
 * Covers arbitrary memecoins (no hardcoded list) on every supported chain.
 */
async function fetchMoralisERC20s(chainId: string, address: string): Promise<AutoToken[]> {
  const chainHex = MORALIS_CHAINS[chainId];
  if (!chainHex || !MORALIS_KEY) return [];
  try {
    const resp = await fetch(
      `https://deep-index.moralis.io/api/v2.2/wallets/${address}/tokens?chain=${chainHex}`,
      { headers: { "X-API-Key": MORALIS_KEY, Accept: "application/json" } },
    );
    if (!resp.ok) return [];
    const data = await resp.json();
    const result: any[] = data.result ?? [];
    const out: AutoToken[] = [];
    for (const t of result) {
      if (t.native_token) continue; // native coin is handled by the chain balance
      const addr = String(t.token_address || "").toLowerCase();
      if (!addr) continue;
      const balance = String(t.balance_formatted ?? "0");
      if (parseFloat(balance) <= 0) continue;
      out.push({
        symbol:   String(t.symbol || addr.slice(0, 8)).trim(),
        name:     String(t.name || t.symbol || addr.slice(0, 8)).trim(),
        address:  addr,
        decimals: Number(t.decimals ?? 18),
        balance,
        logo:     t.logo || t.thumbnail || undefined,
        priceUsd: typeof t.usd_price === "number" ? t.usd_price : undefined,
        possibleSpam:     t.possible_spam === true,
        securityScore:    typeof t.security_score === "number" ? t.security_score : undefined,
        verifiedContract: t.verified_contract === true,
      });
    }
    return out;
  } catch (e) {
    console.warn(`[NumPay] Moralis ${chainId}: token fetch failed`, e);
    return [];
  }
}

/**
 * Fetch all held ERC-20 tokens for one chain via GoldRush (Covalent), with USD
 * price. Fallback to Moralis: when Moralis is over its daily quota this still
 * returns the held tokens. No-op when GOLDRUSH_KEY is unset.
 */
async function fetchGoldRushERC20s(chainId: string, address: string): Promise<AutoToken[]> {
  const cvChain = GOLDRUSH_CHAINS[chainId];
  if (!cvChain || !GOLDRUSH_KEY) return [];
  try {
    const resp = await fetch(
      `https://api.covalenthq.com/v1/${cvChain}/address/${address}/balances_v2/?no-nft-fetch=true&key=${GOLDRUSH_KEY}`,
      { headers: { Accept: "application/json" } },
    );
    if (!resp.ok) return [];
    const json = await resp.json();
    const items: any[] = json?.data?.items ?? [];
    const out: AutoToken[] = [];
    for (const t of items) {
      if (t.native_token) continue; // native coin handled by the chain balance
      const addr = String(t.contract_address || "").toLowerCase();
      if (!addr.startsWith("0x")) continue;
      const decimals = Number(t.contract_decimals ?? 18);
      const raw = String(t.balance ?? "0");
      if (!raw || raw === "0") continue;
      let balance: string;
      try { balance = ethers.formatUnits(raw, decimals); } catch { continue; }
      if (parseFloat(balance) <= 0) continue;
      out.push({
        symbol:   String(t.contract_ticker_symbol || addr.slice(0, 8)).trim(),
        name:     String(t.contract_name || t.contract_ticker_symbol || addr.slice(0, 8)).trim(),
        address:  addr,
        decimals,
        balance,
        logo:     t.logo_url || undefined,
        priceUsd: typeof t.quote_rate === "number" ? t.quote_rate : undefined,
        possibleSpam: t.is_spam === true,
      });
    }
    return out;
  } catch (e) {
    console.warn(`[NumPay] GoldRush ${chainId}: token fetch failed`, e);
    return [];
  }
}

/**
 * Build a networkId → RPC map for all chains that have DEFAULT_TOKENS.
 * Includes Alchemy chains so this acts as a guaranteed fallback when Alchemy 403s.
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
 * Check DEFAULT_TOKENS balances via Multicall3 for every chain with known tokens.
 * Falls back to individual balanceOf calls if Multicall3 is unavailable.
 */
async function sweepTokensByRPC(
  address: string,
  onUpdate: (chainId: string, tokens: AutoToken[]) => void,
): Promise<void> {
  const chainMap = buildChainRpcMap();

  await Promise.all(
    Object.entries(chainMap).map(async ([networkId, { rpc, tokens, mc3 }]) => {
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
            new Promise<never>((_, r) => setTimeout(() => r(new Error("mc3 timeout")), 15000)),
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
        } catch {
          // Multicall3 unavailable on this RPC — fall through to individual calls
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
        }

        if (found.length > 0) onUpdate(networkId, found);
      } catch (e) {
        console.warn(`[NumPay] RPC sweep ${networkId} failed`, e);
      }
    }),
  );
}

// Exported so the background refresher can gate on the cache's age.
export const AUTOTOK_CACHE_PFX = "numpay_autotok6_";
const CACHE_PFX = AUTOTOK_CACHE_PFX;
const CACHE_TTL = 3 * 60 * 1000; // 3 minutes

/**
 * Sweep every supported EVM chain for ERC-20 tokens.
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
      for (const [chainId, tokens] of Object.entries(data)) onUpdate(chainId, stripNativeToken(chainId, tokens));
      if (Date.now() - ts < CACHE_TTL) cacheIsFresh = true;
    }
  } catch {}

  if (cacheIsFresh) return;

  const freshData: Record<string, AutoToken[]> = {};

  // Merge incoming tokens into a chain, deduping by address. Order-independent:
  // fills in price/logo from whichever source has them, and replaces a
  // truncated-address placeholder symbol/name with a real one.
  const merge = (chainId: string, incomingRaw: AutoToken[]) => {
    const incoming = stripNativeToken(chainId, incomingRaw);
    if (incoming.length === 0) return;
    const byAddr = new Map<string, AutoToken>(
      (freshData[chainId] ?? []).map((t) => [t.address.toLowerCase(), t]),
    );
    for (const t of incoming) {
      const k = t.address.toLowerCase();
      const cur = byAddr.get(k);
      if (!cur) { byAddr.set(k, t); continue; }
      const realSym  = (s?: string) => !!s && !s.startsWith("0x");
      byAddr.set(k, {
        ...cur,
        priceUsd: cur.priceUsd ?? t.priceUsd,
        logo:     cur.logo ?? t.logo,
        symbol:   realSym(cur.symbol) ? cur.symbol : t.symbol,
        name:     realSym(cur.name)   ? cur.name   : t.name,
        possibleSpam:     cur.possibleSpam     ?? t.possibleSpam,
        securityScore:    cur.securityScore    ?? t.securityScore,
        verifiedContract: cur.verifiedContract ?? t.verifiedContract,
      });
    }
    freshData[chainId] = Array.from(byAddr.values());
    onUpdate(chainId, freshData[chainId]);
  };

  const alchemyChains = Object.keys(ALCHEMY_CHAINS);

  await Promise.all([
    // Layer 1: Alchemy full auto-detect (only enabled networks return data)
    Promise.all(
      alchemyChains.map(async (chainId) => {
        const tokens = await fetchAlchemyERC20s(chainId, address);
        merge(chainId, tokens);
      }),
    ),
    // Layer 2: Multicall3 balanceOf for all chains with known DEFAULT_TOKENS
    sweepTokensByRPC(address, (chainId, tokens) => merge(chainId, tokens)),
    // Layer 3: Moralis — arbitrary held tokens + USD price (memecoins, all chains)
    Promise.all(
      Object.keys(MORALIS_CHAINS).map(async (chainId) => {
        const tokens = await fetchMoralisERC20s(chainId, address);
        merge(chainId, tokens);
      }),
    ),
    // Layer 4: GoldRush (Covalent) — fallback indexer. Covers held tokens + USD
    // price when Moralis is over its daily quota. No-op when GOLDRUSH_KEY unset.
    Promise.all(
      Object.keys(GOLDRUSH_CHAINS).map(async (chainId) => {
        const tokens = await fetchGoldRushERC20s(chainId, address);
        merge(chainId, tokens);
      }),
    ),
  ]);

  try {
    await setItem(cacheKey, JSON.stringify({ ts: Date.now(), data: freshData }));
  } catch {}
}
