/**
 * Root detection, per NUMPAY_MOBILE_PLAN_2026-07-10.md §3.2: "warn, do not
 * hard-block (honest UX, avoids an arms race)."
 *
 * WHY IT ONLY WARNS. On a rooted device the security model this wallet is built
 * on stops holding: any app with root can read another app's private storage,
 * so the Keystore-encrypted vault blob is reachable, and a root-level hook can
 * read the decrypted mnemonic out of memory while the wallet is unlocked. That
 * is worth telling the user in plain words.
 *
 * It is NOT worth refusing to run over. Every root check is a heuristic that a
 * competent user of Magisk's DenyList defeats in a minute, so a hard block costs
 * the honest power user their wallet and costs an attacker nothing. Blocking
 * would also be dishonest about how strong the check is.
 *
 * WHAT THE CHECK ACTUALLY IS. expo-device's `isRootedExperimentalAsync` looks
 * for the usual tells (su on PATH, test-keys in the build tags, known
 * superuser packages and paths). Expo marks it experimental and so do we: a
 * false negative is expected on a hidden root, and a false positive is possible
 * on a custom ROM or an emulator image. Treat a positive as "tell the user",
 * never as "this device is compromised".
 *
 * Emulators report as rooted, which is correct but noisy in development, so the
 * result carries `isEmulator` and callers can soften the wording rather than
 * suppressing the warning.
 */
import * as Device from "expo-device";

export interface DeviceIntegrity {
  /** The heuristic fired. See the caveats above before treating it as fact. */
  rooted: boolean;
  /** A rooted emulator is the normal case in development, not a finding. */
  isEmulator: boolean;
  /** The check itself failed to run, so nothing is known either way. */
  unknown: boolean;
}

const CLEAN: DeviceIntegrity = { rooted: false, isEmulator: false, unknown: false };

// Cached for the process lifetime. Root status cannot change under a running
// app without it being restarted, and the check touches the filesystem.
let cached: DeviceIntegrity | null = null;
let inflight: Promise<DeviceIntegrity> | null = null;

export async function checkDeviceIntegrity(): Promise<DeviceIntegrity> {
  if (cached) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    try {
      const [rooted, isDevice] = await Promise.all([
        Device.isRootedExperimentalAsync(),
        Promise.resolve(Device.isDevice),
      ]);
      cached = { rooted, isEmulator: !isDevice, unknown: false };
    } catch {
      // Never let a diagnostic take the app down. An unknown result shows no
      // warning: a scary banner the app cannot substantiate is worse than
      // silence, because it teaches people to dismiss the banner.
      cached = { ...CLEAN, unknown: true };
    }
    inflight = null;
    return cached;
  })();

  return inflight;
}

/** True only when there is something real to warn a user about. */
export function shouldWarn(i: DeviceIntegrity | null): boolean {
  return !!i && i.rooted && !i.unknown;
}

/** The warning body, softened on an emulator where root is expected. */
export function integrityWarning(i: DeviceIntegrity): string {
  return i.isEmulator
    ? "This looks like an emulator, where root is normal. On a real rooted phone, other apps can reach NumPay's storage and read your recovery phrase while the wallet is unlocked. Do not keep funds on a rooted device."
    : "This device appears to be rooted. Root access lets other software read NumPay's storage and see your recovery phrase while the wallet is unlocked. NumPay still works, but it cannot protect your keys here. Use a device without root for anything you cannot afford to lose.";
}
