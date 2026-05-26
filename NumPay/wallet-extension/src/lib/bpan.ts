import { ethers } from "ethers";
import { BPAN_MAINNET_CONTRACT, BPAN_MAINNET_RPC } from "./networks";

const BPAN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function tokenOfOwnerByIndex(address owner, uint256 index) view returns (uint256)",
  "function registerNumber(uint256 number) payable",
  "function setWalletMapping(uint256 number, string chain, string wallet)",
  "function removeWalletMapping(uint256 number, string chain)",
  "function getWalletMapping(uint256 number, string chain) view returns (string)",
  "function getAllMappings(uint256 number) view returns (string[], string[])",
  "function isRegistered(uint256 number) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function registrationFee() view returns (uint256)",
  "function totalRegistered() view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

// Lazy mainnet provider – reused across calls to avoid creating a new
// WebSocket/HTTP connection for every resolution.
let _mainnetProvider: ethers.JsonRpcProvider | null = null;
function getMainnetProvider(): ethers.JsonRpcProvider {
  if (!_mainnetProvider) {
    _mainnetProvider = new ethers.JsonRpcProvider(BPAN_MAINNET_RPC);
  }
  return _mainnetProvider;
}

// Returns a contract instance connected to Ethereum mainnet (for reads)
// or to the provided signer (for writes).
export function getBPANContract(
  address: string,
  signerOrProvider: ethers.Signer | ethers.Provider
): ethers.Contract {
  return new ethers.Contract(address, BPAN_ABI, signerOrProvider);
}

// Convenience: mainnet read-only contract instance.
export function getMainnetBPANContract(): ethers.Contract {
  return getBPANContract(BPAN_MAINNET_CONTRACT, getMainnetProvider());
}

// ── Validation ────────────────────────────────────────────────────────────────

export function isValidBPAN(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  const n = BigInt(value);
  return n >= 10_000_000_000n && n <= 99_999_999_999n;
}

export function isBPANInput(value: string): boolean {
  return /^\d{7,11}$/.test(value.trim());
}

export function formatBPAN(raw: string): string {
  return `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
}

// ── Resolution (always queries Ethereum mainnet) ──────────────────────────────

/**
 * Resolve a BPAN number to the wallet address registered for `chain`.
 * ALWAYS queries Ethereum mainnet regardless of the caller's current network.
 *
 * @param number  11-digit BPAN string
 * @param chain   Chain name as stored in registry (e.g. "ethereum", "solana", "polygon")
 */
export async function resolveBPAN(
  number: string,
  chain: string,
): Promise<string | null> {
  const contract = getMainnetBPANContract();
  const wallet: string = await contract.getWalletMapping(BigInt(number), chain);
  return wallet || null;
}

/**
 * Get all wallet mappings for a BPAN number from Ethereum mainnet.
 */
export async function getAllBPANMappings(
  number: string,
): Promise<{ chains: string[]; wallets: string[] }> {
  const contract = getMainnetBPANContract();
  const [chains, wallets] = await contract.getAllMappings(BigInt(number));
  return { chains: [...chains], wallets: [...wallets] };
}

/**
 * Check if a BPAN number is registered on Ethereum mainnet.
 */
export async function isBPANRegistered(number: string): Promise<boolean> {
  const contract = getMainnetBPANContract();
  return contract.isRegistered(BigInt(number));
}

/**
 * Get the owner of a BPAN number from Ethereum mainnet.
 */
export async function getBPANOwner(number: string): Promise<string> {
  const contract = getMainnetBPANContract();
  return contract.ownerOf(BigInt(number));
}

// Extracts the Alchemy API key from the configured RPC URL.
function getAlchemyApiKey(): string | null {
  const match = BPAN_MAINNET_RPC.match(/\/v2\/([^/?]+)/);
  return match ? match[1] : null;
}

/**
 * Discover every BPAN NFT owned by `ownerAddress` on Ethereum mainnet.
 *
 * Strategy (fastest first):
 *  1. balanceOf()           — O(1), skip if wallet has no BPANs
 *  2. tokenOfOwnerByIndex() — O(balance), if contract is ERC-721 Enumerable
 *  3. Alchemy NFT API       — getNFTsForOwner, no eth_getLogs needed (works on free tier)
 *  4. Transfer event scan   — full history then chunked, last resort
 */
export async function findOwnedBPANs(ownerAddress: string): Promise<string[]> {
  const contract = getMainnetBPANContract();

  // ── Step 1: quick balance check ───────────────────────────────────────────
  let balance = 0n;
  try {
    balance = BigInt(await contract.balanceOf(ownerAddress));
  } catch (e) {
    console.warn("[BPAN] balanceOf failed:", e);
  }
  if (balance === 0n) return [];

  // ── Step 2: ERC-721 Enumerable (tokenOfOwnerByIndex) ─────────────────────
  try {
    const ids: string[] = [];
    for (let i = 0n; i < balance; i++) {
      const tokenId: bigint = await contract.tokenOfOwnerByIndex(ownerAddress, i);
      ids.push(tokenId.toString());
    }
    if (ids.length > 0) return ids;
  } catch {
    // Contract is not ERC-721 Enumerable — continue to next strategy.
  }

  // ── Step 3: Alchemy NFT API (avoids eth_getLogs entirely) ────────────────
  const apiKey = getAlchemyApiKey();
  if (apiKey) {
    try {
      const url =
        `https://eth-mainnet.g.alchemy.com/nft/v3/${apiKey}/getNFTsForOwner` +
        `?owner=${ownerAddress}&contractAddresses[]=${BPAN_MAINNET_CONTRACT}&withMetadata=false`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const ids: string[] = (data.ownedNfts ?? []).map((nft: { tokenId: string }) =>
          BigInt(nft.tokenId).toString()
        );
        if (ids.length > 0) return ids;
      }
    } catch (e) {
      console.warn("[BPAN] Alchemy NFT API failed:", (e as Error)?.message);
    }
  }

  // ── Step 4: Transfer event scan (full history first, chunked fallback) ───
  const filter = contract.filters.Transfer(null, ownerAddress);
  const candidates = new Set<string>();

  let fullScanSucceeded = false;
  try {
    const events = (await contract.queryFilter(filter)) as ethers.EventLog[];
    for (const ev of events) {
      const tokenId = ev?.args?.tokenId ?? ev?.args?.[2];
      if (tokenId != null) candidates.add(tokenId.toString());
    }
    fullScanSucceeded = true;
  } catch {
    // RPC range limit — fall through to chunked scan.
  }

  if (!fullScanSucceeded) {
    const provider = getMainnetProvider();
    const currentBlock = await provider.getBlockNumber();
    const CHUNK = 10_000;
    for (let from = 0; from <= currentBlock; from += CHUNK) {
      const to = Math.min(from + CHUNK - 1, currentBlock);
      try {
        const events = (await contract.queryFilter(filter, from, to)) as ethers.EventLog[];
        for (const ev of events) {
          const tokenId = ev?.args?.tokenId ?? ev?.args?.[2];
          if (tokenId != null) candidates.add(tokenId.toString());
        }
      } catch { /* chunk failed — provider likely restricts range, skip */ }
    }
  }

  // Verify current ownership (tokens may have been transferred away).
  const owned: string[] = [];
  await Promise.all(
    Array.from(candidates).map(async (num) => {
      try {
        const current: string = await contract.ownerOf(BigInt(num));
        if (current.toLowerCase() === ownerAddress.toLowerCase()) owned.push(num);
      } catch { /* burned or nonexistent */ }
    })
  );
  return owned;
}

/**
 * Fast check: how many BPANs does an address own? Uses balanceOf() — one call.
 * Returns 0 if the wallet has no BPANs, or if the call fails.
 */
export async function getOwnedBPANCount(ownerAddress: string): Promise<number> {
  try {
    const contract = getMainnetBPANContract();
    const bal: bigint = await contract.balanceOf(ownerAddress);
    return Number(bal);
  } catch {
    return 0;
  }
}

/**
 * Register a BPAN number on Ethereum mainnet.
 * The signer must be connected to Ethereum mainnet (chainId 1 or 11155111).
 */
export async function registerBPAN(
  number: string,
  contractAddress: string,
  signer: ethers.Signer,
): Promise<ethers.TransactionResponse> {
  const contract = getBPANContract(contractAddress, signer);
  const fee: bigint = await contract.registrationFee();
  return contract.registerNumber(BigInt(number), { value: fee });
}

/**
 * Set wallet mapping(s) for a BPAN number.
 * Must be called on the chain where the contract is deployed (mainnet/sepolia).
 */
export async function setWalletMapping(
  number: string,
  chain: string,
  wallet: string,
  contractAddress: string,
  signer: ethers.Signer,
): Promise<ethers.TransactionResponse> {
  const contract = getBPANContract(contractAddress, signer);
  return contract.setWalletMapping(BigInt(number), chain, wallet);
}
