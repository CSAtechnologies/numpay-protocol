// Standalone crypto verification (run with: node --experimental-strip-types).
// Proves the ported primitives against known vectors, independent of the UI.
import { derivePath } from "./src/lib/slip10";
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

// 5) Solana transfer message: structure, signature validity, base64 encoder
{
  const { buildSolTransferMessage, bytesToBase64, deriveSolSecretKey } = await import("./src/lib/tx");
  const mnemonic = "abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about";
  const secretKey = deriveSolSecretKey(mnemonic);
  const fromPubkey = secretKey.slice(32);
  const toPubkey = new Uint8Array(32).fill(7);
  const blockhash = new Uint8Array(32).fill(9);
  const lamports = 1_234_567n;

  const message = buildSolTransferMessage(fromPubkey, toPubkey, blockhash, lamports);

  // Header (1,0,1), 3 keys, key order from/to/system, program index 2,
  // account indices [0,1], data = u32(2) LE + u64 lamports LE
  const wantLen = 3 + 1 + 96 + 32 + 1 + 1 + 1 + 2 + 1 + 12;
  check("SOL message length", String(message.length), String(wantLen));
  check("SOL message header", bytesToHex(message.slice(0, 4)), "01000103");
  check("SOL from key at offset 4", bytesToHex(message.slice(4, 36)), bytesToHex(fromPubkey));
  const dataStart = message.length - 12;
  check("SOL transfer discriminant + lamports",
    bytesToHex(message.slice(dataStart)),
    "0200000087d61200" + "00000000".slice(0, 8));

  const sig = nacl.sign.detached(message, secretKey);
  check("SOL signature verifies", String(nacl.sign.detached.verify(message, sig, fromPubkey)), "true");

  // base64 encoder vs Node's Buffer for several lengths (padding cases)
  for (const n of [0, 1, 2, 3, 31, 64, 100]) {
    const bytes = new Uint8Array(n).map((_, i) => (i * 37 + 11) % 256);
    check(`base64 encoder matches Buffer (len ${n})`,
      bytesToBase64(bytes), Buffer.from(bytes).toString("base64"));
  }
}

console.log(failed === 0 ? "\nALL CHECKS PASSED" : `\n${failed} CHECK(S) FAILED`);
process.exit(failed === 0 ? 0 : 1);
