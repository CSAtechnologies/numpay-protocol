import { ethers, artifacts } from "hardhat";

// Read-only release check. No signer and no transaction submission.
async function main() {
  const network = await ethers.provider.getNetwork();
  if (network.chainId !== 8453n && network.chainId !== 84532n) {
    throw new Error("Verification requires Base or Base Sepolia");
  }
  const address = ethers.getAddress(process.env.REGISTRY_ADDRESS || "");
  const deploymentHash = process.env.DEPLOYMENT_TX_HASH;
  const expectedOwner = process.env.BPAN_DEPLOYER_ADDRESS
    ? ethers.getAddress(process.env.BPAN_DEPLOYER_ADDRESS) : undefined;
  if (deploymentHash) {
    const [tx, receipt, finalized] = await Promise.all([
      ethers.provider.getTransaction(deploymentHash),
      ethers.provider.getTransactionReceipt(deploymentHash),
      ethers.provider.getBlock("finalized"),
    ]);
    if (!tx || !receipt || !finalized || receipt.status !== 1) throw new Error("Successful deployment receipt not found");
    if (receipt.blockNumber > finalized.number) throw new Error("Deployment is not finalized yet");
    if (tx.chainId !== network.chainId || tx.to !== null || tx.value !== 0n || receipt.contractAddress !== address) {
      throw new Error("Transaction does not match the requested Base contract creation");
    }
    if (expectedOwner && tx.from !== expectedOwner) throw new Error("Deployment sender differs from the requested owner");
    const artifact = await artifacts.readArtifact("BANPRegistryBase");
    if (tx.data.toLowerCase() !== artifact.bytecode.toLowerCase()) throw new Error("Creation bytecode mismatch");
  }
  const code = await ethers.provider.getCode(address, "finalized");
  if (code === "0x") throw new Error("Registry deployment is not finalized or has no code");
  const matches: string[] = [];
  for (const name of ["BANPRegistryBase"]) {
    const artifact = await artifacts.readArtifact(name);
    if (artifact.deployedBytecode.toLowerCase() === code.toLowerCase()) matches.push(name);
  }
  if (matches.length !== 1) {
    throw new Error("Deployed bytecode does not match a local registry artifact. Verify its source/build before cutover.");
  }
  const registry = new ethers.Contract(address, [
    "function owner() view returns(address)",
    "function totalRegistered() view returns(uint256)",
    "function registrationFee() view returns(uint256)",
  ], ethers.provider);
  const [owner, total, fee] = await Promise.all([
    registry.owner({ blockTag: "finalized" }), registry.totalRegistered({ blockTag: "finalized" }),
    registry.registrationFee({ blockTag: "finalized" }),
  ]);
  if (expectedOwner && owner !== expectedOwner) throw new Error("Registry owner differs from the requested wallet");
  console.log(JSON.stringify({ chainId: Number(network.chainId), address, contract: matches[0],
    owner, totalRegistered: total.toString(), registrationFeeWei: fee.toString(),
    codeHash: ethers.keccak256(code) }, null, 2));
  if (matches[0] === "BANPRegistryBase" && fee !== 0n) throw new Error("Fresh Base registration fee must be zero");
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
