# NumPay Wallet API (proxy)

Stateless Cloudflare Worker that holds the provider API keys so the extension
bundle does not have to. Full spec: `NUMPAY_WALLET_API_SPEC_2026-07-04.md` at
the project root. Privacy posture: spec section 6 (no address+IP logging, no
install-ID-to-address mapping, observability off).

## Status

Live at https://numpay-wallet-api.numpay.workers.dev with `/v1/health`,
`/v1/prices` (CoinGecko, 30 s colo + 5 min global KV cache) and
`/v1/tokens/{chain}/{address}` (Moralis with GoldRush failover, 45 s cache).
`/v1/token-meta` and `/v1/token-market` were deliberately dropped from v1:
their upstreams are keyless and scale better from user IPs (see the spec's
section 4 amendment).

## Develop

```
npm install
cp .dev.vars.example .dev.vars   # local secrets, gitignored
npm run dev                      # http://127.0.0.1:8787
npm run check                    # typecheck
```

Local dev needs no Cloudflare login; the rate-limit bindings are simulated.

## Deploy

```
npx wrangler login               # once, interactive
npx wrangler secret put MORALIS_KEY      # repeat per secret
npx wrangler deploy
```

Rollback: `npx wrangler rollback` or redeploy the previous commit. The
extension falls back to direct provider keys whenever the proxy errors
(spec section 7), so a bad deploy degrades, it does not break wallets.
