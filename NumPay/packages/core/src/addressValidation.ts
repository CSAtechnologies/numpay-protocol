import { ethers } from "ethers";
import { bech32, bech32m } from "bech32";
import bs58 from "bs58";

/**
 * Per-chain address validation, shared by the Send page (validating
 * BPAN-resolved targets) and the BPAN mapping page (validating addresses
 * before they are written to the registry).
 *
 * This is the last client-side check before an address is either written to the
 * on-chain registry or used as a send recipient, so it decodes and verifies the
 * checksum / decoded length instead of matching a plausibility regex
 * (DERIVATION-1, DERIVATION-3). A regex-only check accepts a typo'd or
 * wrong-network address whose checksum is broken; for chains with no send-path
 * node backstop (Bitcoin/Litecoin/XRP) that address would be permanently
 * advertised and receipts misdirected.
 */

// SHA256(SHA256(bytes)) — the checksum hash used by Base58Check (BTC/LTC/Tron/XRP).
function doubleSha256(bytes: Uint8Array): Uint8Array {
  const h1 = ethers.sha256(bytes);          // hex string
  return ethers.getBytes(ethers.sha256(h1)); // second round over the first digest
}

// Verify a decoded Base58Check payload: 25 bytes total (1 version + 20 hash +
// 4 checksum), checksum matches, and the version byte is in `versions`.
function isValidBase58Check(decoded: Uint8Array, versions: number[]): boolean {
  if (decoded.length !== 25) return false;
  const payload = decoded.slice(0, 21);
  const checksum = decoded.slice(21);
  const expected = doubleSha256(payload).slice(0, 4);
  for (let i = 0; i < 4; i++) if (checksum[i] !== expected[i]) return false;
  return versions.includes(payload[0]);
}

// XRP uses its own Base58 alphabet (not Bitcoin's). Mirror of the encoder in
// chains/xrp.ts so a checksum-valid r... address round-trips.
const XRP_ALPHA = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

function xrpBase58Decode(str: string): Uint8Array | null {
  let num = 0n;
  for (const ch of str) {
    const idx = XRP_ALPHA.indexOf(ch);
    if (idx < 0) return null; // character outside the XRP alphabet
    num = num * 58n + BigInt(idx);
  }
  // Big-integer → bytes
  const bytes: number[] = [];
  while (num > 0n) {
    bytes.unshift(Number(num % 256n));
    num /= 256n;
  }
  // Restore leading-zero bytes (each encoded as the first alphabet char, 'r').
  for (const ch of str) {
    if (ch !== XRP_ALPHA[0]) break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

// Bech32 / Bech32m segwit validation for a given human-readable prefix.
// v0 (P2WPKH/P2WSH) uses bech32 with a 20- or 32-byte program; v1+ (e.g.
// taproot) uses bech32m (BIP-350). The encoding variant is NOT interchangeable:
// a v0 address must use bech32 and a v1-16 address must use bech32m, so this
// reads the witness version and then requires the matching variant rather than
// accepting either (M-02). Mixed-case input is rejected outright per BIP-173.
function isValidSegwit(addr: string, hrp: string): boolean {
  // BIP-173: an address must be entirely lowercase OR entirely uppercase. The
  // decoders below normalize case, so a mixed-case string would otherwise be
  // silently accepted; reject it here first.
  if (addr !== addr.toLowerCase() && addr !== addr.toUpperCase()) return false;
  const lower = addr.toLowerCase();

  const tryDecode = (decode: typeof bech32.decode): number[] | null => {
    try {
      const { prefix, words } = decode(lower, 90);
      if (prefix !== hrp || words.length < 1) return null;
      return words;
    } catch {
      return null;
    }
  };

  // Learn the witness version (words[0] is variant-independent; only the
  // checksum differs between bech32 and bech32m).
  const words = tryDecode(bech32.decode) ?? tryDecode(bech32m.decode);
  if (!words) return false;
  const witver = words[0];
  if (witver < 0 || witver > 16) return false;

  // Re-decode under the REQUIRED variant for this version and confirm it passes
  // that checksum. This rejects a v0 program re-encoded with bech32m, and a
  // v1-16 program re-encoded with bech32.
  const confirmed = tryDecode(witver === 0 ? bech32.decode : bech32m.decode);
  if (!confirmed) return false;

  let program: number[];
  try {
    program = bech32.fromWords(confirmed.slice(1));
  } catch {
    return false;
  }
  if (witver === 0) return program.length === 20 || program.length === 32;
  return program.length >= 2 && program.length <= 40;
}

export function isValidNonEvmAddress(addr: string, chainId: string): boolean {
  if (!addr) return false;

  switch (chainId) {
    case "solana": {
      // Base58 (Bitcoin alphabet) decoding to exactly 32 bytes (an ed25519
      // public key). The old regex only bounded the string length, not the
      // decoded length (DERIVATION-1, DERIVATION-3).
      try {
        return bs58.decode(addr).length === 32;
      } catch {
        return false;
      }
    }

    case "bitcoin": {
      // Native segwit (bc1...) or legacy Base58Check P2PKH (0x00, "1") / P2SH
      // (0x05, "3").
      if (addr.toLowerCase().startsWith("bc1")) return isValidSegwit(addr, "bc");
      try {
        return isValidBase58Check(bs58.decode(addr), [0x00, 0x05]);
      } catch {
        return false;
      }
    }

    case "litecoin": {
      // Native segwit (ltc1...) or legacy Base58Check P2PKH (0x30, "L") / P2SH
      // (0x32 "M" or legacy 0x05).
      if (addr.toLowerCase().startsWith("ltc1")) return isValidSegwit(addr, "ltc");
      try {
        return isValidBase58Check(bs58.decode(addr), [0x30, 0x32, 0x05]);
      } catch {
        return false;
      }
    }

    case "tron": {
      // Base58Check, 25 bytes, version 0x41 ("T").
      try {
        return isValidBase58Check(bs58.decode(addr), [0x41]);
      } catch {
        return false;
      }
    }

    case "xrp": {
      // XRP-alphabet Base58Check, 25 bytes, version 0x00 ("r").
      const decoded = xrpBase58Decode(addr);
      return decoded ? isValidBase58Check(decoded, [0x00]) : false;
    }

    case "sui":
      // 32-byte hex address (0x + 64 hex). Full-length, no checksum in the
      // format, so the regex is already an exact-length check.
      return /^0x[0-9a-fA-F]{64}$/.test(addr);

    default:
      return false;
  }
}

/** Validate an address for any BPAN chain (EVM or non-EVM). */
export function isValidChainAddress(addr: string, chainId: string, isEVM: boolean): boolean {
  return isEVM ? ethers.isAddress(addr) : isValidNonEvmAddress(addr, chainId);
}
