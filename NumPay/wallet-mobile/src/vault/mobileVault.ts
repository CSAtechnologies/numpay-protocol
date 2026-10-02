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
import { importFromMnemonic } from "@numpay/core/wallet";
import {
  attemptsBeforeWipe, isLockedOut, nextFailureState, FRESH,
  type AttemptState,
} from "./attemptPolicy";
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
// Wipe-after-N opt-in. In SecureStore rather than the plain KV store for the
// same reason the counter is: the flag is only worth anything if turning it OFF
// needs the device, not a rooted file write.
const SS_WIPE_ON_FAIL = "numpay_wipe_on_fail";
// In-memory session. Multi-wallet: the whole decrypted payload AND the data key
// live here while unlocked, so switching/adding/removing wallets re-encrypts the
// blob without a re-PIN. The data key in RAM is no more sensitive than the
// mnemonics already there; both are dropped by lock()/auto-lock.
const SESSION_UNLOCKED = "numpay_mobile_session"; // JSON { dataKey, payload }
const SESSION_ACTIVITY = "numpay_lastActivity";

// Same parameters as the extension vault (m in KiB). The stretch runs in the
// native react-native-argon2 module (argon2kt / reference C via JNI); pure-JS
// argon2id at these params measured 166,866 ms on the Pixel7_API35 emulator
// (2026-07-10), so a JS fallback is deliberately absent — if the native module
// is missing, unlock must fail loudly rather than block the JS thread.
// The spike cross-checks native output against @noble byte-for-byte.
const ARGON2_PARAMS = { m: 19_456, t: 2, p: 1 } as const;

// The lockout ladder and the self-destruct threshold live in attemptPolicy.ts
// as pure arithmetic so they can be unit-tested; this module owns only their
// persistence and the side effects.
export { WIPE_AFTER_ATTEMPTS } from "./attemptPolicy";

export const AUTO_LOCK_MINUTES = 15; // same behavior as the extension

export type VaultErrorCode =
  | "no-vault"
  | "wrong-pin"
  | "locked"
  | "no-biometrics"
  | "bio-failed"
  | "corrupt"
  /** Wipe-after-N fired: this attempt destroyed the vault. Terminal. */
  | "wiped";

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

// One wallet inside the vault. `id` is stable for the wallet's lifetime and is
// how the UI addresses it (switch/rename/remove). `avatar` is an optional emoji
// (extension parity); `evmAddress` is derived once at creation so the accounts
// list can show it without re-deriving every wallet on every render.
export interface WalletEntry {
  id: string;
  name: string;
  mnemonic: string;
  createdAt: number;
  avatar?: string;
  evmAddress?: string;
}

function deriveEvm(mnemonic: string): string {
  try {
    return importFromMnemonic(mnemonic).address;
  } catch {
    return "";
  }
}
// v2: multiple wallets + which one is active. v1 (single mnemonic) is migrated
// transparently on unlock and rewritten as v2 on the next mutation.
interface VaultPayloadV1 { v: 1; mnemonic: string; createdAt: number }
interface VaultPayload { v: 2; wallets: WalletEntry[]; activeId: string }
interface PinWrap { salt: string; iv: string; wrapped: string } // all base64
// What the in-memory session holds while unlocked.
interface Unlocked { dataKey: string; payload: VaultPayload } // dataKey base64

function newId(): string {
  return hex(rand(8));
}

// Bring any stored payload up to the current shape.
function migrate(raw: VaultPayloadV1 | VaultPayload): VaultPayload {
  if (raw.v === 2) return raw;
  const id = newId();
  return {
    v: 2,
    wallets: [{
      id, name: "Wallet 1", mnemonic: raw.mnemonic, createdAt: raw.createdAt,
      evmAddress: deriveEvm(raw.mnemonic),
    }],
    activeId: id,
  };
}

function activeMnemonic(p: VaultPayload): string {
  const w = p.wallets.find((x) => x.id === p.activeId) ?? p.wallets[0];
  return w?.mnemonic ?? "";
}

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
  return FRESH;
}

async function writeAttempts(s: AttemptState): Promise<void> {
  await SecureStore.setItemAsync(SS_ATTEMPTS, JSON.stringify(s));
}

/**
 * Records one wrong PIN: advances the counter, opens the next backoff window,
 * and destroys the vault if the user armed wipe-after-N and this attempt hit the
 * threshold.
 *
 * Shared by unlockWithPin and verifyPin ON PURPOSE. Those two are the only PIN
 * oracles in the app and they already share the counter; if only one of them
 * could trigger the wipe, the other would be the obvious place to do the
 * guessing. One function means the two cannot drift apart later either.
 *
 * @throws VaultError "wiped" when the vault was destroyed. Callers must not
 *         continue as if a wrong PIN had merely been rejected: there is nothing
 *         left to unlock.
 */
async function bumpFailure(prev: AttemptState, now: number): Promise<AttemptState> {
  const { next, wipe } = nextFailureState(prev, now, await isWipeOnFailEnabled());

  if (wipe) {
    // Order matters: wipe first, then report, and never persist `next`.
    // wipeVault clears the counter and every key wrap, so a crash between the
    // two leaves no vault and no stale lockout rather than a vault carrying a
    // tripped counter.
    await wipeVault();
    throw new VaultError(
      "wiped",
      `Wallet erased after ${next.fails} wrong PIN attempts. Restore it with your recovery phrase.`,
      undefined,
      next.fails,
    );
  }

  await writeAttempts(next);
  return next;
}

/** Whether the user armed wipe-after-N. Default (and read failure) is OFF. */
export async function isWipeOnFailEnabled(): Promise<boolean> {
  try {
    return (await SecureStore.getItemAsync(SS_WIPE_ON_FAIL)) === "1";
  } catch {
    return false;
  }
}

/**
 * Arms or disarms wipe-after-N. Turning it ON also clears the failure counter:
 * enabling a self-destruct should not inherit a count the user accumulated
 * before the rule existed, which could otherwise put them one typo from a wipe.
 */
export async function setWipeOnFail(on: boolean): Promise<void> {
  await SecureStore.setItemAsync(SS_WIPE_ON_FAIL, on ? "1" : "0");
  if (on) await writeAttempts(FRESH);
}

async function decryptVaultBlob(dataKey: Uint8Array): Promise<VaultPayload> {
  const raw = await getItem(VAULT_BLOB_KEY);
  if (!raw) throw new VaultError("no-vault", "No vault on this device.");
  const { iv, ct } = JSON.parse(raw) as { iv: string; ct: string };
  try {
    const pt = gcm(dataKey, unb64(iv)).decrypt(unb64(ct));
    const parsed = JSON.parse(new TextDecoder().decode(pt)) as VaultPayloadV1 | VaultPayload;
    return migrate(parsed);
  } catch {
    throw new VaultError("corrupt", "Vault data failed to decrypt.");
  }
}

// Encrypt a payload under the data key and persist the blob (fresh IV each time).
async function writeVaultBlob(dataKey: Uint8Array, payload: VaultPayload): Promise<void> {
  const iv = rand(12);
  const ct = gcm(dataKey, iv).encrypt(utf8(JSON.stringify(payload)));
  await setItem(VAULT_BLOB_KEY, JSON.stringify({ iv: b64(iv), ct: b64(ct) }));
}

async function openSession(dataKey: Uint8Array, payload: VaultPayload): Promise<void> {
  const u: Unlocked = { dataKey: b64(dataKey), payload };
  await setSession(SESSION_UNLOCKED, JSON.stringify(u));
  await setSession(SESSION_ACTIVITY, String(Date.now()));
}

async function readSession(): Promise<Unlocked | null> {
  const raw = await getSession(SESSION_UNLOCKED);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as Unlocked;
  } catch {
    return null;
  }
}

// Apply a mutation to the unlocked payload, re-encrypt the blob, refresh the
// session. Throws "no-vault" when locked (no data key available).
async function mutateUnlocked(fn: (p: VaultPayload) => VaultPayload): Promise<VaultPayload> {
  const u = await readSession();
  if (!u) throw new VaultError("no-vault", "Wallet is locked.");
  const dataKey = unb64(u.dataKey);
  const next = fn(u.payload);
  await writeVaultBlob(dataKey, next);
  await openSession(dataKey, next);
  return next;
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
  /** Wipe-after-N is armed. */
  wipeOnFail: boolean;
  /**
   * Wrong PINs left before the wipe fires, or null when it is disarmed. The lock
   * screen SHOWS this once it starts counting: a destructive countdown the user
   * cannot see is a trap, not a security feature.
   */
  attemptsBeforeWipe: number | null;
}

export async function getStatus(): Promise<VaultStatus> {
  const [exists, hw, enrolled, attempts, bioFlag, wipeOnFail] = await Promise.all([
    vaultExists(),
    LocalAuthentication.hasHardwareAsync(),
    LocalAuthentication.isEnrolledAsync(),
    readAttempts(),
    getItem(BIO_ENABLED_FLAG),
    isWipeOnFailEnabled(),
  ]);
  return {
    exists,
    biometricsAvailable: hw && enrolled,
    biometricsEnabled: bioFlag === "1",
    failedAttempts: attempts.fails,
    lockUntil: isLockedOut(attempts, Date.now()) ? attempts.lockUntil : 0,
    wipeOnFail,
    attemptsBeforeWipe: attemptsBeforeWipe(attempts, wipeOnFail),
  };
}

export async function createVault(
  mnemonic: string,
  pin: string,
  enableBiometrics: boolean
): Promise<void> {
  const dataKey = rand(32);

  // Vault blob under the random data key (MMKV: ciphertext only). One wallet to
  // start; more are added via addWallet without a re-PIN.
  const id = newId();
  const payload: VaultPayload = {
    v: 2,
    wallets: [{ id, name: "Wallet 1", mnemonic, createdAt: Date.now(), evmAddress: deriveEvm(mnemonic) }],
    activeId: id,
  };
  await writeVaultBlob(dataKey, payload);

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

  await writeAttempts(FRESH);
  await openSession(dataKey, payload);
}

export async function unlockWithPin(pin: string): Promise<string> {
  const attempts = await readAttempts();
  const now = Date.now();
  if (isLockedOut(attempts, now)) {
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
    // Throws "wiped" instead of returning when this attempt tripped the
    // self-destruct.
    const next = await bumpFailure(attempts, now);
    throw new VaultError("wrong-pin", "Wrong PIN.", next.lockUntil || undefined, next.fails);
  }

  await writeAttempts(FRESH);
  const payload = await decryptVaultBlob(dataKey);
  await openSession(dataKey, payload);
  return activeMnemonic(payload);
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

  const dataKey = unb64(dataKeyB64);
  const payload = await decryptVaultBlob(dataKey);
  await writeAttempts(FRESH);
  await openSession(dataKey, payload);
  return activeMnemonic(payload);
}

/** Mnemonic of the ACTIVE wallet from the in-memory session, or null when locked. */
export async function getUnlockedMnemonic(): Promise<string | null> {
  const u = await readSession();
  return u ? activeMnemonic(u.payload) : null;
}

export async function touchActivity(): Promise<void> {
  if (await getSession(SESSION_UNLOCKED)) {
    await setSession(SESSION_ACTIVITY, String(Date.now()));
  }
}

/** Drops the session if idle past the auto-lock window. Returns true if it locked. */
export async function autoLockCheck(): Promise<boolean> {
  const u = await getSession(SESSION_UNLOCKED);
  if (!u) return false;
  const last = Number((await getSession(SESSION_ACTIVITY)) ?? 0);
  if (Date.now() - last > AUTO_LOCK_MINUTES * 60_000) {
    await lock();
    return true;
  }
  return false;
}

export async function lock(): Promise<void> {
  await removeSession(SESSION_UNLOCKED);
  await removeSession(SESSION_ACTIVITY);
}

// ── Multi-wallet management (all require the vault to be UNLOCKED) ────────────

export interface WalletMeta {
  id: string;
  name: string;
  active: boolean;
  createdAt: number;
  avatar?: string;
  evmAddress?: string;
}

/**
 * Non-secret identity needed to paint the first authenticated frame. Reading
 * this takes one pass over the RAM-only session and deliberately avoids the
 * biometric/SecureStore status checks used by getStatus().
 */
export interface UnlockedBootstrap {
  activeWalletId: string;
  activeWallet: WalletMeta;
}

function walletMeta(entry: WalletEntry, activeId: string): WalletMeta {
  return {
    id: entry.id,
    name: entry.name,
    active: entry.id === activeId,
    createdAt: entry.createdAt,
    avatar: entry.avatar,
    evmAddress: entry.evmAddress,
  };
}

export async function getUnlockedBootstrap(): Promise<UnlockedBootstrap | null> {
  const u = await readSession();
  if (!u) return null;
  const entry = u.payload.wallets.find((wallet) => wallet.id === u.payload.activeId)
    ?? u.payload.wallets[0];
  if (!entry) return null;
  return {
    activeWalletId: entry.id,
    activeWallet: walletMeta(entry, entry.id),
  };
}

/** The wallets in the vault (metadata only; no mnemonics), or [] when locked. */
export async function listWallets(): Promise<WalletMeta[]> {
  const u = await readSession();
  if (!u) return [];
  return u.payload.wallets.map((wallet) => walletMeta(wallet, u.payload.activeId));
}

/** Set (or clear, with "") the active-list emoji avatar for a wallet. */
export async function setWalletAvatar(id: string, avatar: string): Promise<void> {
  await mutateUnlocked((p) => ({
    ...p,
    wallets: p.wallets.map((w) => (w.id === id ? { ...w, avatar: avatar || undefined } : w)),
  }));
}

export async function getActiveWalletId(): Promise<string | null> {
  const u = await readSession();
  return u ? u.payload.activeId : null;
}

/**
 * Add a wallet from a validated mnemonic and make it active. Rejects a mnemonic
 * already in the vault (returns that wallet's id instead of duplicating). Caller
 * validates/normalises the mnemonic first (via @numpay/core/wallet).
 */
export async function addWallet(mnemonic: string, name: string): Promise<string> {
  const u = await readSession();
  if (!u) throw new VaultError("no-vault", "Wallet is locked.");
  const existing = u.payload.wallets.find((w) => w.mnemonic === mnemonic);
  if (existing) {
    await mutateUnlocked((p) => ({ ...p, activeId: existing.id }));
    return existing.id;
  }
  const id = newId();
  const clean = name.trim() || `Wallet ${u.payload.wallets.length + 1}`;
  const evmAddress = deriveEvm(mnemonic);
  await mutateUnlocked((p) => ({
    ...p,
    wallets: [...p.wallets, { id, name: clean, mnemonic, createdAt: Date.now(), evmAddress }],
    activeId: id,
  }));
  return id;
}

/** Switch the active wallet. No-op (but persisted) for an unknown id. */
export async function switchWallet(id: string): Promise<void> {
  await mutateUnlocked((p) =>
    p.wallets.some((w) => w.id === id) ? { ...p, activeId: id } : p
  );
}

export async function renameWallet(id: string, name: string): Promise<void> {
  const clean = name.trim();
  if (!clean) return;
  await mutateUnlocked((p) => ({
    ...p,
    wallets: p.wallets.map((w) => (w.id === id ? { ...w, name: clean } : w)),
  }));
}

/**
 * Remove a wallet. The LAST wallet cannot be removed here (that is the
 * whole-vault wipe flow). Removing the active wallet moves active to the first
 * remaining one.
 */
export async function removeWallet(id: string): Promise<void> {
  await mutateUnlocked((p) => {
    if (p.wallets.length <= 1) return p; // never leave the vault empty
    const wallets = p.wallets.filter((w) => w.id !== id);
    const activeId = p.activeId === id ? wallets[0].id : p.activeId;
    return { ...p, wallets, activeId };
  });
}

/** The active wallet's mnemonic — for the reveal-recovery-phrase flow. */
export async function getActiveMnemonic(): Promise<string | null> {
  return getUnlockedMnemonic();
}

// ── Re-authentication gates ───────────────────────────────────────────────────
// Revealing a secret from an ALREADY-UNLOCKED vault must still cost a PIN or a
// biometric, so an unlocked phone left on a desk cannot hand over the recovery
// phrase. The extension gates the same reveal behind a password re-entry
// (Settings.tsx RevealPrompt → decryptVault). These are the mobile equivalent.
//
// Deliberately NOT reusing unlockWithPin: that opens a session as a side effect
// and returns the mnemonic. A gate should answer one question — "is this the
// person who set the PIN?" — and touch nothing else.

/**
 * Verifies a PIN against the stored wrap WITHOUT opening or refreshing the
 * session. Wrong attempts feed the SAME backoff counter as the lock screen, so
 * a reveal prompt cannot be used as an unthrottled oracle to brute-force the
 * PIN; a correct one clears it, exactly as unlockWithPin does.
 *
 * @throws VaultError "locked" while a backoff window is open, "no-vault" if
 *         there is nothing to check against.
 */
export async function verifyPin(pin: string): Promise<boolean> {
  const attempts = await readAttempts();
  const now = Date.now();
  if (isLockedOut(attempts, now)) {
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
  try {
    gcm(pinKey, unb64(wrap.iv)).decrypt(unb64(wrap.wrapped));
  } catch {
    // A wrong PIN is a `false` return, as before. A wrong PIN that tripped
    // wipe-after-N THROWS "wiped": returning false there would leave the caller
    // showing "wrong PIN, try again" over a vault that no longer exists.
    await bumpFailure(attempts, now);
    return false;
  }

  await writeAttempts(FRESH);
  return true;
}

/**
 * Triggers BiometricPrompt and resolves true only if the Keystore released the
 * auth-gated key. Same gate as unlockWithBiometrics, without opening a session.
 */
export async function verifyBiometrics(prompt = "Confirm it's you"): Promise<boolean> {
  try {
    const key = await SecureStore.getItemAsync(SS_BIO_KEY, {
      requireAuthentication: true,
      authenticationPrompt: prompt,
    });
    return !!key;
  } catch {
    // Cancelled, failed, or no enrolled biometric — all "not authenticated".
    return false;
  }
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
  // The self-destruct setting goes with the vault it was armed for. A restored
  // wallet starts from documented defaults instead of inheriting a rule the user
  // set months ago and would meet again by surprise, one forgotten PIN later.
  await SecureStore.deleteItemAsync(SS_WIPE_ON_FAIL);
  try {
    await SecureStore.deleteItemAsync(SS_BIO_KEY);
  } catch { /* entry may not exist or may be auth-gated; nothing to keep either way */ }
}
