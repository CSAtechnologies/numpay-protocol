/**
 * Bitcoin support — BIP84 native segwit (bc1q...) address derivation + balance fetching.
 * Uses the same secp256k1 curve as Ethereum, just different derivation path and address encoding.
 */
import { ethers } from "ethers";
import { bech32 } from "bech32";

// BIP84 derivation path for native segwit
const BTC_DERIVATION_PATH = "m/84'/0'/0'/0/0";

/**
 * Derive a Bitcoin native segwit (bc1q...) address from a BIP39 mnemonic.
 * Bitcoin and Ethereum both use secp256k1, so we reuse ethers' HDNodeWallet.
 */
export function deriveBitcoinAddress(mnemonic: string): {
  address: string;
  publicKey: string;
  privateKey: string;
} {
  // Derive child key at BIP84 path
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, "", BTC_DERIVATION_PATH);
  const compressedPubKey = hdNode.publicKey; // already compressed hex

  // hash160 = RIPEMD160(SHA256(pubkey))
  const pubkeyBytes = ethers.getBytes(compressedPubKey);
  const sha256Hash = ethers.sha256(pubkeyBytes);
  const ripemd160Hash = ethers.ripemd160(sha256Hash);
  const hash160Bytes = ethers.getBytes(ripemd160Hash);

  // Bech32 encode: witness version 0 + hash160
  const words = bech32.toWords(hash160Bytes);
  words.unshift(0); // witness version 0
  const address = bech32.encode("bc", words);

  return {
    address,
    publicKey: compressedPubKey,
    privateKey: hdNode.privateKey,
  };
}

/**
 * Fetch Bitcoin balance using Blockstream's public API (no key needed).
 * Returns balance in BTC, or null when the source failed — 0 must only ever
 * mean a verified empty account (callers keep last-known on null).
 */
export async function fetchBitcoinBalance(address: string): Promise<number | null> {
  try {
    const resp = await fetch(`https://blockstream.info/api/address/${address}`);
    if (!resp.ok) return null;
    const data = await resp.json();
    // chain_stats has confirmed balance, mempool_stats has unconfirmed
    const confirmedSats =
      (data.chain_stats?.funded_txo_sum || 0) -
      (data.chain_stats?.spent_txo_sum || 0);
    const unconfirmedSats =
      (data.mempool_stats?.funded_txo_sum || 0) -
      (data.mempool_stats?.spent_txo_sum || 0);
    const totalSats = confirmedSats + unconfirmedSats;
    return totalSats / 1e8; // satoshis to BTC
  } catch {
    return null;
  }
}
