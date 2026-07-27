/**
 * Unit tests for the home-list visibility rule (src/wallet/assetVisibility.ts):
 *
 *   node test/asset-visibility.mjs
 *
 * This rule decides what a user believes they own, so the properties worth
 * pinning are the ones where being wrong either hides real money or floods the
 * list with noise:
 *
 *   1. an EMPTY wallet shows exactly the five defaults (ETH/SOL/BTC/BNB/SUI)
 *      and parks every other native in Hidden, recoverable;
 *   2. any balance promotes a native to the home list with no user action;
 *   3. an explicit hide/pin always beats the rules, in BOTH directions, and
 *      outranks the spam classifier;
 *   4. zero-balance discovered TOKENS are dropped, never parked, or the Hidden
 *      section drowns in indexer noise;
 *   5. an UNPRICED balance is never treated as dust (0 means "no price", not
 *      "worthless") — the same trap that hid a held USDC balance before.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-vis-test-"));

const file = join(out, "vis.cjs");
await build({
  entryPoints: [join(root, "src/wallet/assetVisibility.ts")],
  bundle: true,
  format: "cjs",
  outfile: file,
  logLevel: "error",
  platform: "node",
  define: { "process.env.NODE_ENV": '"test"' },
});
const { homeSection, assetKey, DEFAULT_HOME_CHAINS, DUST_USD } =
  createRequire(import.meta.url)(file);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
}
function is(name, actual, expected) {
  check(name, actual === expected, `expected ${expected}\n      actual   ${actual}`);
}

const NONE = new Set();
const native = (chainId, balanceNum = 0, usdValue = 0) =>
  ({ chainId, isNative: true, balanceNum, usdValue });
const token = (chainId, address, balanceNum, usdValue, spam) =>
  ({ chainId, isNative: false, address, balanceNum, usdValue, spam });

// ── 1. An empty wallet shows exactly five ───────────────────────────────────
const ALL_NATIVE_CHAINS = [
  "ethereum", "solana", "bitcoin", "bsc", "sui",
  "base", "polygon", "arbitrum", "optimism", "avalanche",
  "tron", "xrp", "litecoin", "linea", "scroll", "blast",
];
const shown = ALL_NATIVE_CHAINS
  .filter((c) => homeSection(native(c), NONE, NONE) === "home");
is("empty wallet shows exactly 5 assets", shown.length, 5);
check("...and they are ETH, SOL, BTC, BNB, SUI",
  shown.slice().sort().join(",") === "bitcoin,bsc,ethereum,solana,sui",
  `got ${shown.join(",")}`);
for (const c of ["base", "polygon", "arbitrum", "tron", "xrp", "litecoin"]) {
  is(`empty ${c} waits in Hidden, not dropped`, homeSection(native(c), NONE, NONE), "hidden");
}
check("DEFAULT_HOME_CHAINS is exactly the five", DEFAULT_HOME_CHAINS.size === 5);

// ── 2. A balance promotes a native with no user action ──────────────────────
is("a funded non-default native pops onto home",
  homeSection(native("polygon", 12.5, 8.4), NONE, NONE), "home");
is("a dust-value native still shows (natives are never dust)",
  homeSection(native("base", 0.000048, 0.0001), NONE, NONE), "home");
is("a default native with zero balance still shows",
  homeSection(native("ethereum", 0, 0), NONE, NONE), "home");

// ── 3. Explicit user choice wins, both directions ───────────────────────────
const hidEth = new Set([assetKey("ethereum")]);
is("a hidden default native leaves the home list",
  homeSection(native("ethereum"), hidEth, NONE), "hidden");
is("a hidden FUNDED native still only leaves the list, never vanishes",
  homeSection(native("ethereum", 3, 9000), hidEth, NONE), "hidden");
const pinPoly = new Set([assetKey("polygon")]);
is("a pinned empty native is added back to home",
  homeSection(native("polygon"), NONE, pinPoly), "home");
const spamAddr = "0xDEAD00000000000000000000000000000000BEEF";
is("spam is hidden by default",
  homeSection(token("bsc", spamAddr, 1000, 0, true), NONE, NONE), "hidden");
is("...but an explicit pin outranks the spam classifier",
  homeSection(token("bsc", spamAddr, 1000, 0, true), NONE,
    new Set([assetKey("bsc", spamAddr)])), "home");
is("hide beats pin when both are somehow set (hide is checked first)",
  homeSection(native("ethereum"), hidEth, new Set([assetKey("ethereum")])), "hidden");

// ── 4. Zero-balance tokens are dropped, not parked ──────────────────────────
const t0 = "0x1111111111111111111111111111111111111111";
is("a zero-balance discovered token is dropped",
  homeSection(token("ethereum", t0, 0, 0), NONE, NONE), "drop");
is("a zero-balance HIDDEN token is dropped too (no Hidden-section noise)",
  homeSection(token("ethereum", t0, 0, 0), new Set([assetKey("ethereum", t0)]), NONE), "drop");
is("a zero-balance spam token is dropped",
  homeSection(token("ethereum", t0, 0, 0, true), NONE, NONE), "drop");
is("a held hidden token IS parked, so it can come back",
  homeSection(token("ethereum", t0, 5, 20), new Set([assetKey("ethereum", t0)]), NONE), "hidden");

// ── 5. Unpriced is not worthless ────────────────────────────────────────────
is("a priced sub-cent balance is dust",
  homeSection(token("base", t0, 1, DUST_USD / 2), NONE, NONE), "hidden");
is("an UNPRICED balance is NOT dust — the USDC trap",
  homeSection(token("base", t0, 0.176243, 0), NONE, NONE), "home");
is("a priced balance just over the cutoff shows",
  homeSection(token("base", t0, 1, DUST_USD * 1.5), NONE, NONE), "home");

// ── Key shape: a native has no address and must still key stably ────────────
is("native key has an empty address half", assetKey("ethereum"), "ethereum:");
is("token key lowercases the address",
  assetKey("bsc", "0xAbCd"), "bsc:0xabcd");

rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
