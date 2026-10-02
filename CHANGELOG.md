# NUMPAY Changelog

Project log of meaningful changes. Most recent first.

## 2026-09-30: Produce the versioned NumPay 1.03 Android release

Bumped the Android release from versionCode 6/versionName 1.02 to versionCode
7/versionName 1.03, rebuilt the signed ABI-split release, and verified the
arm64 APK metadata and established NumPay RSA 4096/v2 signature. The verified
arm64 artifact was copied to `C:\Users\HP OMEN\Desktop\NumPay-1.03-arm64-v8a.apk`;
its SHA-256 is
`9233fcebb35767fadca24455adf9321c43aa288a32353a810069c40f4c8662e3`.
The copied file matches the build output byte-for-byte. Nothing was installed,
uploaded or published.

## 2026-09-30: Complete the mobile release-build verification

Resumed the September 26 startup and balance-sync work, then completed a signed
Android release build. Twenty-two logo files had WebP bytes behind `.png`
extensions; they now contain real PNG data, and the mobile suite includes an
asset-signature gate covering all 202 PNGs. The release build produced arm64,
armeabi-v7a and universal APKs at versionCode 6, all signed by the established
NumPay RSA 4096 certificate with APK Signature Scheme v2. This was a local build
verification only. The APKs were not copied to the distribution folder,
installed, uploaded or published, and build 6 must not be redistributed under
new hashes without updating the release plan. TypeScript, the full mobile suite
and whitespace checks pass.

## 2026-09-25: Complete the remaining non-transactional Android UI review

Resumed the preserved QA AVD and reviewed Pay/Send, Receive, Swap, token detail,
asset and network management, Browser, DeFi, and Connected dApps in the Expo/
Metro debug client. Representative light and dark states, the send keyboard
layout, reduced-motion rapid navigation, and fully offline local navigation were
all exercised. No blank route, native animation error, fatal entry, ANR, or raw
offline provider error appeared. The emulator was restored to its original
animation, network and System-theme settings. TypeScript, all 570 mobile checks
and whitespace checks pass. Transactional, populated-data, signing and
destructive confirmation states remain explicitly outside this device pass.

## 2026-09-22: Paint wallet assets immediately while balances refresh

Removed the blank/"No assets found" startup interval from the mobile wallet.
Ethereum, Bitcoin, Solana, BNB Chain and Sui now have immediate first-paint rows
even before a cache or provider responds. Native balance reads no longer wait on
slow fiat-price services: pricing gets a 1.5-second fast-path window and can
finish in the background without hiding balances. Token discovery and custom
token reads also start immediately, in parallel with native-chain requests.
Live reads retain the existing per-provider timeouts and offline fallbacks. The
dedicated Android QA emulator rendered all five rows after Fast Refresh; its
preserved wallet currently has zero balances and later auto-locked, so no PIN
was automated. TypeScript and all
570 mobile checks pass; no release, commit or transaction was performed.

## 2026-09-20: Add safe mobile BPAN registration and mapping reviews

Integrated Base BPAN writes with the mobile wallet's transaction-confirmation
model. Registration now requires an availability check, fresh on-chain
preflight, Base ETH balance check and explicit review sheet showing the number,
protocol fee, estimated gas and wallet balance before signing. Mapping now
builds the authoritative write plan from current registry state, includes stale
exact-EVM override repairs, estimates the entire batch and shows every address
and transaction in a confirmation sheet. Ownership, availability and the
reviewed mapping plan are checked again immediately before vault access and
signing. Temporary read and write providers are disposed after use. TypeScript
and all 561 mobile checks pass; no mainnet transaction was broadcast.

## 2026-09-20: Complete the resumed Android UI review slice

Finished native light/dark review of the redesigned Wallet, Activity, BPAN and
Settings surfaces on the dedicated QA emulator. The earlier apparent startup
ANR was reproduced as a slow debug bundle load, then the live logs exposed an
unrelated one-second whole-app render loop and a bottom-navigation native
animation-node race. The lockout clock now runs only during an active lockout,
and the measured tab-indicator graph remains stable across parent renders.
Rapid tab switching no longer reports illegal animated node IDs, and the idle
warning stream is quiet. TypeScript, 550 mobile checks and whitespace checks
pass. See [the current resume note](NUMPAY_UI_RESUME_2026-09-17.md) for the
inspected-state matrix and remaining device-review gaps.

## 2026-09-17: Continue the Android V2 handoff implementation

Simplified the wallet header, added Activity direction filters, flattened
Settings groups into divider lists, and revised the owned BPAN display with
Copy/Share/Lookup actions and expandable mappings. Activity controls meet
44dp targets, and BPAN readiness copy waits for loaded mappings. TypeScript,
the full mobile test suite, and whitespace checks passed. Native visual review
remains pending after the QA debug app stopped responding. See
[the current resume note](NUMPAY_UI_RESUME_2026-09-17.md) for exact state.

## 2026-09-07: Smooth the mobile interaction model

Reworked mobile route changes into a short directional settle that keeps the
canvas painted throughout the transition. Emulator frame review caught and
removed the blank midpoint produced by the earlier exit/enter handoff. The
bottom navigation now slides its active indicator with a measured native
transform, animates in and out around focused flows, and stays out of the
accessibility tree while hidden. Portfolio and token values transition when
live data changes. Unified press feedback across dashboard assets, settings,
receive, token detail, DeFi, browser shortcuts, asset removal and sheet actions.
Motion remains restrained, runs on native-driven transforms where possible,
and follows the operating system's reduced-motion preference.
Unreachable EVM RPCs can no longer leave perpetual ethers network-detection
retries on the mobile JavaScript thread: one-shot providers now use their known
chain IDs and are disposed as soon as each read finishes.

## 2026-09-07: Modernize wallet warnings and errors

Replaced the extension's oversized tinted error boxes and scattered red text
with a shared compact notice system using neutral copy, restrained severity
accents, accessible alert/status roles and reduced-motion support. Applied it to
send/bridge, authentication, token safety, activity, asset/network forms,
settings and BPAN management. Provider failures are now sanitized before
rendering so RPC payloads, raw transaction hex and trace metadata never appear
in user-facing errors. Settings now uses distinct key, recovery phrase, reveal,
lock and delete symbols instead of repeated shields, and the bottom navigation
uses a consistent unfilled monoline set with conventional transfer and history
metaphors. Added render and redaction regression coverage, rebuilt the extension
and re-ran the mobile suite because it shares the error parser.

The extension dark theme now uses neutral graphite surfaces instead of
purple-black gradients and glow. Dashboard actions have equal visual weight,
with purple reserved for Send, while primary buttons, navigation, authentication
cards, transaction dialogs and the BPAN hero use flatter, quieter styling.

## 2026-09-07: Activate the finalized Base BPAN registry

Configured both wallet codebases for the finalized Base deployment at
`0x185a78Dd6bB8D2444B118BAc65Ac73816EBe4686`, starting at block 50998047.
Independent finalized-state reads through two providers matched the creation
transaction, owner, zero registration fee and compiled runtime bytecode. The
live contract reported two registered numbers at verification time. Contract,
shared-core, extension and mobile validation passed, and the extension was
rebuilt. Installed mobile APKs still require a future release to receive this
source change. See [the Base release notes](NUMPAY_BPAN_BASE_2026-09-06.md).

## 2026-09-07: Remove Ethereum BPAN; Base starts fresh

Both wallets now disable BPAN until a real Base deployment is configured.
Removed Ethereum/Sepolia BPAN addresses, development selection, old cache reads,
legacy discovery and recipient-pin reuse. The rebuilt extension no longer loads
Ethereum BPAN ownership. Archived the historical contract sources, interface,
tools and tests. The standalone Base contract has no migration/import API and
starts with zero registration fee. Nine active contract/integration tests,
full wallet suites, typechecks and the extension build pass. See
[the current Base release notes](NUMPAY_BPAN_BASE_2026-09-06.md).

## 2026-09-06: Video-inspired BPAN UI improvements

Applied the supplied video's loading, semantic color, copy, and accessibility
advice to BPAN in both wallets and shared primary controls. Failed ownership
scans now offer Retry instead of reporting an empty wallet. Added skeletons,
readable purple action fills, labeled controls and selected states, extension
keyboard tabs/focus, and mobile reduced-motion support in shared controls.
See [scope and validation](NUMPAY_UI_REVIEW_2026-09-06.md). Base deployment remains pending.

## 2026-09-06: Fresh Base registry with zero registration fee

User confirmed no Base contract exists, Ethereum data can remain an archive,
and registration should be as inexpensive as possible. Added a fresh registry
with zero protocol fee, migration closed at construction, and direct paginated
ownership reads. Both wallet displays revalidate ownership; mobile refreshes
after registration. Local contract/shared-core lifecycle tests pass. Deployment
awaits a locally configured owner/deployer wallet. See the updated
[Base release notes](NUMPAY_BPAN_BASE_2026-09-06.md).

## 2026-09-06: BPAN Base integration prepared, cutover pending

Shared registry configuration now drives the extension and mobile resolver,
registration/mapping, ownership caches, discovery, labels, and explorer links.
Added Base deployment/verification tooling and RPC integration tests. Current
Ethereum V2 remains active pending a verified Base address and the decision on
preserving existing numbers. No contract transaction or release was published.
See [implementation and validation notes](NUMPAY_BPAN_BASE_2026-09-06.md).

---

## 2026-05-22 — Phase 0 docs created (pre-review pause)

Mode: CRITICAL_CODE. Local-only. No remote push. No code outside docs.

### Added

- `docs/THREAT_MODEL.md`. Trust-model gap resolution (TOFU pinning of alias-to-ownerPubkey plus append-only hash-chained audit log). Threats and mitigations mapped from the handoff. Residual risk section names what we accept for testnet PoC.
- `docs/ARCHITECTURE_DECISIONS.md`. Single ADR file. 20 records. 15 accepted, 4 open (ADR-016 rotation, ADR-017 multiple IDs, ADR-018 business ranges, ADR-019 jurisdictions) with reversible PoC defaults. ADR-020 records handoff Q4-Q9 resolved by the handoff's own v1 recommendations.
- `docs/SECURITY_REQUIREMENTS.md`. OWASP API Top 10 mapping. Strict production CSP with real `api.numpay.app` placeholder hostnames. Logging policy with field allowlist and build-time denylist scan. Rate-limit table.
- `docs/CHAIN_SUPPORT_MATRIX.md`. Phase 1 = Sepolia (ETH testnet) + Solana devnet. Phase 2 = BTC signet, TRON Nile, XRP testnet. Chain abstraction layer present from day one even with only two chains wired.
- `docs/POC_PLAN.md`. Phase 1 scope, M1-M10 milestones, 10 exit criteria including real testnet tx hash on each chain.
- `docs/LOCAL_DEV_SETUP.md`. The only file that uses `.local` hostnames. Docker Compose shape, env file template, testnet faucet pointers.

### Verified

- No em-dash (U+2014) anywhere in `docs/`. Grep clean.
- No en-dash (U+2013) anywhere in `docs/`. Grep clean.
- `.local` hostnames appear only in `LOCAL_DEV_SETUP.md`. Production CSP uses `api.numpay.app`.
- No mainnet RPC URL anywhere in any doc.
- No telemetry, no third-party SDK named.

### Open items raised in sanity check

- **Internal contradiction.** `POC_PLAN.md` section 4 lists `argon2-browser` in the dependency allowlist, but `THREAT_MODEL.md` and the ADR-008 allowlist use `@noble/hashes` argon2id. Drop `argon2-browser`, use `@noble/hashes`. Verify at implementation time that the pinned `@noble/hashes` version ships argon2id; if not, file a new ADR.
- **Unverified.** Solana devnet CAIP-2 short form (`solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`) not re-checked against CAIP-30. Verify at implementation time.
- **Unbenchmarked.** Argon2id parameters `m=65536 KiB, t=3, p=1`. Benchmark at vault create per the doc.
- **Underspecified.** Dev TLS setup for `api.numpay.local` (mkcert vs caddy vs plain http on localhost). Pick in M1.
- **Untuned.** Rate-limit values in `SECURITY_REQUIREMENTS.md` section 4 are starting points.

### Pending

- `test-area/verify_numpay_id_checksum.ts` (Verhoeff, must pass).
- `test-area/verify_address_binding_signatures.ts` (runnable skeleton, may not pass yet).
- `test-area/verify_payment_intent_signatures.ts` (runnable skeleton, may not pass yet).
- `test-area/verify_no_secret_logging.ts` (must pass on current tree).
- Minimal `test-area/` tooling (package.json, tsconfig, tsx, deps pinned, audit run).
- All four scripts must actually run; outputs captured to `test-area/results/`.

### Hard stops still in effect

- No production code until Thomas reviews the Phase 0 docs and the four scripts and says "GO Phase 1."
- No remote push. Ever, in v1, without explicit approval.
- No mainnet RPC. Ever, in v1.
- No custodial features, no fiat, no swaps.

### Tasks status

Task #1-6 (docs) completed. Tasks #7-13 (scripts, tooling, run, checkpoint) pending.
