/**
 * migrate.ts
 *
 * Reads every registered BPAN from V1 (Ethereum mainnet) and replicates
 * the full state — ownership + all chain mappings — into the V2 contract.
 *
 * Run AFTER deploy.ts:
 *   npx hardhat run deploy/migrate.ts --network mainnet
 *
 * The script is idempotent: already-migrated numbers are silently skipped,
 * so it is safe to re-run if a batch fails mid-way.
 */

import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// ── V1 constants ──────────────────────────────────────────────────────────────

const V1_BY_NETWORK: Record<string, string> = {
  mainnet : "0x563356958fe3522b7be869666432594fa194a711",
  sepolia : "0xB57A18C0ebfF1fa9610C2D06985cbB9761685C83",
};

// Read the Alchemy key from the environment. Never hardcode provider keys in
// tracked source. Set it before running, e.g.:
//   ALCHEMY_KEY=xxxx npx hardhat run deploy/migrate.ts --network mainnet
const ALCHEMY_KEY = process.env.ALCHEMY_KEY ?? "";
if (!ALCHEMY_KEY) {
  throw new Error(
    "ALCHEMY_KEY env var is not set. Export it before running migrate.ts " +
    "(e.g. ALCHEMY_KEY=... npx hardhat run deploy/migrate.ts --network mainnet)."
  );
}

// Alchemy NFT API base differs by network
const ALCHEMY_NFT_BASE: Record<string, string> = {
  mainnet : `https://eth-mainnet.g.alchemy.com/nft/v3/${ALCHEMY_KEY}`,
  sepolia : `https://eth-sepolia.g.alchemy.com/nft/v3/${ALCHEMY_KEY}`,
};

const V1_ABI = [
  "function totalRegistered() view returns (uint256)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getAllMappings(uint256 number) view returns (string[], string[])",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

// V2 ABI additions needed by this script only
const MIGRATE_ABI = [
  "function migrationOpen() view returns (bool)",
  "function migrateFromV1(uint256[] numbers, address[] owners, string[][] chainsList, string[][] walletsList)",
  "function closeMigration()",
  "function totalRegistered() view returns (uint256)",
];

// Transactions with too many BPANs can exceed block gas. Keep batches small.
const BATCH_SIZE = 20;

// ── Alchemy NFT API helper ────────────────────────────────────────────────────

interface AlchemyNFT  { tokenId: string }
// getNFTsForContract returns { nfts: [...] }, getNFTsForOwner returns { ownedNfts: [...] }
interface AlchemyPage { nfts?: AlchemyNFT[]; ownedNfts?: AlchemyNFT[]; pageKey?: string }

async function fetchAllV1TokenIds(
  networkName: string,
  v1Address:   string,
  provider:    ethers.Provider
): Promise<bigint[]> {

  // ── Strategy 1: Alchemy NFT API (preferred, no eth_getLogs limits) ────────
  try {
    const nftBase = ALCHEMY_NFT_BASE[networkName] ?? ALCHEMY_NFT_BASE["mainnet"];
    const base    = `${nftBase}/getNFTsForContract?contractAddress=${v1Address}&withMetadata=false&limit=100`;
    const ids: bigint[] = [];
    let pageKey: string | undefined;

    do {
      const url = pageKey ? `${base}&pageKey=${encodeURIComponent(pageKey)}` : base;
      const res  = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
      const data: AlchemyPage = await res.json();
      const items = data.nfts ?? data.ownedNfts ?? [];
      for (const nft of items) ids.push(BigInt(nft.tokenId));
      pageKey = data.pageKey;
    } while (pageKey);

    console.log(`  Alchemy NFT API returned ${ids.length} token(s).`);
    return ids;

  } catch (e: any) {
    console.warn(`  Alchemy NFT API failed (${e.message}), falling back to Transfer events...`);
  }

  // ── Strategy 2: Transfer event scan (mint = from address(0)) ─────────────
  const v1 = new ethers.Contract(v1Address, V1_ABI, provider);
  const filter = v1.filters.Transfer(ethers.ZeroAddress, null, null);
  const minted = new Set<string>();

  // Try full-range first; Alchemy supports this on both mainnet and testnet.
  try {
    const events = (await v1.queryFilter(filter)) as ethers.EventLog[];
    for (const ev of events) {
      if (ev.args?.tokenId != null) minted.add(ev.args.tokenId.toString());
    }
  } catch {
    // Chunked fallback (10 000 blocks per call)
    const latest = await provider.getBlockNumber();
    const CHUNK  = 10_000;
    for (let from = 0; from <= latest; from += CHUNK) {
      try {
        const events = (await v1.queryFilter(filter, from, Math.min(from + CHUNK - 1, latest))) as ethers.EventLog[];
        for (const ev of events) {
          if (ev.args?.tokenId != null) minted.add(ev.args.tokenId.toString());
        }
      } catch { /* skip failed chunk */ }
    }
  }

  console.log(`  Transfer scan found ${minted.size} minted token(s).`);
  return Array.from(minted).map(BigInt);
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const [deployer] = await ethers.getSigners();
  const network    = await ethers.provider.getNetwork();

  const networkName = network.name === "unknown" ? "sepolia" : network.name;

  const V1_ADDRESS = V1_BY_NETWORK[networkName];
  if (!V1_ADDRESS) throw new Error(`No V1 address configured for network "${networkName}"`);

  console.log("=== BANPRegistry V1 → V2 Migration ===");
  console.log("Network  :", networkName);
  console.log("V1 addr  :", V1_ADDRESS);
  console.log("Deployer :", deployer.address);

  // ── 1. Load V2 address written by deploy.ts ─────────────────────────────
  const deployedPath = path.join(__dirname, "deployed-v2.json");
  if (!fs.existsSync(deployedPath)) {
    throw new Error("deployed-v2.json not found. Run deploy.ts first.");
  }
  const deployedInfo = JSON.parse(fs.readFileSync(deployedPath, "utf8"));
  const V2_ADDRESS: string = deployedInfo.address;
  console.log("V2 contract:", V2_ADDRESS);

  // ── 2. Connect to both contracts ─────────────────────────────────────────
  const v1 = new ethers.Contract(V1_ADDRESS, V1_ABI, ethers.provider);

  const v2Factory = await ethers.getContractFactory("BANPRegistry");
  const v2        = new ethers.Contract(V2_ADDRESS, [...MIGRATE_ABI], deployer);

  const migOpen: boolean = await v2.migrationOpen();
  if (!migOpen) {
    console.log("Migration window is already closed on V2. Nothing to do.");
    return;
  }

  // ── 3. Enumerate all V1 token IDs ────────────────────────────────────────
  console.log("\nFetching V1 token list...");
  const tokenIds = await fetchAllV1TokenIds(networkName, V1_ADDRESS, ethers.provider);

  const v1Total: bigint = await v1.totalRegistered();
  console.log(`Alchemy returned ${tokenIds.length} tokens  |  V1 totalRegistered = ${v1Total}`);

  if (tokenIds.length === 0) {
    console.log("No BPANs registered on V1. Closing migration window.");
    const tx = await v2.closeMigration();
    await tx.wait();
    console.log("Migration window closed:", tx.hash);
    return;
  }

  // ── 4. Fetch owner + mappings for every V1 token ─────────────────────────
  console.log("\nFetching owner and chain mappings for each BPAN...");

  interface BPANRecord {
    number:  bigint;
    owner:   string;
    chains:  string[];
    wallets: string[];
  }

  const records: BPANRecord[] = [];

  for (const tokenId of tokenIds) {
    try {
      const owner: string = await v1.ownerOf(tokenId);
      const [chains, wallets]: [string[], string[]] = await v1.getAllMappings(tokenId);
      records.push({ number: tokenId, owner, chains: [...chains], wallets: [...wallets] });
      console.log(
        `  BPAN ${tokenId.toString().padEnd(12)}` +
        `owner=${owner}  chains=[${chains.join(", ")}]`
      );
    } catch (e: any) {
      console.warn(`  Skipping ${tokenId}: ${e.message}`);
    }
  }

  console.log(`\nReady to migrate ${records.length} BPAN(s).`);

  // ── 5. Migrate in batches ─────────────────────────────────────────────────
  let migrated = 0;

  for (let i = 0; i < records.length; i += BATCH_SIZE) {
    const batch = records.slice(i, i + BATCH_SIZE);

    const numbers    = batch.map((r) => r.number);
    const owners     = batch.map((r) => r.owner);
    const chainsList = batch.map((r) => r.chains);
    const walletsList = batch.map((r) => r.wallets);

    const batchNum = Math.floor(i / BATCH_SIZE) + 1;
    const batchEnd = Math.min(i + BATCH_SIZE, records.length);
    process.stdout.write(
      `  Batch ${batchNum} (BPANs ${i + 1}–${batchEnd})... `
    );

    try {
      const tx = await v2.migrateFromV1(numbers, owners, chainsList, walletsList);
      const receipt = await tx.wait();
      migrated += batch.length;
      console.log(`done  gas=${receipt.gasUsed}  tx=${tx.hash}`);
    } catch (e: any) {
      console.error(`FAILED: ${e.message}`);
      console.error("Batch data:", JSON.stringify({ numbers: numbers.map(String), owners, chainsList, walletsList }, null, 2));
      throw e; // Stop on failure — re-run is safe (idempotent)
    }
  }

  // ── 6. Close migration window ─────────────────────────────────────────────
  console.log("\nClosing migration window...");
  const closeTx = await v2.closeMigration();
  const closeReceipt = await closeTx.wait();
  console.log(`Migration window closed  gas=${closeReceipt.gasUsed}  tx=${closeTx.hash}`);

  // ── 7. Verify final state ─────────────────────────────────────────────────
  console.log("\nVerifying V2 state...");
  const v2Total: bigint = await v2.totalRegistered();
  console.log(`V2 totalRegistered = ${v2Total}  (expected ${records.length})`);

  for (const rec of records) {
    try {
      const v2Owner: string = await (v2Factory.attach(V2_ADDRESS) as any).ownerOf(rec.number);
      const ok = v2Owner.toLowerCase() === rec.owner.toLowerCase();
      console.log(`  BPAN ${rec.number}: ${ok ? "OK" : `MISMATCH — expected ${rec.owner}, got ${v2Owner}`}`);
    } catch (e: any) {
      console.warn(`  BPAN ${rec.number}: verification failed — ${e.message}`);
    }
  }

  // ── 8. Summary ────────────────────────────────────────────────────────────
  console.log("\n=== Migration Complete ===");
  console.log(`Migrated : ${migrated} BPAN(s)`);
  console.log(`V2 addr  : ${V2_ADDRESS}`);
  console.log("\nFinal step: update BPAN_MAINNET_CONTRACT in");
  console.log("  NumPay/wallet-extension/src/lib/networks.ts");
  console.log(`  to "${V2_ADDRESS}"`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
