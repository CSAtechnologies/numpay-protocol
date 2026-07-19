# NumPay Mobile (Android first): Architecture & Roadmap

**Date:** 2026-07-10
**Status:** Plan for review. No mobile code exists yet.
**Decision made:** React Native + Expo (dev client), shared TypeScript core with the extension.

---

## 1. Decision record

### Stack: React Native + Expo
The extension's `lib/` layer is the asset: signers for EVM/Solana/Tron/Sui/XRP/BTC/LTC,
BPAN quorum resolution with TOFU pins, swap guards, gas-hold checks, token
classification, tx log, currency. All of it is TypeScript with almost no DOM
dependency. React Native keeps that layer as-is; every alternative rewrites it.

Rejected:
- **Flutter**: full Dart rewrite of security-critical code, thinner wallet-crypto
  ecosystem, permanent double maintenance.
- **Kotlin native**: deepest platform integration but slowest for a solo web
  developer, same rewrite problem.
- **Capacitor/WebView**: fastest demo, weakest key custody story, Play review
  treats WebView wallets skeptically. Not acceptable for a wallet.

Expo is used with a **dev client / prebuild**, not Expo Go: secure storage,
biometrics, and MMKV need native modules that Expo Go cannot load.

### Distribution target
Google Play (closed testing track first), with the financial-features
declaration for a non-custodial wallet. Sideload APK for early internal betas.

---

## 2. Repo architecture: extract a shared core first

Move to a lightweight monorepo (npm workspaces is enough, no Nx/Turbo yet):

```
NumPay/
  packages/core/          <- extracted from wallet-extension/src/lib
  wallet-extension/       <- consumes core
  wallet-mobile/          <- new Expo app, consumes core
  wallet-api/             <- CF Worker (unchanged)
```

### What moves into `packages/core`
Everything in `wallet-extension/src/lib` that is platform-free today:
networks, bpan, swapGuards, txLog, currency, autoTokens, tokenSpam, walletApi,
env, the non-EVM signers, address validation. The popup pages and components
stay in the extension.

### The two abstractions that make it possible
1. **Storage.** Core currently calls `chrome.storage.local` (via helpers).
   Define a `KVStore` interface (get/set/remove, JSON values) injected at app
   start. Extension implements it with chrome.storage; mobile implements it
   with MMKV for hot state and Keystore-encrypted storage for secrets (see 3).
2. **Secrets/config.** Mobile must be **proxy-only from day one**. A mobile
   bundle is trivially unpackable, same as the extension, and mobile installs
   multiply provider quota consumption. Wallet-api steps 5 and 6 are therefore
   prerequisites, not parallel work.

### Runtime polyfills needed on RN
- `react-native-get-random-values` (crypto.getRandomValues for ethers/@noble)
- `@ethersproject`/ethers v6 works on RN with the above; verify pbkdf2/argon2
  paths (argon2 may need a native module or WASM alternative; see 3.3)
- Buffer/process shims for @solana/web3.js (standard RN polyfill set)
- No `fetch` shim needed (RN fetch is fine); WebSocket exists natively.

Verification step: a spike that imports core into a bare RN app and runs the
address-vector test suite (33 vectors) plus one signed-tx round trip per chain
family ON DEVICE before any UI work. This is the go/no-go gate for the whole
plan.

---

## 3. Security model on Android

### 3.1 Key custody and login: 6-digit PIN + biometrics (decided 2026-07-10)
Mobile login uses a **6-digit PIN** and **biometrics**, not a password.

A PIN has only 10^6 combinations, so it must NEVER be the sole encryption
factor: a vault encrypted purely from a PIN-derived key falls to offline
brute force in seconds once the file is extracted, no matter the KDF. The
design that makes a PIN safe is dual wrapping:

- Generate/import mnemonic in app memory only.
- The vault is encrypted with a random AES-256-GCM data key. That data key is
  wrapped by a non-exportable **Android Keystore** key (hardware-backed,
  StrongBox where available) AND bound to a PIN-derived key (Argon2id over
  the PIN + per-install salt). Unwrapping requires BOTH: the hardware key
  never leaves the chip, so an exfiltrated vault blob is useless without the
  physical device, and on-device guessing is gated below.
- **Biometric unlock** (BiometricPrompt with
  setUserAuthenticationRequired) releases the Keystore operation directly;
  the PIN is the fallback when biometrics fail, change, or the user opts out.
- **PIN attempt limiting**: wrong-PIN counter with exponential backoff
  (e.g. 5 free attempts, then 30 s / 5 min / 30 min); the counter state rides
  the same Keystore-gated storage so it cannot be trivially reset. Optional
  wipe-after-N is a Phase 3 setting, default OFF (self-DoS risk outweighs the
  gain while Keystore binding holds).
- **Recovery is the seed phrase, not the PIN.** The PIN and Keystore key are
  device-bound by design; a new device restores from the mnemonic (or an
  encrypted backup file, below) and sets a fresh PIN. Onboarding must say
  this in plain words: "your PIN unlocks this phone's copy; your recovery
  phrase is the wallet."
- Auto-lock timer identical in behavior to the extension.

### 3.2 Screen and process hygiene
- `FLAG_SECURE` on every screen that can show a secret (reveal seed, private
  key, backup flow) to block screenshots/recents thumbnails.
- Clipboard: auto-clear after N seconds when copying addresses is fine;
  copying secrets should use the reveal-and-type pattern, never clipboard.
- Root detection: warn, do not hard-block (honest UX, avoids an arms race).

### 3.3 KDF and vault parity (largely resolved by the PIN decision)
The PIN + Keystore design makes the primary mobile vault **device-bound by
construction**, so byte-level parity with the extension's password vault is
off the table for the live vault. Parity now applies only to the **portable
encrypted backup**: an explicit export protected by a real password (Argon2id,
same parameters and format as the extension vault), restorable on either
platform. The PIN never protects anything that leaves the device.

Argon2id on RN still needs a native module (react-native-argon2 family) or a
WASM build, both for the PIN stretch and the backup format; confirm in the
spike.

### 3.4 What carries over as rules, not code
The last months of extension fixes are captured as invariants core enforces:
swap/bridge guards (trusted router/spender, native-value bounds, fee-on-top
cap), upfront gas-hold affordability, BPAN finalized-tag + quorum + TOFU,
per-wallet scoping of logs/hidden tokens. Because they live in core, mobile
gets them for free and cannot drift.

---

## 4. Prerequisites (blocking Phase 1)

1. **wallet-api step 5**: measure upstream volume, move Moralis to a paid
   tier sized for two clients (extension + mobile), then strip bundle keys.
2. **wallet-api step 6**: privacy posture written into the compliance doc and
   a public privacy page. Mobile stores nothing new server-side, but Play
   Store requires a privacy policy URL at listing time anyway.
3. **Core extraction** (section 2) with the extension still green: tsc, build,
   both test suites, and a manual smoke of the popup against the refactor.
4. **The RN spike** (section 2, verification step).

The funded-retest backlog on feat/dapp-connect (7 commits from 2026-07-10 plus
earlier) should be burned down before or during Phase 0; mobile will inherit
whatever core bugs remain.

---

## 5. Phased roadmap

### Phase 0: Foundation
- wallet-api steps 5+6 done and verified.
- Monorepo + core extraction, extension re-verified.
- Expo skeleton: create/import wallet, PIN setup + attempt limiting,
  Keystore-wrapped vault, biometric unlock, auto-lock. On-device core test
  suite passes.
- Exit: a signed testnet tx from a phone, keys never leaving Keystore-gated
  storage; a wrong-PIN backoff demo; a seed-phrase restore onto a second
  device (or wiped emulator).

### Phase 1: MVP wallet
- Dashboard: balances via proxy (prices, tokens), chain filter, hidden/dust
  rules from core.
- Receive (address + QR), Send: EVM + Solana first, then Tron/Sui/XRP/BTC/LTC.
- BPAN resolve on send (core), BPAN display.
- Activity page fed by core txLog + proxy.
- Error UI: port AlertCard patterns (titled cards, amber vs danger).
- Exit: a real funded send on 3+ chains from a test device.

### Phase 2: Trading
- Swap + bridge flows (guards come from core; UI is new).
- Token pickers with spam classification, fiat lines, gas tiers.
- Exit: funded swap on Base/Arbitrum + one bridge, fee wallet accruing.

### Phase 3: Connectivity
- WalletConnect v2 (mobile's equivalent of the extension's dApp connect;
  session approval UI reuses the extension's permission concepts).
- Push notifications via FCM, fed by the Phase C webhook fan-out worker (one
  design serves extension WS and mobile push).
- BPAN registration/management in-app.

### Phase 4: Store launch
- Play closed testing -> production. Financial declaration, privacy policy,
  data-safety form. Marketing copy per compliance rules (no "insured/safe").

No estimates are stated as commitments; the honest unknowns are the RN spike
(days if clean, weeks if argon2/web3.js fight back) and Play review latency.

---

## 6. Out of scope (deliberate)
- iOS (follows Android once the core proves out; RN makes it mostly UI+
  Keychain work).
- On/off-ramp (compliance trapdoor, per posture doc).
- In-app dApp browser (WalletConnect covers the need first).
- Building any general indexer (standing rule).
- Web wallet resurrection.

## 7. Open questions to resolve during Phase 0
1. Portable backup format details (3.3): field layout shared with the
   extension vault, and where the export/import UI lives on each platform.
2. MMKV vs SQLite for tx log at mobile scale (start MMKV, revisit if Activity
   grows past thousands of rows).
3. Monorepo tooling: plain npm workspaces first; adopt Turbo only if build
   times hurt.
4. Whether BPAN registration (a mainnet write) ships in MVP or Phase 3.
