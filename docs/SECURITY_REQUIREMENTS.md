# NUMPAY Security Requirements

Status: ACTIVE.
Last updated: 2026-05-22.
Mode: CRITICAL_CODE.
Scope: applies to extension, web app, and backend across all phases. Some controls (CSP enforcement, supply-chain reproducible builds) ramp in by phase, noted inline.

This document encodes the OWASP API Top 10 baseline, the strict CSP, the "no secret logging" rule, and the extension hardening rules referenced by `THREAT_MODEL.md` and `ARCHITECTURE_DECISIONS.md`.

## TLDR

1. Strict CSP with no `unsafe-inline`, no `unsafe-eval`, with real `https://api.numpay.app` and `wss://api.numpay.app` placeholder hostnames. `.local` hostnames live only in `LOCAL_DEV_SETUP.md`.
2. Keys never leave the client. Backend rejects any payload that even looks like key material. A build-time grep test (`test-area/verify_no_secret_logging.ts`) enforces the logging side.
3. OWASP API Top 10 baseline mapped to concrete controls. Object-level auth on every user-owned resource. Rate limits per IP, per session, per alias, per endpoint.
4. Extension: Manifest V3, no `<all_urls>`, no remote scripts, no `eval`, content-script main-world boundary respected.
5. Production headers and CSP are tested in report-only first, then enforced. Headers below are the enforced target.

## 1. Cross-cutting requirements

### 1.1 Logging policy

- Structured logger only. Free-form `console.log` is banned in production code paths. eslint rule blocks it.
- Field allowlist on the logger. The set of allowed fields is: `timestamp`, `level`, `requestId`, `userId` (UUID, never an email), `aliasIdHash` (sha256 of the alias, not the alias itself), `chainId`, `endpoint`, `httpStatus`, `latencyMs`, `errorClass`, `errorMessage` (after redaction), `extensionVersion`. Anything else must be opted in via a documented exception.
- Denylist enforced at build time by `test-area/verify_no_secret_logging.ts`. The denylist of substrings in source code log calls includes `mnemonic`, `seedPhrase`, `seed_phrase`, `recoveryPhrase`, `recovery_phrase`, `privateKey`, `private_key`, `secretKey`, `secret_key`, `vaultPassword`, `vault_password`, `decryptedVault`, `derivedKey`. The test scans `.ts` and `.tsx` files under `extension/`, `backend/`, `web/`, and reports any line that calls `logger.*` or `console.*` and contains a denied substring.
- Redaction layer wraps any `Error` before it hits the logger. Stack frames are kept; argument values that match wallet-key shape (hex strings of length 64 or 128, base58 strings of length 32 to 44, BIP-39 word sequences of 12 or 24) are replaced with `[REDACTED]`.
- Errors returned to clients are generic. No internal stack frames over the wire.

### 1.2 No telemetry

Per ADR-011. No third-party SDK. No remote analytics. No crash reporter. No font CDN. No Google Tag Manager. No Mixpanel. No Sentry. Period.

### 1.3 Secrets handling

- All secrets in env files outside the repo. `.env.example` lists names only.
- No secret ever logged. See 1.1.
- Backend signing keys are loaded once at process start, kept in memory, scrubbed on shutdown. A `Buffer.fill(0)` step runs in the SIGTERM handler.
- Rotation procedure for the backend signing key is documented in this file's section 5.

### 1.4 Dependency hygiene

- All deps pinned in `package.json` (exact versions, no ranges) and `pnpm-lock.yaml` committed.
- `pnpm audit --prod` runs after every install. High and critical findings break the build unless waived in `docs/SECURITY_WAIVERS.md` with a reason and an expiry date.
- The crypto library allowlist is ADR-008. Adding to that list is a new ADR.
- `npm` is allowed only as the run-script binary; `pnpm` is the install path. Mixing lockfiles is banned.
- No installs from `git+https://...` URLs. No installs from custom registries.

## 2. Transport and HTTP-level controls

### 2.1 Production HTTP headers

All NUMPAY public origins enforce these headers in production. Headers are tested in report-only first, then flipped to enforce.

```
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=(), usb=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Content-Security-Policy:
  default-src 'none';
  base-uri 'none';
  object-src 'none';
  frame-ancestors 'none';
  script-src 'self' 'nonce-{RANDOM}';
  style-src 'self' 'nonce-{RANDOM}';
  img-src 'self' data:;
  font-src 'self';
  connect-src 'self' https://api.numpay.app wss://api.numpay.app
              https://sepolia.infura.io https://eth-sepolia.g.alchemy.com
              https://api.devnet.solana.com;
  form-action 'self';
  manifest-src 'self';
  upgrade-insecure-requests;
```

Notes.
- `https://api.numpay.app` and `wss://api.numpay.app` are placeholder production hostnames. Real production host is finalized before beta.
- The RPC allowlist in `connect-src` is the v1 testnet set. Each entry maps to an ADR-013 provider. Custom RPC URLs in production require explicit user opt-in inside the extension and a warning banner. No wildcard hosts.
- `.local` hostnames belong in `LOCAL_DEV_SETUP.md` only. They never appear in a production CSP.
- For dev and staging, the CSP report-only mode collects violations for one week before enforcement is enabled.

### 2.2 Cookies

- `__Host-` prefix on session cookies.
- `Secure; HttpOnly; SameSite=Strict; Path=/`.
- 30 minute idle timeout. 12 hour absolute timeout. Re-auth required after absolute timeout.

### 2.3 CSRF

- All state-changing endpoints require either a session cookie plus a double-submit CSRF token, or a bearer token. No CSRF cookie without a session bound to it.
- No state changes via `GET`. Enforced by lint rule on controllers.

### 2.4 CORS

- Strict allowlist. v1 dev allowlist is the local web app dev origin only. Production allowlist is the NUMPAY web app origin only. No wildcards.

### 2.5 TLS

- TLS 1.2 minimum, TLS 1.3 preferred. No client-side downgrade option.
- HSTS preload submission planned before beta.

## 3. API security baseline (OWASP API Top 10 mapping)

| OWASP API Top 10 (2023) | NUMPAY control | Test |
|---|---|---|
| API1 Broken Object Level Authorization | Every user-owned resource access requires `userId == session.userId`. Verified by request-scope `AuthorizationGuard` in NestJS. | Integration test `auth/object-level.spec.ts` covers each resource. |
| API2 Broken Authentication | WebAuthn or passkey for web account login. Vault password for the wallet. Session cookies as 2.2. No password resets that bypass the wallet. | Integration tests on login, session refresh, lockout. |
| API3 Broken Object Property Level Authorization | Zod schemas on every endpoint, request and response. Allowlisted fields per role. | Schema tests. |
| API4 Unrestricted Resource Consumption | Redis rate limits, see 4. Body size limits. Request count and request CPU budget per session. | Load test + abuse test in `test-area/`. |
| API5 Broken Function Level Authorization | Admin routes on a separate router with separate auth. RBAC table. | Test that non-admin sessions get 403 on every admin route. |
| API6 Unrestricted Access to Sensitive Business Flows | Payment intent creation is rate-limited by alias and by sender. Resolution endpoint is rate-limited per IP, per session, and per alias-pair. | Abuse test in `test-area/`. |
| API7 Server Side Request Forgery | No URL fetched from user input. RPC URLs come from a static allowlist (ADR-013). | Static analysis. |
| API8 Security Misconfiguration | Headers as 2.1. Default deny CORS. CSP enforced after report-only. | Header check in CI. |
| API9 Improper Inventory Management | OpenAPI spec generated from Nest controllers. Every deployed environment publishes its `/healthz` and `/version`. | CI step asserts spec is in sync. |
| API10 Unsafe Consumption of APIs | External calls (RPC) wrapped in a typed client with timeouts, retries with jitter, and structural response validation. | Unit tests on the RPC client. |

### 3.1 Authorization details

- Session is server-side only. JWTs are not used as session.
- Per-alias write authorization: only the user that owns the alias can create new bindings, rotate the owner key, or revoke a binding. Object-level check on every mutation.
- Server-side validation of every public field. Length limits, character allowlists.
- Idempotency keys on payment intent creation. Replay returns the same intent.
- Replay protection on every signed payload by `nonce` and `expires_at`.

### 3.2 Audit log endpoints

- The audit log is append-only. There is no API to delete or rewrite entries.
- Read endpoints expose the audit chain for a given alias and for the current head. They never expose other users' payloads.

## 4. Rate limits and abuse controls

Redis-backed token-bucket per key.

| Key | Limit | Burst | Notes |
|---|---|---|---|
| `ip:{ip}` | 60 req/min | 30 | Rough sanity. |
| `session:{sid}` | 120 req/min | 60 | Per authenticated session. |
| `resolve:{alias}:{ip}` | 10 req/min | 5 | Per (alias, IP) pair to limit enumeration per IP. |
| `resolve:{alias}` | 60 req/min | 30 | Global per-alias resolution limit. |
| `intent_create:{senderUserId}` | 30 req/min | 15 | Per sender. |
| `intent_create:{aliasId}` | 60 req/min | 30 | Per recipient. |
| `login:{userIdOrEmail}` | 5 req/15min | 5 | Hard lockout on exceed. |
| `binding_change:{aliasId}` | 5 req/hour | 5 | Slow-write protection. |
| `audit_read:{ip}` | 30 req/min | 15 | Audit log reads. |

All responses use a constant-shape error body: `{ "error": "code", "requestId": "uuid" }`. Codes are coarse: `rate_limited`, `not_found`, `invalid_request`, `unauthorized`, `server_error`. The body shape never reveals whether an alias exists, succeeded, or failed for permission reasons.

### 4.1 Enumeration resistance

- Resolution responses are constant-time within a 50ms window. The handler computes the response then waits to the next 50ms tick.
- Unknown aliases return `not_found` after the same wait. Known aliases return `not_found` if not authorised for the requester. The error code is identical.
- No `HEAD` shortcut. No length-based side channel: response bodies are padded to a fixed length for resolution endpoints.
- No bulk lookup endpoint. No "find by display name" endpoint. Display names are returned only after a valid resolution, never enumerated.

## 5. Cryptographic and key handling controls

### 5.1 Client-side key handling

- Mnemonic generated using `@scure/bip39` with `crypto.getRandomValues`. 12 words (128 bits entropy) for v1.
- HD derivation via `@scure/bip32` for secp256k1 paths. Ed25519 derivation for Solana using `@noble/ed25519` and standard Solana paths.
- Vault wrap. Master key derived from the user password using Argon2id with parameters `m=65536 KiB, t=3, p=1` on desktop. Salt is 16 random bytes per vault, stored alongside the ciphertext. AES-256-GCM with a 96-bit IV (random per write) wraps the mnemonic and per-account secrets.
- Vault stored in `chrome.storage.local` for the extension. Format is JSON with base64 ciphertext fields. No private key bytes are ever stored unencrypted at rest.
- Decryption happens only inside the background service worker. Popups talk to the worker via `chrome.runtime.connect`. Decrypted material is held only as long as needed for one signing op.
- After signing, decrypted buffers are scrubbed with `crypto.subtle.exportKey` deletions and explicit `Uint8Array.fill(0)` where applicable.

### 5.2 Owner signing key per alias (ADR-009)

- ed25519 keypair generated on the client when the alias is registered. Stored in the vault alongside chain keys.
- The public key is the alias's root of trust. The audit log records the active key and all rotation events.

### 5.3 Backend signing key for payment intents

- ed25519 long-term key. Loaded once at process start. Kept in memory. Public key pinned in the extension build at release time.
- Rotation procedure: introduce a new key, sign intents with both keys for a transition window, the extension build accepts both keys for that window, then drop the old key in the next extension release. Documented in `LOCAL_DEV_SETUP.md` for dev rotations and in this file for prod rotations.

### 5.4 Forbidden patterns

- No `Math.random` for any security purpose.
- No password-as-key. The vault KEK comes from Argon2id over the password.
- No homemade KDF. No homemade authenticated encryption.
- No reuse of a chain account key as the owner signing key.

## 6. Extension hardening

### 6.1 Manifest V3

- `manifest_version: 3`.
- `permissions`: minimal. Initial set: `storage`. Add only with documented reason.
- `host_permissions`: explicit per-domain entries for the NUMPAY backend and the configured dApp connect surfaces. No `<all_urls>`.
- `content_scripts`: isolated world by default. The main-world provider shim is injected via `world: "MAIN"` with a single small script that posts messages via `window.postMessage` with a channel id.
- `web_accessible_resources`: only the provider shim file, scoped to the matching origin.
- `content_security_policy.extension_pages`: `script-src 'self'; object-src 'self'; style-src 'self'`.
- No `executeScript` with a string. Only function or file targets.

### 6.2 Message validation

- Every message between page, content script, background, and popup is validated with Zod.
- Origin is taken from the extension API (`sender.origin`, `sender.url`), never from the message payload itself.
- Per-page channel id is a random 128-bit value generated by the content script at injection time and shared with the main-world shim only.
- Request IDs are uuid v4. Responses are routed by request ID. Lost responses time out and are not retried automatically.

### 6.3 Approval UI

- All signing approval happens in the extension chrome (popup or fullscreen view). The approval UI is the only thing that can call the signing functions.
- Approval views re-read the request from the background worker right before signing. They do not trust state from the page.
- Held-click required for any signature on an unlimited approve or a contract method we cannot decode.

### 6.4 Service worker lifecycle

- All state needed to resume a flow is persisted in `chrome.storage.local` (encrypted where sensitive).
- Service worker boot rehydrates state. Tests in Phase 1 (`verify_service_worker_restart.ts`) restart the worker mid-flow and assert recovery is safe.
- Idle timeouts on pending signing requests.

## 7. Build, supply chain, release

### 7.1 v1 PoC

- Local builds only. Loaded unpacked in dev mode.
- pnpm lockfile committed. `pnpm install --frozen-lockfile` in CI.
- `pnpm audit` runs in pre-commit, and gate-tests run in `test-area/`.

### 7.2 Phase 3 ramp

- Reproducible build target. Pinned node version. Pinned pnpm version. Deterministic builds documented.
- Release signing for extension store releases.
- SBOM generation per release.

## 8. Operations

### 8.1 Backup and recovery

- Postgres PITR. Point-in-time recovery to within 5 minutes. Tested quarterly once we have any non-test data.
- Audit log table is included in PITR and additionally exported nightly to write-once storage (Phase 3).

### 8.2 Incident response

- Out of scope for v1 PoC as a fully written playbook. The shape is: a single on-call channel, an incident commander rotation, post-incident review template. Before beta we ship the full playbook.

### 8.3 Patch policy

- High and critical CVEs in deployed dependencies are patched within 7 days. A documented exception process is required to delay.

## 9. References

Verified primary sources.

- OWASP API Security Top 10. https://owasp.org/API-Security/
- OWASP Secure Headers. https://owasp.org/www-project-secure-headers/
- OWASP Clickjacking Defense Cheat Sheet. https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html
- OWASP CSRF Prevention Cheat Sheet. https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- MDN CSP. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy
- MDN CSP connect-src. https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src
- Chrome extensions content scripts. https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- Chrome extensions Manifest V3 reference. https://developer.chrome.com/docs/extensions/reference/manifest
- WebAuthn Level 3. https://w3c.github.io/webauthn/
- RFC 8785 JSON canonicalisation. https://www.rfc-editor.org/rfc/rfc8785
