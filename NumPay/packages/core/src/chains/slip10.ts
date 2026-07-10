/**
 * SLIP-0010 Ed25519 HD key derivation (browser-compatible).
 * Replaces `ed25519-hd-key` which requires Node.js Buffer.
 *
 * Reference: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
 */

import { hmac } from "@noble/hashes/hmac";
import { sha512 } from "@noble/hashes/sha512";

const ED25519_SEED = "ed25519 seed";

// HMAC-SHA512 via @noble/hashes, not crypto.subtle: Hermes (React Native) has
// no SubtleCrypto, and WebCrypto HMAC protected nothing here anyway (the key
// material passes through JS either way). Kept async so callers are unchanged.
async function hmacSha512(key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  return hmac(sha512, key, data);
}

/**
 * Derive a master key from a seed using SLIP-0010 for Ed25519.
 */
async function getMasterKeyFromSeed(seed: Uint8Array): Promise<{ key: Uint8Array; chainCode: Uint8Array }> {
  const encoder = new TextEncoder();
  const I = await hmacSha512(encoder.encode(ED25519_SEED), seed);
  return {
    key: I.slice(0, 32),
    chainCode: I.slice(32),
  };
}

/**
 * Derive a child key at a hardened index.
 * SLIP-0010 Ed25519 only supports hardened derivation.
 */
async function deriveChild(
  parentKey: Uint8Array,
  parentChainCode: Uint8Array,
  index: number
): Promise<{ key: Uint8Array; chainCode: Uint8Array }> {
  // Hardened child: 0x00 || ser256(kpar) || ser32(index + 0x80000000)
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parentKey, 1);
  const indexBuf = new DataView(data.buffer, 33, 4);
  indexBuf.setUint32(0, (index | 0x80000000) >>> 0);

  const I = await hmacSha512(parentChainCode, data);
  return {
    key: I.slice(0, 32),
    chainCode: I.slice(32),
  };
}

/**
 * Parse a BIP44-style derivation path string.
 * e.g. "m/44'/501'/0'/0'" → [44, 501, 0, 0]
 * Only hardened indices are supported (all have ').
 */
function parsePath(path: string): number[] {
  return path
    .replace(/^m\//, "")
    .split("/")
    .map((s) => {
      // deriveChild force-hardens every index, and SLIP-0010 Ed25519 only allows
      // hardened derivation. Assert the segment is explicitly hardened and a
      // valid non-negative integer, so a malformed/non-hardened path fails loudly
      // instead of silently deriving a different key (DERIVATION-2).
      const hardened = s.endsWith("'") || s.endsWith("h");
      if (!hardened) {
        throw new Error(`SLIP-0010 supports hardened paths only; segment "${s}" is not hardened.`);
      }
      const n = parseInt(s.slice(0, -1), 10);
      if (!Number.isInteger(n) || n < 0 || String(n) !== s.slice(0, -1)) {
        throw new Error(`Invalid derivation path segment "${s}".`);
      }
      return n;
    });
}

/**
 * Derive an Ed25519 private key from a seed at a given BIP44 path.
 * Returns the 32-byte private key seed.
 */
export async function derivePath(
  path: string,
  seedHex: string
): Promise<{ key: Uint8Array }> {
  const seed = hexToBytes(seedHex);
  let { key, chainCode } = await getMasterKeyFromSeed(seed);

  const indices = parsePath(path);
  for (const index of indices) {
    const child = await deriveChild(key, chainCode, index);
    key = child.key;
    chainCode = child.chainCode;
  }

  return { key };
}

function hexToBytes(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
  }
  return bytes;
}
