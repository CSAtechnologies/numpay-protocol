import { ethers } from "ethers";
import { argon2id } from "@noble/hashes/argon2";
import { getItem, setItem, removeItem, getSession, setSession, removeSession } from "./storage";

const VAULTS_KEY  = "numpay_vaults";
const OLD_VAULT_KEY = "numpay_vault"; // legacy single-wallet key, migrated on first load
const ACTIVE_ID_KEY = "numpay_active_id";
const LOCK_KEY    = "numpay_locked"; // legacy on-disk flag; cleared on lock, no longer trusted

// Decrypted session + activity timestamp live in in-memory session storage only.
export const SESSION_KEY  = "numpay_session";
const ACTIVITY_KEY        = "numpay_lastActivity";
export const AUTO_LOCK_MS = 15 * 60 * 1000; // inactivity window before re-lock

// Vault KDF. Argon2id is the OWASP-preferred password hash (memory-hard, so it
// resists GPU/ASIC cracking far better than PBKDF2). WebCrypto has no native
// Argon2id, so we use the pure-JS implementation from @noble/hashes (already a
// dependency for chain derivation), avoiding a new WASM supply-chain surface.
//
// Parameters follow the OWASP 2023 Argon2id recommendation
// (m = 19 MiB, t = 2, p = 1), which benchmarks ~0.6 s here — acceptable for a
// one-time unlock and strictly stronger than the prior PBKDF2-600k.
const ARGON2_PARAMS = { m: 19_456, t: 2, p: 1 } as const; // m in KiB
const KDF_ARGON2ID = "argon2id";

// Legacy PBKDF2 vaults (no `kdf` field) still decrypt with their stored `iter`
// count, then get re-encrypted under Argon2id transparently on the next
// successful unlock (see decryptAllVaults).
const LEGACY_PBKDF2_ITERATIONS = 100_000;

export interface WalletData {
  mnemonic: string;
  address: string;
  privateKey: string;
}

export interface VaultMeta {
  id: string;
  name: string;
  address: string;
  avatar?: string;
}

interface VaultEntry extends VaultMeta {
  salt: number[];
  iv: number[];
  data: number[];
  // KDF selector. "argon2id" → Argon2id with `argon` params; absent → legacy
  // PBKDF2-HMAC-SHA256 with `iter` iterations.
  kdf?: typeof KDF_ARGON2ID;
  argon?: { m: number; t: number; p: number };
  iter?: number; // PBKDF2 iteration count (legacy vaults only)
}

interface VaultList {
  wallets: VaultEntry[];
}

// ── Internal helpers ───────────────────────────────────────────────────────────

async function loadVaultList(): Promise<VaultList> {
  const raw = await getItem(VAULTS_KEY);
  if (raw) {
    try { return JSON.parse(raw); } catch {}
  }

  // Migrate old single-wallet format
  const old = await getItem(OLD_VAULT_KEY);
  if (old) {
    const parsed = JSON.parse(old);
    // Try to recover address from stale session (may be empty string if session gone)
    let address = "";
    const session = await getItem("numpay_session");
    if (session) {
      try {
        const s = JSON.parse(session);
        if (typeof s.address === "string") address = s.address; // old flat format
      } catch {}
    }
    const entry: VaultEntry = { id: "wallet-1", name: "Wallet 1", address, ...parsed };
    const list: VaultList = { wallets: [entry] };
    await setItem(VAULTS_KEY, JSON.stringify(list));
    await setItem(ACTIVE_ID_KEY, "wallet-1");
    return list;
  }

  return { wallets: [] };
}

async function saveVaultList(list: VaultList): Promise<void> {
  await setItem(VAULTS_KEY, JSON.stringify(list));
}

// Derive a 32-byte AES-256-GCM key from the password + salt using Argon2id,
// then import it as a non-extractable WebCrypto key for the given usage.
async function deriveArgonKey(
  password: string, salt: Uint8Array, usage: KeyUsage
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const raw = argon2id(enc.encode(password), salt, {
    t: ARGON2_PARAMS.t, m: ARGON2_PARAMS.m, p: ARGON2_PARAMS.p, dkLen: 32,
  });
  // Copy into a fresh ArrayBuffer-backed view so the WebCrypto BufferSource type is satisfied.
  return crypto.subtle.importKey("raw", new Uint8Array(raw), { name: "AES-GCM" }, false, [usage]);
}

// Legacy PBKDF2 key derivation, kept only so pre-Argon2id vaults still decrypt.
async function derivePbkdf2Key(
  password: string, salt: Uint8Array, iterations: number, usage: KeyUsage
): Promise<CryptoKey> {
  const enc = new TextEncoder();
  const km = await crypto.subtle.importKey("raw", enc.encode(password), "PBKDF2", false, ["deriveKey"]);
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: new Uint8Array(salt), iterations, hash: "SHA-256" },
    km, { name: "AES-GCM", length: 256 }, false, [usage]
  );
}

async function encryptData(
  plain: string, password: string
): Promise<Pick<VaultEntry, "salt" | "iv" | "data" | "kdf" | "argon">> {
  const enc = new TextEncoder();
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveArgonKey(password, salt, "encrypt");
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const buf = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, enc.encode(plain));
  return {
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(new Uint8Array(buf)),
    kdf: KDF_ARGON2ID,
    argon: { ...ARGON2_PARAMS },
  };
}

async function decryptData(
  entry: Pick<VaultEntry, "salt" | "iv" | "data" | "kdf" | "argon" | "iter">, password: string
): Promise<string> {
  const salt = new Uint8Array(entry.salt);
  const key = entry.kdf === KDF_ARGON2ID
    ? await deriveArgonKey(password, salt, "decrypt")
    : await derivePbkdf2Key(password, salt, entry.iter ?? LEGACY_PBKDF2_ITERATIONS, "decrypt");
  const buf = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: new Uint8Array(entry.iv) }, key, new Uint8Array(entry.data)
  );
  return new TextDecoder().decode(buf);
}

// ── Create & Import ────────────────────────────────────────────────────────────

export function createWallet(): WalletData {
  const w = ethers.Wallet.createRandom();
  return { mnemonic: w.mnemonic!.phrase, address: w.address, privateKey: w.privateKey };
}

export function importFromMnemonic(mnemonic: string): WalletData {
  const w = ethers.Wallet.fromPhrase(mnemonic.trim());
  return { mnemonic: w.mnemonic!.phrase, address: w.address, privateKey: w.privateKey };
}

export function importFromPrivateKey(privateKey: string): WalletData {
  const w = new ethers.Wallet(privateKey);
  return { mnemonic: "", address: w.address, privateKey: w.privateKey };
}

// ── Vault management ───────────────────────────────────────────────────────────

// First wallet (onboarding). Replaces any existing vaults. Returns new id.
export async function encryptAndSave(
  wallet: WalletData, password: string, name = "Wallet 1"
): Promise<string> {
  const id = crypto.randomUUID();
  const enc = await encryptData(JSON.stringify(wallet), password);
  const list: VaultList = { wallets: [{ id, name, address: wallet.address, ...enc }] };
  await saveVaultList(list);
  await setItem(ACTIVE_ID_KEY, id);
  return id;
}

// Add a wallet to an existing vault (while already unlocked). Returns new id.
// Validates password against the active vault first — all vaults share one password.
export async function addEncryptedWallet(
  wallet: WalletData, password: string, name: string
): Promise<string> {
  // Throws if password is wrong, which prevents mismatched-password vaults
  await decryptVault(password);

  const list = await loadVaultList();
  const id = crypto.randomUUID();
  const enc = await encryptData(JSON.stringify(wallet), password);
  list.wallets.push({ id, name, address: wallet.address, ...enc });
  await saveVaultList(list);
  await setItem(ACTIVE_ID_KEY, id);
  return id;
}

export async function renameWallet(id: string, name: string): Promise<void> {
  const list = await loadVaultList();
  const entry = list.wallets.find((w) => w.id === id);
  if (entry) { entry.name = name; await saveVaultList(list); }
}

export async function listVaultMeta(): Promise<VaultMeta[]> {
  const list = await loadVaultList();
  return list.wallets.map(({ id, name, address, avatar }) => ({ id, name, address, avatar }));
}

export async function updateWalletAvatar(id: string, avatar: string): Promise<void> {
  const list = await loadVaultList();
  const entry = list.wallets.find((w) => w.id === id);
  if (entry) { entry.avatar = avatar || undefined; await saveVaultList(list); }
}

export async function getActiveId(): Promise<string | null> {
  return getItem(ACTIVE_ID_KEY);
}

export async function setActiveId(id: string): Promise<void> {
  await setItem(ACTIVE_ID_KEY, id);
}

// Decrypt a single wallet by id (or the active one if id omitted).
export async function decryptVault(password: string, id?: string): Promise<WalletData> {
  const list = await loadVaultList();
  if (list.wallets.length === 0) throw new Error("No wallet found");

  const activeId = id ?? (await getActiveId());
  const entry = list.wallets.find((w) => w.id === activeId) ?? list.wallets[0];

  const plain = await decryptData(entry, password);
  return JSON.parse(plain);
}

// Decrypt every wallet at once (used during unlock). Back-fills missing addresses.
// The active vault MUST decrypt or an error is thrown. Other vaults that fail
// (e.g. added with a different password by mistake) are silently skipped.
export async function decryptAllVaults(
  password: string
): Promise<Array<{ id: string; name: string; wallet: WalletData }>> {
  const list = await loadVaultList();
  if (list.wallets.length === 0) throw new Error("No wallet found");

  const activeId = await getActiveId();
  const results: Array<{ id: string; name: string; wallet: WalletData }> = [];

  for (const entry of list.wallets) {
    try {
      const plain = await decryptData(entry, password);
      const wallet = JSON.parse(plain) as WalletData;
      if (!entry.address) entry.address = wallet.address;

      // Transparent KDF upgrade: re-encrypt any pre-Argon2id (legacy PBKDF2)
      // vault under Argon2id now that we hold the plaintext + password.
      if (entry.kdf !== KDF_ARGON2ID) {
        const reEnc = await encryptData(plain, password);
        entry.salt = reEnc.salt;
        entry.iv = reEnc.iv;
        entry.data = reEnc.data;
        entry.kdf = reEnc.kdf;
        entry.argon = reEnc.argon;
        delete entry.iter; // no longer a PBKDF2 vault
      }

      results.push({ id: entry.id, name: entry.name, wallet });
    } catch {
      const isActive = entry.id === activeId || (!activeId && entry === list.wallets[0]);
      if (isActive) throw new Error("Incorrect password");
      // Non-active vault failed — skip it (password mismatch from a previous add)
    }
  }

  if (results.length === 0) throw new Error("Incorrect password");

  await saveVaultList(list);
  return results;
}

// Delete one wallet. If it was the last one, calls deleteWallet(). Returns remaining count.
export async function deleteOneWallet(id: string): Promise<number> {
  const list = await loadVaultList();
  const idx = list.wallets.findIndex((w) => w.id === id);
  if (idx === -1) return list.wallets.length;

  list.wallets.splice(idx, 1);

  if (list.wallets.length === 0) {
    await deleteWallet();
    return 0;
  }

  await saveVaultList(list);

  const activeId = await getActiveId();
  if (activeId === id) await setItem(ACTIVE_ID_KEY, list.wallets[0].id);

  return list.wallets.length;
}

// ── Lock / Unlock ──────────────────────────────────────────────────────────────

// Lock = drop all decrypted material from in-memory session storage. There is
// no persisted "unlocked" flag to revoke; absence of a session means locked.
export async function lockWallet(): Promise<void> {
  await removeSession(SESSION_KEY);
  await removeSession(ACTIVITY_KEY);
  await removeItem(LOCK_KEY); // clear legacy on-disk flag from older installs
}

// Refresh the inactivity timer. Call on unlock and on user activity.
export async function touchActivity(): Promise<void> {
  await setSession(ACTIVITY_KEY, String(Date.now()));
}

// Locked unless a decrypted session exists AND it is within the inactivity
// window. Enforced on every popup open and before signing, so a suspended
// service-worker timer can never leave the wallet "unlocked" past the timeout.
export async function isLocked(): Promise<boolean> {
  const raw = await getSession(SESSION_KEY);
  if (!raw) return true;
  const last = Number((await getSession(ACTIVITY_KEY)) || 0);
  if (!last || Date.now() - last > AUTO_LOCK_MS) {
    await lockWallet();
    return true;
  }
  return false;
}

export async function hasWallet(): Promise<boolean> {
  const list = await loadVaultList();
  return list.wallets.length > 0;
}

// Full reset: wipe all wallets and related state.
export async function deleteWallet(): Promise<void> {
  await removeItem(VAULTS_KEY);
  await removeItem(OLD_VAULT_KEY);
  await removeItem(ACTIVE_ID_KEY);
  await removeItem(LOCK_KEY);
  await removeSession(SESSION_KEY);
  await removeSession(ACTIVITY_KEY);
}

// ── Provider & Signer ─────────────────────────────────────────────────────────

export function getProvider(rpcUrl: string): ethers.JsonRpcProvider {
  return new ethers.JsonRpcProvider(rpcUrl);
}

export function getSigner(privateKey: string, rpcUrl: string): ethers.Wallet {
  return new ethers.Wallet(privateKey, getProvider(rpcUrl));
}
