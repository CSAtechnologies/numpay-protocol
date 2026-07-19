# NumPay Wallet API (Proxy) Specification

**Status:** v1.1 (2026-07-06). Steps 1-3 built, deployed, live-verified
(worker at numpay-wallet-api.numpay.workers.dev, repo NumPay/wallet-api).
Amended: token-meta/token-market dropped from v1 scope (see section 4) after
build-time findings; original step 4 removed from the build plan.
**Owner:** NumPay
**Decision gate:** build and deploy BEFORE any public launch. This is the single
component standing between "works for us" and "breaks at 500 users".

---

## 1. Problem

The extension ships shared provider API keys (Moralis, Alchemy, GoldRush,
Helius) inside its bundle. Every installed wallet calls the providers directly
with the same keys. Consequences at scale:

- All users share one metered quota. When it throttles, it throttles everyone
  at once.
- Anyone can extract the keys from the bundle and burn the quota from outside
  the product.
- Per-user WebSocket connections multiply against per-key concurrent limits
  (6 sockets per user today).
- Identical data (prices, token metadata) is fetched N times for N users.

What scales naturally and stays client-side: keyless public RPCs and public
WSS endpoints (rate-limited per user IP, load distributed by design). Those
are NOT routed through this proxy.

## 2. Non-goals

- Not an indexer. No block ingestion, no historical data, no reorg handling.
- Not custody. No key material, no signing, nothing user-secret ever transits.
- No user accounts, no sessions, no server-side address book.
- No analytics or tracking of any kind in v1.

## 3. Architecture

One stateless edge worker (Cloudflare Workers) plus its cache layer
(Cache API + KV for longer TTLs). No database. No queue. Nothing persists a
request after it is served.

```
extension ──HTTPS──> worker (keys live here, secrets store)
                       ├── cache hit  -> serve (majority of traffic)
                       └── cache miss -> one upstream call (Moralis /
                            GoldRush / CoinGecko / Alchemy) -> cache -> serve
```

Reasoning for Workers over a VPS: zero ops, global edge latency (Nigeria
included via Cloudflare POPs), per-request pricing that is effectively free at
thousands of users, and secrets management built in. A VPS adds patching,
uptime, and TLS chores with no benefit at this size.

## 4. Endpoints (v1)

All responses JSON, gzip, `Cache-Control` mirroring the internal TTL.

| Endpoint | Upstream | Cache TTL | Purpose |
|---|---|---|---|
| `GET /v1/prices` | CoinGecko | 30 s, shared globally | Native + major token rates. One upstream call per 30 s serves every user. |
| `GET /v1/tokens/{chain}/{address}` | Moralis, GoldRush fallback | 300 s per (chain,address) (45 s until 2026-07-11; raised as the CU lever, user-approved) | Held-token discovery with USD price. Replaces the client's direct Moralis/GoldRush layers. |
| `GET /v1/health` | none | none | Version + upstream status flags for client fallback logic. |

Explicitly NOT proxied in v1: native balance RPC reads (keyless public RPCs,
already distributed), transaction broadcast (goes straight to the chain), and
WebSocket subscriptions (client-side, see section 8).

**Amendment (2026-07-06): `/v1/token-meta` and `/v1/token-market` dropped
from v1.** Build-time findings turned both into liabilities, by this spec's
own section 1 principle:

- Every upstream in the client's market-data chain (CoinGecko detail
  lookups, GeckoTerminal, DexScreener) is keyless and rate-limited per user
  IP. Distributed across user browsers that scales by design; funneled
  through the worker it concentrates onto Cloudflare's shared egress IPs,
  which CoinGecko was MEASURED to reject (403 keyless UA-less, 429 keyless
  keyed-pool) during the /v1/prices build. Routing CG detail lookups through
  the Demo key would also exceed its 10k calls/month (prices alone budgets
  ~8.6k).
- Token metadata (symbol/name/decimals/logo) already ships in the
  /v1/tokens response; a meta endpoint would double Moralis CU for nothing.
- The spam classifier makes no network calls of its own; its inputs arrive
  via /v1/tokens.

Revisit only if production telemetry shows client-side DexScreener /
GeckoTerminal per-IP limits actually degrading UX; if so, a thin
token-market endpoint with its own paid upstream (not keyless passthrough)
is the shape to build.

## 5. Rate limiting and abuse control

- Client generates one random anonymous install ID (UUID, stored in
  `chrome.storage.local`, never derived from addresses) and sends it as
  `X-NumPay-Install`. Token bucket per install ID: 60 requests/min, burst 20.
- Secondary per-IP bucket (Workers rate-limit binding): 120 requests/min,
  catches install-ID rotation abuse.
- Origin header must be the extension origin. This is spoofable outside a
  browser and is treated as a first filter, not a security boundary; the rate
  limits are the boundary.
- 429 responses carry `Retry-After`. The client backs off and falls through to
  its existing cache (stale-while-revalidate already tolerates this).

## 6. Privacy and compliance posture

The worker sees wallet addresses and client IPs. That is unavoidable for any
wallet backend (MetaMask/Infura, Phantom, Rabby all have this component). The
posture, to be added to the compliance doc the day this deploys:

- Stateless by design: no request logging that pairs address with IP. Workers
  observability logging OFF for request bodies/URLs; only aggregate error
  counts kept.
- Cache keys contain addresses but expire on TTL; KV entries carry TTL and are
  never enumerated.
- No install-ID-to-address mapping is ever stored.
- Document this publicly (privacy page): "our API relays balance queries and
  does not retain them".
- NDPA/GDPR: no personal data at rest means no retention schedule to manage;
  the DPIA entry states the transit-only processing basis.

## 7. Client changes

- `lib/env.ts` gains `VITE_API_BASE` (empty = current direct-key behavior, so
  development and the migration period need no flag day).
- `autoTokens.ts`: when `API_BASE` is set, the Moralis + GoldRush layers merge
  into one `GET /v1/tokens/...` call per chain. Alchemy and RPC layers stay
  client-side (keyless or per-user quota).
- `tokenMarket.ts` and `currency.ts` fetchers route to `/v1/prices`,
  `/v1/token-market/...` when `API_BASE` is set.
- Fallback rule: any proxy 5xx/429/timeout falls back to the direct-key path
  for that request, so a proxy outage degrades to today's behavior instead of
  breaking the wallet. Direct keys are removed from the bundle only after the
  proxy has run stably in production (target: one release later).

## 8. Phase C (post-launch, separate spec): event fan-out

Not in v1. When user counts make per-user WebSockets untenable against
provider connection limits, the watcher inverts: the worker (Durable Object)
registers address-activity webhooks upstream (Helius, Alchemy) and clients
hold ONE WebSocket to us. The client-side `wsWatch.ts` logic carries over
unchanged; only the socket target changes. Requires the same privacy posture
plus a registered-address set in the Durable Object (in-memory, not
persisted).

## 9. Capacity math ("thousands without breaking")

Assume 2,000 daily-active users, popup open 3 sessions/day, background sweep
every 12 min per user.

- Prices: all users share one cached entry. Upstream: ~2,880 CoinGecko calls
  per day TOTAL regardless of user count. Today: every user calls CoinGecko
  individually.
- Token discovery: 2,000 users x 17 chains x (5 popup sweeps + 120 background
  gates/day, mostly cache hits at the worker) collapses to upstream calls only
  on 300 s cache expiry per ACTIVE (chain,address) (raised from 45 s, 2026-07-11). Realistic upstream: tens of
  thousands of Moralis calls/day, inside a mid paid tier. Today: the same load
  hits the free key raw and dies at roughly 50 users.
- Worker requests: low millions/month at 2,000 DAU. Workers paid plan covers
  10M requests for ~$5/month (pricing to verify at build time).

## 10. Cost estimate (verify all pricing before committing)

| Item | Est. monthly | Note |
|---|---|---|
| Cloudflare Workers paid + KV | ~$5-10 | 10M req included (verify) |
| Moralis paid tier | ~$50-100 | pick tier from measured upstream volume |
| Helius (already subscribed) | sunk | webhooks come with paid plans |
| Alchemy growth (optional) | $0-50 | only if CU measurements demand it |
| **Total at launch scale** | **~$60-160** | scales step-wise with tiers |

## 11. Build plan

1. Worker skeleton: routing, install-ID rate limiting, secrets, `/v1/health`.
   DONE 2026-07-05.
2. `/v1/prices` + client switch behind `VITE_API_BASE`. DONE 2026-07-05
   (CoinGecko Demo key required from Workers egress; 5-min global KV refresh
   to fit the 10k/month Demo quota, fronted by a 30 s per-colo cache).
3. `/v1/tokens` with Moralis->GoldRush failover + client merge. DONE
   2026-07-06 (worker runs its own dedicated Moralis key; the bundled key
   remains the client's direct-fallback quota until step 5 strips it).
4. ~~`/v1/token-meta`, `/v1/token-market`.~~ REMOVED, see section 4
   amendment.
5. Measure upstream volume, buy the right Moralis tier, remove direct keys
   from the bundle. MEASURED 2026-07-11 (CF GraphQL, one active dev,
   2026-07-05 to 07-11): 442-1,122 worker requests/day, zero errors;
   subrequests minus requests suggests roughly 100-250 upstream fetches/day.
   Pricing verified 2026-07-11: the worker's Moralis endpoint
   (/wallets/{address}/tokens) costs 100 CU/call, so free = 400 calls/day,
   Starter $49 = 20k calls/month (too small to matter), Pro $199 = 1M
   calls/month. Recommendation: stay free through beta, buy Pro at public
   launch, and raise the tokens cache TTL first, since TTL is the dominant CU lever.
   TTL RAISED to 300 s and deployed as v0.3.2, 2026-07-11 (user-approved).
   Purchase pending user billing decision.
6. Write the privacy posture into NUMPAY_COMPLIANCE_POSTURE and the public
   privacy page. DONE 2026-07-11: compliance doc gained Section 6.1
   (transit-only posture + verification checklist); public page drafted at
   NUMPAY_PRIVACY_PAGE_2026-07-11.md, publish before launch.

All steps individually shippable and reversible via `VITE_API_BASE`.
