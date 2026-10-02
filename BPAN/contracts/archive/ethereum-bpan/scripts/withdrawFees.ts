import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Resolve the live (V2) registry address. Prefer an explicit override, then the
// address written by deploy.ts. The old hardcoded "0x5633..." was the V1 mainnet
// contract; withdrawing against it would not drain V2 fees (CONTRACT-1).
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

  // Check accumulated fees
  const balance = await ethers.provider.getBalance(await contract.getAddress());
  console.log("Contract balance:", ethers.formatEther(balance), "ETH");

  if (balance === 0n) {
    console.log("No fees to withdraw.");
    return;
  }

  // Withdraw to owner address (change this to any address you want)
  const withdrawTo = owner.address;
  console.log("Withdrawing to:", withdrawTo);

  const tx = await contract.withdrawFees(withdrawTo);
  console.log("Tx:", tx.hash);
  await tx.wait();
  console.log("Fees withdrawn successfully!");

  const newBalance = await ethers.provider.getBalance(await contract.getAddress());
  console.log("Contract balance after:", ethers.formatEther(newBalance), "ETH");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
