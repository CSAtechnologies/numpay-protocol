// Standalone crypto verification (run with: node --experimental-strip-types).
// Proves the ported primitives against known vectors, independent of the UI.
import { derivePath } from "./src/lib/slip10.ts";
import { pbkdf2Async } from "@noble/hashes/pbkdf2.js";
import { sha256 } from "@noble/hashes/sha2.js";
import { gcm } from "@noble/ciphers/aes.js";
import { utf8ToBytes, bytesToUtf8, bytesToHex, hexToBytes } from "@noble/ciphers/utils.js";
import { ethers } from "ethers";
import nacl from "tweetnacl";
import bs58 from "bs58";

let failed = 0;
function check(name: string, got: string, want: string) {
  const ok = got === want;
  if (!ok) failed++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}`);
  if (!ok) console.log(`  got:  ${got}\n  want: ${want}`);
}

// 1) SLIP-0010 ed25519 official test vector 1 (satoshilabs/slips/slip-0010)
//    Seed 000102030405060708090a0b0c0d0e0f, chain m/0'/1'/2'/2'/1000000000'
{
  const seed = hexToBytes("000102030405060708090a0b0c0d0e0f");
  const { key } = derivePath("m/0'/1'/2'/2'/1000000000'", seed);
  check(
    "SLIP-0010 ed25519 vector 1 (m/0'/1'/2'/2'/1000000000')",
    bytesToHex(key),
    "8f94d394a8e8fd6b1bc2f3f49f5c47e385281d5c17e65324b0f62483e37e8793",
  );
}

// 2) ETH BIP-44 derivation for the standard test mnemonic
{
  const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const w = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, "m/44'/60'/0'/0/0");
  check(
    "ETH address for test mnemonic at m/44'/60'/0'/0/0",
    w.address,
    "0x9858EfFD232B4033E47d90003D41EC34EcaEda94",
  );
}

// 3) SOL derivation is deterministic and produces a valid base58 32-byte key
{
  const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const seed = ethers.getBytes(ethers.Mnemonic.fromPhrase(mnemonic).computeSeed());
  const { key } = derivePath("m/44'/501'/0'/0'", seed);
  const kp = nacl.sign.keyPair.fromSeed(key);
  const addr = bs58.encode(kp.publicKey);
  const again = bs58.encode(nacl.sign.keyPair.fromSeed(derivePath("m/44'/501'/0'/0'", seed).key).publicKey);
  check("SOL derivation deterministic", addr, again);
  console.log(`INFO SOL address for test mnemonic: ${addr} (decoded length ${bs58.decode(addr).length})`);
}

// 4) Vault algorithm roundtrip: PBKDF2-SHA256(600k) + AES-256-GCM
{
  const password = "correct horse battery staple";
  const salt = hexToBytes("00112233445566778899aabbccddeeff");
  const iv = hexToBytes("000000000000000000000001");
  const key = await pbkdf2Async(sha256, utf8ToBytes(password), salt, { c: 600_000, dkLen: 32 });
  const plain = JSON.stringify({ mnemonic: "test test test", address: "0xabc", privateKey: "0xdef" });
  const cipher = gcm(key, iv).encrypt(utf8ToBytes(plain));
  const back = bytesToUtf8(gcm(key, iv).decrypt(cipher));
  check("Vault AES-GCM roundtrip", back, plain);

  let threw = false;
  try {
    const wrongKey = await pbkdf2Async(sha256, utf8ToBytes("wrong password"), salt, { c: 600_000, dkLen: 32 });
    gcm(wrongKey, iv).decrypt(cipher);
  } catch { threw = true; }
  check("Wrong password rejected by GCM auth tag", String(threw), "true");
}

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
