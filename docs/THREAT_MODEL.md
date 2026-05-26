# NUMPAY Threat Model v1

Status: ACTIVE. PoC scope.
Date: 2026-05-22.
Mode: CRITICAL_CODE.
Scope: Phase 1 PoC. Extension-first non-custodial wallet on Sepolia (ETH testnet) and Solana devnet.

## TLDR

1. NUMPAY is non-custodial. Private keys never touch the backend, ever. The 11-digit ID is a public alias, not a secret.
2. The hardest threat is not key theft. It is alias poisoning by a compromised backend. The handoff calls the backend untrusted but then relies on it to vouch for binding integrity. That is the gap this document resolves.
3. Independent integrity anchor for v1: trust-on-first-use (TOFU) client-side pinning of each alias to the alias owner's signing key, combined with a tamper-evident append-only audit log of all binding changes. Documented limits in section 5.
4. v1 PoC builds TOFU pinning fully. The audit log is built as a hash-chained append-only structure in Postgres for Phase 1, with monitor and gossip out of scope until Phase 3. Section 5 lists the residual risk and why we accept it for testnet PoC.
5. The 16 high-priority threats from the handoff are mapped to concrete mitigations in section 4. Section 6 lists what is explicitly out of scope for v1.

## 1. Assets

Ranked by value to the attacker.

| Asset | Where it lives | Loss = | Confidentiality | Integrity | Availability |
|---|---|---|---|---|---|
| User mnemonic / private keys | Local encrypted vault (IndexedDB, WebCrypto-wrapped) | Full custody loss | Critical | Critical | High |
| Alias to address bindings | Postgres (server) + pinned cache (client) | Funds redirected to attacker | High | Critical | Medium |
| Owner pubkey per alias | Postgres + pinned cache (client) | Root of trust for that alias | Medium | Critical | Medium |
| Payment intents | Postgres + signed payload | Funds redirected, replay | Medium | Critical | Medium |
| Audit log | Postgres append-only table + periodic signed roots | Tamper detection breaks | Medium | Critical | High |
| User session token | httpOnly+SameSite cookie | Account takeover (no custody) | High | High | Medium |
| Vault password | User memory only | Brute force of vault | Critical | n/a | n/a |
| RPC provider keys | Backend env / client env | Quota theft, censorship | Medium | Low | Medium |

## 2. Actors

| Actor | Capability | Motivation |
|---|---|---|
| Remote attacker on public internet | Standard web attacks: phishing, XSS payloads, replay, enumeration, DoS | Theft, sale of data, vandalism |
| Malicious dApp | Can request signatures from the wallet via provider API | Drain accounts via approve, signTypedData, malicious tx |
| Compromised backend (insider, supply-chain, RCE) | Can read all Postgres rows, sign new payment intents, return any alias binding it wants | Targeted theft, mass redirect |
| Compromised RPC provider | Can lie about chain state, drop or delay broadcasts, censor by sender | Censorship, double-spend race, balance lies |
| Malicious browser extension installed alongside NUMPAY | Can read DOM, intercept clipboard, observe page-context messages | Clipboard hijacking, screen scrape |
| Network attacker (cafe wifi, hostile ISP, malicious VPN) | TLS-protected paths are safe, but DNS, captive portals, and downgrade attempts are possible | Phishing redirect, downgrade |
| Hostile mainnet contract or program | Can be called by a tricked user, can drain via unbounded approve | Theft |
| Local malware on user device | Game over for that user, but should not affect other users | Theft, lateral compromise |

Out-of-scope actors for v1 PoC: nation-state attackers with cryptographic capabilities beyond current best practice, attackers with physical access to the user's unlocked device.

## 3. Trust zones

From most trusted to least.

1. User memory and biometrics. Trusted.
2. Local encrypted vault on the user's device. High sensitivity. Decrypted only inside the extension service worker after the user enters the password.
3. Extension service worker (background). Trusted controller. Holds decrypted keys only in memory and only as long as needed for one signing operation.
4. Extension popup / fullscreen approval UI. Trusted UI for showing what is about to be signed.
5. Extension content script. Semi-trusted bridge. Validates origin, validates message shape, never sees keys.
6. Page context (the dApp). Untrusted. Treated as adversarial.
7. NUMPAY web app (dashboard). Untrusted runtime for key purposes. Can be useful for non-signing flows. Never receives keys.
8. NUMPAY backend. Untrusted for custody. Trusted only to "publish a value" that the client then verifies with its own pinned anchor. See section 5.
9. RPC providers. Untrusted data source. Always cross-check critical reads where feasible.

## 4. Threats and mitigations

### 4.1 Private key exfiltration. Critical.

Vectors. Backend code accidentally receives key material. Logger writes a sensitive variable. Crash reporter captures memory. Extension main-world script reads from popup context. Page can talk to popup directly. Mnemonic preview screen gets screenshotted into a sync service.

Mitigations.
- Keys generated client-side. Never serialized over the wire. Never sent to backend. Backend has no field that could hold them, and the schema is enforced.
- Encrypted vault stored in IndexedDB inside the extension only. Web app has no vault.
- WebCrypto for key wrapping. Argon2id for the password-derived KEK (target 64 MB, 3 iterations, 1 lane on desktop, tuneable per platform).
- Decryption happens only in the background service worker. Popup requests "sign this", worker decrypts, signs, returns signature, scrubs in-memory keys.
- Strict CSP in web app and extension. No `unsafe-inline`. No `eval`. No remotely hosted scripts. No `<all_urls>`.
- Logging policy: structured logger with field allowlist, plus a build-time check (test-area/verify_no_secret_logging.ts) that fails on any string containing mnemonic, seed, privateKey, secretKey, recoveryPhrase, vaultPassword in source.
- Crash reporting in v1: off. No third-party telemetry. Phase 3 may introduce a redaction layer.
- Recovery phrase preview screen has explicit "do not screenshot" warning and avoids being indexed by clipboard-sync or screen-record services where the platform exposes that hint.

### 4.2 Alias poisoning by a compromised backend. Critical. This is the gap.

The handoff says: backend is untrusted, but the alias-to-address binding is signed by the alias owner's key at registration and the payment intent is signed by the server. Therefore tampering is detectable.

The problem.
- The alias owner's key is generated client-side. When the user registers numpay_id=12345678903 with their wallet, they sign a binding challenge with that wallet key. The backend stores `{alias, ownerPubkey, address, bindingSignature}`. So far, integrity is real.
- But the sender (the person paying that NUMPAY ID) has never met the alias owner's key. The sender just asks the backend "who is 12345678903?". A compromised backend can answer with any binding it likes, signed by any key it likes, and the sender has no anchor to detect the swap. The "signed binding" only proves "someone with this key signed this address". It does not prove "this someone is the same key that signed the binding the alias owner created."
- The server signature on the payment intent does not fix this either. A compromised server signs whatever it wants.

This is the same shape as TLS without certificate transparency: a signature is meaningful only relative to a trusted root.

Resolution. Independent integrity anchor.

The client (sender's wallet) must pin an anchor that the backend cannot rewrite. We considered four options:

| Option | Anchor | Pros | Cons | Decision |
|---|---|---|---|---|
| A. TOFU client-side pinning | First seen `{alias → ownerPubkey}` cached locally and re-verified on every later resolution | Simple, no extra infra, mirrors SSH and Signal "safety number" patterns | Vulnerable on the very first resolution. Selective attack possible. Recovery from a stolen owner key is hard. | Yes for v1 |
| B. Tamper-evident append-only audit log | Server publishes a signed Merkle root of all binding changes. Clients verify their pin is in the log and that the log is monotonic. Gossip catches a server that lies about the root | Detects selective and retroactive tampering | Needs gossip and monitors to catch a forking server. Useful even alone for incident response | Yes for v1, log structure only. Gossip and monitor deferred to Phase 3 |
| C. Blockchain-anchored bindings (ENS-style) | Binding published in a smart contract | Strongest integrity, no separate trust root | Gas costs per binding. Cross-chain story. Heavy infra for "free 11-digit alias" UX | No for v1. Re-evaluate at Phase 4 |
| D. Out-of-band fingerprint confirmation | Sender confirms a short "safety number" with the recipient by another channel | Strong if users do it | Users do not do it. Useful as a deliberate "verify identity" affordance, not a default control | Optional UI feature in Phase 2 |

Adopted: A + B.

Concrete v1 protocol.

Registration (owner side).
1. Wallet generates an `ownerSigningKey` for this alias (separate from any chain account key; see section 4.7 for the curve choice).
2. Wallet signs `BindingV1{ alias, chainId, address, ownerPubkey, issuedAt, nonce }` using `ownerSigningKey`.
3. Wallet POSTs the binding plus signature to the backend over TLS, authenticated by the user's session.
4. Backend stores the row and writes one entry into `binding_audit_log` as `{ prevHash, op: "create", payload: <binding>, payloadHash, ts }`. The append-only table has `prevHash = hash(prev row payload)` to chain entries.
5. Backend returns the stored row plus the audit log position. The client receives nothing it could not have computed itself.

Resolution (sender side, first time for this alias).
1. Client requests `GET /resolve/{alias}?chain={chainId}`.
2. Backend returns `{ alias, ownerPubkey, address, bindingSignature, auditPosition, auditPrevHash }`.
3. Client verifies `bindingSignature` against `ownerPubkey` over the canonical binding payload.
4. Client pins `{ alias → ownerPubkey, firstSeen, auditPosition, originalBindingHash }` in extension local storage (not in the page DOM).
5. Client proceeds with the payment intent flow.

Resolution (sender side, later times).
1. Client requests `GET /resolve/{alias}?chain={chainId}`.
2. Client checks the returned `ownerPubkey` is identical to the pinned `ownerPubkey`. If not, refuse and show a hard-stop warning: "This NUMPAY ID is now signed by a different key. This is either a key rotation by the owner or an attack. Do not pay until you verify out of band." No "continue anyway" button on the default path. A "rotate trust" flow exists but requires extra friction.
3. Client checks the new `bindingSignature` verifies against the pinned `ownerPubkey`.
4. Client checks `auditPosition` is greater than the previously seen one for this alias.

Owner-initiated rotation (legitimate).
- Owner explicitly rotates from inside their own wallet. The rotation transaction is signed by the old `ownerSigningKey`, attests the new `ownerSigningKey`, and lands in the audit log as `op: "rotate"`. Senders' clients, when they see the new key, look back in the audit log for a rotate entry signed by the old key. If they find one and it verifies, they update the pin. If not, the hard-stop warning fires.

Owner key loss.
- If the owner loses `ownerSigningKey`, the alias is effectively bricked. They can register a new alias under a new key. There is no admin recovery path in v1. This is consistent with self-custody. Documented in `ARCHITECTURE_DECISIONS.md` as an accepted tradeoff. Phase 3 may introduce social recovery for the binding key only (not for chain keys).

Audit log shape.
- Table `binding_audit_log` with columns: `position bigint primary key`, `prev_hash bytea`, `payload_hash bytea`, `payload jsonb`, `op text`, `ts timestamptz`.
- `payload_hash = sha256(canonical_json(payload))`.
- `prev_hash` of row N equals `payload_hash` of row N minus 1. Row 0 has zero prev_hash.
- Insertion is via stored procedure inside a transaction that asserts prev_hash matches the current tail. Concurrent writes serialize.
- Phase 1: backend publishes the current `(position, payload_hash)` head on every read. Clients can verify their own row is reachable from the head by walking the chain in O(1) per check (we return the chain segment between their last seen and the new head when small).
- Phase 3: backend signs a head every minute with a long-term audit signing key, publishes signed heads to a public location, and a monitor process gossips them between independent observers. Until then, a compromised backend can rewrite history without detection. This is the known limit of the v1 PoC.

### 4.3 Address substitution. Critical.

Cases.
- Sender pastes a chain address that was clipboard-swapped by malware.
- Backend returns a poisoned address (4.2).
- A malicious sender app fills the recipient field after the user reviewed it (TOCTOU on the approval screen).

Mitigations.
- Approval screen is the trusted UI inside the extension. The address shown there is the address that the signer will sign. The popup re-reads the request from the worker right before signing, never from the calling page.
- Clipboard-pasted addresses get a contrasting "address book?" prompt if we have a saved label, and a clear "Unknown address" badge otherwise. The full address is shown, not truncated, on the approval screen.
- Address format detection per chain. Mismatched address+network forces re-selection.
- NUMPAY ID resolution flows always go through 4.2.
- For BTC and XRP and other chains with destination tags or change outputs, the warning rules in `CHAIN_SUPPORT_MATRIX.md` apply.

### 4.4 Malicious dApp signing. Critical.

Vectors.
- dApp asks for `eth_sign` or `personal_sign` of arbitrary bytes.
- dApp asks for `signTypedData` with a payload that the user cannot read.
- dApp asks for `approve(spender, type(uint256).max)` to drain a token.
- dApp uses confusing UI to make the user click approve fast.

Mitigations.
- Provider only exposes EIP-1193 plus the explicit Solana methods we whitelist. No legacy `eth_sign` of arbitrary bytes. `personal_sign` allowed only with a clearly displayed prefixed message.
- `signTypedData` is decoded and rendered field by field. Unknown domain hashes get a warning.
- ERC-20 `approve` is decoded. Unlimited approvals (type(uint256).max) get a red banner and require a held click. Default replacement: exact-amount approve.
- Permit2 and other unbounded permit patterns get the same treatment.
- Per-origin permissions stored in extension. First connection always shows origin and chain. No silent reconnect.
- Origin validation on every message. The content script tags messages with the page origin from the extension API, not from the message itself.
- Phase 3: transaction simulation through eth_call and Solana RPC simulate, decode balance changes, warn on unknown program IDs.

### 4.5 Extension injection bugs. Critical.

Vectors.
- Main-world script can be hooked by the page.
- Content script trusts messages from the page without origin checks.
- Background sends responses back to the wrong tab.

Mitigations.
- Manifest V3. Minimal permissions. No `<all_urls>`. Host permissions only for the dApp connect flow and the NUMPAY backend domain.
- Main-world code is only the EIP-1193 / Solana provider shim. No private key material in main-world ever. The shim posts requests to the content script via `window.postMessage` with a per-page random channel id. Content script accepts only messages with the right channel id and the right window.origin.
- Content script forwards to background using `chrome.runtime` ports with explicit message schemas validated by Zod.
- Every request has a uuid. Responses are routed by uuid. Lost responses time out and are not retried automatically.
- Service worker lifecycle: explicit state hydration on every wake. No assumption that variables persist. A boot test (`verify_service_worker_restart.ts` in Phase 1) restarts the worker mid-flow and asserts the flow recovers safely.
- Static analysis: eslint plugins for extension security, no `innerHTML` on user input, no `new Function`.

### 4.6 Supply-chain compromise. Critical.

Vectors.
- A dependency ships a malicious update.
- A typosquatted dependency.
- Build pipeline gets a backdoored tool.

Mitigations.
- Pinned versions in `package.json` and a real `pnpm-lock.yaml` committed.
- `pnpm audit` and `npm audit` run after every install. Build fails on high or critical findings unless explicitly waived in a file.
- Dependency allowlist for crypto packages. Initial allowlist: `viem`, `@solana/web3.js`, `@scure/bip39`, `@scure/bip32`, `@noble/secp256k1`, `@noble/ed25519`, `@noble/hashes`. Adding to this list is a documented decision.
- No installs from git URLs or from arbitrary registries.
- Reproducible build target for Phase 3 (out of scope for v1).
- Extension store release signing is mandatory before any alpha distribution. Out of scope for v1 PoC since v1 is loaded unpacked in dev mode only.

### 4.7 Cryptographic choices.

Curves and primitives.
- Mnemonic: BIP-39, 12 words (128 bits entropy), generated by `@scure/bip39` using `crypto.getRandomValues`.
- HD derivation: BIP-32 via `@scure/bip32` for secp256k1 paths, `@scure/ed25519` style derivation for Solana.
- ETH signing: secp256k1 via `@noble/secp256k1`, called through `viem` where reasonable.
- SOL signing: ed25519 via `@noble/ed25519` and `@solana/web3.js`.
- Vault wrapping: AES-256-GCM via WebCrypto. KEK from Argon2id over the user password (`@noble/hashes` argon2id).
- Owner signing key per alias: ed25519 (small, fast, ed25519 signature scheme is misuse-resistant and matches the SOL key model we already need). Generated separately from any chain account key.
- Audit log canonicalisation: JCS (RFC 8785) for deterministic JSON, then sha256.
- Random: `crypto.getRandomValues` only. No `Math.random` for any security purpose.

Mixing rule. We do not roll our own combination of low-level primitives. For every chain there is one library that owns signing, and one library that owns key derivation, and they are pinned.

### 4.8 Lower-priority threats handled but not deep here.

| Threat | Primary mitigation | Location |
|---|---|---|
| Seed phrase phishing | "Never paste your seed phrase anywhere except this exact screen" UI, never request seed after setup, domain education | UX + extension popup |
| Clickjacking | CSP frame-ancestors none, X-Frame-Options DENY, signing UI lives only in extension chrome | SECURITY_REQUIREMENTS.md |
| XSS in web app | Strict CSP, no inline JS or CSS, output encoding by framework, no key access in web app | SECURITY_REQUIREMENTS.md |
| CSRF | SameSite=Strict cookies, CSRF tokens on state-changing endpoints, origin checks, no state changes via GET | SECURITY_REQUIREMENTS.md |
| API enumeration of aliases | Redis rate limits per IP, per session, per alias. Generic error responses. No "exists" or "does not exist" leak. Constant-time response shape. | SECURITY_REQUIREMENTS.md |
| RPC provider manipulation | At least two RPC providers per chain in v1 with simple "do they agree on the latest block" sanity check. Fallback ordering documented | CHAIN_SUPPORT_MATRIX.md |
| Clipboard hijacking | Address book confirmation, full address displayed, paste-from-clipboard flagged | UX |
| Log leakage | Field allowlist logger, build-time grep test in test-area | SECURITY_REQUIREMENTS.md, test-area/verify_no_secret_logging.ts |
| Regulatory scope creep | v1 stays non-custodial. No fiat. No swaps. No yield. Decision logged in ARCHITECTURE_DECISIONS.md | ARCHITECTURE_DECISIONS.md |
| Malicious extension update | Release signing, reproducible build (Phase 3), minimal permissions, manifest review checklist | Phase 3 |

## 5. Residual risk for v1 PoC

We accept the following residual risk for the Phase 1 PoC on testnet only.

1. First-time resolution of an alias by a sender is vulnerable to a compromised backend. The sender has no anchor yet. Mitigation: testnet PoC, no real funds. After Phase 3 the published audit log heads close this window for any client that has ever seen one head.
2. The backend can fork: serve real bindings to most clients while serving poisoned bindings to a target client, including showing different audit log states. v1 does not gossip log heads, so this is undetectable inside the protocol. Mitigation: testnet only. Phase 3 brings monitor + gossip.
3. An attacker who compromises a user's device wins for that user. Mitigations are about reducing how easy that compromise is (locked vault, minimal extension permissions, no remote scripts), not about surviving it.
4. A user who loses the `ownerSigningKey` for their alias loses control of that alias forever in v1. They can register a new alias under a new key.
5. RPC provider agreement is a weak sanity check. A skilled attacker controlling all configured RPC endpoints could lie consistently. Mitigation: at least two independent providers, plus user-visible "RPC source" indicator.

## 6. Out of scope for v1

- Phishing-domain detection feed.
- Hardware wallet integration.
- Social recovery.
- Multi-sig for end users.
- Mobile app.
- Custodial features. Permanent.
- Fiat on-ramp or off-ramp. Permanent for v1 product line.
- Swaps and bridges. Phase 4 at earliest.
- BTC, TRON, XRP. Phase 2.

## 7. References

Verified primary sources.

- BIP-39 mnemonic phrase. https://bips.dev/39
- BIP-32 hierarchical deterministic wallets. https://bips.dev/32
- CAIP-2 blockchain identifiers. https://chainagnostic.org/CAIPs/caip-2
- CAIP-10 account identifiers. https://chainagnostic.org/CAIPs/caip-10
- EIP-1193 Ethereum provider API. https://eips.ethereum.org/EIPS/eip-1193
- EIP-6963 multi-injected provider discovery. https://eip.info/eip/6963
- RFC 8785 JSON canonicalisation. https://www.rfc-editor.org/rfc/rfc8785
- OWASP API Security Top 10. https://owasp.org/API-Security/
- OWASP Secure Headers. https://owasp.org/www-project-secure-headers/
- Chrome extension content scripts. https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- WalletRadar wallet extension survey. https://arxiv.org/abs/2405.04332
- WalletProbe wallet extension survey. https://arxiv.org/abs/2504.11735

Document status. Active. Re-review at the end of Phase 1 and again before any mainnet work.
