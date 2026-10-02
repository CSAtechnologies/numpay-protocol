import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Close the V1→V2 migration window on the live (V2) registry.
 *
 * While `migrationOpen` is true the owner can mint any unregistered number for
 * free and bypass one-BPAN-per-address (CONTRACT-6 blast radius). Once migration
 * is complete this should be called so that path is permanently disabled.
 * `closeMigration()` is irreversible.
 *
 *   npx hardhat run scripts/closeMigration.ts --network mainnet
 *
 * Address resolves from REGISTRY_ADDRESS, else deploy/deployed-v2.json.
 */
function registryAddress(): string {
  if (process.env.REGISTRY_ADDRESS) return process.env.REGISTRY_ADDRESS;
  const deployedPath = path.join(__dirname, "..", "deploy", "deployed-v2.json");
  if (!fs.existsSync(deployedPath)) {
    throw new Error(
      "deployed-v2.json not found and REGISTRY_ADDRESS not set. " +
      "Set REGISTRY_ADDRESS or run deploy.ts first."
    );
  }
  return JSON.parse(fs.readFileSync(deployedPath, "utf8")).address;
}

async function main() {
  const [owner] = await ethers.getSigners();
  console.log("Owner:", owner.address);

  const contractAddress = registryAddress();
  console.log("Registry (V2):", contractAddress);

  const contract = await ethers.getContractAt("BANPRegistry", contractAddress, owner);

  const open: boolean = await contract.migrationOpen();
  console.log("migrationOpen:", open);
  if (!open) {
    console.log("Migration window is already closed. Nothing to do.");
    return;
  }

  const tx = await contract.closeMigration();
  console.log("Tx:", tx.hash);
  await tx.wait();

  const stillOpen: boolean = await contract.migrationOpen();
  console.log("migrationOpen after:", stillOpen);
  console.log(stillOpen ? "WARNING: still open." : "Migration window closed.");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
