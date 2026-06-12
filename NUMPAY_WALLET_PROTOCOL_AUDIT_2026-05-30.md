# NumPay Wallet and BPAN Protocol Audit

Date: 2026-05-30

Scope:

- `NumPay/wallet-extension`
- `BPAN/contracts`
- `BPAN/api`
- `BPAN/resolver-node`
- `BPAN/sdk`

This audit reviewed the current working tree. Existing uncommitted wallet-extension changes were treated as in-scope user changes and were not reverted.

## Executive Summary

The wallet and protocol have improved materially since the older wallet review in `NumPay_Wallet_Security_Review.md`: decrypted wallet data is no longer persisted to `chrome.storage.local`, auto-lock now clears `chrome.storage.session`, EVM sends check the selected chain, swap/bridge paths have spender/router guards, and the BPAN contract now enforces one-BPAN-per-address on transfers.

The remaining high-risk issues are concentrated in cross-chain address correctness and off-chain resolver correctness:

1. Critical: Sui addresses are derived with SHA-256, but Sui uses BLAKE2b-256. The displayed Sui address is not controlled by the derived key.
2. Critical: The resolver node does not clear cached wallet mappings when a BPAN NFT transfers, even though the contract clears them.
3. High: The BPAN mapping UI auto-fills Litecoin with the Bitcoin address.
4. High: The resolver processes each event type in batches instead of canonical log order, so cache state can diverge from contract state.
5. High: The extension still places decrypted private keys and mnemonics in popup React state and `chrome.storage.session`, and unlock decrypts every wallet.

## Findings

### Critical: Sui Address Derivation Uses The Wrong Hash

Evidence:

- `NumPay/wallet-extension/src/lib/chains/sui.ts:20`
- `NumPay/wallet-extension/src/lib/chains/sui.ts:28`

The code derives the Sui address as `SHA-256(0x00 || pubkey)`. Sui address derivation uses BLAKE2b-256 over the signature-scheme flag plus public key bytes. This means the wallet can display a Sui address that does not correspond to the held Sui private key. Any SUI or Sui assets sent to that address may be unrecoverable by this wallet.

Recommended fix:

- Replace the SHA-256 derivation with BLAKE2b-256, using a well-reviewed Sui SDK/helper or a pinned hash library.
- Add a test vector from the official Sui CLI/SDK for a known mnemonic and path.
- Do not show Sui receive/mapping addresses until the derivation is verified against Sui tooling.

References:

- https://docs.rs/sui-sdk-types/latest/sui_sdk_types/struct.Address.html
- https://forums.sui.io/t/how-to-convert-a-public-key-to-a-sui-address/46642

### Critical: Resolver Cache Keeps Stale Mappings After BPAN Transfer

Evidence:

- `BPAN/contracts/core/BANPRegistry.sol:420`
- `BPAN/resolver-node/src/indexer.ts:4`
- `BPAN/resolver-node/src/indexer.ts:187`
- `BPAN/resolver-node/src/db.ts:100`

The V2 contract clears all wallet mappings on NFT ownership transfer and emits `AllMappingsCleared`. The resolver node ABI does not include `AllMappingsCleared`, and its transfer handler only updates the owner. Existing cached mappings remain in SQLite after transfer.

If the resolver cache is used for payments, a transferred BPAN can still resolve to the previous owner's addresses, causing funds to be sent to the wrong party.

Recommended fix:

- Add `AllMappingsCleared` to the resolver ABI and delete all mappings for that number when seen.
- Also clear mappings on non-mint `Transfer` as a defensive mirror of contract behavior.
- Add DB helper `clearMappings(number)`.
- Add resolver tests: register, set mappings, transfer, assert cache owner changes and mappings are empty.

### High: Resolver Event Processing Is Not Canonical

Evidence:

- `BPAN/resolver-node/src/indexer.ts:99`
- `BPAN/resolver-node/src/indexer.ts:128`
- `BPAN/resolver-node/src/indexer.ts:142`
- `BPAN/resolver-node/src/indexer.ts:157`
- `BPAN/resolver-node/src/indexer.ts:171`

The resolver fetches each event type separately and then processes all registrations, then all mapping sets, then all removals, then all transfers. This ignores `blockNumber`, `transactionIndex`, and `logIndex`.

Even after adding mapping clearing, this design can corrupt cache state when a transfer and a later mapping update occur in the same block range, or when a mapping is removed and re-added in the same range.

Recommended fix:

- Fetch all relevant logs, parse them, merge into one list, and sort by `(blockNumber, transactionIndex, logIndex)`.
- Apply state transitions in exact chain order.
- Only advance `last_block` after the full ordered batch commits.

### High: Litecoin BPAN Mapping Uses Bitcoin Address

Evidence:

- `NumPay/wallet-extension/src/popup/pages/BPANPage.tsx:563`
- `NumPay/wallet-extension/src/popup/pages/BPANPage.tsx:567`
- `NumPay/wallet-extension/src/lib/chains/index.ts:52`

`autoNonEvmAddress("litecoin")` returns `nonEvmWallet.bitcoin.address` instead of `nonEvmWallet.litecoin.address`. If a user maps Litecoin through the auto-fill path, their BPAN will advertise a Bitcoin address for Litecoin receipts.

Recommended fix:

- Return `nonEvmWallet.litecoin.address`.
- Add a UI/unit test that Bitcoin and Litecoin auto-fill different chain-specific addresses.
- Consider validating mapped addresses by chain before calling `setWalletMapping`.

### High: Decrypted Wallet Secrets Are Still Broadly Exposed Inside The Popup

Evidence:

- `NumPay/wallet-extension/src/popup/pages/Unlock.tsx:19`
- `NumPay/wallet-extension/src/popup/pages/Unlock.tsx:22`
- `NumPay/wallet-extension/src/popup/hooks/useWallet.ts:551`
- `NumPay/wallet-extension/src/popup/hooks/useWallet.ts:556`
- `NumPay/wallet-extension/src/popup/pages/Send.tsx:170`
- `NumPay/wallet-extension/src/popup/pages/Swap.tsx:634`

The persistent plaintext issue has been fixed, but the current model still decrypts all vaults on unlock and writes all decrypted `WalletData` objects into `chrome.storage.session`. Popup components receive raw private keys/mnemonics and construct signers directly.

This is a major custody blast-radius issue. A popup XSS, dependency compromise, malicious build, or extension-context compromise can read every unlocked wallet secret for the full auto-lock window.

Recommended fix:

- Keep encrypted vaults and wallet metadata in popup-accessible storage.
- Move decryption and signing into the background service worker or an isolated wallet controller.
- Do not pass raw private keys or mnemonics to pages.
- Decrypt only the active wallet, or only for a single signing/export operation.
- Treat key export as a separate re-authenticated flow.

### Medium: Private Key And Recovery Phrase Reveal Does Not Re-Authenticate

Evidence:

- `NumPay/wallet-extension/src/popup/pages/Settings.tsx:400`
- `NumPay/wallet-extension/src/popup/pages/Settings.tsx:405`
- `NumPay/wallet-extension/src/popup/pages/Settings.tsx:428`
- `NumPay/wallet-extension/src/popup/pages/Settings.tsx:433`

Any unlocked popup session can reveal and copy the private key or mnemonic without re-entering the password. This increases damage from shoulder surfing, unattended unlocked popups, and lower-grade UI compromise.

Recommended fix:

- Require password confirmation for each reveal/copy.
- Auto-hide secrets after a short timer.
- Consider blocking clipboard copy unless the user explicitly confirms.

### Medium: API Status Endpoint Defeats Lookup Anti-Enumeration Goals

Evidence:

- `BPAN/api/src/routes.ts:13`
- `BPAN/api/src/routes.ts:163`
- `BPAN/api/src/routes.ts:174`

The API now uses uniform 200 responses for lookup failures, but `/account/:number/status` directly returns `registered: true/false`. Registration state is public on-chain, but this endpoint remains a convenient enumeration oracle despite the anti-enumeration comments and timing smoothing.

Recommended fix:

- Remove the public status endpoint, restrict it to trusted admin/internal use, or accept and document enumeration as an explicit protocol property.
- If kept public, apply per-number throttling and monitoring in addition to per-IP limits.

### Medium: Contract Migration Can Violate The One-BPAN-Per-Address Invariant

Evidence:

- `BPAN/contracts/core/BANPRegistry.sol:156`
- `BPAN/contracts/core/BANPRegistry.sol:314`
- `BPAN/contracts/core/BANPRegistry.sol:341`
- `NumPay/wallet-extension/src/popup/pages/BPANPage.tsx:444`

The contract states each address may hold at most one BPAN, but `migrateFromV1` intentionally bypasses that rule and the UI text says each wallet can hold multiple BPANs. This is a protocol/product invariant mismatch.

Recommended fix:

- Decide whether multiple BPANs per address are allowed.
- If not allowed, migration should reject duplicate owners or move duplicates to designated recipient addresses.
- If allowed for legacy reasons, update contract comments, UI, docs, tests, and resolver expectations to make the exception explicit.

### Medium: Solana Amount Conversion Uses Floating Point

Evidence:

- `NumPay/wallet-extension/src/popup/pages/Send.tsx:201`
- `NumPay/wallet-extension/src/popup/pages/Send.tsx:206`

SOL sends convert user input with `parseFloat(amount) * 1e9` and `Math.round`. Floating-point conversion is not appropriate for transaction amounts and can round unexpectedly.

Recommended fix:

- Parse decimal strings to lamports using integer arithmetic.
- Reject more than 9 decimal places for SOL.
- Add tests for edge cases such as `0.000000001`, `0.0000000009`, and large balances.

### Low/Medium: Resolver Logs Full RPC URLs

Evidence:

- `BPAN/resolver-node/src/index.ts:48`

The resolver prints the full `RPC_URL`, which often includes provider API keys. Logs are commonly shipped to third-party systems and retained longer than expected.

Recommended fix:

- Log only protocol, hostname, and network label.
- Redact path/query components.

### Low/Medium: Contract Uses `_mint` Instead Of `_safeMint`

Evidence:

- `BPAN/contracts/core/BANPRegistry.sol:169`
- `BPAN/contracts/core/BANPRegistry.sol:341`

Registering or migrating to a contract address that cannot handle ERC-721 tokens can lock the BPAN NFT in that contract. This is less likely through the current extension UI, but it is possible through direct contract calls or migration data.

Recommended fix:

- Use `_safeMint` for normal registration.
- For migration, either use `_safeMint` or explicitly document and validate contract recipients.

### Low: `withdrawFees` Allows Zero Address Recipient

Evidence:

- `BPAN/contracts/core/BANPRegistry.sol:386`

`withdrawFees` accepts any payable address. Passing `address(0)` would burn accumulated fees.

Recommended fix:

- Revert on `to == address(0)`.

### Dependency Audit Findings

`npm audit --omit=dev` found moderate issues:

- `NumPay/wallet-extension`: `ws` via `ethers`.
- `BPAN/api`: `qs` via `express`/`body-parser`, and `ws` via `ethers`.
- `BPAN/resolver-node`: `ws` via `ethers`.
- `BPAN/sdk`: `ws` via `ethers`.
- `BPAN/contracts`: no production dependency vulnerabilities reported.

Recommended fix:

- Update lockfiles when upstream packages provide non-breaking fixes.
- For the `ethers`/`ws` advisory, avoid `npm audit fix --force` unless the ethers major-version downgrade is acceptable.
- Track advisories in CI so this does not regress silently.

## Positive Findings

- Wallet extension build passes.
- Decrypted wallet sessions are no longer persisted to `chrome.storage.local`.
- Auto-lock clears `chrome.storage.session`.
- EVM sends verify the provider chain ID before signing.
- Custom RPC URLs require HTTPS outside local development.
- Swap/bridge approvals are exact amount and gated by known spender/router checks.
- EVM swap/bridge transactions are simulated before broadcast.
- BPAN contract now clears mappings on transfer and blocks transfer to an address that already owns a BPAN.
- API uses `helmet`, explicit CORS origin config, global rate limiting, lookup-specific rate limiting, and response-time smoothing.

## Verification Run

Commands run:

- `npm run build` in `NumPay/wallet-extension`: passed.
- `npm test` in `BPAN/contracts`: passed, 77 tests.
- `npm test` in `BPAN/api`: passed, 8 tests.
- `npm test` in `BPAN/resolver-node`: passed, 14 tests.
- `npm test` in `BPAN/sdk`: passed, 9 tests.
- `git diff --check`: no whitespace errors, only line-ending warnings for existing modified files.
- Secret scan with `rg`: no obvious tracked private keys/API secrets found outside placeholders and lockfiles.
- `npm audit --omit=dev`: moderate dependency findings listed above.

## Suggested Priority

1. Fix Sui address derivation and add test vectors before showing Sui receive/mapping addresses.
2. Fix resolver cache clearing and event ordering; add resolver integration tests.
3. Fix Litecoin auto-fill in BPAN mappings.
4. Move signing/decryption out of popup pages and reduce unlocked secret lifetime/blast radius.
5. Resolve the one-BPAN invariant mismatch across migration, contract comments, UI text, and docs.
6. Add re-authentication for secret export.
7. Replace Solana floating-point amount parsing with integer parsing.
8. Redact resolver RPC URLs in logs.
9. Patch dependency audit issues when safe non-breaking updates are available.
