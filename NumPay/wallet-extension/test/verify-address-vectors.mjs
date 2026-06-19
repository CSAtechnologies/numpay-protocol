/**
 * Independent verification harness for src/lib/addressValidation.ts.
 *
 *   node test/verify-address-vectors.mjs
 *
 * Re-implements the address checks using only standard libraries (bs58, bech32,
 * node:crypto), independently of the app code, and runs them over the committed
 * reference vectors in address-vectors.json. This lets anyone confirm both that
 * the vectors are correct and that the validator's rules (checksum + decoded
 * length, not just a plausibility regex) are sound. Exits non-zero on any
 * mismatch so it can gate CI. The logic here MUST stay in lock-step with
 * src/lib/addressValidation.ts.
 */
import bs58 from "bs58";
import { bech32, bech32m } from "bech32";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const sha256 = (b) => new Uint8Array(createHash("sha256").update(Buffer.from(b)).digest());
const doubleSha256 = (b) => sha256(sha256(b));

function isValidBase58Check(decoded, versions) {
  if (decoded.length !== 25) return false;
  const payload = decoded.slice(0, 21);
  const checksum = decoded.slice(21);
  const expected = doubleSha256(payload).slice(0, 4);
  for (let i = 0; i < 4; i++) if (checksum[i] !== expected[i]) return false;
  return versions.includes(payload[0]);
}

const XRP_ALPHA = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";
function xrpBase58Decode(str) {
  let num = 0n;
  for (const ch of str) {
    const idx = XRP_ALPHA.indexOf(ch);
    if (idx < 0) return null;
    num = num * 58n + BigInt(idx);
  }
  const bytes = [];
  while (num > 0n) { bytes.unshift(Number(num % 256n)); num /= 256n; }
  for (const ch of str) { if (ch !== XRP_ALPHA[0]) break; bytes.unshift(0); }
  return Uint8Array.from(bytes);
}

function isValidSegwit(addr, hrp) {
  const attempt = (decode) => {
    try {
      const { prefix, words } = decode(addr.toLowerCase(), 90);
      if (prefix !== hrp || words.length < 1) return false;
      const witver = words[0];
      if (witver < 0 || witver > 16) return false;
      const program = bech32.fromWords(words.slice(1));
      if (witver === 0) return program.length === 20 || program.length === 32;
      return program.length >= 2 && program.length <= 40;
    } catch { return false; }
  };
  return attempt(bech32.decode) || attempt(bech32m.decode);
}

function isValidNonEvmAddress(addr, chainId) {
  if (!addr) return false;
  switch (chainId) {
    case "solana":
      try { return bs58.decode(addr).length === 32; } catch { return false; }
    case "bitcoin":
      if (addr.toLowerCase().startsWith("bc1")) return isValidSegwit(addr, "bc");
      try { return isValidBase58Check(bs58.decode(addr), [0x00, 0x05]); } catch { return false; }
    case "litecoin":
      if (addr.toLowerCase().startsWith("ltc1")) return isValidSegwit(addr, "ltc");
      try { return isValidBase58Check(bs58.decode(addr), [0x30, 0x32, 0x05]); } catch { return false; }
    case "tron":
      try { return isValidBase58Check(bs58.decode(addr), [0x41]); } catch { return false; }
    case "xrp": {
      const d = xrpBase58Decode(addr);
      return d ? isValidBase58Check(d, [0x00]) : false;
    }
    case "sui":
      return /^0x[0-9a-fA-F]{64}$/.test(addr);
    default:
      return false;
  }
}

const here = dirname(fileURLToPath(import.meta.url));
const vectors = JSON.parse(readFileSync(join(here, "address-vectors.json"), "utf8"));

let failures = 0, checks = 0;
for (const [chain, sets] of Object.entries(vectors)) {
  if (chain.startsWith("_")) continue;
  for (const addr of sets.valid ?? []) {
    checks++;
    if (!isValidNonEvmAddress(addr, chain)) { failures++; console.error(`FAIL ${chain} should ACCEPT: ${addr}`); }
  }
  for (const addr of sets.invalid ?? []) {
    checks++;
    if (isValidNonEvmAddress(addr, chain)) { failures++; console.error(`FAIL ${chain} should REJECT: ${addr}`); }
  }
}

console.log(`${checks - failures}/${checks} vector checks passed.`);
if (failures > 0) { console.error(`${failures} FAILED`); process.exit(1); }
console.log("All address vectors verified.");
