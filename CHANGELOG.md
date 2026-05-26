# NUMPAY Changelog

Project log of meaningful changes. Most recent first.

---

## 2026-05-22 — Phase 0 docs created (pre-review pause)

Mode: CRITICAL_CODE. Local-only. No remote push. No code outside docs.

### Added

- `docs/THREAT_MODEL.md`. Trust-model gap resolution (TOFU pinning of alias-to-ownerPubkey plus append-only hash-chained audit log). Threats and mitigations mapped from the handoff. Residual risk section names what we accept for testnet PoC.
- `docs/ARCHITECTURE_DECISIONS.md`. Single ADR file. 20 records. 15 accepted, 4 open (ADR-016 rotation, ADR-017 multiple IDs, ADR-018 business ranges, ADR-019 jurisdictions) with reversible PoC defaults. ADR-020 records handoff Q4-Q9 resolved by the handoff's own v1 recommendations.
- `docs/SECURITY_REQUIREMENTS.md`. OWASP API Top 10 mapping. Strict production CSP with real `api.numpay.app` placeholder hostnames. Logging policy with field allowlist and build-time denylist scan. Rate-limit table.
- `docs/CHAIN_SUPPORT_MATRIX.md`. Phase 1 = Sepolia (ETH testnet) + Solana devnet. Phase 2 = BTC signet, TRON Nile, XRP testnet. Chain abstraction layer present from day one even with only two chains wired.
- `docs/POC_PLAN.md`. Phase 1 scope, M1-M10 milestones, 10 exit criteria including real testnet tx hash on each chain.
- `docs/LOCAL_DEV_SETUP.md`. The only file that uses `.local` hostnames. Docker Compose shape, env file template, testnet faucet pointers.

### Verified

- No em-dash (U+2014) anywhere in `docs/`. Grep clean.
- No en-dash (U+2013) anywhere in `docs/`. Grep clean.
- `.local` hostnames appear only in `LOCAL_DEV_SETUP.md`. Production CSP uses `api.numpay.app`.
- No mainnet RPC URL anywhere in any doc.
- No telemetry, no third-party SDK named.

### Open items raised in sanity check

- **Internal contradiction.** `POC_PLAN.md` section 4 lists `argon2-browser` in the dependency allowlist, but `THREAT_MODEL.md` and the ADR-008 allowlist use `@noble/hashes` argon2id. Drop `argon2-browser`, use `@noble/hashes`. Verify at implementation time that the pinned `@noble/hashes` version ships argon2id; if not, file a new ADR.
- **Unverified.** Solana devnet CAIP-2 short form (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`) not re-checked against CAIP-30. Verify at implementation time.
- **Unbenchmarked.** Argon2id parameters `m=65536 KiB, t=3, p=1`. Benchmark at vault create per the doc.
- **Underspecified.** Dev TLS setup for `api.numpay.local` (mkcert vs caddy vs plain http on localhost). Pick in M1.
- **Untuned.** Rate-limit values in `SECURITY_REQUIREMENTS.md` section 4 are starting points.

### Pending

- `test-area/verify_numpay_id_checksum.ts` (Verhoeff, must pass).
- `test-area/verify_address_binding_signatures.ts` (runnable skeleton, may not pass yet).
- `test-area/verify_payment_intent_signatures.ts` (runnable skeleton, may not pass yet).
- `test-area/verify_no_secret_logging.ts` (must pass on current tree).
- Minimal `test-area/` tooling (package.json, tsconfig, tsx, deps pinned, audit run).
- All four scripts must actually run; outputs captured to `test-area/results/`.

### Hard stops still in effect

- No production code until Thomas reviews the Phase 0 docs and the four scripts and says "GO Phase 1."
- No remote push. Ever, in v1, without explicit approval.
- No mainnet RPC. Ever, in v1.
- No custodial features, no fiat, no swaps.

### Tasks status

Task #1-6 (docs) completed. Tasks #7-13 (scripts, tooling, run, checkpoint) pending.
