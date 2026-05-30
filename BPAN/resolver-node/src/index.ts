import dotenv from "dotenv";
dotenv.config();

import { BANPDatabase } from "./db";
import { BANPIndexer } from "./indexer";

const RPC_URL = process.env.RPC_URL;
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const START_BLOCK = parseInt(process.env.START_BLOCK || "0", 10);
const POLL_INTERVAL_MS = Math.max(1000, parseInt(process.env.POLL_INTERVAL_MS || "12000", 10));
const DB_PATH = process.env.DB_PATH || "./data/banp.db";

if (!RPC_URL) {
  console.error("RPC_URL environment variable is required");
  process.exit(1);
}

if (!CONTRACT_ADDRESS) {
  console.error("CONTRACT_ADDRESS environment variable is required");
  process.exit(1);
}

const db = new BANPDatabase(DB_PATH);
const indexer = new BANPIndexer({
  rpcUrl: RPC_URL,
  contractAddress: CONTRACT_ADDRESS,
  startBlock: START_BLOCK,
  pollIntervalMs: POLL_INTERVAL_MS,
  db,
});

// Graceful shutdown
process.on("SIGINT", () => {
  console.log("\nShutting down...");
  indexer.stop();
  db.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  indexer.stop();
  db.close();
  process.exit(0);
});

// Log only protocol + host so provider API keys in the RPC path/query are not
// leaked to terminals, CI logs, or third-party log sinks.
function redactRpc(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}`;
  } catch {
    return "[invalid RPC URL]";
  }
}

console.log("BANP Resolver Node");
console.log(`  Contract: ${CONTRACT_ADDRESS}`);
console.log(`  RPC: ${redactRpc(RPC_URL)}`);
console.log(`  Poll interval: ${POLL_INTERVAL_MS}ms`);
console.log(`  Database: ${DB_PATH}`);

indexer.start().catch((err) => {
  console.error("Failed to start indexer:", err);
  process.exit(1);
});

export { db, indexer };
