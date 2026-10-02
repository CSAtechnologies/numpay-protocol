/**
 * Unit tests for the dashboard balance snapshot (src/wallet/balanceCache.ts):
 *
 *   node test/balance-cache.mjs
 *
 * The snapshot exists to make a cold open paint instantly, and it carries the
 * wallet's PUBLIC receive addresses so the balance sweep can start without
 * waiting on key derivation. That makes its rejection rules safety-critical
 * rather than cosmetic: a snapshot wrongly accepted for another wallet would
 * put someone else's address on the Receive screen.
 *
 * Pinned here:
 *   1. a snapshot round-trips for the wallet that wrote it;
 *   2. it is NEVER returned for a different wallet id;
 *   3. a version bump or a truncated/garbage record is rejected, not guessed at;
 *   4. clearing really clears;
 *   5. two wallets keep independent snapshots.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-cache-test-"));

// ONE bundle re-exporting both, so the planted raw records land in the SAME
// core-storage instance balanceCache reads from. Bundling them separately gives
// each its own in-memory store, and every "rejected" assertion below would then
// pass for the wrong reason — the record simply would not be there.
const entry = join(out, "entry.ts");
writeFileSync(entry, [
  `export * from ${JSON.stringify(join(root, "src/wallet/balanceCache.ts").replace(/\\/g, "/"))};`,
  `export { setItem as rawSet } from ${JSON.stringify(join(root, "../packages/core/src/storage.ts").replace(/\\/g, "/"))};`,
].join("\n"));

const file = join(out, "cache.cjs");
await build({
  entryPoints: [entry],
  bundle: true,
  format: "cjs",
  outfile: file,
  logLevel: "error",
  platform: "node",
  define: { "process.env.NODE_ENV": '"test"' },
});
const req = createRequire(import.meta.url);
const {
  loadBalanceSnapshot, saveBalanceSnapshot, clearBalanceSnapshot, walletCacheId,
  loadWalletPortfolioSummary, saveWalletPortfolioSummary, rawSet,
} = req(file);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
}

const ADDRS = {
  bitcoin: "bc1qexample", solana: "So1anaExample", sui: "0xsui",
  tron: "TExample", xrp: "rExample", litecoin: "ltc1example",
};
const NATIVES = [
  { key: "native:ethereum", chainId: "ethereum", chainName: "Ethereum", symbol: "ETH",
    name: "Ethereum", isNative: true, balanceNum: 1.5, usdValue: 4500 },
];
const payload = (evm = "0xAAA") => ({
  evmAddress: evm, addrs: ADDRS, natives: NATIVES,
  tokensByChain: { ethereum: [] }, customBal: {}, rates: { ethereum: { usd: 3000 } },
});

// ── 1. Round-trip ───────────────────────────────────────────────────────────
await saveBalanceSnapshot("w1", payload());
const got = await loadBalanceSnapshot("w1");
check("a snapshot round-trips", !!got);
check("...with the evm address intact", got?.evmAddress === "0xAAA", got?.evmAddress);
check("...with the non-EVM addresses intact", got?.addrs?.solana === "So1anaExample");
check("...with the balances intact", got?.natives?.[0]?.balanceNum === 1.5);
check("...and a savedAt stamp", typeof got?.savedAt === "number" && got.savedAt > 0);

// ── 2. Never returned for another wallet ────────────────────────────────────
check("a different wallet id gets NOTHING", (await loadBalanceSnapshot("w2")) === null);
check("an absent wallet id falls back to its own slot",
  (await loadBalanceSnapshot(null)) === null);
check("walletCacheId maps null/undefined onto one stable slot",
  walletCacheId(null) === walletCacheId(undefined) && walletCacheId(null) === "default");
check("walletCacheId stringifies a numeric id", walletCacheId(7) === "7");

// ── 3. Two wallets stay independent ─────────────────────────────────────────
await saveBalanceSnapshot("w2", payload("0xBBB"));
check("wallet 2 reads back its OWN address",
  (await loadBalanceSnapshot("w2"))?.evmAddress === "0xBBB");
check("wallet 1 is untouched by wallet 2's write",
  (await loadBalanceSnapshot("w1"))?.evmAddress === "0xAAA");

// ── 3b. Wallet-switcher totals stay scoped without switching wallets ───────
await saveWalletPortfolioSummary("w1", 4512.34);
check("wallet 1 portfolio summary round-trips",
  (await loadWalletPortfolioSummary("w1")) === 4512.34);
check("wallet 2 cannot read wallet 1's portfolio summary",
  (await loadWalletPortfolioSummary("w2")) !== 4512.34);
check("older snapshots provide a first-open summary fallback",
  (await loadWalletPortfolioSummary("w2")) === 4500);
await saveWalletPortfolioSummary("w2", Number.NaN);
check("invalid portfolio summaries are ignored",
  (await loadWalletPortfolioSummary("w2")) === 4500);

// ── 4. Corrupt / stale records are rejected, never half-used ────────────────
// CONTROL FIRST. Every rejection below asserts that load() returns null, which
// is also what it returns when the record was never written — so without this
// one check proving a hand-planted record IS readable, the whole section could
// pass with the gates deleted.
await rawSet("numpay_balance_cache::w0", JSON.stringify({
  v: 1, walletId: "w0", evmAddress: "0xF00", addrs: ADDRS,
  natives: [], tokensByChain: {}, customBal: {}, rates: null, savedAt: 1,
}));
check("CONTROL: a hand-planted VALID record is readable, so the store is shared",
  (await loadBalanceSnapshot("w0"))?.evmAddress === "0xF00");

await rawSet("numpay_balance_cache::w3", "{not json");
check("garbage is rejected", (await loadBalanceSnapshot("w3")) === null);

await rawSet("numpay_balance_cache::w4", JSON.stringify({
  v: 999, walletId: "w4", evmAddress: "0xCCC", addrs: ADDRS,
  natives: [], tokensByChain: {}, customBal: {}, rates: null, savedAt: 1,
}));
check("a future/unknown version is rejected, not migrated",
  (await loadBalanceSnapshot("w4")) === null);

// The dangerous one: a record whose stored walletId disagrees with its slot.
await rawSet("numpay_balance_cache::w5", JSON.stringify({
  v: 1, walletId: "SOMEONE_ELSE", evmAddress: "0xDDD", addrs: ADDRS,
  natives: [], tokensByChain: {}, customBal: {}, rates: null, savedAt: 1,
}));
check("a record claiming another wallet is rejected",
  (await loadBalanceSnapshot("w5")) === null);

await rawSet("numpay_balance_cache::w6", JSON.stringify({
  v: 1, walletId: "w6", evmAddress: "", addrs: ADDRS,
  natives: [], tokensByChain: {}, customBal: {}, rates: null, savedAt: 1,
}));
check("a record with no evm address is rejected", (await loadBalanceSnapshot("w6")) === null);

await rawSet("numpay_balance_cache::w7", JSON.stringify({
  v: 1, walletId: "w7", evmAddress: "0xEEE", addrs: { bitcoin: "x" },
  natives: [], tokensByChain: {}, customBal: {}, rates: null, savedAt: 1,
}));
check("a record with half the addresses is rejected",
  (await loadBalanceSnapshot("w7")) === null);

// ── 5. Clearing ─────────────────────────────────────────────────────────────
await clearBalanceSnapshot("w1");
check("cleared wallet 1 reads back null", (await loadBalanceSnapshot("w1")) === null);
check("clearing a wallet also clears its switcher summary",
  (await loadWalletPortfolioSummary("w1")) === null);
check("...and wallet 2 survived the clear",
  (await loadBalanceSnapshot("w2"))?.evmAddress === "0xBBB");

rmSync(out, { recursive: true, force: true });
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
