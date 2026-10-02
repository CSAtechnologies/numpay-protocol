# NumPay mobile: live theme switching

Written 2026-07-28. Everything below was run on this machine, not recalled.

Branch `feat/dapp-connect`. Committed 2026-07-31 in three parts, see "Where this
stands" at the bottom.

---

## 1. What was built

Mobile Settings had a Theme row that was decoration: `right="Light"`, hint
"Dark theme coming soon", no `onPress`. The dark palette was already written
and contrast-tuned in `src/ui/theme.ts`, just unreachable, because 25
module-level `StyleSheet.create` calls and ~540 `colors.*` reads all resolved
once at import.

It is now a real System / Light / Dark switch.

### The two mechanisms

Everything hinges on this split, and a new screen has to use the right one:

1. **Values read during render** (`colors.brand` on an icon prop, `gradients`,
   `elevation`, `press`) come from exported objects that are **mutated in
   place** on a theme change. The binding never moves, so all ~540 existing
   call sites work untouched.
2. **Values baked into a StyleSheet** cannot be mutated after the fact, so
   sheets are declared with `themedStyles((colors) => ({ ... }))` instead of
   `StyleSheet.create({ ... })`. That builds and caches one real sheet per
   theme, lazily, behind a proxy that resolves at read time.

If you add a theme-dependent token, add it to `applyTheme()` in `theme.ts` or
it silently keeps light values forever.

### Where the re-render comes from

`useThemeState()` is subscribed in exactly one place, `AppInner`. Nothing in
the tree is memoised, so that single re-render reaches every screen, sheet and
overlay. Do not add `React.memo` to a screen without also subscribing it.

### Preference and persistence

`light | dark | system`, stored under `numpay_theme` via core storage (MMKV
here, the same key the extension uses in its own localStorage; separate stores,
so the extra `system` value cannot leak into a build that does not understand
it). Default is `system`, set by `DEFAULT_THEME_PREF` in `theme.ts`. An
`Appearance` listener keeps `system` tracking the OS live.

### Native config this needed

- `app.json`: `userInterfaceStyle` `"light"` -> `"automatic"`. Without it Expo
  pins the OS scheme and `system` resolves to light forever.
- `app.json`: added a `dark` splash variant (`#0a0912`).
- Both are native. They need a rebuild, not a Metro reload.

`App` also holds the splash until `themeReady` resolves, so a dark-theme user
never gets a light first paint on a cold start. Verified on device.

### Files

`src/ui/theme.ts` (the store + `themedStyles`), `App.tsx` (subscription,
StatusBar, splash gate), `src/screens/SettingsScreen.tsx` (the picker),
`src/ui/icons.tsx` (`MoonIcon`, ported 1:1 from the extension's `Icons.tsx`),
`app.json`, plus the 25 files whose sheets became `themedStyles`.

`test/theme-switch.mjs` (40 assertions, wired into `npm test`) pins the two
things that would otherwise break silently: that the token objects are mutated
rather than rebound, and that the proxy resolves per read with one cached sheet
per theme.

System uses the gear glyph. There is no device icon in the ported set and
`icons.tsx` does not invent art.

---

## 2. The Tappable layout bug (found on the emulator, fixed)

Not the theme work. Worth writing down because it was invisible in code review
and obvious in one screenshot.

`Tappable` (from the press-feedback refactor, committed in `bc5a408`) wraps its
Pressable in an `Animated.View` when `feedback="tile"`, to
carry the press scale. It applied the caller's `style` to the **inner**
Pressable. But the wrapper is what is actually the flex child of whatever laid
the tile out, so `flex: 1` landed one level too deep and every tile row
collapsed to its content width.

On screen: the dashboard's Receive / Swap / DeFi row bunched into the left
third, and the add-wallet segmented control did the same. 21 `feedback="tile"`
call sites share the pattern.

Fixed in `Tappable` rather than per call site: layout props (flex, width,
margin, position) hoist to the wrapper via `splitTileStyle`, everything that
paints the tile stays on the Pressable so the ripple still clips to its edge.

**The general trap:** any wrapper component that adds an outer view has to
decide which style props belong outside. Getting it wrong does not error, it
just quietly changes layout.

---

## 3. Emulator notes to fold into NUMPAY_EMULATOR_RUNBOOK.md

Two things that cost time on 2026-07-28 and are not in the runbook yet.

- **Metro dies if it starts before Gradle finishes.** Its file watcher walks
  `node_modules/**/android/build/intermediates/...`, which Gradle is deleting
  and recreating under it, and Metro exits with
  `ENOENT: no such file or directory, watch '...'`. Start Metro *after* the
  build, or accept one restart. Restarting is cheap (the transform cache
  survives).
- **`adb shell input tap` drops taps when they are sent back to back** from the
  host. Entering the 6-digit vault PIN as six rapid `adb shell input tap` calls
  lost one and produced a wrong-PIN failure. Pace them device-side instead:
  `adb shell 'input tap X Y; sleep 0.6; input tap X Y; ...'`. This matters more
  than it sounds now that wipe-after-N-failures exists (default OFF, opt-in,
  threshold 10 in `src/vault/attemptPolicy.ts`).

Also confirmed still true: `MSYS_NO_PATHCONV=1` is required in Git Bash for any
adb command with a `/sdcard/...` or `/data/...` path, or it becomes
`C:/Git/sdcard/...`.

---

## 4. Verified on device (Pixel7_API35, debug build, 2026-07-28)

- Settings -> Theme opens the System / Light / Dark picker.
- Choosing Dark repaints the whole app instantly, no reload: dashboard, hero
  gradient number, nav bar, asset rows, sheets, status bar icons.
- Cold restart comes back up dark with no light flash.
- `tsc --noEmit` clean. Full suite green, including `theme-switch` 40/40.

### 4b. The dark visual pass (2026-07-31, native rebuild + all screens)

Native rebuild from a regenerated `android/`, then every screen walked in dark.

**`system` resolves correctly on Android, verified rather than assumed.**
`expo prebuild` warns `userInterfaceStyle: Install expo-system-ui in your
project to enable this feature`, which reads like the default preference is
broken. It is not. The generated project is DayNight-correct on its own
(`Theme.AppCompat.DayNight.NoActionBar`, a real `values-night`, `uiMode` in the
activity's `configChanges`), so `automatic` is just Android's native behaviour
rather than something Expo enforces. Tested by leaving the pref on System and
flipping the OS with `adb shell cmd uimode night yes`: the app repainted dark
live, no restart. **Do not add `expo-system-ui` to silence that warning without
re-testing**; it would start forcing a mode that currently follows the OS.

The dark splash generated correctly too: `#0a0912` in `values-night`, `#faf9ff`
in `values`.

Walked and correct in dark: dashboard, Send, Receive (the QR keeps its white
quiet zone, as it must to stay scannable), BPAN, Activity, Swap, DeFi, Browser
(including the amber open-web caution), TokenDetail with a live chart, Manage
assets, Connected dApps, Settings, the skeleton loading rows, and the
arm-wipe ConfirmSheet. The `Tappable` layout fix holds in a real build: the
dashboard's Receive/Swap/DeFi row spans full width.

Two things the pass turned up, neither of them dark-only:

1. **The primary CTA's label fails AA, in BOTH themes.** `gradients.brand` is
   deliberately identical light and dark (`#a394ff` -> `#7c6df0` -> `#5b4cdb`,
   locations `[0, 0.55, 1]`) and `onBrand` is `#ffffff` in both. Measured
   against white at 15px/600 (`type.body`, not large text, so the bar is 4.5):

       #a394ff  top stop     2.55:1   FAIL
       #7c6df0  mid, 0.55    3.96:1   FAIL
       #5b4cdb  bottom       6.00:1   pass

   A centred label sits around the mid stop. This is every primary button in
   the app: dashboard Send, Copy Address, Register BPAN, Scan QR code, the
   BPAN tab pill.

   `palette-contrast.mjs` does not catch it for two reasons: it asserts
   `onBrand` at **3**, not 4.5 (grouped with chip and tile labels), and it
   tests the flat `brand` token, never the gradient stops the button paints.

   Not a regression from the theme work, and not fixable without a brand
   decision: darkening the ramp so the mid stop clears 4.5 changes the app's
   most recognisable colour. Left as a decision, not silently changed.

2. **Manage assets clips its CHAIN chip grid mid-row**, leaving sliced chip
   tops along the card's bottom edge. Cosmetic, and almost certainly present in
   light too.

Also worth knowing: `Device integrity` reports "No root detected" on the
emulator, so `expo-device`'s heuristic does not fire on this AVD and the
emulator-softened wording path is still untested.

### 4c. Emulator gotchas from this session

- `expo prebuild` **clears `android/` even without `--clean`**. Harmless (it is
  gitignored CNG and the release keystore lives in `~/.numpay-keys/`), but it
  does delete `android/app/debug.keystore`. Back that up first: if it comes
  back different, the install fails on a signature mismatch and the only fix is
  an uninstall, which wipes the vault.
- `INSTALL_FAILED_INSUFFICIENT_STORAGE` on a 5.8 GB `/data` at 95% full. Freed
  by deleting the 66 MB staged APK at `/data/local/tmp/app-debug.apk` (a failed
  install leaves it behind) and `pm trim-caches 999G`. The AVD also carries
  unrelated apps (`com.example.dwello_app`, `team.opay.pay`) if more is needed.
- The runbook's `MSYS_NO_PATHCONV=1` rule applies to **`adb shell df /data`**
  too, not just `/sdcard` paths. Without it you get a confusing
  `df: 'C:/Git/data': No such file or directory`.
- `adb install` wants a WINDOWS path for the local APK (`C:/np/...`). With
  `MSYS_NO_PATHCONV=1` exported, a `/c/np/...` path is passed through unconverted
  and fails to stat.

---

## 5. Where this stands, and the git situation

Resolved 2026-07-31. The tree held two streams interleaved in the same files,
and it went in as three commits on `feat/dapp-connect`:

- `cb05918` `fix(ext)` the popup tone-colour contrast port. Cleanly separable,
  three extension files, unrelated to the mobile work.
- `bc5a408` `feat(mobile)` the theme switch, `Tappable` and `ScreenTransition`.
- `7f2c456` `feat(mobile)` the security stream: wipe-after-N failed PINs
  (`src/vault/attemptPolicy.ts`, `test/attempt-policy.mjs`), device-integrity
  checks (`src/platform/deviceIntegrity.ts`), ephemeral clipboard
  (`src/platform/clipboard.ts`), FLAG_SECURE.

**Theme and press-feedback could not be separated and were not.** `Tappable`
consumes the `press` and `motion` tokens that only exist after the theme
refactor, and the two share hunks in 14 files. Splitting the security stream
out DID work, and was worth the hunk surgery in `App.tsx`,
`SettingsScreen.tsx`, `ReceiveScreen.tsx`, `SeedPhrase.tsx` and `package.json`:
a change that can erase somebody's wallet should not be buried inside a 2,100
line theme commit.

Method, if this is ever needed again: snapshot `git hash-object` for every
changed file first, build the intermediate state by reverting only the other
stream's hunks, verify THAT state compiles with the untracked new modules moved
aside (or tsc silently covers for you), commit, restore from the snapshot, then
assert every file is byte-identical again before the second commit. It was, all
42 of them.

### Open, not done

1. **The brand ramp's white label fails AA in both themes.** See 4b. Needs a
   brand decision, not a silent palette edit. Whatever is decided,
   `palette-contrast.mjs` should assert the gradient STOPS and not just the
   flat `brand` token, or the next change re-opens the same hole.
   (The dark visual pass itself is DONE, 2026-07-31; see 4b.)
2. **The security stream is not device-verified at all.** It typechecks and its
   arithmetic is unit-tested, but the wipe path has never been run to
   completion on hardware, and both new native modules (`expo-device`,
   `expo-screen-capture`) need a rebuild before any of it can be.
3. **Default changed to `system`.** Existing installs on a dark phone will come
   back dark after this ships. One constant if that is not wanted.
4. **The extension has no System option.** Its own two-way toggle is untouched
   (`wallet-extension/src/popup/hooks/useTheme.ts`); only the tone-contrast
   port landed there, in `cb05918`.
5. `NEXT_STEP.md` is stale (dated 2026-05-22, says no production code exists).
   It is not a usable resume page any more.


## 2026-09-06 update: primary action contrast

The user requested applying relevant UI advice from a supplied video. Primary
buttons and Receive's Copy Address action now use a separate darker purple
`gradients.action` ramp. BPAN selected tabs and number chips use `colors.action`.
The logo ramp remains decorative. The previous test that pinned failing button
ratios has been replaced with 4.5:1 assertions for every action ramp stop in
both themes. This resolves the color choice for these controls; it does not
establish whole-app accessibility compliance. This update has automated checks,
not a fresh device visual pass. See NUMPAY_UI_REVIEW_2026-09-06.md.
