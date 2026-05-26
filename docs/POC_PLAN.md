# NUMPAY Phase 1 PoC Plan

Status: ACTIVE. Awaits "GO Phase 1" from Thomas before any production code is written.
Last updated: 2026-05-22.
Mode: CRITICAL_CODE.

This plan covers Phase 1 only. Phase 0 deliverables (this doc set and the four `test-area/` scripts) are tracked separately.

## TLDR

1. Phase 1 proves five claims in a runnable end-to-end demo on testnet/devnet only:
   1. Local encrypted vault that survives an extension reload and protects keys at rest.
   2. NUMPAY ID allocation, Verhoeff checksum validation, public alias registration.
   3. Signed address bindings with the ed25519 owner key (ADR-009) plus chain-key self-attestation.
   4. TOFU resolution path with the audit log integrity check (ADR-004).
   5. Real testnet transfer signed locally on Sepolia and on Solana devnet, never touching backend keys.
2. Scope is two chains, three flows (create wallet, register alias, send by alias), strict local-first.
3. Exit criteria are concrete and testable. Section 6.
4. Out of scope: any mainnet RPC, fiat, swaps, social recovery, hardware wallets, custodial features, BTC, TRON, XRP.

## 1. Phase 1 deliverables

### 1.1 Repo scaffold

- pnpm workspaces: `extension/`, `web/`, `backend/`, `shared/`, `test-area/`.
- TypeScript across the workspace. One `tsconfig.base.json` extended per package.
- Vitest for unit and integration tests in each workspace.
- Lint (eslint + project-specific rules: no `console.log` in production code, no `Math.random`, no `<all_urls>` in manifest, no inline JS in extension HTML).
- Docker Compose at the repo root: Postgres 16 + Redis 7 services for local dev.
- Drizzle migrations live in `backend/drizzle/`.

### 1.2 Database

Tables from the handoff schema plus the additions from ADR-012:

- `users`
- `numpay_aliases`
- `wallet_accounts`
- `address_bindings`
- `alias_owner_keys` (alias_id, public_key, status, created_at, audit_position)
- `binding_audit_log` (position bigint PK, prev_hash bytea, payload_hash bytea, payload jsonb, op text, ts timestamptz)
- `payment_intents`
- `transactions`
- `sessions`

Postgres-side constraints: alias unique on `numpay_id`; audit log inserts must call the stored procedure `audit_append` that enforces `prev_hash` matches current tail; `address_bindings.chain_id` is CAIP-2 form (regex check).

### 1.3 Backend (NestJS)

Endpoints. All payloads validated with Zod.

- `POST /auth/register` and `POST /auth/login` (vault wallet flow only in Phase 1; passkeys are Phase 2). Session cookie set per `SECURITY_REQUIREMENTS.md`.
- `POST /aliases` body `{ alias, ownerPubkey, bindingSignature }`. Validates checksum, ownership signature, idempotency.
- `GET /aliases/:alias/resolve?chain={chainId}` returns `{ alias, ownerPubkey, address, bindingSignature, auditPosition, auditPrevHash }`. Rate-limited per `SECURITY_REQUIREMENTS.md` section 4.
- `POST /bindings` body `{ alias, chainId, address, chainKeyAttestation, ownerBindingSignature }`. Object-level auth: only the alias owner can call this. Inserts a row into `binding_audit_log` via `audit_append`.
- `POST /payment_intents` body `{ alias, chainId, assetId, amount? }`. Returns `{ intent_id, recipient, expires_at, server_signature, ... }`.
- `GET /payment_intents/:id` for sender confirmation.
- `GET /audit/head` and `GET /audit/log/:position` for client-side audit chain verification.
- `GET /healthz` and `GET /version`.

### 1.4 Extension (Manifest V3)

- React + Vite app. Popup, fullscreen vault setup, options page.
- Background service worker holds the key material in memory only while signing.
- Content script + main-world provider shim for EIP-1193 (Ethereum) and Solana Wallet Standard (Solana).
- Vault: AES-256-GCM, key wrapped by Argon2id over the vault password (parameters per `SECURITY_REQUIREMENTS.md` section 5.1).
- Storage: `chrome.storage.local` for the vault. Pinned alias data and audit positions stored separately, also in `chrome.storage.local`, never in the page DOM.

### 1.5 Web app

- One page in v1: a simple "view your alias and bindings" dashboard. No signing in the web app. The web app links into the extension popup for any action.
- Vite + React. Same component library as the extension.

### 1.6 Shared crypto core (`shared/crypto`)

- BIP-39 mnemonic generation and validation.
- HD derivation for secp256k1 (ETH) and ed25519 (Solana) accounts.
- ed25519 owner-key generation per alias.
- Canonical JSON (JCS) serialiser.
- Verhoeff checksum (already in `test-area/verify_numpay_id_checksum.ts`; lifted to `shared/` in Phase 1).

## 2. Phase 1 user flows

### Flow A. Create wallet, generate mnemonic, set vault password.

1. User installs the unpacked extension and opens the popup.
2. Extension calls the in-memory entropy source (`crypto.getRandomValues`) and produces a 12-word mnemonic via `@scure/bip39`.
3. UI shows the mnemonic with a "do not screenshot" warning. User confirms by re-entering selected words.
4. User sets a vault password. Argon2id KEK is computed. Mnemonic is encrypted and stored in `chrome.storage.local`.
5. Extension derives the first ETH account (path `m/44'/60'/0'/0/0`) and the first SOL account (`m/44'/501'/0'/0'`). Public keys are computed; private keys remain wrapped.

### Flow B. Register a NUMPAY alias.

1. User clicks "Create my NUMPAY ID" in the extension.
2. Extension generates an ed25519 owner key (the `ownerSigningKey` from ADR-009).
3. Backend issues a candidate alias (10 random digits + Verhoeff). Conflict retry inside the backend.
4. Extension signs `BindingV1` (alias + ownerPubkey + issuedAt + nonce) with the owner key.
5. Backend stores the alias and the initial owner-key entry in the audit log (`op: "create"`).

### Flow C. Add a chain-specific binding (ETH or SOL).

1. User picks a chain in the extension.
2. Extension produces the chain-specific attestation: the chain account signs a canonical message including `alias`, `chainId`, `address`, and a nonce.
3. Extension signs the same payload with the owner key as well.
4. Backend stores `address_bindings` row and appends `op: "bind"` to the audit log.

### Flow D. Resolve and send by alias.

1. Sender enters the alias and chooses a chain in the extension popup.
2. Extension calls `GET /aliases/:alias/resolve?chain=...`.
3. Extension verifies the owner signature with the pinned owner pubkey if any, otherwise pins on first use.
4. Extension calls `POST /payment_intents` and verifies the server signature against the pinned backend signing pubkey.
5. Extension shows the approval screen: origin, network, action, recipient alias and address, amount, fee, risk badge.
6. User approves. Extension signs locally, broadcasts via the chain's primary RPC, and confirms via the secondary.
7. Backend records the broadcast (optional in Phase 1; sender-reported tx hash is acceptable).

## 3. Phase 1 milestones

| # | Milestone | What we build | Exit |
|---|---|---|---|
| M1 | Repo scaffold and CI | Workspaces, lint, vitest, Docker Compose for Postgres+Redis | `pnpm install` and `pnpm test` work locally; Postgres and Redis come up via Compose |
| M2 | Shared crypto core | Mnemonic, HD derivation, JCS, ed25519 owner key, Verhoeff lifted from `test-area/` | All `shared/` unit tests pass with deterministic vectors |
| M3 | Backend skeleton | NestJS app, Drizzle migrations, `binding_audit_log` table with `audit_append` SP, healthz | Backend boots; migrations create all tables; smoke test posts and reads an alias |
| M4 | Extension shell | Manifest V3 build, popup + service worker, vault create/unlock | Vault round-trip survives extension reload; service worker restart test passes |
| M5 | Alias registration | Extension + backend flow B and C | A real alias is registered with a real owner key; ETH and SOL bindings recorded; audit log contains 3 entries (create, bind ETH, bind SOL) |
| M6 | TOFU resolution | Pin store in extension; verify path; rotation alert | Manual test: tamper with returned ownerPubkey in dev tools, extension refuses to proceed |
| M7 | Send by alias on Sepolia | Flow D end to end with viem; payment intent server signature; held-click approval | One real testnet ETH transfer from a newly created wallet to a registered alias, signed by the extension, broadcast via Sepolia, mined |
| M8 | Send by alias on Solana devnet | Flow D end to end with `@solana/web3.js` | One real devnet SOL transfer the same way |
| M9 | Test-area scripts and dependency audit | All four Phase 0 scripts plus Phase 1 additions: `verify_service_worker_restart.ts`, `verify_audit_chain_integrity.ts`, `verify_resolution_constant_time.ts` | All `test-area/` scripts run and pass |
| M10 | Final report | Summary, screenshots of approval screens, tx hashes, test outputs, known limits | Thomas reviews |

## 4. Phase 1 dependencies

Tooling pinned via `pnpm` lockfile. Versions are recorded in `package.json` at install time; the v1 baseline is what the public registry returns at install and is then frozen.

Allowlisted runtime packages (per ADR-008): `@scure/bip39`, `@scure/bip32`, `@noble/secp256k1`, `@noble/ed25519`, `@noble/hashes`, `viem`, `@solana/web3.js`, `react`, `react-dom`, `zod`, `tailwindcss`, `@nestjs/core`, `@nestjs/common`, `drizzle-orm`, `drizzle-kit`, `pg`, `ioredis`, `cookie`, `argon2-browser` (Argon2id in the extension; the backend uses a server-side equivalent only for password handling, not for wallet keys).

Anything else needs an ADR.

## 5. Verification during Phase 1

We do not claim a test passes without running it.

- `pnpm test` runs vitest in every workspace.
- `pnpm run test:scripts` runs every script in `test-area/` and writes the outputs to `test-area/results/`.
- `pnpm run audit` runs `pnpm audit --prod` and fails on high or critical.
- A `pnpm run check` script chains the above and is the gate for the M10 milestone.

For each Phase 1 milestone we record:
- The vitest output.
- The script output from `test-area/results/`.
- For M7 and M8 the actual transaction hash and the block it landed in.
- A screenshot of the approval screen for at least one signing event.

## 6. Phase 1 exit criteria

All of the following must hold before Phase 1 is declared done.

1. Keys never leave the client. Verified by:
   - Backend code review: no field, no log call, no schema column can hold key material.
   - `test-area/verify_no_secret_logging.ts` passes on the whole tree.
   - Manual mitmproxy or browser devtools trace of the registration and send flows shows no key material in transit.
2. Backend stores no secrets. Verified by:
   - Schema review.
   - `SELECT *` over each table in dev shows only public material plus rate-limit state.
3. Vault survives extension reload and service worker restart. Verified by `test-area/verify_service_worker_restart.ts` and a manual reload test.
4. NUMPAY ID checksum is Verhoeff and matches the deterministic vectors. Verified by `test-area/verify_numpay_id_checksum.ts`.
5. TOFU pinning works: tampering with the resolved ownerPubkey in a test fixture triggers the hard-stop warning and refuses to proceed.
6. Audit log integrity: deleting or mutating any row in `binding_audit_log` breaks the chain and is detected by `test-area/verify_audit_chain_integrity.ts`.
7. Real Sepolia testnet ETH transfer signed by the extension, broadcast, mined. Transaction hash recorded.
8. Real Solana devnet SOL transfer signed by the extension, broadcast, confirmed. Signature recorded.
9. Constant-time resolution responses: `test-area/verify_resolution_constant_time.ts` shows the response-time band stays within ±5 ms across known and unknown aliases.
10. The strict CSP from `SECURITY_REQUIREMENTS.md` section 2.1 is in place on the local dev server in report-only mode, with zero violations during the Phase 1 demo flows.

## 7. Out of scope for Phase 1

Documented here to avoid scope creep.

- Mainnet RPCs of any chain.
- Phase 2 chains (BTC, TRON, XRP).
- Tokens beyond native asset on Sepolia and Solana devnet.
- Custodial features.
- Fiat on-ramp or off-ramp.
- Swaps, bridges, yield.
- Hardware wallets.
- WalletConnect.
- Social recovery.
- Mobile.
- Phishing-domain feed.
- Browser-store publishing.
- Audit-log gossip and monitor (Phase 3).
- Reproducible builds and SBOM (Phase 3).

## 8. Risks and how Phase 1 handles them

| Risk | Mitigation in Phase 1 |
|---|---|
| Library API drift in `viem`, `@solana/web3.js`, `@scure/*`, `@noble/*` | Pull live docs at implementation time (`use context7`), not training memory. Pin versions in the lockfile. |
| Argon2id parameters too slow on low-end devices | Benchmark at vault create. If derivation exceeds 1.5s on the dev machine, document the parameter choice in `LOCAL_DEV_SETUP.md` and revisit. |
| Service worker idle-kill mid-signing | M4 includes the service worker restart test. Pending requests time out cleanly; nothing partial is stored. |
| RPC inconsistency on testnet | M7 and M8 require both RPC providers to be configured. Disagreement triggers a warning and a retry on the second provider. |
| Backend signing key handling in dev | Generate once, store in a `.env` file outside git. Document rotation. |
| Audit log inserts race | The `audit_append` stored procedure serialises inserts via row-level lock on the current tail. Tested in M5. |

## 9. Reporting at Phase 1 close

The final M10 report includes:
- Summary of what was built.
- All test outputs from `test-area/`.
- Sepolia tx hash and Solana devnet signature with explorer links.
- The signed approval-screen screenshot.
- Open items, including any new ADRs.
- Recommendation for Phase 2 entry.
