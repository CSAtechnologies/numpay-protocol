# NumPay Wallet Total Audit

Date: 2026-06-24  
Scope: `NumPay/wallet-extension`, BPAN contracts, resolver node, API, SDK, deployment scripts, documentation, local secret handling, and the configured Ethereum mainnet registry.  
Mode: white-box review, local builds/tests, dependency advisory checks, static data-flow review, and read-only live-chain verification.

## Executive Summary

NumPay has materially improved since the May 2026 reviews. The current tree builds cleanly, all existing tests pass, Sui derivation is canonical, decrypted sessions are active-wallet-only, secret export requires re-authentication, direct EVM sends check chain IDs, and swap/bridge paths now use exact approvals, router/spender allowlists, native-value checks, and simulation.

The wallet is not ready to be treated as fully hardened custody software yet. The highest risks are:

1. Aggregator-built EVM and Solana transactions are not cryptographically or semantically bound to the swap intent shown to the user.
2. BPAN resolution permits a single low-confidence RPC response to become a payable destination.
3. BPAN trust pins automatically accept a changed mapping after displaying one warning.
4. Solana dApp transaction approvals show programs, but not the actual asset, amount, destination, or simulated balance changes.
5. The private key in `BPAN/contracts/.env` is the live mainnet registry owner's key.
6. Auto-lock clears session storage but does not immediately clear raw keys already held by the open popup, and BPAN write paths omit the pre-sign lock check.
7. The resolver indexes the chain head without confirmations or reorg rollback.

No transactions were signed or broadcast during this audit. Live-chain activity was read-only.

## Overall Result

| Severity | Count |
| --- | ---: |
| Critical | 0 |
| High | 7 |
| Medium | 11 |
| Low | 4 |

Risk rating: **High until the transaction-intent, BPAN fail-closed, owner-key, and lock-boundary findings are fixed.**

## Verification Performed

### Build and test results

| Component | Result |
| --- | --- |
| Wallet address vectors | Pass, 33/33 |
| Wallet dApp adversarial suite | Pass, 71/71 |
| Wallet TypeScript + production build | Pass |
| BPAN contracts | Pass, 89 tests |
| BPAN contract compile | Pass |
| BPAN API | Pass, 8 tests + build |
| BPAN resolver | Pass, 16 tests + build |
| BPAN SDK | Pass, 9 tests + build |

There is no repository CI configuration, lint command, coverage threshold, browser automation suite, or end-to-end transaction test.

### Live registry verification

Configured mainnet contract:

- Address: `0xdB5206e06a7509b9181F0594752CD42cbD7eD371`
- Chain ID: 1
- Owner: `0xd7f8A3B876f774e1344b2658F7c3D6B1d087F96e`
- Owner is an EOA
- `migrationOpen`: `false`
- `totalRegistered`: `2`
- Registration fee: `250000000000000` wei
- On-chain runtime code hash: `0x645da953bca077c23b96aaed5d9ff3d5068a5a904d478657bae9885eb46e7254`
- Current local artifact runtime code hash: `0x7a20b25c6aa73cf4e82b64ce4b429eaceb04102b89182921c63882e83de18a07`
- Runtime logic still differs after stripping Solidity metadata.

The deployment record dates the live V2 deployment to May 26, 2026. Repository hardening for transfer invariants, `_safeMint`, and zero-address withdrawal landed on May 29-30, 2026.

## High-Severity Findings

### H-01. Aggregator transactions are not bound to the displayed swap/bridge intent

Affected code:

- `NumPay/wallet-extension/src/popup/pages/Swap.tsx:870-935`
- `NumPay/wallet-extension/src/popup/pages/Swap.tsx:961-998`
- `NumPay/wallet-extension/src/lib/chains/solana.ts:639-725`

The current guards confirm the chain, target router/spender, native value, contract code, and whether the transaction reverts. They do not decode and verify all funds-determining fields:

- input token
- output token
- exact input amount
- minimum output
- output recipient
- refund recipient
- route programs/contracts

A compromised ParaSwap, KyberSwap, LI.FI, or Jupiter response can use a trusted router and produce a successful simulation while directing output to an attacker. Exact allowance limits the loss to the approved swap amount, but does not prevent that loss.

Remediation:

- Decode each supported router's calldata locally.
- Verify the complete intent before approval or broadcast.
- For Solana, resolve address lookup tables and inspect every instruction.
- Compare independent simulation balance deltas against the expected input/output and recipient.
- Fail closed when a route format is unknown.

### H-02. BPAN resolution fails open under degraded provider agreement

Affected code:

- `NumPay/wallet-extension/src/lib/bpan.ts:165-222`
- `NumPay/wallet-extension/src/popup/pages/Send.tsx:167-219`

`resolveBPANChecked` only treats two different non-empty addresses as a conflict. A single non-empty response is returned with `confidence: "low"`, and the Send page permits payment after displaying a caution.

An empty/non-empty disagreement is also not a hard conflict. Under a provider outage, one malicious or stale provider can therefore supply the only payable address.

Impact:

- A single compromised RPC can redirect a payment when the other providers fail or return empty.
- This contradicts the stated invariant that one provider cannot determine a payment destination.

Remediation:

- Require at least two independent providers to return the same non-empty address before enabling Send.
- Treat empty/non-empty disagreement as a hard failure.
- Require quorum agreement for "no mapping" as well.
- Do not expose a low-confidence address as a send target.

### H-03. A changed BPAN trust pin is automatically accepted

Affected code:

- `NumPay/wallet-extension/src/lib/bpan.ts:205-220`

When a high-confidence mapping differs from the stored pin, the code sets `changed = true` and immediately overwrites the pin. The next lookup sees the new address as trusted, so the warning is effectively one-shot.

Impact:

- Closing and reopening the flow can remove the warning without user acknowledgement.
- An address change is promoted to trusted state by lookup, not by an explicit security decision.

Remediation:

- Keep the old pin until the user explicitly accepts the new mapping.
- Store changed mappings as pending.
- Require the user to review the full old/new addresses and confirm out-of-band verification.
- Record acknowledgement time and reason.

### H-04. Solana dApp transaction approvals are economically opaque

Affected code:

- `NumPay/wallet-extension/src/approval/main.tsx:430-563`
- `NumPay/wallet-extension/src/lib/chains/solana.ts:490-630`

The approval window binds the fee payer, lists invoked programs, and simulates the transaction. It does not show:

- assets leaving the wallet
- transfer amounts
- destination accounts
- token approvals/delegates
- account ownership changes
- resolved lookup-table accounts

A malicious transaction is expected to simulate successfully. "Simulation passed" is not a safety signal when the requested action itself is a drainer.

Remediation:

- Resolve v0 address lookup tables.
- Decode System, SPL Token, Token-2022, ATA, Compute Budget, and common DeFi instructions.
- Display simulated balance and token-account changes.
- Hard-warn or reject unknown programs and unresolved account sets.

### H-05. The live registry owner key is stored in the workspace

Affected local file:

- `BPAN/contracts/.env`

The ignored deployer private key is valid and derives to the current Ethereum mainnet registry owner:

`0xd7f8A3B876f774e1344b2658F7c3D6B1d087F96e`

`.gitignore` prevents accidental commits but does not protect backups, sync services, malware, screenshots, logs, or workspace archives.

Remediation:

- Transfer contract ownership to a hardware-backed multisig.
- Remove the private key from the project directory.
- Rotate provider/API credentials if the workspace has been shared or synced.
- Use a secret manager or hardware signer for deployment and admin actions.
- Add secret scanning in CI and local pre-commit hooks.

### H-06. Auto-lock does not immediately remove all in-memory signing authority

Affected code:

- `NumPay/wallet-extension/src/lib/wallet.ts:340-367`
- `NumPay/wallet-extension/src/popup/App.tsx:51-84`
- `NumPay/wallet-extension/src/popup/hooks/useWallet.ts:90-110`
- `NumPay/wallet-extension/src/popup/pages/BPANPage.tsx:513-525`
- `NumPay/wallet-extension/src/popup/pages/BPANPage.tsx:692-731`

The background alarm clears `chrome.storage.session`, but an open popup still holds `WalletData`, mnemonic-derived non-EVM keys, and private keys in React state. The popup detects the lock on a 60-second interval.

Send and Swap explicitly call `isLocked()` before signing. BPAN registration and mapping do not, so they can use the stale React-held private key after the nominal lock until the popup re-renders as locked.

Remediation:

- Move all signing into a small background signing controller.
- Send a lock event to every open extension page and immediately clear local wallet state.
- Enforce an authoritative lock check inside every signing function, not only at call sites.
- Require chain-ID verification for BPAN writes.
- Avoid passing raw private keys through page components.

### H-07. Resolver state is not reorg-safe

Affected code:

- `BPAN/resolver-node/src/indexer.ts:74-91`
- `BPAN/resolver-node/src/db.ts:67-82`

The resolver indexes the latest block immediately, persists only `last_block`, and records no block hash. It has no confirmation depth, finalized-head selection, or rollback mechanism.

After a reorg, mappings from orphaned blocks can remain permanently cached because the indexer believes those block numbers are already processed.

Remediation:

- Index only finalized blocks, or use a documented confirmation depth.
- Persist block number and hash checkpoints.
- Detect parent/hash mismatch and roll back affected database changes.
- Apply each block atomically.
- Add integration tests for set/remove/transfer events across simulated reorgs.

## Medium-Severity Findings

### M-01. The live mainnet contract does not match the audited source

Affected code/config:

- `BPAN/contracts/deploy/deployed-v2.json`
- `BPAN/contracts/core/BANPRegistry.sol`
- `NumPay/wallet-extension/src/lib/networks.ts:10`

The current local artifact and live runtime logic differ. The live deployment predates the May 29-30 hardening commits.

The migration window is closed, reducing the impact of old migration bugs. However, local test results for the current source do not establish the behavior of the contract users actually call.

Remediation:

- Verify and publish the exact deployed source and compiler settings.
- Maintain immutable release artifacts and bytecode hashes.
- Add a CI deployment check that rejects a configured address whose runtime code does not match an approved artifact.
- Explicitly decide whether to keep V2 or migrate to V3.

### M-02. Bitcoin/Litecoin SegWit validation accepts invalid encodings

Affected code:

- `NumPay/wallet-extension/src/lib/addressValidation.ts:61-81`

The validator lowercases input before decoding, which accepts invalid mixed-case Bech32 addresses. It also accepts witness-v0 programs encoded with Bech32m and witness-v1+ programs encoded with Bech32.

Local proof:

- Invalid mixed-case `bC1...` was accepted.
- A witness-v0 address re-encoded with Bech32m was accepted.

BTC/LTC sending is not yet enabled, but invalid addresses can be published as BPAN mappings and copied to external wallets.

Remediation:

- Reject mixed-case input.
- Require Bech32 for witness version 0.
- Require Bech32m for witness versions 1-16.
- Add BIP-173/BIP-350 cross-variant negative vectors.

### M-03. Legacy API and SDK resolution are single-provider and non-finalized

Affected code:

- `BPAN/api/src/contract.ts:19-34`
- `BPAN/api/src/routes.ts:58-135`
- `BPAN/sdk/src/client.ts:79-121`

These paths read one RPC at its default block tag and do not perform provider agreement or destination-chain address validation.

The current extension does not use this backend for payment resolution. If the API or SDK becomes a funds-determining path, it reintroduces the single-provider redirect risk that the extension tries to mitigate.

Remediation:

- Share one hardened resolution implementation across extension, API, and SDK.
- Require finalized reads and provider quorum.
- Validate the returned address for the requested chain.

### M-04. Current production dependency advisories are unresolved

Affected packages:

- Wallet: `ethers@6.16.0`, `ws@8.17.1`, `react-router-dom@6.30.3`
- API/resolver/SDK: `ethers@6.16.0`, `ws@8.17.1`

Current audit result:

- `ws` memory-exhaustion DoS: high
- `ws` uninitialized-memory disclosure: moderate
- React Router protocol-relative open redirect: moderate

Fixed releases are available:

- `ethers@6.17.0`
- `ws@8.21.0`
- a non-vulnerable React Router release

The `ws` paths are lower-exploitability in the browser extension and HTTP-only providers, but the dependency should still be upgraded and locked.

### M-05. RPC keys can leak through exception logging

Affected code:

- `BPAN/api/src/routes.ts:85-87`
- `BPAN/api/src/routes.ts:132-134`
- `BPAN/api/src/index.ts:32-35`
- `BPAN/resolver-node/src/indexer.ts:63-67`

Startup logging redacts RPC URLs, but caught ethers errors can include the full `requestUrl`, including an API key in the path. The API logs full error objects; the resolver logs `err.message`, which can also contain the URL.

Remediation:

- Log structured allowlisted fields.
- Redact URLs and query/path credentials from all error messages.
- Never log raw provider error objects.

### M-06. Security documentation is materially stale

Affected documents:

- `docs/THREAT_MODEL.md`
- `docs/CHAIN_SUPPORT_MATRIX.md`
- `docs/SECURITY_REQUIREMENTS.md`

The authoritative threat-model section dated June 19 says no dApp injection/content scripts shipped. The current manifest injects EVM and Solana providers on every HTTP/HTTPS page. The chain matrix still describes testnet-only phases while the wallet is mainnet and multi-chain.

Impact:

- Reviews can omit live attack surfaces.
- Security requirements and release reality cannot be reliably compared.

Remediation:

- Update the threat model in the same change that modifies trust boundaries.
- Add a release check that verifies documented surfaces against the manifest and network registry.

### M-07. High-risk flows lack automated coverage and CI enforcement

Missing coverage includes:

- EVM native/ERC-20 send integration
- ParaSwap/Kyber/LI.FI transaction intent checks
- Jupiter instruction and balance binding
- Sui/Tron transaction fixtures
- BPAN multi-provider disagreement behavior
- vault migration and lock lifecycle
- extension browser connect/sign/send flows
- resolver event ingestion and reorgs

The existing tests are useful but concentrate on address validation, parser robustness, contract unit behavior, and database helpers.

Remediation:

- Add CI for install, build, test, audit policy, secret scan, and bytecode match.
- Add deterministic signed-transaction fixtures per supported chain.
- Add Playwright/Chrome extension tests for locking and dApp approvals.

### M-08. Default deployment tooling still deploys V2 with known migration gaps

Affected code:

- `BPAN/contracts/deploy/deploy.ts:9-21`
- `BPAN/contracts/core/BANPRegistry.sol:326-375`

The V2 migration function:

- does not validate migrated token IDs against the 11-digit range
- silently truncates per-record chain/wallet array mismatches

V3 fixes these issues, but `deploy.ts` still deploys `BANPRegistry` V2 and writes `deployed-v2.json`.

The live V2 migration is closed, so this is primarily a future deployment/release risk.

### M-09. DeFi APY and TVL values are hardcoded financial claims

Affected code:

- `NumPay/wallet-extension/src/popup/pages/DeFi.tsx:17-35`

The wallet displays static APY and TVL figures without a source timestamp. The disclaimer says rates are approximate, but users can reasonably interpret the values as current.

Remediation:

- Fetch signed/attributed current data with timestamps, or remove the figures.
- Clearly label stale/cache age and network/asset assumptions.
- Do not present hardcoded yields in a wallet production build.

### M-10. API anti-enumeration is bypassed by the chains endpoint

Affected code:

- `BPAN/api/src/routes.ts:138-159`

`/account/:number/chains` directly returns an empty or populated array, revealing whether mappings exist. This undermines the uniform response policy used by `/resolve` and `/account`.

Registration data is public on-chain, so this is an abuse-resistance issue rather than confidentiality.

### M-11. dApp-added custom-chain fields are insufficiently bounded

Affected code:

- `NumPay/wallet-extension/src/lib/dapp/chainOps.ts:80-113`

`wallet_addEthereumChain` validates the RPC scheme and chain ID, but does not adequately bound:

- chain name length
- symbol length
- decimals range
- explorer URL scheme/length
- overall request size

A user-approved malicious configuration can poison wallet formatting or create UI/storage denial of service.

Remediation:

- Bound all strings and request size.
- Restrict decimals to a sane range.
- Validate explorer URLs as HTTPS.
- Re-probe and normalize all saved fields.

## Low-Severity Findings

### L-01. EVM connect approval can expose a different account than displayed

Affected code:

- `NumPay/wallet-extension/src/background/dappRouter.ts:349-355`
- `NumPay/wallet-extension/src/approval/main.tsx:199-243`

The approval displays `pending.account`, but the router re-reads and grants the current account after approval. If the active wallet changes while the approval is open, the dApp can receive a different address than the one reviewed.

Reject when the account changed, or refresh the approval UI before enabling Connect.

### L-02. Content scripts inject on insecure HTTP origins

Affected configuration:

- `NumPay/wallet-extension/manifest.json:68-80`

Provider injection on arbitrary HTTP pages allows a network attacker to alter the dApp UI/request. The wallet approval still protects signing, but phishing risk is higher.

Consider limiting HTTP support to localhost/development.

### L-03. Host and remote-asset permissions create privacy surface

Affected configuration/code:

- `NumPay/wallet-extension/manifest.json:7-67`
- remote token/logo and metadata fetchers throughout the wallet

Remote token images and metadata endpoints can learn that a wallet user holds or views a specific asset. `referrerPolicy="no-referrer"` helps for framed icons, but the broader metadata/image pipeline remains externally observable.

Proxy or package high-value assets, restrict arbitrary metadata URLs, and document the privacy model.

### L-04. `activeTab` permission appears unused

Affected configuration:

- `NumPay/wallet-extension/manifest.json:6`

Remove unused permissions to reduce review surface and future misuse potential.

## Previously Reported Findings Now Fixed

The current tree resolves or materially improves these May 2026 findings:

- Sui address derivation now uses canonical Blake2b-256.
- Resolver handles `AllMappingsCleared`.
- Resolver sorts event logs in canonical order.
- Litecoin BPAN autofill uses the Litecoin address.
- Solana amount conversion uses integer base units.
- Secret export requires password re-entry.
- Custom RPCs require HTTPS and chain-ID probing.
- EVM sends derive the signer network from the selected chain and check chain ID.
- Swap/bridge approvals are exact amount and known-spender gated.
- EVM swap/bridge transactions are simulated before send.
- Resolver startup RPC logging is redacted.
- API status enumeration endpoint was removed.
- Contract zero-address withdrawal and `_safeMint` protections exist in current source.

The last two contract fixes are not present in the configured live V2 bytecode.

## Positive Security Controls

- AES-256-GCM vault encryption with Argon2id.
- Legacy PBKDF2 vault upgrade on unlock.
- Only the active wallet is decrypted into session.
- `chrome.storage.session` is used instead of persistent local storage for plaintext session material.
- Manual and timeout lock paths remove session storage.
- Direct EVM sends and swaps check the provider chain ID.
- BPAN-resolved destinations are validated by chain format.
- `eth_sign` and legacy typed-data methods are rejected.
- dApp origins are stamped by the isolated content bridge.
- DApp signing is bound to the connected account again at sign time.
- DApp payload size caps and adversarial parser tests exist.
- Sui transactions dry-run and check balance changes before signing.
- Tron transaction IDs and selected intent fields are checked before signing.
- Contract mapping counts and wallet string lengths are bounded.
- Contract mapping state is cleared on ownership transfer.
- API uses Helmet, explicit CORS configuration, rate limits, and timing smoothing.

## Remediation Order

### Immediate

1. Transfer live contract ownership to a hardware-backed multisig and remove the owner key from the workspace.
2. Make BPAN resolution quorum-only and stop auto-updating changed pins.
3. Bind every aggregator transaction to the complete displayed intent.
4. Add economic decoding/balance-delta previews for Solana dApp transactions.
5. Move signing out of popup components and close the post-lock key window.

### Next

6. Make the resolver finalized/reorg-safe.
7. Verify and publish the exact live contract source; enforce bytecode matching in CI.
8. Fix Bech32/Bech32m and mixed-case validation.
9. Upgrade ethers, ws, and React Router.
10. Add end-to-end extension, transaction-fixture, and resolver integration tests in CI.

### Then

11. Consolidate API/SDK resolution with the hardened extension resolver.
12. Redact provider errors, update security documentation, and remove hardcoded DeFi rates.
13. Bound custom-chain fields and narrow unused permissions.

## Release Recommendation

Do not market the current build as fully audited or production-hardened until the Immediate items are closed and independently retested. The basic architecture is recoverable and several controls are strong, but the remaining transaction-intent and BPAN fail-open paths are directly funds-determining.
