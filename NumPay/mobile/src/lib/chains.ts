// Multi-chain account derivation + balance reads.
// Phase 1 on mobile: Ethereum + Solana (mirrors the extension's Phantom-
// compatible derivation paths). Balances via plain JSON-RPC fetch, keyless
// public endpoints by default.
import { ethers } from "ethers";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { derivePath } from "./slip10";

export const ETH_RPC = "https://ethereum-rpc.publicnode.com";
export const SOL_RPC = "https://api.mainnet-beta.solana.com";

export const ETH_PATH = "m/44'/60'/0'/0/0";
export const SOL_PATH = "m/44'/501'/0'/0'";

export interface ChainAccount {
  chain: "ethereum" | "solana";
  symbol: "ETH" | "SOL";
  address: string;
}

export function deriveEthAccount(mnemonic: string): ChainAccount {
  const w = ethers.HDNodeWallet.fromPhrase(mnemonic, undefined, ETH_PATH);
  return { chain: "ethereum", symbol: "ETH", address: w.address };
}

export function deriveSolAccount(mnemonic: string): ChainAccount {
  const seed = ethers.getBytes(ethers.Mnemonic.fromPhrase(mnemonic).computeSeed());
  const { key } = derivePath(SOL_PATH, seed);
  const kp = nacl.sign.keyPair.fromSeed(key);
  return { chain: "solana", symbol: "SOL", address: bs58.encode(kp.publicKey) };
}

// Accounts for a wallet. Private-key-only imports have no mnemonic, so no SOL.
export function deriveAccounts(mnemonic: string, ethAddress: string): ChainAccount[] {
  if (!mnemonic) return [{ chain: "ethereum", symbol: "ETH", address: ethAddress }];
  return [deriveEthAccount(mnemonic), deriveSolAccount(mnemonic)];
}

async function rpc<T>(url: string, body: unknown): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`RPC ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result as T;
}

export async function fetchEthBalance(address: string): Promise<string> {
  const hex = await rpc<string>(ETH_RPC, {
    jsonrpc: "2.0", id: 1, method: "eth_getBalance", params: [address, "latest"],
  });
  return ethers.formatEther(hex);
}

export async function fetchSolBalance(address: string): Promise<string> {
  const result = await rpc<{ value: number }>(SOL_RPC, {
    jsonrpc: "2.0", id: 1, method: "getBalance", params: [address],
  });
  return (result.value / 1e9).toFixed(6).replace(/\.?0+$/, "") || "0";
}
