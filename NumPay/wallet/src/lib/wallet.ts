"use client";

// Native NumPay wallet — private key lives in localStorage, encrypted with
// the user's password via AES-GCM + PBKDF2. Decrypted key only held in memory.

import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";

const STORAGE_KEY = "numpay:wallet:v1";
const NUMBER_KEY = "numpay:number:v1";
const PBKDF2_ITERATIONS = 210_000;

interface Stored {
  v: 1;
  salt: string; // base64
  iv: string; // base64
  ct: string; // base64 ciphertext of raw 32-byte private key
}

const enc = new TextEncoder();
const toB64 = (buf: ArrayBuffer | Uint8Array) => {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let s = "";
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s);
};
const fromB64 = (b64: string) => {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return bytes;
};

async function deriveKey(password: string, salt: Uint8Array) {
  const keyMaterial = await crypto.subtle.importKey(
    "raw", enc.encode(password), "PBKDF2", false, ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    { name: "PBKDF2", salt: salt as BufferSource, iterations: PBKDF2_ITERATIONS, hash: "SHA-256" },
    keyMaterial,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

function hexToBytes(hex: Hex): Uint8Array {
  const clean = hex.startsWith("0x") ? hex.slice(2) : hex;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}
function bytesToHex(bytes: Uint8Array): Hex {
  let s = "0x";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s as Hex;
}

export function hasWallet(): boolean {
  return typeof window !== "undefined" && !!localStorage.getItem(STORAGE_KEY);
}

export async function createWallet(password: string): Promise<{ privateKey: Hex; address: `0x${string}` }> {
  const privateKey = generatePrivateKey();
  await saveEncrypted(privateKey, password);
  const account = privateKeyToAccount(privateKey);
  return { privateKey, address: account.address };
}

export async function importWallet(privateKey: Hex, password: string): Promise<{ address: `0x${string}` }> {
  // Validate
  const account = privateKeyToAccount(privateKey);
  await saveEncrypted(privateKey, password);
  return { address: account.address };
}

async function saveEncrypted(privateKey: Hex, password: string) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const ct = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, key, hexToBytes(privateKey) as BufferSource);
  const blob: Stored = {
    v: 1,
    salt: toB64(salt),
    iv: toB64(iv),
    ct: toB64(new Uint8Array(ct)),
  };
  localStorage.setItem(STORAGE_KEY, JSON.stringify(blob));
}

export async function unlockWallet(password: string): Promise<Hex> {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) throw new Error("No wallet on this device");
  const blob = JSON.parse(raw) as Stored;
  const salt = fromB64(blob.salt);
  const iv = fromB64(blob.iv);
  const ct = fromB64(blob.ct);
  const key = await deriveKey(password, salt);
  try {
    const pt = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, ct);
    return bytesToHex(new Uint8Array(pt));
  } catch {
    throw new Error("Wrong password");
  }
}

export function destroyWallet() {
  localStorage.removeItem(STORAGE_KEY);
  localStorage.removeItem(NUMBER_KEY);
}

export function saveNumber(n: string) {
  if (n) localStorage.setItem(NUMBER_KEY, n);
  else localStorage.removeItem(NUMBER_KEY);
}
export function loadNumber(): string {
  if (typeof window === "undefined") return "";
  return localStorage.getItem(NUMBER_KEY) ?? "";
}
