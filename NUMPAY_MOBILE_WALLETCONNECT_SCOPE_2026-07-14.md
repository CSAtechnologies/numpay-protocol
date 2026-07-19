# NumPay Mobile: WalletConnect v2 scoping

**Status:** scoping only. No code, no dependency added yet. This exists so the
dependency + external-service decisions get made before any build starts.
**Date:** 2026-07-14. **Phase:** 3 (Connectivity), the anchor item.
**Blocks on you:** a dependency approval and a Reown Cloud account (see §2).

Facts below about the SDK were verified against reown.com / npm on 2026-07-14
and are flagged where they must be re-checked at build time (the SDK moves
fast; do not trust this doc's version numbers months from now).

---

## 1. What this delivers and why it's the anchor

WalletConnect v2 is how a mobile wallet connects to dApps it is not embedded
in: the user scans a QR (or follows a `wc:` deep link), approves a session, and
the dApp can then request signatures and transactions that NumPay signs with the
keys already in the vault. It is the mobile equivalent of the extension's
`window.ethereum` / `window.solana` dApp-connect, which is already built and
live (see the dApp-connect and dApp-Solana memories). Without it, mobile can
only send/swap/bridge/BPAN from inside NumPay; with it, mobile is a first-class
signer for the whole ecosystem. That is why the roadmap calls it the Phase 3
anchor.

## 2. Decisions required BEFORE building (the ask-first items)

1. **New dependency: `@reown/walletkit`** (the current WalletConnect wallet SDK;
   `@walletconnect/web3wallet` is the deprecated predecessor). Verified current
   npm version 1.5.6 as of 2026-07-14; RN is a first-class supported target.
   Adding it is a CLAUDE.md "ask first" item, and for a wallet the SDK sits on
   the signing path, so it deserves a deliberate yes.
2. **Reown Cloud projectId** — WalletKit requires a free projectId from
   cloud.reown.com to relay pairing traffic. This is an external account only
   you can create. It is not a custody or key service (the relay only moves
   encrypted session messages; keys never leave the device), but it is a
   third-party service dependency, so it needs sign-off and belongs in the
   privacy page's sub-processor list.
3. **Peer dependencies WalletKit pulls in** (verified list, re-confirm at build):
   `@react-native-async-storage/async-storage`, `@react-native-community/netinfo`,
   `react-native-get-random-values` (ALREADY in the app), `fast-text-encoding`.
   Plus, for the wallet side: a QR scanner (`expo-camera`) and deep-link handling
   (`expo-linking` + a `scheme` in app.json) so `wc:` links open NumPay.

If any of these is a no, WalletConnect does not proceed and FCM/other Phase 3
work should be resequenced ahead of it.

## 3. Architecture (how it slots into what exists)

The winning move is the same one that made swap/bridge/BPAN clean: **the
request-handling and decoding logic is platform-free and belongs in
`@numpay/core`; only the transport and the approval UI are new per platform.**

The extension already has all the request logic:
- `wallet-extension/src/background/dappRouter.ts` — routes EVM/Solana requests.
- `wallet-extension/src/lib/dapp/{txDecode,signDecode,solDecode,types}.ts` —
  human-readable decode + safety framing of each request (the "what am I
  signing" preview).
- `wallet-extension/src/approval/main.tsx` — the approval UI concepts.

Proposed shape:
1. **Extract** the dApp request router + decoders from the extension into
   `@numpay/core/dapp` (verbatim, thin callers left behind), the same refactor
   pattern as `@numpay/core/swap`. This is the biggest single work item and it
   also pays back the extension (shared code, one place to audit).
2. **Mobile transport = WalletKit.** A small `src/walletconnect/` module:
   init WalletKit with the projectId + wallet metadata; subscribe to
   `session_proposal` and `session_request`; map each into the core router;
   return signatures via WalletKit's `respondSessionRequest`.
3. **Pairing entry points:** a QR scanner screen (scan the dApp's code) and a
   deep-link handler for `wc:` URIs (so "open in wallet" buttons work). Both
   feed WalletKit's `pair({ uri })`.
4. **Approval UI (new, mobile):** two surfaces — a session-proposal screen
   (which dApp, which chains/accounts/methods it wants; reuse the extension's
   permission concepts and copy) and a per-request signing sheet (renders the
   core decoder's preview, then signs with the vault via the SAME gated
   `getUnlockedMnemonic → getSigner` path used by Send/Swap/BPAN).
5. **Sessions list:** a screen to see and disconnect active dApp sessions.

Namespaces: support `eip155` (EVM) first — it reuses the finished EVM signing
path. `solana` namespace is a fast follow (the Solana signing path also already
exists). Non-EVM/Solana namespaces are out of scope for the first pass.

## 4. Security posture (this is the signing path — treat as high-care)

- Every request is user-approved; nothing auto-signs. The signing sheet must
  show the core decoder's plain-language preview, never a raw hex blob.
- Scope sessions to explicit chains + methods; reject requests for methods the
  session did not negotiate.
- Show the dApp's verified origin / verify-context from WalletKit and warn on
  unverified or flagged domains (mirror the extension's dApp warnings).
- Reuse the vault lock discipline: a write/sign re-checks `getUnlockedMnemonic`
  and surfaces the re-auth overlay on expiry (H-06 parity with Send/BPAN).
- The relay sees only encrypted session traffic; document it as a transit-only
  sub-processor in the privacy page, alongside the wallet-API proxy.
- Never expose `eth_sign` (blind sign) without the same guardrails the
  extension applies; prefer `personal_sign` / typed-data with decode.

## 5. Proposed sequencing (slices, once §2 is approved)

- **Slice 0:** add the dependency + projectId config + polyfills; WalletKit
  inits and pairs against a test dApp, no signing yet (prove transport).
- **Slice 1:** extract the dApp router + decoders into `@numpay/core/dapp`
  (extension retrofitted to thin callers; tsc + tests + build green).
- **Slice 2:** session-proposal approval screen + sessions list (eip155).
- **Slice 3:** per-request signing sheet wired to the core decoders + vault
  signer (eip155): `personal_sign`, `eth_signTypedData_v4`,
  `eth_sendTransaction`.
- **Slice 4:** QR scanner + `wc:` deep-link entry points.
- **Slice 5:** `solana` namespace (reuse the Solana signing path).
- Exit: a live session with a real dApp from a phone, signing a message and
  sending a transaction, each behind an approval sheet.

## 6. Open decisions for you

1. Approve the `@reown/walletkit` dependency? (yes/no)
2. Will you create the Reown Cloud projectId, or want the build to stub the
   transport until you do?
3. QR scanner: `expo-camera` acceptable, or do you have a preferred scanner?
4. EVM-first with Solana as a fast follow — agreed, or Solana in the first pass?
5. Does WalletConnect go ahead of FCM push, or do you want push first?

## 7. Out of scope (first pass)

- FCM push notifications (separate Phase 3 item; needs Firebase + the unbuilt
  Phase C fan-out worker).
- iOS specifics (RN makes it mostly reuse; handled at the store-launch phase).
- Non-EVM/Solana WalletConnect namespaces.
- In-app dApp browser (WalletConnect covers the connect need first, per the
  mobile plan's out-of-scope list).
