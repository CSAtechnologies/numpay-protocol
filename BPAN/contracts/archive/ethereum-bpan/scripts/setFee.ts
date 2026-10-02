import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Resolve the live (V2) registry address. Prefer an explicit override, then the
// address written by deploy.ts. The old hardcoded "0x5633..." was the V1 mainnet
// contract; running fee/withdraw admin against it has no effect on the V2
// production contract (CONTRACT-1).
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

  const contract = await ethers.getContractAt(
    "BANPRegistry",
    contractAddress,
    owner
  );

  const oldFee = await contract.registrationFee();
  console.log("Current fee:", ethers.formatEther(oldFee), "ETH");

  // ~$3 at ETH ~$2029
  const newFee = ethers.parseEther("0.0015");
  console.log("Setting new fee:", ethers.formatEther(newFee), "ETH");

  const tx = await contract.setRegistrationFee(newFee);
  console.log("Tx:", tx.hash);
  await tx.wait();
  console.log("Fee updated successfully!");

  const updatedFee = await contract.registrationFee();
  console.log("New fee:", ethers.formatEther(updatedFee), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
