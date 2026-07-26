/**
 * Unit tests for token USD pricing (core/currency.ts):
 *
 *   node test/token-pricing.mjs
 *
 * Regression cover for a real, user-reported bug: a held 0.176243 USDC balance
 * on Base rendered "$0.00" and was silently excluded from the portfolio total.
 *
 * Cause: getUsdPrice() is backed by a NATIVE-symbol table (ETH/BNB/SOL/…), so
 * every ERC-20 symbol fell through it to 0. The ERC-20 table that would have
 * priced USDC existed only as a private constant inside the extension's
 * Dashboard.tsx, so mobile had no such fallback at all.
 *
 * The properties worth pinning, because getting them wrong moves money figures:
 *   1. a known stablecoin/wrapped token resolves to a real price;
 *   2. an UNKNOWN token stays at 0 — 0 means "no price", never "worthless",
 *      and callers must not let it fall into the dust filter;
 *   3. natives keep working through the same entry point;
 *   4. prices come back in USD, not display currency (the double-convert trap).
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-price-test-"));

const file = join(out, "currency.cjs");
await build({
  entryPoints: [join(root, "../packages/core/src/currency.ts")],
  bundle: true,
  format: "cjs",
  outfile: file,
  logLevel: "error",
  platform: "node",
  define: { "process.env.NODE_ENV": '"test"' },
});
const {
  getUsdPrice, getErc20UsdPrice, getAnyUsdPrice, usdToDisplayCurrency,
} = createRequire(import.meta.url)(file);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
}
function near(name, actual, expected) {
  check(name, Math.abs(actual - expected) < 1e-9,
    `expected ${expected}\n      actual   ${actual}`);
}

// A realistic rates cache: CoinGecko ids at the top level, currencies beneath.
const rates = {
  tether:      { usd: 1, ngn: 1600, eur: 0.92 },
  ethereum:    { usd: 3000, ngn: 4_800_000, eur: 2760 },
  bitcoin:     { usd: 95000 },
  binancecoin: { usd: 571.8 },
  solana:      { usd: 180 },
};

// ── 1. The reported bug ─────────────────────────────────────────────────────
near("getUsdPrice('USDC') is 0 — this WAS the bug", getUsdPrice("USDC", rates), 0);
near("getErc20UsdPrice('USDC') prices it", getErc20UsdPrice("USDC", rates), 1);
near("getAnyUsdPrice('USDC') prices it", getAnyUsdPrice("USDC", rates), 1);

const BAL = 0.176243; // the exact balance from the report
near("0.176243 USDC is now worth ~$0.176", BAL * getAnyUsdPrice("USDC", rates), 0.176243);
near("...and was worth $0 before", BAL * getUsdPrice("USDC", rates), 0);
check("the row is above the $0.01 dust cutoff, so it stays visible",
  BAL * getAnyUsdPrice("USDC", rates) > 0.01);

// ── 2. Symbol coverage ──────────────────────────────────────────────────────
near("USDT", getAnyUsdPrice("USDT", rates), 1);
near("DAI", getAnyUsdPrice("DAI", rates), 1);
near("BUSD", getAnyUsdPrice("BUSD", rates), 1);
near("TUSD", getAnyUsdPrice("TUSD", rates), 1);
near("cUSD is matched case-insensitively", getAnyUsdPrice("cUSD", rates), 1);
near("WETH rides ethereum", getAnyUsdPrice("WETH", rates), 3000);
near("WBTC rides bitcoin", getAnyUsdPrice("WBTC", rates), 95000);
near("BTCB rides bitcoin", getAnyUsdPrice("BTCB", rates), 95000);
near("WBNB rides binancecoin", getAnyUsdPrice("WBNB", rates), 571.8);
near("lowercase input still resolves", getAnyUsdPrice("weth", rates), 3000);

// ── 3. Natives still work through the same door ─────────────────────────────
near("native ETH", getAnyUsdPrice("ETH", rates), 3000);
near("native BNB", getAnyUsdPrice("BNB", rates), 571.8);
near("native SOL", getAnyUsdPrice("SOL", rates), 180);
near("native BTC", getAnyUsdPrice("BTC", rates), 95000);

// ── 4. Unknown means UNKNOWN, not worthless ─────────────────────────────────
// A fresh memecoin the rates cache has never heard of must come back 0 so the
// caller shows the balance rather than filtering it away as dust.
near("unknown symbol is 0", getAnyUsdPrice("SOMEMEME", rates), 0);
near("empty symbol is 0", getAnyUsdPrice("", rates), 0);
check("a known symbol MISSING from the cache is 0, not another coin's price",
  getAnyUsdPrice("WAVAX", rates) === 0);

// ── 5. USD, not display currency (the double-convert trap) ──────────────────
// getAnyUsdPrice must never pre-convert: callers run formatFiat once at render,
// so a converted price here would be applied twice.
near("price is USD even when a foreign rate exists", getAnyUsdPrice("USDC", rates), 1);
near("conversion is the CALLER's single step",
  usdToDisplayCurrency(BAL * getAnyUsdPrice("USDC", rates), "ngn", rates),
  0.176243 * 1600);

rmSync(out, { recursive: true, force: true });

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
