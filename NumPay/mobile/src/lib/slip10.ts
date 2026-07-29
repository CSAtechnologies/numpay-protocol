// SLIP-0010 Ed25519 HD derivation, ported from the extension's slip10.ts.
// The extension used WebCrypto HMAC; Hermes has none, so this uses
// @noble/hashes (synchronous, same output).
// Reference: https://github.com/satoshilabs/slips/blob/master/slip-0010.md
import { hmac } from "@noble/hashes/hmac.js";
import { sha512 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

const ED25519_SEED = "ed25519 seed";

function hmacSha512(key: Uint8Array, data: Uint8Array): Uint8Array {
  return hmac(sha512, key, data);
}

function getMasterKeyFromSeed(seed: Uint8Array): { key: Uint8Array; chainCode: Uint8Array } {
  const I = hmacSha512(utf8ToBytes(ED25519_SEED), seed);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function deriveChild(
  parentKey: Uint8Array,
  parentChainCode: Uint8Array,
  index: number
): { key: Uint8Array; chainCode: Uint8Array } {
  const data = new Uint8Array(1 + 32 + 4);
  data[0] = 0x00;
  data.set(parentKey, 1);
  new DataView(data.buffer, 33, 4).setUint32(0, (index | 0x80000000) >>> 0);
  const I = hmacSha512(parentChainCode, data);
  return { key: I.slice(0, 32), chainCode: I.slice(32) };
}

function parsePath(path: string): number[] {
  return path
    .replace("m/", "")
    .split("/")
    .map((s) => parseInt(s.replace("'", ""), 10));
}

export function derivePath(path: string, seed: Uint8Array): { key: Uint8Array } {
  let { key, chainCode } = getMasterKeyFromSeed(seed);
  for (const index of parsePath(path)) {
    const child = deriveChild(key, chainCode, index);
    key = child.key;
    chainCode = child.chainCode;
  }
  return { key };
}
