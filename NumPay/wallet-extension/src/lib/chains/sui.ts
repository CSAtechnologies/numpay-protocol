/**
 * Sui support — Ed25519 address derivation + balance fetching.
 * Uses SLIP-0010 HD derivation with BIP44 path m/44'/784'/0'/0'/0'.
 * Sui address = 0x + hex(SHA3-256(0x00 || pubkey))
 */
import { derivePath } from "./slip10";
import nacl from "tweetnacl";
import { ethers } from "ethers";

// Sui BIP44 derivation path
const SUI_DERIVATION_PATH = "m/44'/784'/0'/0'/0'";

const SUI_RPCS = [
  "https://fullnode.mainnet.sui.io",
  "https://sui-mainnet.nodeinfra.com",
  "https://mainnet.sui.rpcpool.com",
];

/**
 * Compute Sui address from Ed25519 public key.
 * address = SHA-256(0x00 || pubkey), hex-encoded with 0x prefix
 */
async function suiAddressFromPubkey(pubkey: Uint8Array): Promise<string> {
  const payload = new Uint8Array(1 + pubkey.length);
  payload[0] = 0x00; // Ed25519 scheme flag
  payload.set(pubkey, 1);

  const hashBuffer = await crypto.subtle.digest("SHA-256", payload);
  const hashBytes = new Uint8Array(hashBuffer);

  const hex = Array.from(hashBytes.slice(0, 32))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "0x" + hex;
}

/**
 * Derive a Sui address from a BIP39 mnemonic.
 */
export async function deriveSuiAddress(mnemonic: string): Promise<{
  address: string;
  publicKey: string;
  secretKey: Uint8Array;
}> {
  const seed = ethers.Mnemonic.fromPhrase(mnemonic).computeSeed();
  const seedHex = seed.slice(2);

  // SLIP-0010 derivation for Ed25519
  const derived = await derivePath(SUI_DERIVATION_PATH, seedHex);

  // Generate Ed25519 keypair
  const keypair = nacl.sign.keyPair.fromSeed(derived.key);

  // Derive Sui address from public key
  const address = await suiAddressFromPubkey(keypair.publicKey);

  const pubHex = Array.from(keypair.publicKey)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    address,
    publicKey: "0x" + pubHex,
    secretKey: keypair.secretKey,
  };
}

/**
 * Fetch Sui balance using JSON-RPC.
 * Returns balance in SUI.
 */
export async function fetchSuiBalance(address: string): Promise<number> {
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    method: "suix_getBalance",
    params: [address, "0x2::sui::SUI"],
  });
  for (const rpc of SUI_RPCS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const mist = parseInt(data.result?.totalBalance || "0", 10);
      return mist / 1e9; // MIST to SUI
    } catch {}
  }
  return 0;
}
