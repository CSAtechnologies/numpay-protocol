// Guards the one thing the generated-injection approach can get wrong: the
// committed copy of the page-world provider drifting from the extension's
// build. Without this, someone edits inpage/provider.ts, ships the extension,
// and the phone silently keeps injecting last month's provider.
//
// Two checks:
//   1. SELF-CONSISTENCY (always runs): the recorded sha256 matches the embedded
//      bundle. Catches a hand-edited generated file.
//   2. FRESHNESS (runs only when the extension has been built): the embedded
//      bundle matches wallet-extension/dist/inpage-evm.js byte for byte.
//
// Check 2 is skipped rather than failed when dist/ is absent, because a fresh
// clone has no extension build and `npm test` must still pass there. It is a
// hard failure whenever the file DOES exist, which is the case in any working
// tree where the extension has been built.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
let pass = 0;
const failures = [];

function check(name, fn) {
  try {
    fn();
    pass++;
  } catch (e) {
    failures.push(`${name}: ${e.message}`);
  }
}

// The generated module is TS-syntax-free apart from the export statements, so
// rather than add a transpiler we pull the two literals out directly.
const genPath = resolve(here, "../src/browser/injected.generated.ts");
const gen = readFileSync(genPath, "utf8");

function literal(name) {
  const m = new RegExp(`export const ${name} = ("(?:[^"\\\\]|\\\\.)*");`).exec(gen);
  if (!m) throw new Error(`could not find ${name} in injected.generated.ts`);
  return JSON.parse(m[1]);
}

const bundle = literal("INPAGE_EVM_BUNDLE");
const recordedSha = literal("INPAGE_EVM_SHA256");

check("recorded sha256 matches the embedded bundle", () => {
  const actual = createHash("sha256").update(bundle, "utf8").digest("hex");
  if (actual !== recordedSha) {
    throw new Error(
      `sha mismatch: recorded ${recordedSha.slice(0, 16)}… but embedded bundle hashes to ${actual.slice(0, 16)}…`,
    );
  }
});

check("bundle is the EVM surface, not a stub", () => {
  if (!bundle.includes("eip6963:announceProvider")) {
    throw new Error("bundle does not announce over EIP-6963");
  }
  if (!bundle.includes("numpay-content")) {
    throw new Error("bundle does not post to the host bridge");
  }
});

// The EVM-only entry exists precisely so a Solana dApp does NOT pick NumPay in
// the mobile browser and then fail every call. If the Solana surface ever leaks
// back into this bundle, that regression is silent in the app.
check("bundle carries no Solana surface", () => {
  if (/solana|wallet-standard/i.test(bundle)) {
    throw new Error(
      "Solana surface leaked into the EVM-only bundle (is gen-injected reading dist/inpage.js instead of dist/inpage-evm.js?)",
    );
  }
});

check("committed bundle matches a fresh extension build", () => {
  const distPath = resolve(here, "../../wallet-extension/dist/inpage-evm.js");
  let fresh;
  try {
    fresh = readFileSync(distPath, "utf8");
  } catch {
    console.log("  (skipped freshness check: no extension build at dist/inpage-evm.js)");
    return;
  }
  if (fresh !== bundle) {
    throw new Error(
      "committed injected.generated.ts is stale. Run: npm run gen:injected",
    );
  }
});

if (failures.length) {
  console.error(`injected-sync: ${pass} passed, ${failures.length} FAILED`);
  for (const f of failures) console.error("  ✗ " + f);
  process.exit(1);
}
console.log(`injected-sync: ${pass}/${pass} passed`);
