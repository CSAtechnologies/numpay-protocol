/**
 * /v1/prices - native + major token rates (spec section 4).
 *
 * The coin and currency lists are worker-owned so every user shares ONE
 * cache entry; they must stay a superset of the client's lists in
 * wallet-extension/src/lib/currency.ts (coinIds + CURRENCIES codes). When a
 * chain or display currency is added there, add it here too.
 *
 * Upstream reality (measured 2026-07-05): CoinGecko's keyless tier 429s
 * Cloudflare Workers egress (shared IP pool), so a Demo API key
 * (COINGECKO_KEY secret) is REQUIRED in production. The Demo quota is 10k
 * calls/month, which forces the refresh interval to 5 min globally - well
 * inside the client's own 15-min rates cache, so users see FRESHER data
 * than today, not staler.
 *
 * Two cache layers:
 *   1. Cache API, per-colo, 30 s fresh: absorbs request bursts.
 *   2. KV, global, 5 min fresh: ensures ONE upstream call per interval
 *      worldwide (~8.6k/month) instead of one per colo.
 * On upstream failure the stale KV copy serves for up to 24 h.
 */

import type { Env } from "./index";

const COIN_IDS =
  "ethereum,bitcoin,matic-network,avalanche-2,binancecoin,fantom,mantle,sei-network,solana,sui,tron,ripple,litecoin,tether,crypto-com-chain,celo,xdai,moonbeam,kaia,metis-token";

const VS_CURRENCIES =
  "btc,eth,usd,eur,gbp,jpy,cny,krw,inr,cad,aud,chf,sgd,hkd,brl,mxn,ars,clp,cop,pen,sek,nok,dkk,pln,czk,huf,ron,bgn,hrk,isk,rub,uah,try,gel,idr,myr,thb,php,vnd,twd,pkr,bdt,lkr,mmk,nzd,aed,sar,qar,kwd,bhd,omr,ils,egp,zar,ngn,kes,ghs,tzs,ugx,mad,xof,xaf,etb,rwf";

const COLO_FRESH_MS = 30_000;
const GLOBAL_FRESH_MS = 300_000;
const KV_KEY = "prices:v1";
const KV_TTL_SECONDS = 86_400; // stale copy survives a day of upstream outage
// Synthetic cache key: one shared entry per colo for the whole endpoint.
const CACHE_URL = "https://numpay-wallet-api.internal/v1/prices";

interface StoredPrices {
  body: string;
  fetchedAt: number;
}

async function fetchUpstream(env: Env): Promise<string | null> {
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${COIN_IDS}&vs_currencies=${VS_CURRENCIES}`;
  // CoinGecko 403s requests without a User-Agent (workerd sends none).
  const headers: Record<string, string> = {
    Accept: "application/json",
    "User-Agent": "numpay-wallet-api/0.2 (+https://numpay-wallet-api.numpay.workers.dev)",
  };
  if (env.COINGECKO_KEY) headers["x-cg-demo-api-key"] = env.COINGECKO_KEY;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15_000);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    // Aggregate error signal only (spec section 6): status code, never URLs
    // with user data (this endpoint has none) and never request bodies.
    if (!res.ok) {
      console.log(`prices upstream non-ok: ${res.status}`);
      return null;
    }
    return await res.text();
  } catch {
    console.log("prices upstream network failure");
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function toClient(body: string, cacheState: "hit" | "kv" | "miss" | "stale"): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=30",
      "X-NumPay-Cache": cacheState,
    },
  });
}

function toColoCache(stored: StoredPrices): Response {
  return new Response(stored.body, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "public, max-age=300",
      "X-Fetched-At": String(stored.fetchedAt),
    },
  });
}

export async function handlePrices(env: Env, ctx: ExecutionContext): Promise<Response> {
  const cache = caches.default;
  const cacheKey = new Request(CACHE_URL);

  // Layer 1: per-colo cache, absorbs bursts without touching KV.
  const colo = await cache.match(cacheKey);
  if (colo) {
    const fetchedAt = Number(colo.headers.get("X-Fetched-At") ?? 0);
    if (Date.now() - fetchedAt < COLO_FRESH_MS) {
      return toClient(await colo.text(), "hit");
    }
  }

  // Layer 2: global KV entry, one upstream refresh per interval worldwide.
  const stored = await env.PRICES_KV.get<StoredPrices>(KV_KEY, "json");
  if (stored && Date.now() - stored.fetchedAt < GLOBAL_FRESH_MS) {
    ctx.waitUntil(cache.put(cacheKey, toColoCache(stored)));
    return toClient(stored.body, "kv");
  }

  const body = await fetchUpstream(env);
  if (body !== null) {
    const fresh: StoredPrices = { body, fetchedAt: Date.now() };
    ctx.waitUntil(
      Promise.all([
        env.PRICES_KV.put(KV_KEY, JSON.stringify(fresh), { expirationTtl: KV_TTL_SECONDS }),
        cache.put(cacheKey, toColoCache(fresh)),
      ])
    );
    return toClient(body, "miss");
  }

  // Upstream down: serve the stale global copy rather than failing.
  if (stored) return toClient(stored.body, "stale");
  return new Response(JSON.stringify({ error: "upstream_failed" }), {
    status: 502,
    headers: { "Content-Type": "application/json; charset=utf-8" },
  });
}
