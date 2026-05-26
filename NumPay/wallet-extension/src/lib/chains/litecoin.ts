/**
 * Litecoin (LTC) — secp256k1, BIP84 m/84'/2'/0'/0/0.
 * Native segwit P2WPKH address with "ltc" bech32 prefix.
 * Same derivation pattern as Bitcoin; only the path and prefix differ.
 */
import { ethers } from "ethers";
import { bech32 } from "bech32";

const LTC_PATH = "m/84'/2'/0'/0/0";

export function deriveLitecoinAddress(mnemonic: string): {
  address: string;
  privateKey: string;
} {
  const hdNode   = ethers.HDNodeWallet.fromPhrase(mnemonic, "", LTC_PATH);
  const pubBytes = ethers.getBytes(hdNode.publicKey); // compressed 33 bytes

  // hash160 = RIPEMD160(SHA256(pubkey))
  const sha256Hash = ethers.sha256(pubBytes);
  const ripemd    = ethers.getBytes(ethers.ripemd160(sha256Hash));

  // BIP84 P2WPKH: bech32 with "ltc" HRP, witness version 0
  const words = bech32.toWords(ripemd);
  words.unshift(0);
  const address = bech32.encode("ltc", words);

  return { address, privateKey: hdNode.privateKey };
}

export async function fetchLitecoinBalance(address: string): Promise<number> {
  try {
    const resp = await fetch(`https://litecoinspace.org/api/address/${address}`);
    if (!resp.ok) return 0;
    const data = await resp.json();
    const confirmed   = (data.chain_stats?.funded_txo_sum   || 0) - (data.chain_stats?.spent_txo_sum   || 0);
    const unconfirmed = (data.mempool_stats?.funded_txo_sum || 0) - (data.mempool_stats?.spent_txo_sum || 0);
    return (confirmed + unconfirmed) / 1e8; // litoshis → LTC
  } catch {
    return 0;
  }
}
