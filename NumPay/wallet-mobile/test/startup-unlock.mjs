import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const app = read("App.tsx");
const vault = read("src/vault/mobileVault.ts");
const metro = read("metro.config.js");
let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

const refreshBody = app.match(/const refresh = useCallback\(async \(\) => \{([\s\S]*?)\n  \}, \[applyUnlockedIdentity/)?.[1] ?? "";
const finishBody = app.match(/const finishUnlock = useCallback\(async[\s\S]*?\{([\s\S]*?)\n  \}, \[applyUnlockedIdentity/)?.[1] ?? "";
const pinBody = app.match(/const pinUnlock = async[\s\S]*?\{([\s\S]*?)\n  \};\n  const bioUnlock/)?.[1] ?? "";

check("startup route reads session and vault presence concurrently",
  refreshBody.includes("Promise.all")
  && refreshBody.includes("getUnlockedBootstrap()")
  && refreshBody.includes("vaultExists()"));
check("full security status does not gate the startup route",
  !refreshBody.includes("await getStatus()")
  && refreshBody.includes("refreshStatusInBackground()"));
check("successful unlock reuses the already-open RAM session",
  finishBody.includes("getUnlockedBootstrap()"));
check("successful unlock does not repeat activity or full status awaits",
  !finishBody.includes("touchActivity")
  && !finishBody.includes("await getStatus"));
check("PIN unlock is single-flight",
  pinBody.includes("if (unlockInFlight.current) return")
  && pinBody.includes("setUnlocking(true)"));
check("a rejected PIN does not keep the busy state up for status reads",
  pinBody.includes("refreshStatusInBackground()")
  && !pinBody.includes("setStatus(await getStatus())"));
check("keypad is disabled while secure unlock is running",
  app.includes("disabled={p.busy}")
  && app.includes("Unlocking securely…"));
check("Argon2 security parameters were not reduced",
  vault.includes("const ARGON2_PARAMS = { m: 19_456, t: 2, p: 1 } as const"));
check("bootstrap exposes metadata without returning a mnemonic",
  vault.includes("export async function getUnlockedBootstrap")
  && vault.includes("activeWallet: walletMeta(entry, entry.id)"));
check("non-startup modules are evaluated on demand",
  metro.includes("inlineRequires: true"));

console.log(`startup-unlock: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
