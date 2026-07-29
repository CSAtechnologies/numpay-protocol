// NumPay ID (BPAN) validation, formatting, and mainnet resolution.
// Ported from the extension's bpan.ts. The registry lives on Ethereum
// mainnet; resolution ALWAYS queries mainnet regardless of active network.
import { ethers } from "ethers";

export const BPAN_MAINNET_CONTRACT = "0xdB5206e06a7509b9181F0594752CD42cbD7eD371";
const BPAN_RPC = "https://ethereum-rpc.publicnode.com";

const BPAN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function getWalletMapping(uint256 number, string chain) view returns (string)",
  "function getAllMappings(uint256 number) view returns (string[], string[])",
  "function isRegistered(uint256 number) view returns (bool)",
];

let _provider: ethers.JsonRpcProvider | null = null;
function getProvider(): ethers.JsonRpcProvider {
  if (!_provider) _provider = new ethers.JsonRpcProvider(BPAN_RPC);
  return _provider;
}

function getContract(): ethers.Contract {
  return new ethers.Contract(BPAN_MAINNET_CONTRACT, BPAN_ABI, getProvider());
}

export function isValidBPAN(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  const n = BigInt(value);
  return n >= 10_000_000_000n && n <= 99_999_999_999n;
}

export function formatBPAN(raw: string): string {
  return `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
}

export async function resolveBPAN(number: string, chain: string): Promise<string | null> {
  const wallet: string = await getContract().getWalletMapping(BigInt(number), chain);
  return wallet || null;
}

// Look up the BPAN owned by an address (first token), or null if none.
export async function bpanOfOwner(address: string): Promise<string | null> {
  try {
    const c = getContract();
    const bal: bigint = await c.balanceOf(address);
    if (bal === 0n) return null;
    const token: bigint = await c.tokenOfOwnerByIndex(address, 0n);
    return token.toString();
  } catch {
    return null;
  }
}
