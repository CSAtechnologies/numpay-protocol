import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const wallet = read("src/wallet/useMobileWallet.ts");
const watcher = read("src/notify/receiveWatch.ts");
let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) passed++;
  else { failed++; console.error(`FAIL ${name}`); }
}

check("wallet refreshes when returning to foreground",
  wallet.includes('AppState.addEventListener("change"') && wallet.includes("returnedToForeground"));
check("wallet keeps a battery-aware foreground sync",
  wallet.includes("FOREGROUND_SYNC_MS") && wallet.includes("requestAutoRefresh"));
check("network recovery wakes refresh",
  wallet.includes("NetInfo.addEventListener") && wallet.includes("!wasOnline && online"));
check("automatic discovery bypasses stale token cache",
  wallet.includes("refresh(true)"));
check("closed-app watcher includes EVM tokens",
  watcher.includes("sweepAllChainTokens") && watcher.includes("fetchTokenReadings"));
check("closed-app watcher includes non-EVM tokens",
  ["fetchSolanaTokens", "fetchTronTokens", "fetchSuiTokens"].every((name) => watcher.includes(name)));
check("notification snapshot migration is versioned",
  watcher.includes("SNAPSHOT_VERSION = 2") && watcher.includes("notifyFirstSeen: isV2"));

console.log(`live-balance-sync: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
