import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

/**
 * Transfer ownership of the live (V2) registry to a multisig or timelock
 * (CONTRACT-6 / A2). The registry owner can set the fee, withdraw fees, migrate,
 * and close migration, so a single EOA owning it is a key-loss / single-point-of-
 * compromise risk. Move it to a Gnosis Safe or a timelock.
 *
 *   NEW_OWNER=0xSafe... npx hardhat run scripts/transferOwnership.ts --network mainnet
 *
 * Guardrails (this script will NOT broadcast unless they pass):
 *  - NEW_OWNER must be set and a valid, non-zero, checksummed address.
 *  - The connected signer must be the CURRENT owner.
 *  - The target should be a CONTRACT (Safe/timelock). If it has no bytecode it
 *    looks like an EOA; set ALLOW_EOA=1 to override (not recommended).
 *
 * Notes:
 *  - This uses OZ v5 single-step Ownable.transferOwnership: ownership moves
 *    immediately, so triple-check NEW_OWNER. There is no two-step accept here.
 *  - Do NOT renounceOwnership while value sits in the contract or migration is
 *    open: it permanently disables withdrawFees and closeMigration.
 *  - Consider running closeMigration.ts BEFORE handing ownership to a multisig,
 *    unless the multisig itself will run the migration/close.
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
  const newOwnerRaw = process.env.NEW_OWNER;
  if (!newOwnerRaw) {
    throw new Error("NEW_OWNER is not set. Pass the multisig/timelock address, e.g. NEW_OWNER=0xSafe...");
  }
  if (!ethers.isAddress(newOwnerRaw)) {
    throw new Error(`NEW_OWNER is not a valid address: ${newOwnerRaw}`);
  }
  const newOwner = ethers.getAddress(newOwnerRaw); // checksum + normalize
  if (newOwner === ethers.ZeroAddress) {
    throw new Error("NEW_OWNER is the zero address. Refusing (this is not renounce).");
  }

  const [signer] = await ethers.getSigners();
  const contractAddress = registryAddress();
  const contract = await ethers.getContractAt("BANPRegistry", contractAddress, signer);

  const currentOwner: string = await contract.owner();
  console.log("Registry (V2):", contractAddress);
  console.log("Signer:       ", signer.address);
  console.log("Current owner:", currentOwner);
  console.log("New owner:    ", newOwner);

  if (currentOwner.toLowerCase() !== signer.address.toLowerCase()) {
    throw new Error("Connected signer is NOT the current owner. Aborting.");
  }
  if (newOwner.toLowerCase() === currentOwner.toLowerCase()) {
    console.log("New owner equals current owner. Nothing to do.");
    return;
  }

  const code = await signer.provider!.getCode(newOwner);
  const isContract = code !== "0x";
  if (!isContract && process.env.ALLOW_EOA !== "1") {
    throw new Error(
      `NEW_OWNER ${newOwner} has no bytecode (looks like an EOA, not a multisig/timelock). ` +
      "Set ALLOW_EOA=1 to override (not recommended)."
    );
  }
  console.log("Target is a contract:", isContract);

  const tx = await contract.transferOwnership(newOwner);
  console.log("Tx:", tx.hash);
  await tx.wait();

  const owner: string = await contract.owner();
  console.log("Owner after transfer:", owner);
  console.log(
    owner.toLowerCase() === newOwner.toLowerCase()
      ? "Ownership transferred."
      : "WARNING: owner did not change as expected."
  );
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
