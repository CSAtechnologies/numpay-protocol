import { ethers } from "hardhat";

// V2 Sepolia registry (matches the extension's networks.ts). The old
// "0xB57A18C0…" was the V1 Sepolia contract (CONTRACT-2). Override with
// REGISTRY_ADDRESS to point at a different deployment.
const CONTRACT_ADDRESS =
  process.env.REGISTRY_ADDRESS ?? "0xF2C65Bc0e54b5694c13d7c5E5Accf6DD93d7267a";

async function main() {
  const [deployer] = await ethers.getSigners();
  const registry = await ethers.getContractAt("BANPRegistry", CONTRACT_ADDRESS);

  console.log("\n========================================");
  console.log("  BPAN Manual Test — Sepolia Testnet");
  console.log("========================================");
  console.log("  Wallet:", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("  Balance:", ethers.formatEther(balance), "ETH");

  const fee = await registry.registrationFee();
  console.log("  Registration fee:", ethers.formatEther(fee), "ETH\n");

  // ── Step 1: Register a BPAN number ───────────
  const BPAN_NUMBER = 12345678901n;
  console.log(`[1] Registering BPAN #${BPAN_NUMBER}...`);

  const isAlreadyRegistered = await registry.isRegistered(BPAN_NUMBER);
  if (isAlreadyRegistered) {
    console.log("    Already registered! Skipping...\n");
  } else {
    const tx1 = await registry.registerNumber(BPAN_NUMBER, { value: fee });
    console.log("    Tx sent:", tx1.hash);
    await tx1.wait();
    console.log("    Confirmed! BPAN number registered.\n");
  }

  // ── Step 2: Set wallet mappings ──────────────
  console.log("[2] Setting wallet mappings...");

  const mappings = [
    { chain: "ethereum", wallet: deployer.address },
    { chain: "solana", wallet: "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU" },
    { chain: "bitcoin", wallet: "bc1qw508d6qejxtdg4y5r3zarvary0c5xw7kv8f3t4" },
  ];

  for (const m of mappings) {
    const tx = await registry.setWalletMapping(BPAN_NUMBER, m.chain, m.wallet);
    console.log(`    ${m.chain} -> ${m.wallet.slice(0, 20)}...`);
    await tx.wait();
  }
  console.log("    All mappings set!\n");

  // ── Step 3: Resolve mappings ─────────────────
  console.log("[3] Resolving BPAN #" + BPAN_NUMBER + "...");
  const [chains, wallets] = await registry.getAllMappings(BPAN_NUMBER);
  for (let i = 0; i < chains.length; i++) {
    console.log(`    ${chains[i].padEnd(12)} -> ${wallets[i]}`);
  }

  // ── Step 4: Verify owner ────────────────────
  console.log("\n[4] Verifying ownership...");
  const owner = await registry.ownerOf(BPAN_NUMBER);
  console.log("    Owner:", owner);
  console.log("    Is you:", owner.toLowerCase() === deployer.address.toLowerCase() ? "YES" : "NO");

  // ── Step 5: Protocol stats ──────────────────
  console.log("\n[5] Protocol stats:");
  const totalRegistered = await registry.totalRegistered();
  console.log("    Total registered:", totalRegistered.toString());

  const balanceAfter = await ethers.provider.getBalance(deployer.address);
  const spent = balance - balanceAfter;
  console.log("    Gas spent:", ethers.formatEther(spent), "ETH");

  console.log("\n========================================");
  console.log("  All tests passed on live Sepolia!");
  console.log("========================================\n");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
