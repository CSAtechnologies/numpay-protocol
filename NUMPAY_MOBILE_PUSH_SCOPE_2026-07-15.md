# NumPay Mobile: push notifications scoping (the last Phase 3 item)

**Status:** scoping only. No code, no dependency, no account created.
**Date:** 2026-07-15. **Phase:** 3 (Connectivity), final item after WalletConnect
shipped and passed its exit test.
**Blocks on you:** an approach decision (section 2) and, for the full option,
two external accounts (Firebase, provider webhooks) plus a deliberate privacy
call (section 5).

Facts below were verified against expo.dev / alchemy.com / helius.dev /
cloudflare.com docs on 2026-07-15 and are flagged where they must be re-checked
at build time.

---

## 1. What push delivers and the tension to be honest about

The mobile plan's Phase 3 line: "Push notifications via FCM, fed by the Phase C
webhook fan-out worker (one design serves extension WS and mobile push)." The
value is one thing only, for now: **"you received funds" while the app is
closed.** Everything else the wallet notifies about (send results, WalletConnect
requests while the app is open) already works in-app.

The tension: the wallet-api spec (section 8) explicitly parks the fan-out
worker as **post-launch** ("Not in v1... separate spec"). Building full FCM push
now pulls a post-launch backend into Phase 3, and it would be the first NumPay
component that **stores user data server-side** (address-to-device mappings;
today the proxy is stateless by design and the privacy page says so). That is
not a reason to refuse it, but it is a real scope and posture change that
deserves an explicit yes, not a drive-by.

## 2. The decision: three options

### Option A: local polling notifications, no backend (recommended for beta)
The app already sweeps balances. Add an OS-scheduled background fetch that runs
the same lean sweep and fires a LOCAL notification when a balance increased.

- New pieces: `expo-background-fetch` + `expo-task-manager` (OS task), and
  `expo-notifications` for the local notification. All Expo SDK packages, no
  external service, no Firebase, no backend, no server-side address storage.
- Delivery reality (be honest in the UI): Android schedules background fetch
  loosely; ~15 minutes is the floor and the OS can defer or skip on Doze /
  battery saver. This is "you got paid, within the hour", not realtime.
  (Re-verify the interval floor at build time.)
- Cost: zero. Privacy: zero change (nothing leaves the device).
- Effort: small (one slice). Reuses `useMobileWallet`'s sweep internals.

### Option B: full FCM push via the Phase C fan-out worker (realtime, backend)
Provider webhooks watch registered addresses; a Cloudflare worker receives the
webhook, looks up the device token for the address, and sends the push.

- Chain watching (verified free tiers):
  - Alchemy address-activity webhooks: 5 webhooks per account free, up to
    100,000 addresses per webhook, billed as CU (~40 CU per event against the
    30M CU/month free allowance). Covers the Alchemy EVM chains.
  - Helius (Solana): free plan includes exactly 1 webhook, up to 100,000
    addresses. Note we already lean on Helius for Solana reads; same account.
  - Chains with neither (Tron, Sui, XRP, BTC, LTC, the non-Alchemy EVMs) get
    NO push in v1; the app's next open catches those. Say so in the doc/UI.
- Fan-out worker: extends `wallet-api` (or a sibling worker). Needs persistent
  state (address -> Expo push token). Durable Objects now exist on the Workers
  FREE plan (SQLite-backed only: 5 GB total, ~150M row reads / 3M row writes
  per month free; storage billing for SQLite DOs starts January 2026, so this
  is no longer a "paid plan only" blocker but IS a small real cost at scale.
  Re-verify pricing at build time.)
- Push delivery: use the Expo push service rather than raw FCM. Backend POSTs
  to `https://exp.host/--/api/v2/push/send` with Expo push tokens (free,
  documented ceiling 600 notifications/second/project). IMPORTANT verified
  catch: Android delivery still requires real FCM credentials in the app
  build: a Firebase project + `google-services.json` wired via app.json, then
  a native rebuild. Expo's service simplifies the SERVER side, not the
  Firebase requirement.
- External accounts you must create: Firebase project (free), webhook
  registrations on the Alchemy + Helius dashboards.
- Effort: the largest remaining Phase 3 item by far (worker + registration
  API + client integration + privacy work).

### Option C: A now, B after launch (the spec's original sequencing)
Ship Option A in Phase 3 so the beta has "you got paid" at all, and build
Option B as the separate post-launch Phase C spec it was always planned to be,
when user counts justify a backend. A's client work (notification permission,
notification channel, the "balance increased" diffing) carries over to B
unchanged; only the trigger source changes (OS timer -> push).

**Recommendation: Option C.** It matches the existing spec's sequencing,
costs nothing now, avoids taking on server-side address storage before the
privacy page and compliance posture are updated for it, and loses only
latency (an hour-ish vs realtime) during beta, when the user count is tiny.

## 3. Decisions required from you

1. A, B, or C? (C recommended.)
2. If B (now or later): you create the Firebase project and the
   Alchemy/Helius webhook registrations; both are external accounts.
3. If B: sign off on the privacy change in section 5 BEFORE any code.
4. Notification content: amount + chain ("Received 0.5 SOL")? Or a bare
   "Balance updated" (leaks less if notifications show on the lock screen)?
   Applies to A and B equally. Default proposal: bare text, amount behind tap.

## 4. Option A sketch (what Phase 3 would actually build)

- `expo-notifications` (permission prompt, Android channel, local notify) +
  `expo-background-fetch`/`expo-task-manager` (registered task). All need a
  native rebuild (config plugins), same cycle as expo-camera was.
- Task body: read cached addresses (NO key material in the background task),
  run the lean native-balance sweep with short timeouts, compare against the
  last-notified snapshot in MMKV, notify on increase, store new snapshot.
- Zero notifications when the vault has never been set up, and no decryption
  anywhere in the path (addresses are cached public data).
- Verify headless: task logic unit-testable (diff + threshold rules); the
  OS-scheduling behavior is emulator/device territory.

## 5. Privacy posture (Option B only, decide before building)

Registering for push means the worker persistently stores, per user:
device push token + the addresses to watch. That is exactly the linkage the
stateless proxy design avoided, and it is the first genuinely personal data
NumPay would hold server-side.

- Privacy page: new sub-processor entries (Firebase/Google, Expo push,
  Alchemy/Helius webhooks) AND a new "what we store" section with a deletion
  story (unregister on wipe/uninstall; TTL tokens that expire without renewal).
- NDPA/GDPR: address+token is likely personal data; needs the deletion story
  and a lawful-basis line in the compliance posture doc.
- Minimization: store token -> addresses only, no BPAN, no balances, no
  history; DO memory/SQLite only; no analytics on it.

## 6. Out of scope (all options, first pass)

- iOS push (APNs) - lands with the store-launch phase like the rest of iOS.
- Extension WS fan-out (the other half of Phase C) - unchanged, post-launch.
- Notifying on outgoing/spend activity, price alerts, marketing pushes.
- Non-webhook chains in Option B (Tron/Sui/XRP/BTC/LTC): app-open catch-up.
