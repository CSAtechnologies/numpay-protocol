/**
 * Example: Look up full account info for a BANP number
 *
 * This shows how to display a BANP profile — useful for
 * address books, contact cards, or payment UIs.
 *
 * Usage:
 *   ts-node src/lookup.ts <banp-number>
 *
 * Example:
 *   ts-node src/lookup.ts 48290173462
 */
import dotenv from "dotenv";
dotenv.config();

import { JsonRpcProvider, Contract } from "ethers";

const ABI = [
  "function isRegistered(uint256 number) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function getAllMappings(uint256 number) view returns (string[] chains, string[] wallets)",
  "function totalRegistered() view returns (uint256)",
];

async function main() {
  const [, , numberArg] = process.argv;

  if (!numberArg) {
    console.log("Usage: ts-node src/lookup.ts <banp-number>");
    console.log("Example: ts-node src/lookup.ts 48290173462");
    process.exit(1);
  }

  const rpcUrl = process.env.RPC_URL!;
  const contractAddress = process.env.CONTRACT_ADDRESS!;

  const provider = new JsonRpcProvider(rpcUrl);
  const registry = new Contract(contractAddress, ABI, provider);

  const number = BigInt(numberArg);

  console.log(`\n  ┌─────────────────────────────────────────┐`);
  console.log(`  │           BANP Account Lookup            │`);
  console.log(`  └─────────────────────────────────────────┘\n`);

  // Check registration
  const isRegistered = await registry.isRegistered(number);
  if (!isRegistered) {
    console.log(`  BANP #${number} is not registered.\n`);

    const total = await registry.totalRegistered();
    console.log(`  Total registered accounts: ${total}`);
    process.exit(0);
  }

  // Fetch owner and all mappings
  const [owner, [chains, wallets]] = await Promise.all([
    registry.ownerOf(number),
    registry.getAllMappings(number),
  ]);

  console.log(`  Account:  #${number}`);
  console.log(`  Owner:    ${owner}`);
  console.log(`  Chains:   ${chains.length}`);
  console.log(`  ─────────────────────────────────────────`);

  if (chains.length === 0) {
    console.log(`  No wallet mappings set.`);
  } else {
    for (let i = 0; i < chains.length; i++) {
      const chain = chains[i].padEnd(12);
      console.log(`  ${chain} ${wallets[i]}`);
    }
  }

  console.log();
}

main().catch(console.error);
