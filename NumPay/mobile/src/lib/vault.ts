// Encrypted key vault, ported from the extension (src/lib/wallet.ts).
// Hermes has no WebCrypto, so PBKDF2/AES-GCM run on @noble primitives.
// The on-disk JSON format is IDENTICAL to the extension's vault format
// (salt/iv/data as number arrays + iter), so vaults stay portable.
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { utf8ToBytes, bytesToUtf8 } from "@noble/ciphers/utils.js";
import { ethers } from "ethers";
import { getItem, setItem, removeItem, getSession, setSession, removeSession } from "./storage";

const VAULTS_KEY = "numpay_vaults";
const ACTIVE_ID_KEY = "numpay_active_id";
export const SESSION_KEY = "numpay_session";
const ACTIVITY_KEY = "numpay_lastActivity";
export const AUTO_LOCK_MS = 15 * 60 * 1000;

// OWASP 2023 minimum for PBKDF2-HMAC-SHA256. Runs in pure JS here (no native
// WebCrypto), so unlock takes a moment on older phones. Argon2id or a native
// KDF is the planned upgrade; do NOT lower this number for speed.
const PBKDF2_ITERATIONS = 600_000;

export interface WalletData {
  mnemonic: string;
  address: string; // ETH address (primary identifier, mirrors extension)
  privateKey: string;
}

export interface VaultMeta {
  id: string;
  name: string;
  address: string;
}

interface VaultEntry extends VaultMeta {
  salt: number[];
  iv: number[];
  data: number[];
  iter?: number;
}

interface VaultList {
  wallets: VaultEntry[];
}

function randomBytes(n: number): Uint8Array {
  const b = new Uint8Array(n);
  crypto.getRandomValues(b);
  return b;
}

// pbkdf2Async yields to the event loop between blocks, so the 600k-iteration
// derivation does not freeze the UI thread during unlock.
function deriveKey(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  return pbkdf2Async(sha256, utf8ToBytes(password), salt, { c: iterations, dkLen: 32, asyncTick: 20 });
}

async function encryptData(plain: string, password: string): Promise<Pick<VaultEntry, "salt" | "iv" | "data" | "iter">> {
  const salt = randomBytes(16);
  const iv = randomBytes(12);
  const key = await deriveKey(password, salt, PBKDF2_ITERATIONS);
  const cipher = gcm(key, iv).encrypt(utf8ToBytes(plain));
  return {
    salt: Array.from(salt),
    iv: Array.from(iv),
    data: Array.from(cipher),
    iter: PBKDF2_ITERATIONS,
  };
}

async function decryptData(entry: Pick<VaultEntry, "salt" | "iv" | "data" | "iter">, password: string): Promise<string> {
  const key = await deriveKey(password, new Uint8Array(entry.salt), entry.iter ?? PBKDF2_ITERATIONS);
  const plain = gcm(key, new Uint8Array(entry.iv)).decrypt(new Uint8Array(entry.data));
  return bytesToUtf8(plain);
}

async function loadVaultList(): Promise<VaultList> {
  const raw = await getItem(VAULTS_KEY);
  if (raw) {
    try { return JSON.parse(raw) as VaultList; } catch {}
  }
  return { wallets: [] };
}

async function saveVaultList(list: VaultList): Promise<void> {
  await setItem(VAULTS_KEY, JSON.stringify(list));
}

// ── Create & Import ───────────────────────────────────────────────────────────

export function createWallet(): WalletData {
  const w = ethers.Wallet.createRandom();
  return { mnemonic: w.mnemonic!.phrase, address: w.address, privateKey: w.privateKey };
}

export function importFromMnemonic(mnemonic: string): WalletData {
  const w = ethers.Wallet.fromPhrase(mnemonic.trim().toLowerCase());
  return { mnemonic: w.mnemonic!.phrase, address: w.address, privateKey: w.privateKey };
}

export function importFromPrivateKey(privateKey: string): WalletData {
  const w = new ethers.Wallet(privateKey.trim());
  return { mnemonic: "", address: w.address, privateKey: w.privateKey };
}

// ── Vault management ──────────────────────────────────────────────────────────

export async function encryptAndSave(wallet: WalletData, password: string, name = "Wallet 1"): Promise<string> {
  const id = `w-${Date.now()}-${Math.floor(Math.random() * 1e6)}`;
  const enc = await encryptData(JSON.stringify(wallet), password);
  const list: VaultList = { wallets: [{ id, name, address: wallet.address, ...enc }] };
  await saveVaultList(list);
  await setItem(ACTIVE_ID_KEY, id);
  return id;
}

export async function listVaultMeta(): Promise<VaultMeta[]> {
  const list = await loadVaultList();
  return list.wallets.map(({ id, name, address }) => ({ id, name, address }));
}

export async function getActiveId(): Promise<string | null> {
  return getItem(ACTIVE_ID_KEY);
}

export async function decryptAllVaults(password: string): Promise<Array<{ id: string; name: string; wallet: WalletData }>> {
  const list = await loadVaultList();
  if (list.wallets.length === 0) throw new Error("No wallet found");

  const activeId = await getActiveId();
  const results: Array<{ id: string; name: string; wallet: WalletData }> = [];

  for (const entry of list.wallets) {
    try {
      const plain = await decryptData(entry, password);
      const wallet = JSON.parse(plain) as WalletData;
      if (!entry.address) entry.address = wallet.address;
      results.push({ id: entry.id, name: entry.name, wallet });
    } catch {
      const isActive = entry.id === activeId || (!activeId && entry === list.wallets[0]);
      if (isActive) throw new Error("Incorrect password");
    }
  }

  if (results.length === 0) throw new Error("Incorrect password");
  await saveVaultList(list);
  return results;
}

// ── Session / lock ────────────────────────────────────────────────────────────

export interface SessionWallet {
  id: string;
  name: string;
  wallet: WalletData;
}

export function cacheSession(wallets: SessionWallet[], activeId: string): void {
  setSession(SESSION_KEY, JSON.stringify({ wallets, activeId }));
  touchActivity();
}

export function getSessionWallets(): { wallets: SessionWallet[]; activeId: string } | null {
  const raw = getSession(SESSION_KEY);
  if (!raw) return null;
  try { return JSON.parse(raw); } catch { return null; }
}

export function lockWallet(): void {
  removeSession(SESSION_KEY);
  removeSession(ACTIVITY_KEY);
}

export function touchActivity(): void {
  setSession(ACTIVITY_KEY, String(Date.now()));
}

export function isLocked(): boolean {
  const raw = getSession(SESSION_KEY);
  if (!raw) return true;
  const last = Number(getSession(ACTIVITY_KEY) || 0);
  if (!last || Date.now() - last > AUTO_LOCK_MS) {
    lockWallet();
    return true;
  }
  return false;
}

export async function hasWallet(): Promise<boolean> {
  const list = await loadVaultList();
  return list.wallets.length > 0;
}

export async function deleteAllWallets(): Promise<void> {
  await removeItem(VAULTS_KEY);
  await removeItem(ACTIVE_ID_KEY);
  lockWallet();
}
