# NumPay Wallet Security Review

Date: 2026-05-29
Scope: `C:\Users\HP OMEN\Desktop\NumPay Project`, focused on wallet, wallet-extension, BPAN resolution, and wallet-related contract/API code.

## Summary

The codebase has no TypeScript compile failures in the wallet surfaces I checked:

- `NumPay/wallet-extension`: `tsc --noEmit --pretty false --incremental false` passed.
- `NumPay/wallet`: `tsc --noEmit --pretty false --incremental false` passed.

The main risks are not type errors. They are custody and transaction-safety issues:

- Decrypted wallet secrets are persisted in extension storage.
- Auto-lock does not reliably start or clear plaintext session data.
- Swap/bridge code signs aggregator-supplied transactions without enough local validation.
- The web wallet custody model relies on `localStorage` and lacks security headers.
- The BPAN "one number per address" invariant can be bypassed by ERC-721 transfer.

## Issues And Fixes

### 1. Critical: Decrypted extension wallet secrets are stored persistently

Evidence:

- `NumPay/wallet-extension/src/popup/hooks/useWallet.ts:138`
- `NumPay/wallet-extension/src/popup/hooks/useWallet.ts:540`
- `NumPay/wallet-extension/src/popup/hooks/useWallet.ts:549`
- `NumPay/wallet-extension/src/lib/wallet.ts:239`

The extension writes `numpay_session` to storage. That session contains full `WalletData`, including `mnemonic` and `privateKey`. On startup, the popup reads that stored session and restores the decrypted wallet without asking for the password again.

Why this matters:

If an attacker, another extension with sufficient access, a malicious debug build, or local compromise can read extension storage, the wallet is lost. This also contradicts the threat model, which says decrypted keys should only live in memory and should not be persisted.

Fix:

- Do not store `mnemonic`, `privateKey`, or non-EVM secret keys in `chrome.storage.local` or `localStorage`.
- Store only encrypted vault data and non-sensitive metadata such as wallet id, address, name, and avatar.
- Keep decrypted key material only in memory.
- Move signing into the background service worker or an isolated wallet controller.
- Make popup pages request signing operations rather than receiving raw private keys.
- Clear all in-memory decrypted material on lock, timeout, popup close, service worker suspend, and explicit reset.

Recommended implementation shape:

```ts
// storage: encrypted vault only
{
  id,
  name,
  address,
  salt,
  iv,
  data
}

// runtime memory only
{
  activeId,
  unlockedWalletPrivateKey,
  unlockedMnemonic
}
```

### 2. Critical: Auto-lock timer likely never starts and does not clear secrets

Evidence:

- `NumPay/wallet-extension/src/background/index.ts:7`
- `NumPay/wallet-extension/src/background/index.ts:14`
- `NumPay/wallet-extension/src/background/index.ts:20`
- No matching `chrome.runtime.connect(...)` or `chrome.runtime.sendMessage({ type: "ACTIVITY" })` was found in `NumPay/wallet-extension/src`.

The background worker starts the auto-lock timer only on `runtime.onConnect` or `ACTIVITY` messages, but the popup does not appear to send either. Even if the timer fires, it only sets `numpay_locked` to `"true"` and does not remove `numpay_session`.

Why this matters:

The UI may show a locked state while decrypted keys remain persisted in storage. That creates a false sense of security.

Fix:

- On popup mount and user actions, call `chrome.runtime.connect()` or send `ACTIVITY`.
- Use one lock function for both manual lock and auto-lock.
- The lock function must clear plaintext session data and in-memory key material.
- Avoid relying only on service worker timers because MV3 workers can suspend. Store `lastActivityAt` and enforce timeout on every popup open and signing request.

Recommended checks:

- Open popup, unlock, wait longer than `AUTO_LOCK_MINUTES`, reopen, confirm it asks for password.
- Inspect extension storage and confirm no plaintext `privateKey`, `mnemonic`, or `secretKey` remains.

### 3. High: Swap and bridge execution trusts aggregator transactions too much

Evidence:

- `NumPay/wallet-extension/src/popup/pages/Swap.tsx:633`
- `NumPay/wallet-extension/src/popup/pages/Swap.tsx:644`
- `NumPay/wallet-extension/src/popup/pages/Swap.tsx:656`
- `NumPay/wallet-extension/src/popup/pages/Swap.tsx:667`
- `NumPay/wallet-extension/src/popup/pages/Swap.tsx:701`
- `NumPay/wallet-extension/src/popup/pages/Swap.tsx:713`
- `NumPay/wallet-extension/src/lib/chains/solana.ts:213`
- `NumPay/wallet-extension/src/lib/chains/solana.ts:247`

The code signs and submits transactions built by ParaSwap, KyberSwap, LI.FI, and Jupiter. It approves spender addresses returned by remote APIs and sends returned calldata with limited local verification. Jupiter swaps are sent with `skipPreflight: true`.

Why this matters:

If an aggregator response is compromised, DNS/TLS is intercepted, an API has a bug, or a malicious token/route manipulates build output, the wallet may approve or execute a transaction that does not match the user's expectation.

Fix:

- Maintain a per-chain whitelist of trusted router/spender addresses.
- Decode transaction calldata before signing.
- Verify:
  - chain id
  - router address
  - input token
  - output token
  - amount in
  - minimum amount out
  - recipient address
  - approval spender
  - approval amount
- Reject approvals to unknown spenders.
- Prefer exact-amount approvals.
- Warn strongly for unlimited approvals.
- Simulate EVM transactions with `eth_call` / tenderly-style simulation before broadcast.
- For Solana, decode the Jupiter transaction message enough to confirm expected program ids, source mint, output mint, token accounts, and signer count.
- Avoid `skipPreflight: true` unless there is a clearly documented reason and a local simulation step.

### 4. High: Web wallet stores encrypted private key in `localStorage` and has no CSP/security headers

Evidence:

- `NumPay/wallet/src/lib/wallet.ts:88`
- `NumPay/wallet/src/lib/wallet.ts:91`
- `NumPay/wallet/next.config.js:1`

The web wallet stores the encrypted private key in `localStorage`. The Next config has no Content Security Policy, frame protection, or other explicit security headers.

Why this matters:

Any XSS, malicious package, browser extension, or injected script can copy the encrypted vault for offline brute force. When unlocked, the raw private key also exists in React state.

Fix:

- For production custody, prefer the extension as the only signer.
- Treat the web app as non-custodial UI only, not a key holder.
- If the web wallet remains:
  - Add strict CSP.
  - Disallow inline scripts.
  - Set `frame-ancestors 'none'`.
  - Add `X-Frame-Options: DENY`.
  - Add `Referrer-Policy: no-referrer`.
  - Add `Permissions-Policy` with tight defaults.
  - Consider IndexedDB plus WebCrypto wrapping instead of `localStorage`.
  - Add auto-lock and memory clearing.
  - Use a stronger KDF plan, ideally Argon2id where available or a calibrated PBKDF2 fallback.

Example Next header direction:

```js
async headers() {
  return [
    {
      source: "/(.*)",
      headers: [
        { key: "Content-Security-Policy", value: "default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self'" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "no-referrer" },
        { key: "X-Content-Type-Options", value: "nosniff" }
      ]
    }
  ];
}
```

### 5. High: BPAN one-number-per-address invariant can be bypassed by transfer

Evidence:

- `BPAN/contracts/core/BANPRegistry.sol:159`
- `BPAN/contracts/core/BANPRegistry.sol:167`
- `BPAN/contracts/core/BANPRegistry.sol:402`
- `BPAN/contracts/core/BANPRegistry.sol:408`

`registerNumber` prevents an address from registering if it already owns a BPAN. But `_update` does not prevent someone from transferring another BPAN NFT to that same address.

Why this matters:

The contract comments and product assumption say each address may hold at most one BPAN. Transfers can violate that invariant.

Fix:

- Enforce the invariant in `_update` for non-mint, non-burn transfers.
- Example rule: if `to != address(0)` and `from != to`, require `balanceOf(to) == 0` before calling `super._update`.
- Add tests:
  - registering second BPAN from same address reverts
  - transferring BPAN to an address that already owns one reverts
  - transferring BPAN to an address with none succeeds
  - mappings still clear on successful transfer

### 6. Medium: Extension EVM send can use stale or wrong network after route prefill

Evidence:

- `NumPay/wallet-extension/src/popup/pages/Send.tsx:49`
- `NumPay/wallet-extension/src/popup/pages/Send.tsx:53`
- `NumPay/wallet-extension/src/popup/pages/Send.tsx:76`
- `NumPay/wallet-extension/src/popup/pages/Send.tsx:148`
- `NumPay/wallet-extension/src/popup/pages/Send.tsx:155`

The selected chain can be seeded from navigation state, but `handleEvmSend` signs using `network.rpcUrl` and `network.decimals`, which come from the global wallet network state.

Why this matters:

A user may think they are sending on one EVM chain while the signer uses another RPC/network. That can cause failed sends, wrong-chain sends, or misleading balances/fees.

Fix:

- Derive signer, decimals, explorer, and native symbol from `selectedChainId`, not from global `network`.
- Or force `switchChain(selectedChainId)` before allowing send.
- Add a guard that checks the provider network chain id equals the selected chain id before signing.

### 7. Medium: Extension host permissions are broader than needed

Evidence:

- `NumPay/wallet-extension/manifest.json:6`
- `NumPay/wallet-extension/manifest.json:7`

The extension declares `host_permissions: ["https://*/*"]`.

Why this matters:

Broad host permissions increase review friction and expand the blast radius of future content scripts or permission misuse.

Fix:

- Remove host permissions if not needed.
- If needed, restrict them to exact domains:
  - RPC provider hosts
  - BPAN API host
  - aggregator API hosts
  - token metadata hosts
- Avoid `<all_urls>` and broad HTTPS patterns.

### 8. Medium: Public RPC/API keys are hardcoded in source

Evidence:

- `NumPay/wallet-extension/src/lib/networks.ts:10`
- `NumPay/wallet-extension/src/lib/networks.ts:29`
- `NumPay/wallet-extension/src/lib/networks.ts:37`
- Similar hardcoded Alchemy key usage appears in history, token detail, auto-token, Solana, and migration code.

Why this matters:

Public client keys are not private secrets, but hardcoding them allows quota abuse and makes rotation harder.

Fix:

- Move keys to build-time config, for example `VITE_ALCHEMY_KEY`.
- Restrict provider keys by allowed origin/app where the provider supports it.
- Use separate keys for dev, test, staging, and production.
- Add a secret/API-key scan in CI.

### 9. Medium: Custom RPC URLs are accepted without scheme or safety validation

Evidence:

- `NumPay/wallet-extension/src/popup/pages/ManageAssets.tsx:169`
- `NumPay/wallet-extension/src/popup/pages/ManageAssets.tsx:181`
- `NumPay/wallet-extension/src/popup/pages/ManageAssets.tsx:188`

The custom network flow lets users save any RPC URL after `eth_chainId` responds. It does not clearly enforce HTTPS, localhost-only exceptions, chain-id uniqueness, or warnings for untrusted RPC providers.

Why this matters:

An untrusted RPC can lie about balances, gas, transaction state, and simulation results. It can also degrade availability or trick users through incorrect chain state.

Fix:

- Require `https://` for non-local RPC URLs.
- Allow `http://127.0.0.1`, `http://localhost`, and local dev addresses only in development mode.
- Warn that custom RPCs can lie about chain state.
- Check for duplicate chain ids and duplicate network names.
- Confirm the chain id from RPC matches the user's intended chain.

### 10. Low/Medium: BPAN API leaks existence through response shape

Evidence:

- `BPAN/api/src/routes.ts:28`
- `BPAN/api/src/routes.ts:45`
- `BPAN/api/src/routes.ts:78`
- `BPAN/api/src/index.ts:15`

The API returns different status codes and messages for invalid, unregistered, and unmapped numbers. It has a basic global rate limit.

Why this matters:

This enables enumeration of registered or mapped BPAN numbers. The threat model calls out generic errors and anti-enumeration behavior, but the implementation currently exposes existence.

Fix:

- Return a generic response shape for lookup failures.
- Add per-IP, per-session, and per-number throttling.
- Add response-time smoothing where practical.
- Consider making direct on-chain reads the source of truth for wallet clients, and use the API only as an optimization.

## Additional Observations

### Smart contract mapping cleanup is good

`BPAN/contracts/core/BANPRegistry.sol` clears mappings on successful transfer. That is a useful protection against stale mappings after ownership changes.

### TypeScript checks pass

No TypeScript errors were found in:

- `NumPay/wallet-extension`
- `NumPay/wallet`

### Existing uncommitted files

Before this report file was created, the repository already had these modified files:

- `NumPay/wallet-extension/src/popup/pages/Swap.tsx`
- `NumPay/wallet-extension/src/popup/pages/TokenDetail.tsx`
- `NumPay/wallet/tsconfig.tsbuildinfo`

Those were treated as existing user changes during review.

## Suggested Priority Order

1. Stop persisting decrypted extension secrets.
2. Fix auto-lock so it clears plaintext and is enforced on every popup/signing entry point.
3. Add local transaction verification for swaps/bridges before signing.
4. Decide whether the web wallet is production custody or demo-only; if production, add CSP and harden storage.
5. Fix the BPAN transfer invariant if one-number-per-address is a real protocol rule.
6. Fix selected-chain versus signer-network mismatch in extension send.
7. Narrow extension permissions.
8. Move public RPC keys to config and rotate them.
9. Harden custom RPC handling.
10. Reduce BPAN API enumeration leakage.
