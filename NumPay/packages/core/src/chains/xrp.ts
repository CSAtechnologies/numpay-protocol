/**
 * XRP Ledger — secp256k1, BIP44 m/44'/144'/0'/0/0.
 * Uses XRP's custom Base58 alphabet and version byte 0x00.
 */
import { ethers } from "ethers";

const XRP_PATH = "m/44'/144'/0'/0/0";

// XRP Base58 alphabet (not Bitcoin's)
const ALPHA = "rpshnaf39wBUDNEGHJKLM4PQRST7VWXYZ2bcdeCg65jkm8oFqi1tuvAxyz";

function xrpBase58Encode(bytes: Uint8Array): string {
  // Count leading zero bytes
  let leading = 0;
  for (const b of bytes) { if (b !== 0) break; leading++; }

  // Convert bytes → big integer
  let num = 0n;
  for (const b of bytes) num = num * 256n + BigInt(b);

  // Encode big integer as base-58
  let encoded = "";
  while (num > 0n) {
    encoded = ALPHA[Number(num % 58n)] + encoded;
    num /= 58n;
  }

  // Each leading zero byte maps to the first alphabet character ('r')
  return ALPHA[0].repeat(leading) + encoded;
}

export function deriveXrpAddress(mnemonic: string): {
  address: string;
  privateKey: string;
} {
  const hdNode  = ethers.HDNodeWallet.fromPhrase(mnemonic, "", XRP_PATH);
  const pubBytes = ethers.getBytes(hdNode.publicKey); // compressed 33 bytes

  // hash160 = RIPEMD160(SHA256(pubkey)) — same as Bitcoin
  const sha256Hash = ethers.sha256(pubBytes);
  const ripemd    = ethers.getBytes(ethers.ripemd160(sha256Hash));

  // Payload: [0x00, ...20 ripemd bytes]
  const payload = new Uint8Array(21);
  payload[0] = 0x00;
  payload.set(ripemd, 1);

  // Checksum = first 4 bytes of SHA256(SHA256(payload))
  const h1 = ethers.sha256(payload);
  const h2 = ethers.sha256(h1);
  const checksum = ethers.getBytes(h2).slice(0, 4);

  const full = new Uint8Array(25);
  full.set(payload);
  full.set(checksum, 21);

  return { address: xrpBase58Encode(full), privateKey: hdNode.privateKey };
}

// Returns balance in XRP, or null when the source failed — 0 must only ever
// mean a verified unfunded account (callers keep last-known on null).
export async function fetchXrpBalance(address: string): Promise<number | null> {
  // account_info returns only the balance (~0.5 kB).
  //
  // We deliberately do NOT fall back to XRPScan's REST account endpoint
  // (https://api.xrpscan.com/api/v1/account/{address}): it 302-redirects to a
  // full transaction dump (/tx.json — ~18 MB for an active account), which
  // fetch() auto-follows. With the background refresher hitting this every
  // ~60s for an unfunded address (where the primary returns actNotFound and
  // used to fall through), that download alone burned ~1 GB/hour. An
  // unfunded/not-found account is a definitive balance of 0.
  try {
    const resp = await fetch("https://xrplcluster.com/", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        method: "account_info",
        params: [{ account: address, ledger_index: "current" }],
      }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const drops: string | undefined = data.result?.account_data?.Balance;
      if (drops) return parseInt(drops, 10) / 1_000_000;
      // actNotFound (unfunded / never-activated) → definitive 0, no
      // giant-payload fallback. Any other answer shape is unknown → null.
      if (data.result?.error === "actNotFound") return 0;
    }
  } catch {}

  return null;
}
