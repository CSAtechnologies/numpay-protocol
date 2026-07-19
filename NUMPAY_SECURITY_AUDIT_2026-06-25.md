# NumPay Security Audit

Date: 2026-06-25
Branch: `feat/dapp-connect`
Auditor pass: independent white-box re-review of the wallet extension, with local build/test runs and dependency advisory checks.

## Scope and method

This pass focused on the `NumPay/wallet-extension` code, which is what the current branch touches. I read the security-critical modules directly (vault/crypto, BPAN resolution, dApp router and content bridge, swap guards, transaction decoders, address validation, storage, manifest), confirmed each finding against current `file:line`, and ran the project's own test and build commands plus a production dependency audit.

What I did this session:

| Check | Result |
| --- | --- |
| `npm test` (address vectors) | Pass, 33/33 |
| `npm test` (dApp adversarial suite) | Pass, 71/71 |
| `npm run build` (tsc + 3 vite builds) | Pass, no type errors |
| `npm audit --omit=dev` | 4 advisories (1 high, 3 moderate) |
| Vault/crypto read-through | Argon2id + AES-256-GCM confirmed |
| dApp router / bridge read-through | Origin stamping + connect/sign binding confirmed |
| Presence of `BPAN/contracts/.env` | Present (636 bytes), gitignored |

What I did NOT re-verify this session (carried forward from the 2026-06-24 total audit, unchanged on this branch): live mainnet contract bytecode comparison, the resolver-node reorg behavior, and the legacy API/SDK resolution paths. Those findings are repeated below and labelled `[not re-verified this pass]`. Treat them as open until independently retested.

No transactions were signed or broadcast. No live-chain writes were made.

## Result summary

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 7 |
| Medium | 8 |
| Low | 4 |
| Informational | 1 |

Overall: **the extension is well-architected and several controls are genuinely strong, but it is not yet hardened custody software.** The dominant risk is that funds-determining data (aggregator calldata, BPAN resolution, Solana dApp transactions) is approved without being fully decoded and bound to what the user was shown. A live deployer key sitting in the workspace and a post-lock in-memory key window compound this.

## Strong controls confirmed this pass

These are real and verified in current code, not assumed:

- Vault encryption is AES-256-GCM with an Argon2id KDF (`m=19456, t=2, p=1`), with transparent lazy upgrade of legacy PBKDF2 vaults on unlock (`lib/wallet.ts:23,96-105,259-267`).
- Only the active wallet is decrypted into session; blast radius is one wallet's keys at a time (`unlockActiveVault`, `lib/wallet.ts:239-271`).
- Decrypted material lives only in `chrome.storage.session` (in-memory), never on disk (`lib/storage.ts:30-59`).
- Lock is enforced on a value, not a flag: absence of a session means locked, and the inactivity window is re-checked on every `isLocked()` call so a suspended worker timer cannot leave it unlocked (`lib/wallet.ts:358-367`).
- The content bridge stamps the real page origin and never trusts an origin asserted in a page message (`content/bridge.ts:87-102`, `background/dappRouter.ts:753-757`).
- dApp signing/sending is re-bound to the connected account at request time, and a `from`/address mismatch is rejected rather than silently signed (`dappRouter.ts:453-459,506-512`).
- EVM swaps check chain id, enforce exact native value, gate approvals/targets to known aggregator addresses, require contract code, and simulate before send (`lib/swapGuards.ts`, `pages/Swap.tsx:791,868-934,947-992`).
- Solana transfers and dApp transactions bind the fee payer to the connected wallet before signing and simulate before broadcast (`lib/chains/solana.ts:595-631,680-711`).
- Non-EVM address validation decodes and checksums rather than regex-matching (`lib/addressValidation.ts`).
- Per-origin single-approval-window cap blocks popup-spam DoS (`dappRouter.ts:204-241`).

## High-severity findings

### H-01. Aggregator swap/bridge transactions are not bound to the displayed intent

`lib/swapGuards.ts`, `pages/Swap.tsx:868-934,947-992`

The guards confirm chain id, trusted spender/router, native value, contract code, and that the transaction does not revert. They do not decode the router calldata to verify the funds-determining fields: input token, output token, exact input amount, minimum output, output recipient, and refund recipient. A compromised ParaSwap/KyberSwap/LI.FI response can use a trusted router and simulate successfully while routing output to an attacker. The exact-allowance control caps the loss at the swap amount but does not prevent it.

Fix: decode each supported router's calldata locally, verify the full intent before signing, and compare independent simulation balance deltas against the expected input/output/recipient. Fail closed on unknown route formats.

### H-02. BPAN resolution fails open on a single non-empty response

`lib/bpan.ts:165-223`, `pages/Send.tsx`

`resolveBPANChecked` only treats two *different* non-empty addresses as a hard conflict (`BPANConsensusError`). A single non-empty response returns `confidence: "low"` and the Send page still permits payment after a caution. An empty-vs-non-empty disagreement is also not a hard failure. Under a provider outage, one malicious or stale RPC can therefore become the only payable address, which contradicts the stated invariant that no single provider can determine a destination.

Fix: require at least two independent providers to return the same non-empty address before Send is enabled; treat empty/non-empty disagreement as a hard failure; require quorum even for "no mapping"; do not surface a low-confidence address as a send target.

### H-03. A changed BPAN trust pin is auto-accepted after one warning

`lib/bpan.ts:205-220`

When a high-confidence mapping differs from the stored pin, the code sets `changed = true` and immediately overwrites the pin (`if (confidence === "high" && (!pinnedBefore || changed)) setItem(...)`). The next lookup sees the new address as already trusted, so the change warning is effectively one-shot: closing and reopening the flow clears it without explicit acknowledgement.

Fix: keep the old pin until the user explicitly accepts the new mapping; store changed mappings as pending; require the user to review full old/new addresses and confirm out-of-band; record the acknowledgement.

### H-04. Solana dApp transaction approvals are economically opaque

`lib/chains/solana.ts:490-561,595-631`, `lib/dapp/solDecode.ts`, `approval/main.tsx`

`inspectSolanaTransaction` surfaces fee payer, invoked programs, lookup-table usage, and instruction count, and `simulateSolanaTx` checks for revert. Nothing decodes the economic effect: assets leaving the wallet, amounts, destination accounts, token approvals/delegates, or resolved lookup-table accounts. `solDecode.ts` only handles `signMessage` payloads, not transactions. A drainer transaction is expected to simulate successfully, so "simulation passed" is not a safety signal here.

Fix: resolve v0 address lookup tables; decode System / SPL Token / Token-2022 / ATA / Compute Budget and common DeFi instructions; display simulated balance and token-account deltas; hard-warn or reject unknown programs and unresolved account sets.

### H-05. The live registry owner key is stored in the workspace

`BPAN/contracts/.env` (confirmed present this pass, 636 bytes)

The gitignored deployer key derives to the live Ethereum mainnet registry owner (`0xd7f8A3B876f774e1344b2658F7c3D6B1d087F96e` per the prior pass). `.gitignore` prevents an accidental commit but does nothing against backups, cloud sync, malware, screenshots, or workspace archives. A single host compromise hands an attacker registry ownership.

Fix: transfer contract ownership to a hardware-backed multisig, remove the key from the project directory, rotate provider credentials if the workspace was ever synced or shared, and add secret scanning to CI and a local pre-commit hook.

### H-06. Auto-lock leaves signing authority in the open popup, and BPAN writes skip the lock check

`lib/wallet.ts:344-367`, `popup/App.tsx:54-84`, `pages/BPANPage.tsx`

Lock clears `chrome.storage.session`, but an open popup still holds `WalletData`, derived non-EVM keys, and private keys in React state; the popup only notices the lock on a 60-second interval (`App.tsx:71-76`). Send and Swap call `isLocked()` immediately before signing (`Swap.tsx:791,947`), which closes most of the window. BPAN registration and mapping do not: a grep of `BPANPage.tsx` finds no `isLocked` / `lockWallet` call, so a BPAN write can use the stale in-memory key after the nominal lock until the popup re-renders as locked.

Fix: move signing into a background signing controller; broadcast a lock event that immediately clears in-page wallet state; enforce an authoritative lock check inside every signing function (not only at call sites); add the pre-sign lock check to the BPAN write paths.

### H-07. Resolver indexing is not reorg-safe `[not re-verified this pass]`

`BPAN/resolver-node/src/indexer.ts`, `BPAN/resolver-node/src/db.ts`

The resolver indexes the latest block with no confirmation depth, persists only `last_block` (no block hash), and has no rollback. After a reorg, mappings from orphaned blocks can stay cached permanently because the indexer believes those block numbers are processed. Carried forward from 2026-06-24; the branch did not touch the resolver.

Fix: index only finalized blocks (or a documented confirmation depth), persist number+hash checkpoints, detect parent-hash mismatch and roll back, apply each block atomically, and add reorg integration tests.

## Medium-severity findings

### M-01. Live mainnet contract does not match the audited source `[not re-verified this pass]`
`BPAN/contracts/deploy/deployed-v2.json`, `core/BANPRegistry.sol`, `lib/networks.ts`. The live runtime predates the May 29-30 hardening commits; local tests do not describe the contract users actually call. Publish exact deployed source + compiler settings and enforce a bytecode-match check in CI.

### M-02. Bitcoin/Litecoin SegWit validation accepts invalid encodings
`lib/addressValidation.ts:64-81`. The validator lowercases input before decoding (`decode(addr.toLowerCase(), 90)`), so it accepts invalid mixed-case Bech32, and it accepts either Bech32 or Bech32m for any witness version, so it accepts witness-v0 encoded with Bech32m and witness-v1+ encoded with Bech32. BTC/LTC sends are not enabled yet, but invalid addresses can still be written as BPAN mappings and copied to external wallets. Reject mixed-case; require Bech32 for v0 and Bech32m for v1-16; add BIP-173/BIP-350 negative vectors.

### M-03. Legacy API and SDK resolution are single-provider and non-finalized `[not re-verified this pass]`
`BPAN/api/src/contract.ts`, `routes.ts`, `sdk/src/client.ts`. One RPC at the default block tag, no provider agreement, no destination-chain validation. The extension does not use this path today; if it ever becomes funds-determining it reintroduces the single-provider redirect risk. Share one hardened resolver across extension, API, and SDK.

### M-04. Production dependency advisories are unresolved (verified this pass)
`npm audit --omit=dev` reports:
- `ws` (via `ethers@6.16.0`): **high**, uninitialized memory disclosure (GHSA-58qx-3vcg-4xpx) and memory-exhaustion DoS (GHSA-96hv-2xvq-fx4p).
- `react-router` / `react-router-dom` (6.x): **moderate**, protocol-relative open redirect (GHSA-2j2x-hqr9-3h42).

Exploitability is lower in a browser extension over HTTP-only providers, but pin and upgrade: `ethers` to a release pulling `ws` >= 8.21, and React Router to a non-vulnerable release. `npm audit fix` is available.

### M-05. RPC keys can leak through exception logging `[not re-verified this pass]`
`BPAN/api/src/routes.ts`, `index.ts`, `resolver-node/src/indexer.ts`. Caught ethers errors can carry the full `requestUrl` including an API key in the path. Log allowlisted structured fields only; never log raw provider error objects.

### M-06. Security documentation is stale `[not re-verified this pass]`
`docs/THREAT_MODEL.md`, `CHAIN_SUPPORT_MATRIX.md`, `SECURITY_REQUIREMENTS.md`. The threat model still says no content scripts ship, but the manifest injects EVM and Solana providers on every HTTP/HTTPS page (`manifest.json:68-80`). Update the threat model in the same change that moves a trust boundary.

### M-07. dApp-added custom-chain fields are insufficiently bounded (verified this pass)
`lib/dapp/chainOps.ts:80-114`, `lib/customChains.ts:24-30`. `wallet_addEthereumChain` validates the RPC scheme/chain id and confirms `eth_chainId`, but `name`, `symbol`, `explorer`, and `decimals` are accepted essentially unbounded (`decimals` only needs to be an integer, so a chain can set `decimals: 1000000`), and stored raw. A user-approved malicious config can poison formatting (`10n ** BigInt(decimals)`) or create UI/storage denial of service. Bound all strings and request size, restrict `decimals` to a sane range (0-36), and require the explorer URL to be HTTPS.

### M-08. High-risk flows still lack automated coverage and CI
There is no repository CI, lint, coverage threshold, or end-to-end transaction test. The existing suites (address vectors, dApp adversarial parser) are useful but do not cover EVM/aggregator intent binding, Jupiter instruction binding, lock lifecycle, BPAN provider disagreement, or resolver reorgs. Add CI for install/build/test/audit-policy/secret-scan plus deterministic signed-tx fixtures and a Playwright extension test for lock and dApp approval.

## Low-severity findings

### L-01. EVM connect can grant a different account than displayed
`dappRouter.ts:349-355`. On approval, connect re-reads the live active account (`getActiveAccount()`) rather than the one shown in the approval window. If the user switches wallet while the window is open, the dApp receives a different address than was reviewed. Reject on change, or refresh the approval UI before enabling Connect. (Note: re-reading is the correct TOCTOU choice for *value freshness*; the gap is that the displayed value is not re-confirmed.)

### L-02. Content scripts inject on insecure HTTP origins
`manifest.json:68-74` matches `http://*/*`. Provider injection on plain HTTP lets a network attacker alter the dApp request surface. Signing approval still protects keys, but phishing risk rises. Consider limiting HTTP to localhost.

### L-03. Broad host and remote-asset permissions create a privacy surface
`manifest.json:7-67`. Remote token logos/metadata endpoints can learn which assets a wallet holds or views. Proxy or package high-value assets and document the privacy model.

### L-04. `activeTab` permission appears unused
`manifest.json:6`. No code path uses `activeTab`. Remove it to shrink the review surface.

## Informational

### I-01. Spam classifier now keeps priced flagged tokens visible (new on this branch)
`lib/tokenSpam.ts` (uncommitted change). An indexer `possible_spam` flag is no longer an automatic hide: a flagged token that is priced and worth >= `$0.10` (`SPAM_FLAGGED_MIN_VALUE_USD`) stays visible and surfaces risk via a badge instead. This is a reasonable UX fix for over-flagged memecoins and is not funds-determining. The minor residual: an attacker who can get a worthless airdrop token to report a fake price >= $0.10 could keep it on the asset list. Keep the badge prominent on any flagged token and do not let "visible" imply "safe to interact with."

## Remediation order

Immediate (funds-determining, do before any "audited"/"production" claim):
1. Transfer live contract ownership to a hardware multisig and remove the owner key from the workspace (H-05).
2. Make BPAN resolution quorum-only and stop auto-advancing changed pins (H-02, H-03).
3. Bind every aggregator transaction to the full displayed intent (H-01).
4. Add economic decoding + balance-delta previews for Solana dApp transactions (H-04).
5. Move signing out of popup components and add the pre-sign lock check to BPAN writes (H-06).

Next:
6. Make the resolver finalized/reorg-safe (H-07).
7. Verify and publish exact live contract source; enforce bytecode match in CI (M-01).
8. Fix Bech32/Bech32m and mixed-case address validation (M-02).
9. Upgrade and pin `ethers`/`ws`/`react-router` (M-04).
10. Add CI, transaction fixtures, and an extension lock/approval test (M-08).

Then:
11. Consolidate API/SDK resolution onto the hardened resolver (M-03).
12. Redact provider errors and update the threat model (M-05, M-06).
13. Bound custom-chain fields and drop `activeTab` (M-07, L-04).

## Remediation status (2026-06-25, applied this session)

The following were fixed in code and verified with `npm run build` (clean) and `npm test` (33/33 + 71/71), plus a targeted negative-case check for the address validation.

| ID | Status | What changed |
| --- | --- | --- |
| H-02 | Fixed | `bpan.ts` now requires a >=2 provider quorum for any actionable result (address or "no mapping"); under-quorum throws `BPANInsufficientConfirmationError` and `Send.tsx` blocks rather than warning. A single provider can no longer determine a destination. |
| H-03 | Fixed | A changed mapping no longer auto-advances the trust pin. `Send.tsx` shows old vs new address and requires an explicit "I have verified this" checkbox; the pin advances only via `acceptBPANChange()` on a confirmed send. |
| H-05 | Mitigated | Deployer key moved out of the workspace to `~/Desktop/bpan-contracts-DEPLOYER.env`; confirmed never committed (0 commits across all refs) and still gitignored. Ownership transfer to a multisig remains for you to do. |
| H-06 | Fixed | Added authoritative `isLocked()` checks before signing in `BPANPage.tsx` register and set-mappings paths. |
| M-02 | Fixed | `addressValidation.ts` rejects mixed-case Bech32 and enforces the correct variant per witness version (bech32 for v0, bech32m for v1-16). Verified against valid + invalid vectors. |
| M-04 | Fixed | `npm audit fix` upgraded ws / ethers / react-router. Production deps now report 0 vulnerabilities. (Remaining esbuild advisory is dev-server-only, not shipped.) |
| M-07 | Fixed | `chainOps.ts` bounds `wallet_addEthereumChain` fields: name/symbol length, `decimals` 0-36, https-only explorer, and overall request size. |
| L-01 | Fixed | EVM connect now rejects if the active account changed while the approval window was open, instead of granting a different address. |
| L-02 | Fixed | Content-script injection restricted to `https://*/*` plus `http://localhost` / `127.0.0.1`. |
| L-04 | Fixed | Removed the unused `activeTab` permission. |

Deliberately NOT changed this session (require dedicated work or your decision), still open:

- **H-01 / H-04** (full aggregator-calldata and Solana-instruction intent binding): large, funds-critical decoders. A partial implementation in the signing path is worse than none, so these need a dedicated, well-tested piece of work rather than a quick patch.
- **H-07, M-01, M-03, M-05, M-06, M-08**: resolver reorg safety, contract bytecode verification/publish, API/SDK consolidation, backend log redaction, doc updates, and CI. These live in the BPAN backend and tooling, outside this extension branch.
- **H-05 ownership transfer**: only you can sign the transaction that moves registry ownership to a multisig.

## Release recommendation

Do not market this build as fully audited or production-hardened until the Immediate items are closed and independently retested. The architecture is sound and the crypto/lock foundations are strong, but the transaction-intent and BPAN fail-open paths are directly funds-determining and remain open.
