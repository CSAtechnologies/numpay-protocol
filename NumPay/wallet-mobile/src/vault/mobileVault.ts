/**
 * Mobile vault: the PIN + Keystore design from NUMPAY_MOBILE_PLAN_2026-07-10.md §3.1.
 *
 * A 6-digit PIN has only 10^6 combinations, so it is NEVER the sole encryption
 * factor. The vault JSON is encrypted with a random AES-256-GCM data key, and
 * that data key is reachable only through two device-bound paths:
 *
 *  - PIN path: dataKey wrapped with AES-256-GCM under argon2id(PIN, salt)
 *    (same Argon2 parameters as the extension vault), and the wrapped blob is
 *    stored in expo-secure-store — which encrypts it at rest with a
 *    non-exportable Android Keystore key. An exfiltrated storage dump is
 *    useless without the physical device, and on-device guessing is gated by
 *    the attempt counter below.
 *  - Biometric path: dataKey stored in expo-secure-store with
 *    requireAuthentication, so the Keystore releases it only after a
 *    successful BiometricPrompt. PIN remains the fallback.
 *
 * Wrong-PIN attempts: 5 free, then exponential lockout (30 s / 5 min / 30 min).
 * The counter rides SecureStore (Keystore-encrypted) so a storage wipe of the
 * plain KV store cannot reset it.
 *
 * Recovery is the seed phrase, not the PIN: everything here is device-bound by
 * design. A new device restores from the mnemonic and sets a fresh PIN.
 *
 * The decrypted mnemonic lives ONLY in core's in-memory session store while
 * unlocked (see src/platform/init.ts) and is dropped by lock()/auto-lock.
 */

import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";
import { gcm } from "@noble/ciphers/aes.js";
import argon2 from "react-native-argon2";
import {
  getItem, setItem, removeItem,
  getSession, setSession, removeSession,
} from "@numpay/core/storage";

// MMKV (plain, non-secret ciphertext + flags)
const VAULT_BLOB_KEY = "numpay_mobile_vault";
const BIO_ENABLED_FLAG = "numpay_bio_enabled";
// SecureStore (Android Keystore-encrypted)
const SS_PIN_WRAP = "numpay_dk_pin";
const SS_BIO_KEY = "numpay_dk_bio";
const SS_ATTEMPTS = "numpay_pin_attempts";
// In-memory session
const SESSION_MNEMONIC = "numpay_mobile_session";
const SESSION_ACTIVITY = "numpay_lastActivity";

// Same parameters as the extension vault (m in KiB). The stretch runs in the
// native react-native-argon2 module (argon2kt / reference C via JNI); pure-JS
// argon2id at these params measured 166,866 ms on the Pixel7_API35 emulator
// (2026-07-10), so a JS fallback is deliberately absent — if the native module
// is missing, unlock must fail loudly rather than block the JS thread.
// The spike cross-checks native output against @noble byte-for-byte.
const ARGON2_PARAMS = { m: 19_456, t: 2, p: 1 } as const;

const FREE_ATTEMPTS = 5;
const BACKOFF_MS = [30_000, 300_000, 1_800_000] as const; // 30 s / 5 min / 30 min

export const AUTO_LOCK_MINUTES = 15; // same behavior as the extension

export type VaultErrorCode =
  | "no-vault"
  | "wrong-pin"
  | "locked"
  | "no-biometrics"
  | "bio-failed"
  | "corrupt";

export class VaultError extends Error {
  constructor(
    public code: VaultErrorCode,
    message: string,
    public lockUntil?: number,
    public failedAttempts?: number
  ) {
    super(message);
  }
}

interface VaultPayload { v: 1; mnemonic: string; createdAt: number }
interface PinWrap { salt: string; iv: string; wrapped: string } // all base64
interface AttemptState { fails: number; lockUntil: number }

let lastArgonMs: number | null = null;
/** Duration of the most recent argon2id PIN stretch on this device, in ms. */
export function getLastArgonMs(): number | null {
  return lastArgonMs;
}

const b64 = (u: Uint8Array) => Buffer.from(u).toString("base64");
const unb64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const hex = (u: Uint8Array) => Buffer.from(u).toString("hex");
const unhex = (s: string) => new Uint8Array(Buffer.from(s, "hex"));
const utf8 = (s: string) => new TextEncoder().encode(s);

function rand(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

async function stretchPin(pin: string, salt: Uint8Array): Promise<Uint8Array> {
  const t0 = Date.now();
  const { rawHash } = await argon2(pin, hex(salt), {
    mode: "argon2id",
    iterations: ARGON2_PARAMS.t,
    memory: ARGON2_PARAMS.m,
    parallelism: ARGON2_PARAMS.p,
    hashLength: 32,
    saltEncoding: "hex",
  });
  lastArgonMs = Date.now() - t0;
  return unhex(rawHash);
}

async function readAttempts(): Promise<AttemptState> {
  try {
    const raw = await SecureStore.getItemAsync(SS_ATTEMPTS);
    if (raw) return JSON.parse(raw) as AttemptState;
  } catch { /* treat as fresh */ }
  return { fails: 0, lockUntil: 0 };
}

async function writeAttempts(s: AttemptState): Promise<void> {
  await SecureStore.setItemAsync(SS_ATTEMPTS, JSON.stringify(s));
}

async function decryptVaultBlob(dataKey: Uint8Array): Promise<VaultPayload> {
  const raw = await getItem(VAULT_BLOB_KEY);
  if (!raw) throw new VaultError("no-vault", "No vault on this device.");
  const { iv, ct } = JSON.parse(raw) as { iv: string; ct: string };
  try {
    const pt = gcm(dataKey, unb64(iv)).decrypt(unb64(ct));
    return JSON.parse(new TextDecoder().decode(pt)) as VaultPayload;
  } catch {
    throw new VaultError("corrupt", "Vault data failed to decrypt.");
  }
}

async function openSession(mnemonic: string): Promise<void> {
  await setSession(SESSION_MNEMONIC, mnemonic);
  await setSession(SESSION_ACTIVITY, String(Date.now()));
}

// ── Public API ────────────────────────────────────────────────────────────────

export async function vaultExists(): Promise<boolean> {
  return (await getItem(VAULT_BLOB_KEY)) !== null;
}

export interface VaultStatus {
  exists: boolean;
  biometricsAvailable: boolean; // device has hardware + enrolled biometrics
  biometricsEnabled: boolean; // this vault stored a biometric-released key copy
  failedAttempts: number;
  lockUntil: number; // 0 = not locked out
}

export async function getStatus(): Promise<VaultStatus> {
  const [exists, hw, enrolled, attempts, bioFlag] = await Promise.all([
    vaultExists(),
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    readAttempts(),
    getItem(BIO_ENABLED_FLAG),
  ]);
  return {
    exists,
    biometricsAvailable: hw && enrolled,
    biometricsEnabled: bioFlag === "1",
    failedAttempts: attempts.fails,
    lockUntil: attempts.lockUntil > Date.now() ? attempts.lockUntil : 0,
  };
}

export async function createVault(
  mnemonic: string,
  pin: string,
  enableBiometrics: boolean
): Promise<void> {
  const dataKey = rand(32);

  // Vault blob under the random data key (MMKV: ciphertext only).
  const blobIv = rand(12);
  const payload: VaultPayload = { v: 1, mnemonic, createdAt: Date.now() };
  const ct = gcm(dataKey, blobIv).encrypt(utf8(JSON.stringify(payload)));
  await setItem(VAULT_BLOB_KEY, JSON.stringify({ iv: b64(blobIv), ct: b64(ct) }));

  // PIN path: argon2id-wrapped data key, at rest inside the Keystore-encrypted
  // SecureStore.
  const salt = rand(16);
  const wrapIv = rand(12);
  const pinKey = await stretchPin(pin, salt);
  const wrapped = gcm(pinKey, wrapIv).encrypt(dataKey);
  const wrap: PinWrap = { salt: b64(salt), iv: b64(wrapIv), wrapped: b64(wrapped) };
  await SecureStore.setItemAsync(SS_PIN_WRAP, JSON.stringify(wrap));

  // Biometric path: Keystore releases the data key only after BiometricPrompt.
  let bioStored = false;
  if (enableBiometrics) {
    const hw = await LocalAuthentication.hasHardwareAsync();
    const enrolled = await LocalAuthentication.isEnrolledAsync();
    if (hw && enrolled) {
      await SecureStore.setItemAsync(SS_BIO_KEY, b64(dataKey), {
        requireAuthentication: true,
      });
      bioStored = true;
    }
  }
  await setItem(BIO_ENABLED_FLAG, bioStored ? "1" : "0");

  await writeAttempts({ fails: 0, lockUntil: 0 });
  await openSession(mnemonic);
}

export async function unlockWithPin(pin: string): Promise<string> {
  const attempts = await readAttempts();
  const now = Date.now();
  if (attempts.lockUntil > now) {
    throw new VaultError(
      "locked",
      "Too many attempts. Try again later.",
      attempts.lockUntil,
      attempts.fails
    );
  }

  const rawWrap = await SecureStore.getItemAsync(SS_PIN_WRAP);
  if (!rawWrap) throw new VaultError("no-vault", "No vault on this device.");
  const wrap = JSON.parse(rawWrap) as PinWrap;

  const pinKey = await stretchPin(pin, unb64(wrap.salt));
  let dataKey: Uint8Array;
  try {
    dataKey = gcm(pinKey, unb64(wrap.iv)).decrypt(unb64(wrap.wrapped));
  } catch {
    const fails = attempts.fails + 1;
    const over = fails - FREE_ATTEMPTS;
    const lockUntil =
      over >= 0 ? now + BACKOFF_MS[Math.min(over, BACKOFF_MS.length - 1)] : 0;
    await writeAttempts({ fails, lockUntil });
    throw new VaultError("wrong-pin", "Wrong PIN.", lockUntil || undefined, fails);
  }

  await writeAttempts({ fails: 0, lockUntil: 0 });
  const payload = await decryptVaultBlob(dataKey);
  await openSession(payload.mnemonic);
  return payload.mnemonic;
}

export async function unlockWithBiometrics(): Promise<string> {
  let dataKeyB64: string | null;
  try {
    // getItemAsync with requireAuthentication triggers BiometricPrompt; the
    // Keystore key backing this entry demands user authentication.
    dataKeyB64 = await SecureStore.getItemAsync(SS_BIO_KEY, {
      requireAuthentication: true,
      authenticationPrompt: "Unlock NumPay",
    });
  } catch (e) {
    throw new VaultError("bio-failed", "Biometric unlock failed or was cancelled.");
  }
  if (!dataKeyB64) throw new VaultError("no-biometrics", "Biometric unlock is not set up.");

  const payload = await decryptVaultBlob(unb64(dataKeyB64));
  await writeAttempts({ fails: 0, lockUntil: 0 });
  await openSession(payload.mnemonic);
  return payload.mnemonic;
}

/** Mnemonic from the in-memory session, or null when locked. */
export async function getUnlockedMnemonic(): Promise<string | null> {
  return getSession(SESSION_MNEMONIC);
}

export async function touchActivity(): Promise<void> {
  if (await getSession(SESSION_MNEMONIC)) {
    await setSession(SESSION_ACTIVITY, String(Date.now()));
  }
}

/** Drops the session if idle past the auto-lock window. Returns true if it locked. */
export async function autoLockCheck(): Promise<boolean> {
  const mn = await getSession(SESSION_MNEMONIC);
  if (!mn) return false;
  const last = Number((await getSession(SESSION_ACTIVITY)) ?? 0);
  if (Date.now() - last > AUTO_LOCK_MINUTES * 60_000) {
    await lock();
    return true;
  }
  return false;
}

export async function lock(): Promise<void> {
  await removeSession(SESSION_MNEMONIC);
  await removeSession(SESSION_ACTIVITY);
}

/**
 * Removes the vault and every key wrap from this device. Only for the explicit
 * "restore from seed phrase" flow (and dev/testing) — there is no undo.
 */
export async function wipeVault(): Promise<void> {
  await lock();
  await removeItem(VAULT_BLOB_KEY);
  await removeItem(BIO_ENABLED_FLAG);
  await SecureStore.deleteItemAsync(SS_PIN_WRAP);
  await SecureStore.deleteItemAsync(SS_ATTEMPTS);
  try {
    await SecureStore.deleteItemAsync(SS_BIO_KEY);
  } catch { /* entry may not exist or may be auth-gated; nothing to keep either way */ }
}
