// Turns the extension's built EVM-only page-world provider
// (wallet-extension/dist/inpage-evm.js) into a committed TypeScript string
// constant that Metro can bundle.
//
// Why a generated, committed file: the mobile app has no bundler at runtime, so
// the injected script has to exist as source. Why generated rather than
// hand-copied: this is the SAME provider the extension injects, and a silent
// divergence between the two clients is exactly the kind of bug that only shows
// up as "this dApp works in the extension but not on the phone". test/
// injected-sync.mjs fails the build if the committed copy drifts.
//
// Usage (from wallet-mobile/):  npm run gen:injected
//   Requires the extension to have been built first:
//   cd ../wallet-extension && npx vite build -c vite.config.inpage-evm.ts

import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(here, "../../wallet-extension/dist/inpage-evm.js");
const OUT = resolve(here, "../src/browser/injected.generated.ts");

let bundle;
try {
  bundle = readFileSync(SRC, "utf8");
} catch {
  console.error(
    `gen-injected: cannot read ${SRC}\n` +
      "Build the extension bundle first:\n" +
      "  cd ../wallet-extension && npx vite build -c vite.config.inpage-evm.ts",
  );
  process.exit(1);
}

const sha256 = createHash("sha256").update(bundle, "utf8").digest("hex");

const out = `// GENERATED FILE - DO NOT EDIT BY HAND.
// Source: wallet-extension/dist/inpage-evm.js (built from src/inpage/evm.ts)
// Regenerate: npm run gen:injected     Verify: node test/injected-sync.mjs
//
// This is the byte-for-byte provider the browser extension injects, minus the
// Solana surface. Editing it here would fork the two clients silently.

/** The page-world EIP-1193 + EIP-6963 provider, as injectable JS source. */
export const INPAGE_EVM_BUNDLE = ${JSON.stringify(bundle)};

/** sha256 of INPAGE_EVM_BUNDLE, checked against a fresh build by the sync test. */
export const INPAGE_EVM_SHA256 = ${JSON.stringify(sha256)};
`;

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, out, "utf8");

console.log(
  `gen-injected: wrote ${OUT}\n  ${bundle.length} bytes, sha256 ${sha256.slice(0, 16)}…`,
);
