# dApp Connectivity: Security Review

Scope: the dApp connectivity feature added on branch `feat/dapp-connect`. Two
surfaces over one shared transport: the EVM `window.ethereum` / EIP-6963
provider (phases P1 to P4), and the Solana `window.solana` / Wallet Standard
provider (phases P1 to P4). This reviews the trust model, the threats the design
defends against, the hardening added in P4, and the residual risks that are
accepted for now. It complements `THREAT_MODEL.md` (wallet custody) and
`SECURITY_REQUIREMENTS.md`.

Last updated: 2026-06-20.

## 1. Architecture and trust boundary

Four layers, smallest trust at the top:

1. **Inpage provider** (`src/inpage/provider.ts`) runs in the page MAIN world.
   Fully untrusted: it shares the page's JS context. It holds no keys, does no
   signing, and only forwards `request()` calls and relays events. It is treated
   as hostile input by everything below it.
2. **Content bridge** (`src/content/bridge.ts`) runs in the ISOLATED world. This
   is the trust boundary. It stamps the REAL page origin
   (`window.location.origin`) onto every request and never trusts an origin
   supplied in a page message. It validates message shape and relays over a
   `chrome.runtime` port.
3. **Background router** (`src/background/dappRouter.ts`) routes EIP-1193
   methods. It trusts ONLY the origin recorded for the port, never an origin in
   the message payload. It handles connect, reads, and event fan-out, and it
   never touches key material.
4. **Approval window** (`src/approval/main.tsx`) is the only layer that decrypts
   and uses a key. It unlocks the active vault, decodes the request for human
   review, signs or broadcasts, and returns the result (signature or tx hash)
   for the router to relay.

The Solana surface (`src/inpage/solana.ts`, `src/lib/dapp/solPermissions.ts`,
the `sol_*` routes in the router, the `SolConnect`/`SolSign`/`SolSignTx` views)
mirrors this exactly. One difference matters for the trust model: the active
wallet's Solana address is **not** in cleartext vault metadata (only the EVM
address is); it is derived from the mnemonic at runtime. So the key-free router
cannot produce a Solana address on its own. It is derived only where a key is
already present: the approval window (for connect and for binding a signature),
and the popup (for the accountChanged-on-switch notification, where only the
derived public address — never the key — is passed to the router).

### Invariants

- **No keys below the approval window.** The provider, bridge, and router never
  see a private key. Signing and broadcasting happen only in the approval
  window, which holds the decrypted active wallet in session.
- **Origin is authoritative and page-supplied origin is ignored.** The bridge
  stamps the real origin; the router binds to the port-recorded origin.
- **Single active account.** Only the active wallet's key is in session
  (decrypt-only-active). Signatures and transactions are bound to the connected
  account and re-checked at sign time; a mid-flow wallet switch refuses rather
  than signing with the wrong key.
- **Every request settles.** Each method path replies (result or typed error),
  and the approval window rejects on close (`beforeunload`), so a dApp promise
  cannot silently hang under normal operation.

## 2. Threats and mitigations

| # | Threat | Mitigation |
|---|--------|------------|
| T1 | Page forges a different origin to inherit another site's connection | Origin stamped in the ISOLATED-world bridge from `window.location.origin`; router trusts only the port-recorded origin. Content scripts are top-frame only, so a cross-origin iframe cannot reach the bridge. |
| T2 | Silent account exposure without consent | `eth_accounts` returns only previously granted accounts; no silent reconnect. Grant requires the connect approval. Auto-lock broadcasts `accountsChanged: []`. |
| T3 | Signing for an account the user did not intend | Sign/send bind the target address to the connected account; the approval window re-verifies the session wallet matches at sign time. Under decrypt-only-active no other key is even present. |
| T4 | Blind-signing drainers (`eth_sign`) | `eth_sign` and legacy `eth_signTypedData` v1/v3 stay rejected (4200). Only `personal_sign` and `eth_signTypedData_v4` are supported. |
| T5 | Signature phishing (Permit / Permit2, wrong-chain) | Typed-data approval surfaces a warning for Permit/Permit2 token approvals and for a domain `chainId` that differs from the active chain. `personal_sign` shows decoded UTF-8 so the user reads what they sign. |
| T6 | Malicious transaction (unlimited approval, NFT approval-for-all) | Calldata is decoded; unlimited `approve`, `setApprovalForAll(true)`, `increaseAllowance`, and `permit` raise warnings. A pre-broadcast `estimateGas` simulation warns on a predicted revert. |
| T7 | Wrong-chain broadcast via a stale RPC | Before broadcasting, the window confirms the RPC's reported chain id matches the expected network (the Send-flow guard). |
| T8 | Site repoints a canonical network at a hostile RPC | `wallet_addEthereumChain` refuses to add or override a built-in chain id; a newly added RPC must actually serve the claimed chain id (`eth_chainId` probe) before it is saved. https-only. |
| T9 | Approval-window DoS (popup spam) | One interactive approval per origin at a time; a second concurrent interactive request is rejected with `-32002`. |
| T10 | Oversized payload (storage exhaustion, UI hang) | Sign/typed-data/calldata payloads over 128 KB are rejected with `-32602`. |
| T11 | Malformed payload crashes the approval render | The decoders (`signDecode`, `txDecode`) are throw-safe by construction and covered by an adversarial + fuzz suite (`test/dapp-adversarial.mjs`). |
| T12 | Slow / hostile RPC hangs a dApp promise | `proxyRead` and the add-chain `eth_chainId` probe use `AbortController` timeouts. |
| T13 | Worker suspends mid-approval, response stranded | Undeliverable responses are buffered in `storage.session` and flushed when a port re-registers; the bridge reconnects while a request is in flight so the buffer can drain. |
| T14 | Page drives arbitrary node methods through the wallet | Only an allowlist of read methods is proxied; everything else is handled explicitly or rejected. Reads go to NumPay's own configured RPC, never a page-supplied endpoint. |
| T15 | Content script spoofs an approval decision or a wallet-state change | The background trusts `MSG_DAPP_DECISION` / `MSG_DAPP_STATE_CHANGED` / `ACTIVITY` only from our own extension pages: `sender.id === chrome.runtime.id && !sender.tab` (an extension page has no tab; a content script in a web page does). There is no `externally_connectable`, so a web page cannot message the background at all. |

### Solana surface

| # | Threat | Mitigation |
|---|--------|------------|
| S1 | Blind-signing an arbitrary transaction (drainer) | `signTransaction` / `signAndSendTransaction` decode the serialized message and **bind the fee payer to the connected account before any key is used** (`signSolanaTransaction`); a mismatch is refused, not signed. `signAndSend` additionally requires the user to be the sole signer (numSigs == 1) and runs a `simulateTransaction` (sigVerify) guard before broadcasting. The approval shows the programs invoked, instruction count, and a warning when the message uses address lookup tables (whose accounts cannot be resolved offline). |
| S2 | signMessage phishing / unreadable bytes | The message is carried as base64 and decoded for display: valid UTF-8 is shown as text (control-character soup rejected), otherwise the raw base64 is shown so the user sees exactly what they sign. |
| S3 | Signing for the wrong account after a mid-flow wallet switch | The approval re-derives the Solana address from the session mnemonic and binds `address === pending.account` at sign time; a switch refuses rather than signing with a different key. |
| S4 | Stale Solana account exposed after a wallet switch (P1 gap) | A wallet switch now threads Solana `accountChanged`: the popup derives the new public address and the router re-points every connected Solana origin and emits the event. A new wallet with no Solana account (or a lock) drops the connection instead of leaving a stale account. Auto-lock emits Solana `disconnect`. |
| S5 | Malformed transaction bytes crash or OOM the approval render | `inspectSolanaTransaction` / `decodeSolanaMessage` are throw-safe and **bound their account-key and instruction loops by the remaining buffer** — a hostile compact-u16 count (up to ~2M) can no longer drive millions of allocations and white-screen the approval. Covered by the adversarial + byte-fuzz suite. |
| S6 | Oversized transaction payload | The serialized-transaction base64 is subject to the same 128 KB `MAX_PAYLOAD_BYTES` cap (`-32602`). |

## 3. Residual risks (accepted for now)

- **Read proxy as a CORS bypass.** A page can use the allowlisted read methods
  against NumPay's RPC. The data is public chain state and no key is involved;
  the abuse value is low. Accepted.
- **Worker-restart edge.** The buffer-and-reconnect design (T13) covers the
  common slow-approval case. A pathological sequence (repeated restarts, page
  closed before the buffer drains) can still drop a response; the dApp can
  re-request. Not a custody risk.
- **Phishing UX.** Warnings make dangerous requests legible but do not block
  them; a determined user can still approve a malicious Permit. This is the
  standard wallet posture (inform, do not override the user).
- **Broad host match.** Two content scripts match `http://*/*` and
  `https://*/*` (the provider must be present everywhere a dApp might run). This
  is the headline permissions cost and a Web Store review point, not a runtime
  vulnerability: the scripts hold no keys.

## 4. Test coverage

- `test/dapp-adversarial.mjs` (`npm run test:dapp`): hostile and malformed input
  for `signDecode`, `txDecode`, `chainOps`, `solDecode`, and
  `inspectSolanaTransaction`, plus two 2000-iteration fuzz loops (random hex for
  the decoders, random byte arrays for the Solana transaction inspector)
  asserting nothing throws. 71 assertions.
- `test/verify-address-vectors.mjs` (`npm run test:vectors`): 33 address vectors
  (unchanged by this feature).
- Offline signing round-trips confirm signatures recover/verify to the signer:
  EVM `personal_sign`, EIP-712 Mail and Permit2; Solana ed25519 signMessage.

## 5. Follow-ups

- Browser smoke-test of the EVM P2 / P3 flows and the full Solana surface
  (connect, signMessage, signTransaction / signAllTransactions /
  signAndSendTransaction, and accountChanged-on-switch) — these have been
  built and unit/fuzz-tested but not yet click-tested live.
- Account-picker fast-follow (currently single active account by design).
- Consider rate-limiting read proxying per origin if abuse is observed.
- Solana lacks a per-transaction risk decoder equivalent to the EVM calldata
  checks (unlimited-approval etc.); previews rely on program identification +
  simulation. A deeper SPL-instruction decoder is a candidate follow-up.
