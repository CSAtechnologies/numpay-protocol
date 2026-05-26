/**
 * Example: Resolve a BANP number to a wallet address
 *
 * This is the most common integration — a wallet or dApp takes a
 * BANP number from the user, resolves it to the target chain's
 * wallet address, and uses that address for the transaction.
 *
 * Usage:
 *   ts-node src/resolve.ts <banp-number> <chain>
 *
 * Example:
 *   ts-node src/resolve.ts 48290173462 ethereum
 */
import dotenv from "dotenv";
dotenv.config();

import { ethers, JsonRpcProvider, Contract } from "ethers";

const ABI = [
  "function getWalletMapping(uint256 number, string chain) view returns (string)",
  "function isRegistered(uint256 number) view returns (bool)",
  "function getAllMappings(uint256 number) view returns (string[] chains, string[] wallets)",
];

async function main() {
  const [, , numberArg, chain] = process.argv;

  if (!numberArg || !chain) {
    console.log("Usage: ts-node src/resolve.ts <banp-number> <chain>");
    console.log("Example: ts-node src/resolve.ts 48290173462 ethereum");
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL!;
  const contractAddress = process.env.CONTRACT_ADDRESS!;

  const provider = new JsonRpcProvider(rpcUrl);
  const registry = new Contract(contractAddress, ABI, provider);

  const number = BigInt(numberArg);
  console.log(`\nResolving BANP #${number} on ${chain}...\n`);

  // Step 1: Check if the number is registered
  const isRegistered = await registry.isRegistered(number);
  if (!isRegistered) {
    console.log(`BANP #${number} is not registered.`);
    process.exit(0);
  }

  // Step 2: Resolve the wallet address for the target chain
  const wallet: string = await registry.getWalletMapping(number, chain);

  if (!wallet) {
    console.log(`No ${chain} wallet mapped for BANP #${number}.`);

    // Show what chains ARE available
    const [chains] = await registry.getAllMappings(number);
    if (chains.length > 0) {
      console.log(`Available chains: ${chains.join(", ")}`);
    }
    process.exit(0);
  }

  console.log(`  BANP:    #${number}`);
  console.log(`  Chain:   ${chain}`);
  console.log(`  Wallet:  ${wallet}`);
  console.log(`\n  You can now send funds to: ${wallet}`);
}

main().catch(console.error);
