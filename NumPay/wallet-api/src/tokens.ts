/**
 * /v1/tokens/{chain}/{address} - held ERC-20 discovery with USD price
 * (spec section 4). Moralis first, GoldRush (Covalent) failover, normalized
 * to the client's AutoToken shape so the extension's merge logic is
 * provider-agnostic. Chain slugs mirror wallet-extension/src/lib/
 * autoTokens.ts (GOLDRUSH_CHAINS is the full 17-chain set; MORALIS_CHAINS
 * is trimmed to what Moralis' Data API actually serves).
 *
 * Privacy (spec section 6): the wallet address transits to the upstream and
 * lands in a per-colo cache key that expires on TTL. Nothing is logged with
 * it and nothing persists past the cache window.
 *
 * A 200 with an empty tokens array is a real answer ("verifiably holds
 * nothing here") and drives cache eviction client-side; provider failures
 * are 502 so the client falls back to its direct-key path instead.
 */

import type { Env } from "./index";

// networkId slug -> Moralis hex chain id.
// Verified against docs.moralis.com/supported-chains 2026-07-05: fantom and
// scroll are gone from the Data API, and zksync/mantle/blast/polygonzkevm
// are RPC-only (wallets/tokens 400s on all six, measured live). Those
// chains go straight to GoldRush below.
const MORALIS_CHAINS: Record<string, string> = {
  ethereum:     "0x1",
  polygon:      "0x89",
  bsc:          "0x38",
  avalanche:    "0xa86a",
  cronos:       "0x19",
  arbitrum:     "0xa4b1",
  optimism:     "0xa",
  base:         "0x2105",
  gnosis:       "0x64",
  linea:        "0xe708",
  moonbeam:     "0x504",
};

// networkId slug -> GoldRush (Covalent) decimal chain id
const GOLDRUSH_CHAINS: Record<string, string> = {
  ethereum: "1",     polygon: "137",   bsc: "56",         avalanche: "43114",
  fantom: "250",     cronos: "25",     arbitrum: "42161", optimism: "10",
  base: "8453",      gnosis: "100",    linea: "59144",    moonbeam: "1284",
  zksync: "324",     mantle: "5000",   blast: "81457",    scroll: "534352",
  polygonzkevm: "1101",
};

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
// 5 min (was 45 s until 2026-07-11): client sweeps run minutes apart, so at
// 45 s nearly every sweep missed the cache and hit Moralis at 100 CU/call.
// 5 min only delays NEW-token discovery; balances of known tokens come from
// client-side RPC reads and are unaffected.
const FRESH_SECONDS = 300;
const UPSTREAM_TIMEOUT_MS = 8_000;
// Some upstreams reject UA-less fetches (workerd sends none) - see prices.ts.
const USER_AGENT = "numpay-wallet-api/0.3 (+https://numpay-wallet-api.numpay.workers.dev)";

interface ProxyToken {
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
}

/** Integer token units -> decimal string (ethers.formatUnits equivalent). */
function formatUnits(raw: string, decimals: number): string | null {
  if (!/^\d+$/.test(raw)) return null;
  if (decimals <= 0) return raw;
  const padded = raw.padStart(decimals + 1, "0");
  const int = padded.slice(0, -decimals);
  const frac = padded.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

async function timedFetch(url: string, headers: Record<string, string>): Promise<Response | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, ...headers }, signal: ctrl.signal });
    if (!res.ok) {
      // Aggregate error signal only: provider + status, never the URL
      // (it contains the wallet address).
      console.log(`tokens upstream non-ok: ${new URL(url).hostname} ${res.status}`);
      return null;
    }
    return res;
  } catch {
    console.log(`tokens upstream network failure: ${new URL(url).hostname}`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function fetchMoralis(chain: string, address: string, env: Env): Promise<ProxyToken[] | null> {
  const chainHex = MORALIS_CHAINS[chain];
  if (!chainHex || !env.MORALIS_KEY) return null;
  const res = await timedFetch(
    `https://deep-index.moralis.io/api/v2.2/wallets/${address}/tokens?chain=${chainHex}`,
    { "X-API-Key": env.MORALIS_KEY, Accept: "application/json" },
  );
  if (!res) return null;
  try {
    const data = (await res.json()) as { result?: any[] };
    const out: ProxyToken[] = [];
    for (const t of data.result ?? []) {
      if (t.native_token) continue; // native coin is the chain-balance row
      const addr = String(t.token_address || "").toLowerCase();
      if (!addr) continue;
      const balance = String(t.balance_formatted ?? "0");
      if (!(parseFloat(balance) > 0)) continue;
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
  } catch {
    return null;
  }
}

async function fetchGoldRush(chain: string, address: string, env: Env): Promise<ProxyToken[] | null> {
  const cvChain = GOLDRUSH_CHAINS[chain];
  if (!cvChain || !env.GOLDRUSH_KEY) return null;
  const res = await timedFetch(
    `https://api.covalenthq.com/v1/${cvChain}/address/${address}/balances_v2/?no-nft-fetch=true&key=${env.GOLDRUSH_KEY}`,
    { Accept: "application/json" },
  );
  if (!res) return null;
  try {
    const json = (await res.json()) as { data?: { items?: any[] } };
    const out: ProxyToken[] = [];
    for (const t of json?.data?.items ?? []) {
      if (t.native_token) continue;
      const addr = String(t.contract_address || "").toLowerCase();
      if (!addr.startsWith("0x")) continue;
      const decimals = Number(t.contract_decimals ?? 18);
      const raw = String(t.balance ?? "0");
      if (!raw || raw === "0") continue;
      const balance = formatUnits(raw, decimals);
      if (balance === null || !(parseFloat(balance) > 0)) continue;
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
  } catch {
    return null;
  }
}

function toClient(body: string, cacheState: "hit" | "miss", source: string): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": `public, max-age=${FRESH_SECONDS}`,
      "X-NumPay-Cache": cacheState,
      "X-NumPay-Source": source,
    },
  });
}

export async function handleTokens(
  chain: string,
  addressRaw: string,
  env: Env,
  ctx: ExecutionContext,
): Promise<Response> {
  if (!(chain in MORALIS_CHAINS) && !(chain in GOLDRUSH_CHAINS)) {
    return new Response(JSON.stringify({ error: "unknown_chain" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  if (!ADDRESS_RE.test(addressRaw)) {
    return new Response(JSON.stringify({ error: "invalid_address" }), {
      status: 400,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }
  const address = addressRaw.toLowerCase();

  const cache = caches.default;
  const cacheKey = new Request(`https://numpay-wallet-api.internal/v1/tokens/${chain}/${address}`);
  const cached = await cache.match(cacheKey);
  if (cached) {
    return toClient(await cached.text(), "hit", cached.headers.get("X-NumPay-Source") ?? "cache");
  }

  let source = "moralis";
  let tokens = await fetchMoralis(chain, address, env);
  if (tokens === null) {
    source = "goldrush";
    tokens = await fetchGoldRush(chain, address, env);
  }
  if (tokens === null) {
    return new Response(JSON.stringify({ error: "upstream_failed" }), {
      status: 502,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  }

  const body = JSON.stringify({ tokens });
  ctx.waitUntil(
    cache.put(
      cacheKey,
      new Response(body, {
        headers: {
          "Content-Type": "application/json; charset=utf-8",
          "Cache-Control": `public, max-age=${FRESH_SECONDS}`,
          "X-NumPay-Source": source,
        },
      }),
    ),
  );
  return toClient(body, "miss", source);
}
