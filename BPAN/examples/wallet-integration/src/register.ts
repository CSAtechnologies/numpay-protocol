/**
 * Example: Register a BANP number and set wallet mappings
 *
 * This example shows the full onboarding flow:
 * 1. Register an 11-digit BANP number (pays the registration fee)
 * 2. Set wallet mappings for multiple chains
 *
 * Usage:
 *   ts-node src/register.ts <banp-number>
 *
 * Example:
 *   ts-node src/register.ts 48290173462
 */
import dotenv from "dotenv";
dotenv.config();

import { ethers, JsonRpcProvider, Wallet, Contract } from "ethers";

const ABI = [
  "function registerNumber(uint256 number) payable",
  "function setWalletMapping(uint256 number, string chain, string wallet)",
  "function registrationFee() view returns (uint256)",
  "function isRegistered(uint256 number) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getAllMappings(uint256 number) view returns (string[] chains, string[] wallets)",
];

async function main() {
  const [, , numberArg] = process.argv;

  if (!numberArg) {
    console.log("Usage: ts-node src/register.ts <banp-number>");
    console.log("Example: ts-node src/register.ts 48290173462");
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL!;
  const contractAddress = process.env.CONTRACT_ADDRESS!;
  const privateKey = process.env.PRIVATE_KEY!;

  if (!privateKey) {
    console.error("PRIVATE_KEY is required for registration");
    process.exit(1);
  }

  const provider = new JsonRpcProvider(rpcUrl);
  const wallet = new Wallet(privateKey, provider);
  const registry = new Contract(contractAddress, ABI, wallet);

  const number = BigInt(numberArg);
  console.log(`\nRegistering BANP #${number}...`);
  console.log(`  Account: ${wallet.address}\n`);

  // Step 1: Check if already registered
  const alreadyRegistered = await registry.isRegistered(number);
  if (alreadyRegistered) {
    const owner = await registry.ownerOf(number);
    console.log(`BANP #${number} is already registered to ${owner}`);
    process.exit(0);
  }

  // Step 2: Get the registration fee
  const fee = await registry.registrationFee();
  console.log(`  Registration fee: ${ethers.formatEther(fee)} ETH`);

  // Step 3: Register the number
  console.log("  Sending registration transaction...");
  const registerTx = await registry.registerNumber(number, { value: fee });
  const receipt = await registerTx.wait();
  console.log(`  Registered! Tx: ${receipt.hash}`);

  // Step 4: Set wallet mappings (example with multiple chains)
  const mappings = [
    { chain: "ethereum", wallet: wallet.address },
    { chain: "polygon", wallet: wallet.address },
    // Add more chains as needed:
    // { chain: "solana", wallet: "your-solana-address" },
    // { chain: "bitcoin", wallet: "your-btc-address" },
  ];

  console.log("\n  Setting wallet mappings...");
  for (const mapping of mappings) {
    const tx = await registry.setWalletMapping(
      number,
      mapping.chain,
      mapping.wallet
    );
    await tx.wait();
    console.log(`    ${mapping.chain} -> ${mapping.wallet}`);
  }

  // Step 5: Verify
  console.log("\n  Verifying...");
  const [chains, wallets] = await registry.getAllMappings(number);
  console.log(`  BANP #${number} mappings:`);
  for (let i = 0; i < chains.length; i++) {
    console.log(`    ${chains[i]}: ${wallets[i]}`);
  }

  console.log("\n  Done! Your BANP number is ready to receive payments.");
}

main().catch(console.error);
