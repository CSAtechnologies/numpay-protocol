import { ethers } from "hardhat";
import * as fs from "fs";
import * as path from "path";

async function main() {
  const [deployer] = await ethers.getSigners();
  const network = await ethers.provider.getNetwork();

  console.log("=== BANPRegistry V2 Deployment ===");
  console.log("Network  :", network.name, `(chainId ${network.chainId})`);
  console.log("Deployer :", deployer.address);

  const balance = await ethers.provider.getBalance(deployer.address);
  console.log("Balance  :", ethers.formatEther(balance), "ETH");

  // ~$0.50 at $2 000/ETH. Owner can adjust post-deploy with setRegistrationFee().
  const registrationFee = ethers.parseEther("0.00025");

  const BANPRegistry = await ethers.getContractFactory("BANPRegistry");
  console.log("\nDeploying...");
  const registry = await BANPRegistry.deploy(registrationFee);
  await registry.waitForDeployment();

  const address = await registry.getAddress();

  console.log("\n--- Deployment Summary ---");
  console.log("Contract :", address);
  console.log("Fee      :", ethers.formatEther(registrationFee), "ETH (~$0.50)");
  console.log("Owner    :", deployer.address);

  // Persist address so migrate.ts can pick it up automatically.
  const outPath = path.join(__dirname, "deployed-v2.json");
  fs.writeFileSync(
    outPath,
    JSON.stringify(
      {
        address,
        network: network.name,
        chainId: Number(network.chainId),
        fee: registrationFee.toString(),
        deployedAt: new Date().toISOString(),
      },
      null,
      2
    )
  );
  console.log("\nSaved to:", outPath);
  console.log("\nNext: npx hardhat run deploy/migrate.ts --network mainnet");
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
