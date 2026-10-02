import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const wallet = read("src/wallet/useMobileWallet.ts");
const sweep = read("../packages/core/src/balanceSweep.ts");
let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

check("first paint has native asset rows", wallet.includes("FIRST_PAINT_NATIVES"));
check("first paint covers the five default home chains",
  ["ethereum", "bitcoin", "solana", "bsc", "sui"].every((id) =>
    wallet.includes(`chainId: "${id}"`)));
check("native state starts from first-paint rows",
  wallet.includes("useState<AssetRow[]>(firstPaintNatives)"));
check("cache rejection falls back to first-paint rows",
  wallet.includes("setNatives(firstPaintNatives()); setTokensByChain({}); setCustomBal({});"));
check("balance refresh caps its wait for rates", wallet.includes("const quickRates = Promise.race"));
check("token discovery starts before native balance settlement",
  wallet.indexOf("const discovery = Promise.all") < wallet.indexOf("const [liveRates, evmSweep, nonEvm] = await"));
check("slow rates finish outside the first balance paint",
  /setNatives\(nativeRows\);[\s\S]*?void ratesPromise\.then/.test(wallet));
check("EVM sweep also caps pricing wait", sweep.includes("QUICK_RATE_WAIT_MS = 1500"));
check("native values retain offline price fallbacks", wallet.includes("NATIVE_USD_PRICES[row.symbol]"));

console.log(`startup-balance: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
