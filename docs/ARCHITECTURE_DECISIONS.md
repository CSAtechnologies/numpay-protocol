# NUMPAY Architecture Decisions

Status: ACTIVE. Single source of truth for architectural decisions.
Last updated: 2026-05-22.
Mode: CRITICAL_CODE.

This file replaces both the older `NUMPAY_ARCHITECTURE_DECISIONS.md` and the proposed `ARCHITECTURE_DECISION_RECORDS/` directory referenced in the handoff. All recorded decisions live here. Decisions marked "Open" have a safe reversible default for the PoC and need a real call from Thomas before locking.

## TLDR

1. Non-custodial extension-first wallet. Backend never holds keys.
2. Phase 1 covers ETH (Sepolia) and SOL (devnet) only. BTC, TRON, XRP are Phase 2.
3. Independent integrity anchor is TOFU client-side pinning plus an append-only audit log. See `THREAT_MODEL.md` section 4.2.
4. Stack: TypeScript everywhere. React + Vite + Tailwind for Manifest V3 extension. NestJS + Postgres + Redis for backend. Drizzle ORM. Docker Compose for local Postgres + Redis.
5. Checksum is Verhoeff, not Luhn. Per kickoff pre-flight correction.
6. Four open questions (rotation, multiple IDs, business ranges, jurisdictions) get safe reversible defaults for PoC and explicit "Open, needs Thomas" status.

## Decision record format

Each ADR has: ID, title, status, context, decision, alternatives considered, consequences, and revisit trigger. Status values: Accepted, Open, Superseded.

---

### ADR-001. Non-custodial model. Accepted.

Context. The product is a payment identity layer over self-custody wallets. The handoff and the kickoff are explicit that custody is not v1.

Decision. NUMPAY v1 is strictly non-custodial. Private keys are generated and stored only on the user device. Backend stores public bindings, payment intents, audit log, and rate-limit state. Backend has no schema column that could hold key material and no code path that would request it.

Alternatives. Custodial wallet (scored 35/100 in the handoff, rejected). Hybrid with optional custodial accounts (rejected, scope creep).

Consequences. Recovery is the user's responsibility. No password reset for funds. Legal exposure is lower but not zero, see `SECURITY_REQUIREMENTS.md` section on regulatory scope. If the business later wants custody, it is a separate product with separate legal architecture, not a v2 of NUMPAY.

Revisit trigger. Never for the NUMPAY product. A custodial sibling product is a different decision.

---

### ADR-002. Extension-first delivery. Accepted.

Context. Two real choices: extension-first (Phantom-like) or web-only with IndexedDB vault. Mobile is v2+.

Decision. Manifest V3 extension as the primary surface for signing and key handling. A NUMPAY web app exists for dashboards, alias browsing, and payment intent creation but never sees keys. Extension is loaded unpacked in dev for v1 PoC, no store publishing yet.

Alternatives. Web-only with IndexedDB (scored 60/100 in handoff, higher XSS risk for key material, rejected for v1). Mobile-first (scored 78/100, slower to build, deferred to v2).

Consequences. Service worker lifecycle is a real cost. Extension requires Chrome/Brave/Edge in v1. Firefox port is a Phase 2 chore. dApp integration is straightforward via EIP-1193 and the Solana wallet adapter.

Revisit trigger. If mobile becomes the demanded surface earlier, we may parallelise the mobile track with shared crypto core.

---

### ADR-003. Phase 1 chain scope: ETH (Sepolia) and SOL (devnet) only. Accepted.

Context. Handoff lists five chains for v1 product. Kickoff cuts Phase 1 to two. Phase 2 brings BTC, TRON, XRP.

Decision. Phase 1 PoC supports exactly Sepolia (ETH testnet) and Solana devnet. All wallet code paths must be designed for the chain abstraction (CAIP-2 chain IDs, signing-curve registry), but the only concrete implementations in v1 are EVM (secp256k1) and Solana (ed25519). No mainnet RPC is configured.

Alternatives. Implement all five chains in Phase 1 (rejected, slows the PoC, increases security surface). Implement only ETH (rejected, fails to prove the chain-abstraction layer).

Consequences. The chain abstraction layer must be in place from day one. Adding BTC, TRON, XRP in Phase 2 should not require rewriting common code.

Revisit trigger. After Phase 1 exit criteria pass, Phase 2 immediately picks up the next chain.

---

### ADR-004. Trust-model integrity anchor: TOFU plus append-only audit log. Accepted.

Context. The handoff treats the backend as untrusted but relies on the backend to vouch for binding integrity via stored signatures. A compromised backend can fabricate self-signed bindings. See `THREAT_MODEL.md` section 4.2.

Decision. The client (sender's wallet) pins the alias owner's signing key on first resolution and verifies that the same key signs subsequent resolutions. The backend additionally keeps an append-only audit log of all binding mutations, with hash-chained rows. Phase 1 builds the pin and the log. Phase 3 adds signed log heads and a gossip monitor.

Alternatives. Blockchain-anchored bindings via ENS-style contract (heavy, deferred to Phase 4). Out-of-band safety number confirmation only (Phase 2 affordance, not the default).

Consequences. First-time resolution still has a one-shot vulnerability window. Selective forking by the backend is detectable only after Phase 3 gossip ships. v1 PoC runs on testnet, so the residual risk is accepted, see `THREAT_MODEL.md` section 5.

Revisit trigger. Before any mainnet pilot. Before any onboarding flow that ships outside the testnet PoC.

---

### ADR-005. NUMPAY ID format: 11 digits, 10 random plus 1 Verhoeff checksum. Accepted.

Context. Handoff suggested "Verhoeff or Luhn mod 10". Kickoff pre-flight correction mandates Verhoeff because it catches adjacent transposition errors that Luhn misses.

Decision. The 11-digit NUMPAY ID is 10 random payload digits from CSPRNG followed by 1 Verhoeff check digit. Display format: `D D D  D D D  D D D  D C` rendered as `123 456 789 03`. Storage format: `12345678903`. Random allocation with database uniqueness retry on collision. No sequential issuance, ever.

Alternatives. Luhn mod 10 (rejected, weaker error detection). Damm algorithm (rejected, not strictly better than Verhoeff for our digit count, and Verhoeff has more reference implementations to cross-check against).

Consequences. Verhoeff is slightly more code than Luhn, but `test-area/verify_numpay_id_checksum.ts` ships deterministic test vectors and the implementation is small.

Revisit trigger. Never under v1 product line.

---

### ADR-006. Public alias only, no secret use. Accepted.

Context. Anti-pattern in the industry: phone-number-as-password, SSN-as-identifier, etc.

Decision. The 11-digit NUMPAY ID is a public alias, full stop. It is not used as a password, seed, KDF input, recovery code, authentication factor, or source of any entropy. UI copy never invites users to "keep it secret".

Consequences. Privacy controls (rate limits, no exists-leak, no bulk lookup, signed payment intents) must do the work that secrecy would. See `SECURITY_REQUIREMENTS.md`.

Revisit trigger. None.

---

### ADR-007. Stack choice. Accepted.

Context. Need one stack for the whole product.

Decision.
- Language: TypeScript across extension, web app, backend, tests, and tooling.
- Extension UI: React + Vite. Manifest V3. Tailwind for styling. Radix or shadcn primitives where they fit.
- Web app: Vite + React. Same component library.
- Backend: NestJS. Postgres for durable data. Redis for rate limits and nonce storage.
- ORM: Drizzle. Reasons: lighter than Prisma, plain SQL escape hatch is straightforward, the migration model is explicit. Pinned in `package.json`.
- Local dev: Docker Compose for Postgres and Redis. See `LOCAL_DEV_SETUP.md`.
- Tests: Vitest for unit and integration. tsx for one-shot scripts in `test-area`.

Alternatives. Prisma over Drizzle (rejected, heavier, slower migrations). FastAPI in Python on the backend (rejected, breaks one-language stack). Next.js for the web app (rejected, Vite is enough for v1 and the build chain is simpler).

Consequences. One dependency tree to audit. One lint config. One typing model.

Revisit trigger. If the team gains a strong Python preference or if Next.js becomes necessary for SSR-driven receive pages, reassess.

---

### ADR-008. Crypto library allowlist. Accepted.

Context. Mixing low-level primitives is a known source of subtle wallet bugs.

Decision. The crypto allowlist for v1 is exactly:
- `@scure/bip39`, `@scure/bip32` for mnemonic and HD derivation.
- `@noble/secp256k1`, `@noble/ed25519`, `@noble/hashes` for low-level audited primitives.
- `viem` for EVM transaction building and broadcast.
- `@solana/web3.js` for Solana transactions.

Adding to this list is a documented ADR. No mixing of `ethers` with `viem` for the same purpose. No `bitcoinjs-lib` until Phase 2. No `tronweb` until Phase 2. No `xrpl` until Phase 2.

Consequences. One library per concern. Easier audit, easier dependency pinning.

Revisit trigger. New chain support.

---

### ADR-009. Address binding signature: per-alias owner key, ed25519. Accepted.

Context. The binding must be re-verified by senders' clients (TOFU). Using a chain account key directly mixes "who owns the alias" with "who controls this address on this chain", which makes rotation and multi-chain bindings ugly.

Decision. Each NUMPAY alias has a dedicated `ownerSigningKey` (ed25519) generated on the client. This key signs every binding the alias publishes, including the initial registration and any future address additions. Rotation of this key is a signed rotation message in the audit log. Chain account keys are separate.

Alternatives. Reuse the user's EVM key for all signings (rejected, mixes concerns, can't sign Solana-style address claims without ugly cross-format encoding). Use one of the chain account keys per chain (rejected, makes rotation per chain instead of per alias).

Consequences. One extra ed25519 keypair per alias to manage. Trivially handled by the same vault. Owners must back up this key with their other key material.

Revisit trigger. None for v1.

---

### ADR-010. Server-signed payment intents. Accepted.

Context. Sender needs to know the recipient address, amount, expiry, and chain were not modified after the intent was created.

Decision. The backend signs every payment intent payload with a long-term backend signing key. Public key is published at a known path on the backend domain and pinned in the extension build. The signature covers the canonical JCS-encoded payload. Replay protection by `intent_id` (UUID v4) and `expires_at`. Phase 3 may federate this key.

Consequences. If the backend signing key leaks, an attacker can forge intents. Mitigation: short-lived rotating subkey signed by a long-term offline root, deferred to Phase 3. v1 PoC uses a single subkey, rotation procedure documented.

Revisit trigger. Before mainnet pilot.

---

### ADR-011. No telemetry, no analytics, no crash reporting in v1. Accepted.

Context. Wallet pages contain seed phrases, transaction details, and dApp origins. Any third-party SDK is a leak risk.

Decision. v1 ships with zero third-party scripts and zero remote telemetry. Local logs only, with the field-allowlist logger from `SECURITY_REQUIREMENTS.md`. No Sentry, no Datadog, no analytics pixel, no fingerprinting libraries. Phase 3 may add a redacted opt-in metric beacon with explicit consent.

Consequences. Operational visibility is limited to logs we generate ourselves. Acceptable for PoC.

Revisit trigger. Beta launch.

---

### ADR-012. Database. Postgres. Drizzle. One schema. Accepted.

Context. Need durable storage for users, aliases, bindings, payment intents, transactions, audit log, sessions.

Decision. Single Postgres database (Postgres 16 in v1) with one logical schema. Drizzle migrations. Tables follow the handoff schema with these additions:
- `binding_audit_log` (see `THREAT_MODEL.md` section 4.2).
- `alias_owner_keys` (alias_id, public_key, status, created_at). Active key per alias is computed from the audit log.
- `rate_limit_state` lives in Redis, not Postgres.
- `payment_intents` adds `nonce` and a `server_signature` column (already in handoff schema).

Consequences. One backup target. One PITR setup.

Revisit trigger. Scale problems we do not have in PoC.

---

### ADR-013. RPC providers. Two per chain minimum. Accepted.

Context. A single RPC provider can lie, censor, or be down.

Decision. The extension and the backend each call at least two independent RPC providers per chain in Phase 1. v1 testnet defaults:
- Sepolia: Infura (with project key) and Alchemy (with API key). Optional fallback: ethereum-rpc.publicnode.com.
- Solana devnet: official `https://api.devnet.solana.com` plus a second provider (Helius or QuickNode devnet).

A simple "do they agree on the latest finalised block" check runs on every read of safety-critical data (resolving an alias, decoding a contract). Disagreement triggers a warning.

Consequences. Two API keys to manage per chain.

Revisit trigger. If a free public endpoint fails to meet uptime, swap.

---

### ADR-014. No remote scripts and no eval in extension. Accepted.

Context. Manifest V3 forbids most remote code already, but the rule is product policy too.

Decision. The extension bundle ships with all code locally. No `new Function`, no `eval`, no dynamic `import()` from a URL, no jsonp, no remotely hosted images that could carry SVG-XSS in the popup. CSP for the extension pages is the strictest one Chrome accepts.

Consequences. Feature flags and copy updates require an extension release.

Revisit trigger. None.

---

### ADR-015. Local-only repository for v1. Accepted.

Context. Kickoff says local only, never push to GitHub or any remote without explicit approval.

Decision. The repo lives only on the local machine and any local backups Thomas chooses. No `git push` to any remote. Local git for checkpoints is allowed but not required. CI is local for v1.

Consequences. Loss of the local machine equals loss of the repo. Thomas's own backup discipline applies.

Revisit trigger. Explicit approval from Thomas to push to a private remote.

---

### ADR-016. Open: NUMPAY ID rotation policy.

Context. Handoff question Q1. Can users rotate their 11-digit ID?

PoC default. One immutable ID per user. No rotation in v1.

Status. Open, needs Thomas. The default is reversible. Switching to "one rotation per N days with audit log entries" is a future ADR; the alias owner key already rotates separately under ADR-009.

Why the default is safe. Immutability avoids the operational and abuse-detection problems of rotation in v1 and does not commit us to a policy.

Revisit trigger. Before any consumer-facing positioning that promises rotation.

---

### ADR-017. Open: Multiple NUMPAY IDs per user.

Context. Handoff question Q2.

PoC default. One ID per user account. The data model already supports many-to-one (users to aliases) so lifting this is a config flag.

Status. Open, needs Thomas.

Revisit trigger. Before beta.

---

### ADR-018. Open: Business number ranges and verified profiles.

Context. Handoff question Q3.

PoC default. No business ranges. No verified profiles. No KYC. PoC IDs are anonymous to the alias registry. Display name is a freeform user-set string.

Status. Open, needs Thomas. Adding verified business profiles brings KYC and likely MiCA implications. Out of scope for PoC.

Revisit trigger. Before any "verified" badge ships.

---

### ADR-019. Open: Launch jurisdictions.

Context. Handoff question Q10.

PoC default. No jurisdiction claims. No marketing copy. PoC is internal testnet only.

Status. Open, needs Thomas. Triggers MiCA, FinCEN, local payment law review.

Revisit trigger. Before any public availability.

---

### ADR-020. Resolved by handoff: Q4 through Q9.

These were called open in the handoff but are resolved by the handoff's own "Recommended v1 decisions" section. Recording them here for traceability.

- Q4. Sender sees only the selected chain by default. Recipient can opt in to "show all my chains" per alias in settings.
- Q5. Address resolution requires a wallet session and rate limits, not anonymous bulk lookup.
- Q6. v1 supports only native coins (ETH, SOL on testnet/devnet). Stablecoin support (USDC) is a Phase 2 add.
- Q7. v1 is transfers only. No token approvals beyond what is needed to send a native asset. No swaps.
- Q8. v1 recovery is seed phrase only. Social recovery is Phase 3 at earliest.
- Q9. Mobile app is v2 roadmap, parallel track allowed once v1 PoC is stable.

---

## Index of decisions

| ID | Title | Status |
|---|---|---|
| ADR-001 | Non-custodial model | Accepted |
| ADR-002 | Extension-first delivery | Accepted |
| ADR-003 | Phase 1 chain scope: ETH+SOL only | Accepted |
| ADR-004 | Trust-model integrity anchor: TOFU + audit log | Accepted |
| ADR-005 | NUMPAY ID format: 11 digits, Verhoeff | Accepted |
| ADR-006 | Public alias only, no secret use | Accepted |
| ADR-007 | Stack: TypeScript, NestJS, Postgres, Drizzle | Accepted |
| ADR-008 | Crypto library allowlist | Accepted |
| ADR-009 | Per-alias owner key, ed25519 | Accepted |
| ADR-010 | Server-signed payment intents | Accepted |
| ADR-011 | No telemetry in v1 | Accepted |
| ADR-012 | Database + audit log structure | Accepted |
| ADR-013 | Two RPC providers per chain | Accepted |
| ADR-014 | No remote scripts, no eval | Accepted |
| ADR-015 | Local-only repository for v1 | Accepted |
| ADR-016 | NUMPAY ID rotation policy | Open |
| ADR-017 | Multiple IDs per user | Open |
| ADR-018 | Business ranges and verified profiles | Open |
| ADR-019 | Launch jurisdictions | Open |
| ADR-020 | Handoff Q4 through Q9 resolved | Accepted |
