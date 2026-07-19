# NumPay: What Is Limited Because We Are On Free Plans

**Date:** 2026-07-11
**Purpose:** one page to remember every design decision and product limitation
that exists ONLY because a provider is on a free tier. Revisit this file the
day any billing decision is made, and before public launch at the latest.
Each entry says: the limit, what we changed because of it, and what undoes it.

---

## 1. Moralis (token discovery) - THE binding constraint

- **Plan:** free tier on a dedicated second account (key lives in the worker;
  the extension keeps the original free key as its direct fallback).
- **Hard limit:** 40,000 CU/day. The worker's endpoint
  `/wallets/{address}/tokens` costs **100 CU per call**, so the entire product
  gets **~400 token-discovery calls per day**. One active dev burns up to half.
  This already caused the 2026-07-06 "daily usage consumed" outage.
- **What we limited because of it:**
  - Tokens cache TTL raised 45 s -> 300 s (worker v0.3.2, 2026-07-11): new
    tokens can take up to 5 minutes longer to appear. Chosen as the cheap CU
    lever, user-approved.
  - Client keeps 3-min / 12-min sweep gates on indexer-backed discovery.
  - Approval/revoke dashboard (extension Batch B) is DEFERRED: free-tier data
    was blocked; needs a paid proxy endpoint.
- **Undo:** buy **Moralis Pro ($199/mo, 100M CU/mo = ~1M calls/mo)** at public
  launch. Starter ($49, 20k calls/mo) was evaluated and rejected as pointless.
  Decision: stay free through beta. Pricing verified 2026-07-11.

## 2. CoinGecko (fiat rates) - Demo key

- **Plan:** free Demo API key (10,000 calls/month), held in the worker.
- **Hard limit:** keyless calls from Workers egress IPs are 403/429'd
  (measured), so the Demo key is the only path, and its quota shapes /v1/prices.
- **What we limited because of it:**
  - Global price refresh is **5 minutes via KV** (spec originally wanted 30 s);
    a 30 s per-colo cache fronts it. Budget ~8.6k upstream calls/month.
  - `/v1/token-meta` and `/v1/token-market` were **CANCELLED from v1** (spec
    v1.1): proxying CG detail/GeckoTerminal/DexScreener would blow the quota or
    hit the Workers-egress blocks. Meta ships inside /v1/tokens instead.
- **Undo:** a paid CG tier would allow faster refresh and a token-market
  endpoint, but only build that if production telemetry shows client-side
  DexScreener/GeckoTerminal per-IP limits hurting UX.

## 3. GoldRush / Covalent (Moralis failover) - credits exhausted

- **Plan:** free tier; credits ran out 2026-07-06 ("Credit limit exceeded").
- **What we limited because of it:** the six chains Moralis' Data API dropped
  (fantom, scroll, zksync, mantle, blast, polygonzkevm) currently 502-fast at
  the proxy, so token DISCOVERY is dead there; client Multicall covers
  DEFAULT_TOKENS and lean-sweep retention keeps already-known tokens visible.
- **Undo:** monthly credit reset brings it back temporarily; a small paid
  GoldRush plan is an open billing decision if those six chains matter at
  launch.

## 4. Cloudflare Workers (the proxy itself)

- **Plan:** free. Measured 2026-07-11: 450-1,100 requests/day with one dev,
  so nowhere near free limits. Least urgent.
- **Undo:** move to the $5/mo paid plan (10M requests) before public launch,
  as already planned in the wallet-api spec.

## 5. Solana public RPC (mobile only)

- **Plan:** none. Mobile ships proxy-only with zero bundled keys, so core
  falls back to `api.mainnet-beta.solana.com`, which is rate-limited per IP.
  Fine for one user's reads; watch it during mobile beta.
- Related dev nuisance: the public **devnet faucet** is usually dry (429).
  Fund test addresses from desktop via a Helius devnet `requestAirdrop`.
- **Undo:** if mobile Solana reads throttle in practice, the fix is a proxy
  RPC relay decision (spec currently keeps native reads client-side) or a
  keyed endpoint delivered server-side. Do not bundle keys in the app.

## NOT limited (for contrast)

- **Helius:** already PAID (Solana mainnet reads on the extension, webhooks
  available for Phase C).
- **Alchemy:** free tier currently sufficient; the Optimism WSS 403 is a
  dashboard network-enablement issue, not a quota problem.

---

**Trigger dates:** revisit at the Moralis billing decision, at mobile beta
start (Solana public RPC), and unconditionally before public launch (Workers
paid plan + Moralis Pro + privacy page publication are all launch gates).
