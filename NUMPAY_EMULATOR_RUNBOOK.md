# NumPay mobile: running the emulator yourself

Written 2026-07-19. Everything here was executed on this machine, not recalled.
Paths and AVD names are this box's, not generic.

---

## 1. The one flag you cannot forget

```bat
C:\asdk\emulator\emulator.exe -avd Pixel7_API35 -dns-server 8.8.8.8,1.1.1.1
```

Without `-dns-server`, DNS dies emulator-wide. It is not obvious, because it
looks like a network or RPC bug rather than a launch-flag bug, and **it
survives an Android reboot**, so rebooting the guest will not clear it. If
name resolution is broken inside the emulator, check this before anything
else.

Wait for boot to finish before driving it:

```bash
adb wait-for-device
adb shell getprop sys.boot_completed   # "1" = ready
```

`adb` lives at `C:\asdk\platform-tools\adb.exe`.

---

## 2. Which AVD

Two exist. They are not interchangeable.

| AVD | State as of 2026-07-19 | Use |
|---|---|---|
| `Pixel7_API35` | Live/most-used image (~9.3 GB). **App data is gone** — package registers but has no data dir and no launchable activity. | Primary. Needs a fresh install. |
| `Pixel7_API35_b` | Stale image from 2026-07-11 (~2.4 GB). **Still holds an encrypted wallet vault.** | Wallet recovery. See §5. |

List them: `C:\asdk\emulator\emulator.exe -list-avds`

Run both at once by giving the second a port; they appear as `emulator-5554`
and `emulator-5556`, and every adb command then needs `-s <name>`:

```bash
C:\asdk\emulator\emulator.exe -avd Pixel7_API35_b -dns-server 8.8.8.8,1.1.1.1 -port 5556
adb -s emulator-5556 shell ...
```

---

## 3. Unlocking after a cold boot

Device PIN is `1111`. After a cold boot the direct-boot keyguard needs the
key events, not just typing:

```bash
adb shell input keyevent WAKEUP
adb shell input keyevent 82
adb shell input text 1111
adb shell input keyevent 66
```

The wallet's own dev vault PIN is `123456`. Two different PINs, easy to mix up.

---

## 4. Building and running the app

From `NumPay\wallet-mobile`:

```bash
npm run android      # expo run:android
npm start            # Metro only
```

Hard-won details:

- **Gradle needs the junctions** (`C:\np`, `C:\asdk`, `C:\gr`, `C:\jbr`).
  **Metro and the extension's Vite builds need the real spaced path**
  (`C:\Users\HP OMEN\Desktop\NumPay Project`). Using the wrong one for the
  wrong tool is a recurring time sink. All four junctions currently exist.
- Debug builds: pass `-PreactNativeArchitectures=x86_64`. Building every ABI
  for an x86_64 emulator wastes minutes.
- After any mid-session `npm install`, Metro needs `--clear` or it serves a
  stale graph.
- First refresh after a process kill takes about 60 s. That is one-time key
  derivation, not a hang. Do not kill it.
- Anything touching native modules (notifications, expo-camera) needs a
  **native rebuild**, not a Metro reload. A JS refresh will not show it.

---

## 5. The wallet situation (read this before assuming it is broken)

**The funded test wallet's recovery phrase is not stored anywhere on this
machine.** It is not in the repo, not in a `.env`, not in any doc. The only
mnemonic in the codebase is `NumPay/wallet-mobile/spike/gen-expected.mjs`,
which is the public hardhat/anvil fixture (`test test ... junk`), explicitly
commented "Never holds funds". It is a derivation-check fixture and is **not**
the wallet that did the on-chain sends.

What does still exist: `Pixel7_API35_b` has an intact encrypted vault at

```
/data/data/com.anonymous.walletmobile/files/mmkv/numpay
```

containing key `numpay_mobile_vault` (`{"iv":...,"ct":...}`), with the
Keystore-wrapped data key in `shared_prefs/SecureStore.xml`. That vault is
decryptable **on that AVD**, with vault PIN `123456`. The Keystore key is
device-bound, so copying the MMKV file to another AVD will not work — the
ciphertext would have no key.

Caveat worth knowing: that image is from 2026-07-11, and the funded sends
were verified 2026-07-13 onward on the *other* AVD. So `_b` may hold an
earlier wallet rather than the exact one used for those transactions. Confirm
by comparing the address in-app against a known transaction before trusting it.

### To get the wallet onto the primary AVD

1. Boot `Pixel7_API35_b`, unlock the device (`1111`), open the app, unlock the
   vault (`123456`).
2. Settings, reveal the recovery phrase, and write the words down **on paper
   or into a password manager**.
3. Boot `Pixel7_API35`, install the app, import from that phrase.

**Do not paste the phrase into a file on the Desktop.** That wallet has held
real funds. A plaintext file is readable by every process on the box and gets
picked up by sync clients. That is also why this runbook does not contain it.

If `_b` turns out to be the wrong wallet, the phrase is genuinely
unrecoverable from this machine and only you have it.

---

## 6. Quick sanity checks

```bash
adb devices                                          # emulator visible?
adb shell pm list packages | grep walletmobile       # installed?
adb shell run-as com.anonymous.walletmobile ls files/mmkv   # vault present?
```

In Git Bash, prefix adb commands that contain `/data/...` paths with
`MSYS_NO_PATHCONV=1`. Otherwise Git Bash rewrites `/data/data/...` into
`C:/Git/data/data/...` and you get a confusing "No such file or directory"
that has nothing to do with the device.

A package that lists in `pm list packages` but reports "No activities found to
run" and has no data dir is a **ghost registration**, not an install. That is
the current state of `Pixel7_API35`. Reinstall rather than debug it.
