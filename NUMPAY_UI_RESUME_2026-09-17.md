# Mobile UI resume, September 17

## Requested scope

The user approved the Android V2 redesign for every mobile page and asked for
GPT-5.6 Sol to implement it under the main agent's review. Preserve wallet,
signing, storage, transaction, and security behavior. Work locally.

Reference: `design/numpay-android-v2/numpay-android-v2.html` and `DESIGN-SPEC.md`.
The working tree includes earlier contract, extension, and wallet changes;
do not discard or attribute those to this presentation pass.

## Saved implementation

Earlier work includes three rectangular dashboard actions, compact BPAN/DeFi
links, an inline asset filter, and slim five-destination bottom navigation.
The resumed pass changes:

- Wallet header: account switcher, Scan, Browser. Lock remains in Settings.
- Activity: All/Sent/Received filters, matching empty states, header refresh.
- Settings: primary groups use open divider lists.
- BPAN: prominent owned number, Copy/Share/Lookup actions, expandable mappings,
  and underline navigation tabs.
- App and preview callers match the updated WalletOverview props.

Files: `NumPay/wallet-mobile/App.tsx`, `src/ui/WalletOverview.tsx`,
`src/preview/PreviewWorkbench.tsx`, and screens `ActivityScreen.tsx`,
`SettingsScreen.tsx`, `BPANScreen.tsx`.

## Validation

Sol ran `npx tsc --noEmit`, full `npm test` (507 checks, zero failures), and
`git diff --check` successfully. Native visual review is in progress and is
not yet a whole-app sign-off. No release, commit, or deployment was performed.

Final review fixes: Activity tabs/refresh have 44dp targets. BPAN readiness
copy requires loaded, nonempty mappings; the unloaded state says
"Registered payment identity." Removed the unused card owner read. TypeScript
and whitespace checks passed again after these fixes.

## QA environment

Only `NumPay_QA_API35` (`emulator-5558`) is used. Do not reset either Pixel7
wallet AVD. The existing QA wallet can be unlocked using its established
test-only PIN; no wallet reset was needed in this session.

Metro runs on 8081 but Expo's localhost option bound only IPv6 `::1`.
`adb reverse tcp:8081 tcp:8081` connects over IPv4, causing the app to fall
back to a missing packaged bundle. Local helper
`qa/mobile-ui-resume-2026-09-13/metro-ipv4.cjs` bridges `127.0.0.1:8081` to
`::1:8081`. Its process and Metro must be running for that setup. Use the
React Native dev menu's Reload after connecting. The helper is QA-only.

Next: finish native light/dark review, record exact states inspected here,
and preserve any remaining gaps without claiming full device coverage.

The bundle downloaded successfully (2,257 modules, about 12 seconds), but
the long-lived debug app subsequently displayed Android's "isn't responding"
dialog. Closed it through that dialog and relaunched normally. This runtime
issue blocks a fresh visual sign-off; it has not been attributed to the UI
changes. No wallet storage was cleared.

## September 20 continuation

The dedicated `NumPay_QA_API35` AVD was relaunched in a visible emulator window
as `emulator-5554`. The serial is assigned per boot; the AVD identity remained
the same. Wallet storage was preserved, Metro and the local IPv4 bridge were
reconnected, and the established test wallet unlocked with one PIN attempt.

The earlier black interval was reproduced and traced to the debug build taking
about 12 seconds to load and initialize its Metro bundle. The prior ANR remains
recorded in Android's historical exit info, but no new ANR occurred. Live logs
did reveal two actionable runtime problems: the lockout clock re-rendered the
whole app every second while no lockout was active, and `BottomNav` rebuilt its
native `Animated.add`/`Animated.multiply` graph on every parent render. Android
then reported an illegal animated node ID race and Expo showed its debug warning
banner. `App.tsx` now arms the one-second clock only for an active lockout, and
`src/ui/BottomNav.tsx` memoizes the measured indicator graph. The motion-system
test covers both regressions.

Native states inspected at 1080x2400 in the Expo/Metro debug client:

- Light and dark Wallet home, including account/Scan/Browser header, balance,
  Send/Receive/Swap actions, BPAN/DeFi links, asset filter, asset rows, hidden
  count, and five-item bottom navigation.
- Light Activity empty state with All, Sent and Received filters plus refresh;
  dark Activity empty state.
- Light BPAN RPC-unavailable state, Register form, no-BPAN Mapping state and
  Lookup form; dark BPAN RPC-unavailable state.
- Light and dark Settings at the account, security, connections, preferences
  and danger-zone portions; theme switching between Light and Dark. The QA
  preference was restored to System afterward.
- Rapid bottom-tab changes after the runtime fix. Seven changes completed with
  no `NativeAnimatedNodesManager`, illegal-node, fatal or ANR entry.

Fresh post-fix evidence is under
`NumPay/wallet-mobile/qa/ui-resume-final/*-post-fix` and
`NumPay/wallet-mobile/qa/ui-resume-final/wallet-post-fix`. An eight-second idle
log window produced none of the former repeating status-bar or native-animation
warnings. Frame reports come from the debug client and emulator and are not a
release-performance claim; the captured slice showed roughly 5.9-7.9% janky
frames by Android's current metric, with debug startup and network work included.

Validation after the runtime fix: `npx tsc --noEmit`, full `npm test` (550
checks, zero failures), targeted motion test (24 checks, zero failures), and
`git diff --check` passed. The visible emulator remains open on Wallet with the
System theme. No release, commit or deployment was performed.

This completes the fresh native review for the resumed Wallet/Activity/BPAN/
Settings slice. It is not a whole-app device sign-off. Still uninspected in this
continuation are owned-BPAN and populated-activity data states, transaction and
destructive confirmations, keyboard-open layouts, offline interactions beyond
the BPAN RPC failure, reduced-motion behavior on-device, and the remaining Pay,
Receive, Swap, DeFi, Browser, WalletConnect, token-detail and asset-management
flows.

## September 20 BPAN write integration

The mobile Base registration and mapping paths now use the shared confirmation
sheet before any signature or broadcast. Registration rechecks availability,
estimates gas with a 20% limit margin, reads the live protocol fee and Base ETH
balance, and previews all values. Mapping derives its exact batch from fresh
registry state, rewrites stale per-chain EVM overrides when the synthetic `evm`
destination changes, estimates the batch, and previews each address. Immediately
before signing, registration checks availability again; mapping checks current
ownership and rejects any plan that changed after review. Successful
registration still refreshes ownership/cache and opens Mapping, while Send
continues to resolve BPAN recipients through finalized multi-provider consensus.

Validation: `npx tsc --noEmit`, full `npm test` (561 checks, zero failures), and
`git diff --check` passed. The dedicated visible AVD was relaunched without
clearing wallet storage and reached the existing Welcome back PIN screen. Final
on-device review of the new confirmation sheets requires the user to unlock that
preserved wallet. No PIN was automated and no Base mainnet transaction was
broadcast.

## September 22 startup balance continuation

The wallet no longer opens on an empty asset canvas while network reads are in
flight. `useMobileWallet` starts with visible Ethereum, Bitcoin, Solana, BNB
Chain and Sui native rows, uses the stored snapshot when available, and replaces
the placeholders with live balances as providers respond. A slow fiat-price
request is no longer on the balance critical path: both the mobile refresh and
the shared EVM sweep wait at most 1.5 seconds for prices, then apply final pricing
in the background without removing the already-painted balances.
Token discovery and custom-token balance reads now start as soon as the wallet's
public addresses are ready, in parallel with the native sweep, so a slow native
provider cannot add its timeout before held tokens begin to paint.

The visible `NumPay_QA_API35` emulator rendered all five native rows after Fast
Refresh instead of the former "No assets found" state. The preserved QA wallet
currently has zero balances, and the app later auto-locked, so the PIN was not
automated. Android's HTTPS traffic in this environment is intercepted by a local
CA the emulator does not trust; therefore this is first-paint/on-device evidence,
not a remote-provider latency benchmark. The temporary BPAN QA RPC harness was
removed and the product configuration points back to the real Base RPC.

Validation: `npx tsc --noEmit`, full `npm test` (570 checks, zero failures), the
new startup regression test (9 checks), and whitespace checks passed. No release,
commit, deployment or mainnet transaction was performed.

## September 25 remaining-flow QA continuation

The preserved `NumPay_QA_API35` AVD was resumed as `emulator-5554` without
clearing or reinstalling the wallet. Metro's first debug bundle completed in
9.6 seconds, the existing QA wallet was unlocked by the user, and no new ANR or
native-animation failure appeared.

The remaining non-transactional Android V2 surfaces were reviewed at 1080x2400:

- Light and dark Pay/Send, including the address field with the keyboard open.
- Light Receive, including chain selection, QR layout and actions. The capture
  containing the test address and QR code was removed after visual inspection.
- Light and dark Swap and token detail, including zero-balance and no-chart/
  no-transaction states.
- Light and dark asset management, plus the light custom-network form and its
  untrusted-RPC warning.
- Light and dark Browser, DeFi and Connected dApps/WalletConnect empty states.
- Reduced-motion mode with eight rapid bottom-tab changes. The selected tab and
  destination stayed synchronized, with no blank route or native animation error.
- Fully offline local navigation across Wallet, Pay, BPAN, Settings and Activity,
  followed by an Activity refresh. Navigation stayed responsive and no raw
  provider error appeared.

The AVD was restored to its original animation scales, Wi-Fi/mobile connectivity
and System theme. Evidence is under
`NumPay/wallet-mobile/qa/ui-resume-2026-09-25`; screenshots/XML containing the
test address, QR code or dashboard BPAN were removed. TypeScript, the full mobile
suite (570 checks, zero failures) and `git diff --check` passed. This was an
Expo/Metro debug-client review, not a release-performance claim.

Still uninspected on-device are an owned-BPAN write confirmation, populated
activity and transaction detail, nonzero-balance send/swap confirmation and
result states, a real WalletConnect/dApp signing request, and destructive wallet
confirmations. Those require suitable disposable test data or a transaction
harness; no signature, broadcast, wallet reset, release, commit or deployment
was performed here.

## September 30 build continuation

The September 26 source work now has end-to-end local build validation. Startup
routing reads the RAM session and vault presence concurrently, defers the full
security-status refresh, keeps PIN unlock single-flight and enables Metro inline
requires. Balance refresh wakes on foreground and connectivity recovery, keeps a
battery-aware foreground interval, and expands the closed-app receive watcher to
token balances with a versioned snapshot migration.

The release build exposed 22 chain/token logo files containing WebP bytes behind
`.png` names. Those assets were losslessly normalized to real PNG containers,
and `test/asset-format.mjs` now checks the PNG signature of all 202 mobile assets.
The signed split release build then completed successfully and produced:

- `app-arm64-v8a-release.apk`, 45.34 MiB, SHA-256
  `44d6df1f9bf1992363a5daec9f1bf9fae1cc67816786862038084b5dc52c7cc5`
- `app-armeabi-v7a-release.apk`, 38.21 MiB, SHA-256
  `68391f0f075c1ba19acd64608c2d30d482fbe1b97bb90525d7037375bbd7ae3e`
- `app-universal-release.apk`, 107.19 MiB, SHA-256
  `b7dc43c0cb98bd47b127dd8356cb3af6fd738f14ba913a28421614dec88ffceb`

All three report versionCode 6/versionName 1.02, minSdk 24, targetSdk 36,
APK Signature Scheme v2, and the established `CN=NumPay, O=NumPay, C=NG`
RSA 4096 signer. The ABI splits contain only their named ABI; the universal APK
contains arm64-v8a, armeabi-v7a, x86 and x86_64. The host's Avast HTTPS
inspection required a temporary build-only Java trust store to download one
Maven artifact. No release network-security setting was changed.

Validation: `npx tsc --noEmit`, the full mobile suite including the new 202-file
asset gate, `git diff --check`, Gradle release lint and
`app:assembleRelease -PnumpaySplitAbi=true` all passed. The APKs remain only in
the ignored Android build output. They were not installed, copied to the
distribution folder, uploaded or published. Because public build 6 hashes were
already documented previously, these newly built build-6 files are verification
artifacts and must not be distributed without a versioned release update.

No emulator was connected during this continuation, so the remaining on-device
transaction, signing and destructive-state gaps above remain unchanged.

## September 30 versioned Android release continuation

Android release metadata was advanced from versionCode 6/versionName 1.02 to
versionCode 7/versionName 1.03 in both the Expo configuration and checked-in
native Gradle configuration. The signed ABI-split build completed successfully:

- `app-arm64-v8a-release.apk`, 47,537,503 bytes, SHA-256
  `9233fcebb35767fadca24455adf9321c43aa288a32353a810069c40f4c8662e3`
- `app-armeabi-v7a-release.apk`, 40,065,411 bytes, SHA-256
  `86af74122a21878ec9f7062c5dcad72ba2850f4209593a71e18d7342e4a1a09a`
- `app-universal-release.apk`, 112,393,316 bytes, SHA-256
  `bc5f6f1bc51890a7b155aa391729edf8c4471da0137e8ff60fe52e1b3e84bb7a`

Direct APK inspection confirms package `com.anonymous.walletmobile`, versionCode
7, versionName 1.03, minSdk 24 and targetSdk 36. APK Signature Scheme v2
verification passes with the established `CN=NumPay, O=NumPay, C=NG` RSA 4096
signer and certificate SHA-256
`cad2b8799f32446e944871ed30bc4a7d805fce525d746f339ca55dc78a37293d`.
The arm64 artifact was copied to
`C:\Users\HP OMEN\Desktop\NumPay-1.03-arm64-v8a.apk`, and its hash matches the
build output byte-for-byte. Nothing was installed, uploaded or published.
