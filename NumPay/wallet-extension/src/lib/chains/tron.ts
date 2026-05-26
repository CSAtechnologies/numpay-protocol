/**
 * Tron (TRX) — secp256k1, BIP44 m/44'/195'/0'/0/0.
 * Same keccak address algorithm as Ethereum; differs only in
 * address encoding (version byte 0x41, Base58Check via bs58).
 */
import { ethers } from "ethers";
import bs58 from "bs58";

const TRON_PATH = "m/44'/195'/0'/0/0";

export function deriveTronAddress(mnemonic: string): {
  address: string;
  privateKey: string;
} {
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, "", TRON_PATH);

  // ethers gives the keccak-derived 20-byte address as a hex string
  const addrBytes = ethers.getBytes(hdNode.address);

  // Tron raw = [0x41, ...20 address bytes]
  const raw = new Uint8Array(21);
  raw[0] = 0x41;
  raw.set(addrBytes, 1);

  // Checksum = first 4 bytes of SHA256(SHA256(raw))
  const h1 = ethers.sha256(raw);
  const h2 = ethers.sha256(h1);
  const checksum = ethers.getBytes(h2).slice(0, 4);

  const payload = new Uint8Array(25);
  payload.set(raw);
  payload.set(checksum, 21);

  return { address: bs58.encode(payload), privateKey: hdNode.privateKey };
}

export async function fetchTronBalance(address: string): Promise<number> {
  // Primary: Trongrid REST API
  try {
    const resp = await fetch(`https://api.trongrid.io/v1/accounts/${address}`, {
      headers: { Accept: "application/json" },
    });
    if (resp.ok) {
      const data = await resp.json();
      const sun: number = data.data?.[0]?.balance ?? -1;
      if (sun >= 0) return sun / 1_000_000;
    }
  } catch {}

  // Fallback: Trongrid wallet RPC (direct node endpoint)
  try {
    const resp = await fetch("https://api.trongrid.io/wallet/getaccount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, visible: true }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const sun: number = data.balance ?? 0;
      return sun / 1_000_000;
    }
  } catch {}

  return 0;
}
