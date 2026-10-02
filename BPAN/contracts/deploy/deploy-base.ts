import { ethers, network, artifacts } from "hardhat";
import * as fs from "fs";
import * as path from "path";

// Dry run by default. Broadcast only after reviewing the plan and setting
// BPAN_DEPLOY_BROADCAST=true locally. Fresh registry, no imports, zero fee.
async function main() {
  const chain = await ethers.provider.getNetwork();
  if (![8453n, 84532n, 31337n].includes(chain.chainId)) {
    throw new Error("Base deployment requires Base, Base Sepolia, or local Hardhat");
  }
  // Deliberately ignore historical fee/version env values: this deployment
  // always starts fresh with zero fee and no state-import functions.
  const contractName = "BANPRegistryBase";
  const fee = 0n;
  const artifact = await artifacts.readArtifact(contractName);
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode);
  const unsigned = await factory.getDeployTransaction();
  const [deployer] = await ethers.getSigners();
  const sender = process.env.BPAN_DEPLOYER_ADDRESS
    ? ethers.getAddress(process.env.BPAN_DEPLOYER_ADDRESS) : deployer?.address;
  if (sender && deployer && sender !== deployer.address) throw new Error("Configured signer does not match the reviewed deployer address");
  const balance = sender ? await ethers.provider.getBalance(sender) : null;
  console.log(JSON.stringify({ deployer: sender ?? "not configured", balanceETH: balance == null ? null : ethers.formatEther(balance) }));
  // A nonzero simulation sender is needed because Ownable rejects address(0).
  const estimatedGas = await ethers.provider.estimateGas({ ...unsigned, from: sender ?? "0x0000000000000000000000000000000000000001" });
  const gasLimit = (estimatedGas * 120n + 99n) / 100n;
  const fees = await ethers.provider.getFeeData();
  if (!fees.maxFeePerGas || fees.maxPriorityFeePerGas == null) throw new Error("No EIP-1559 fee quote available");
  const nonce = sender ? await ethers.provider.getTransactionCount(sender, "pending") : 0;
  const unsignedTx = ethers.Transaction.from({ ...unsigned, chainId: chain.chainId, nonce,
    gasLimit, type: 2, maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  let l1FeeUpperBound = 0n;
  let operatorFee = 0n;
  if (chain.chainId !== 31337n) {
    const oracle = new ethers.Contract("0x420000000000000000000000000000000000000F", [
      "function getL1FeeUpperBound(uint256) view returns(uint256)",
      "function getOperatorFee(uint256) view returns(uint256)",
    ], ethers.provider);
    l1FeeUpperBound = await oracle.getL1FeeUpperBound(ethers.getBytes(unsignedTx.unsignedSerialized).length + 65);
    operatorFee = await oracle.getOperatorFee(gasLimit);
  }
  const estimatedMaximum = gasLimit * fees.maxFeePerGas + l1FeeUpperBound + operatorFee;
  console.log(JSON.stringify({
    network: network.name, chainId: Number(chain.chainId), contractName,
    registrationFeeWei: fee.toString(), initCodeHash: ethers.keccak256(unsigned.data!),
    deployer: sender ?? "not configured", balanceETH: balance == null ? null : ethers.formatEther(balance),
    expectedContractAddress: sender ? ethers.getCreateAddress({ from: sender, nonce }) : null,
    estimatedGas: estimatedGas.toString(), gasLimit: gasLimit.toString(),
    maxFeePerGasWei: fees.maxFeePerGas.toString(), maxPriorityFeePerGasWei: fees.maxPriorityFeePerGas.toString(),
    l1FeeUpperBoundETH: ethers.formatEther(l1FeeUpperBound), operatorFeeETH: ethers.formatEther(operatorFee),
    estimatedMaximumETH: ethers.formatEther(estimatedMaximum),
    sufficientBalance: balance != null && balance >= estimatedMaximum,
    mode: process.env.BPAN_DEPLOY_BROADCAST === "true" ? "broadcast" : "dry-run",
  }, null, 2));
  if (process.env.BPAN_DEPLOY_BROADCAST !== "true") return;
  if (!deployer) throw new Error("No local deployer configured");
  if (balance == null || balance < estimatedMaximum) throw new Error("Deployer needs ETH on the selected Base network");
  const registry = await factory.connect(deployer).deploy({ gasLimit, maxFeePerGas: fees.maxFeePerGas,
    maxPriorityFeePerGas: fees.maxPriorityFeePerGas, nonce });
  const receipt = await registry.deploymentTransaction()!.wait();
  if (!receipt || receipt.status !== 1) throw new Error("Deployment failed");
  const address = await registry.getAddress();
  const deployment = {
    address, chainId: Number(chain.chainId), network: network.name,
    contractName, version: "base-1",
    startBlock: receipt.blockNumber, transactionHash: receipt.hash,
    registrationFeeWei: fee.toString(), deployer: deployer.address,
    deployedAt: new Date().toISOString(),
  };
  // Keep every Base deployment receipt.
  const output = path.join(__dirname, `deployed-${chain.chainId}-${address}.json`);
  fs.writeFileSync(output, JSON.stringify(deployment, null, 2) + "\n", { flag: "wx" });
  console.log(JSON.stringify(deployment, null, 2));
  console.log(`Saved ${output}. Zero registration fee, fresh registry. Verify before wallet cutover.`);
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
