/**
 * Unit tests for token REMOVAL in the ERC-20 sweep (core/autoTokens.ts):
 *
 *   node test/token-removal.mjs
 *
 * Regression cover for a real, user-reported bug (2026-07-27): after swapping
 * a whole USDC balance away on Base, the USDC row kept showing the pre-swap
 * amount. Pull-to-refresh did not clear it, and neither did restarting the app.
 *
 * Two causes, both about the difference between "found nothing" and "did not
 * look":
 *   1. every emission from the sweep carried only tokens that were FOUND, and
 *      merge() took an early return on an empty list. A chain whose last
 *      holding was swapped away therefore produced NO update at all, so the
 *      client went on painting its last-known row forever. Base had nothing
 *      else on it, which is why it never recovered, while BNB (where another
 *      token remained) corrected itself on the next sweep.
 *   2. the indexers are minutes stale by construction (the proxy edge-caches
 *      /v1/tokens for 5 minutes), and that is exactly the window right after a
 *      swap. The client's own balanceOf reads are not stale, so where the two
 *      disagree about zero, the chain has to win.
 *
 * The properties pinned here, because getting them wrong either strands a
 * ghost balance on the dashboard or deletes rows that really are held:
 *   1. a chain emptied on-chain gets a FINAL, empty update, and is cached as
 *      empty so a cold start clears it too;
 *   2. an on-chain zero overrides an indexer that still lists the token;
 *   3. a token that IS still held is never removed (the control that stops 1+2
 *      from passing by deleting everything);
 *   4. a sweep where the sources FAILED removes nothing — a network blip must
 *      not read as "you sold it";
 *   5. the last word on any chain we could enumerate is a final update.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-tokrm-test-"));
const req = createRequire(import.meta.url);
const posix = (p) => JSON.stringify(p.replace(/\\/g, "/"));

const { ethers } = req("ethers");
const MC3 = new ethers.Interface([
  "function aggregate3(tuple(address target, bool allowFailure, bytes callData)[] calls) returns (tuple(bool success, bytes returnData)[] results)",
]);

// The sweep talks to chains through `new ethers.JsonRpcProvider(...).call()`.
// Alias ethers to a stub that keeps the REAL library (absolute path, so the
// alias does not rewrite it again) and swaps only the provider, driven by a
// per-test plan on globalThis. Encoding/decoding stays real, so the test
// exercises the same decode path the wallet does.
const stub = join(out, "ethers-stub.js");
writeFileSync(stub, `
const real = require(${posix(req.resolve("ethers"))});
class TestProvider {
  constructor(url) { this.url = url; }
  async call(tx) { return globalThis.__TEST_RPC__(this.url, tx); }
}
const ethers = { ...real.ethers, JsonRpcProvider: TestProvider };
module.exports = { ...real, ethers, JsonRpcProvider: TestProvider };
`);

// ONE bundle, so the sweep's cache writes and the assertions below share a
// single core-storage instance. Bundled separately they would each get their
// own in-memory store and every cache assertion would pass vacuously.
const entry = join(out, "entry.ts");
writeFileSync(entry, [
  `export { sweepAllChainTokens, AUTOTOK_CACHE_PFX } from ${posix(join(root, "../packages/core/src/autoTokens.ts"))};`,
  `export { getItem, setItem } from ${posix(join(root, "../packages/core/src/storage.ts"))};`,
  `export { NETWORKS } from ${posix(join(root, "../packages/core/src/networks.ts"))};`,
  `export { DEFAULT_TOKENS } from ${posix(join(root, "../packages/core/src/tokens.ts"))};`,
].join("\n"));

const file = join(out, "sweep.cjs");
await build({
  entryPoints: [entry],
  bundle: true,
  format: "cjs",
  outfile: file,
  logLevel: "error",
  platform: "node",
  alias: { ethers: stub },
  define: { "process.env.NODE_ENV": '"test"' },
});

// Must be set BEFORE the bundle evaluates: core/env.ts reads it at module load,
// and networks.ts bakes the result into constants. API_BASE on = the proxy path
// the mobile app actually uses (it ships no provider keys of its own).
globalThis.__NUMPAY_ENV__ = { API_BASE: "https://proxy.test" };

const { sweepAllChainTokens, AUTOTOK_CACHE_PFX, getItem, setItem, NETWORKS, DEFAULT_TOKENS } =
  req(file);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
}

// rpcUrl -> networkId, so the provider stub knows which chain it is answering.
const chainOfRpc = new Map(
  Object.entries(NETWORKS).map(([id, n]) => [n.rpcUrl, id]),
);
const tokensOf = (networkId) => DEFAULT_TOKENS[NETWORKS[networkId]?.chainId] ?? [];

// ── Per-test plans ──────────────────────────────────────────────────────────
// rpcPlan[networkId]: { [tokenAddrLower]: rawBalanceString } — chains absent
// from the plan answer "every call failed", which is what a chain we could NOT
// read looks like. indexerPlan[networkId]: array of tokens, or null for a 502.
let rpcPlan = {};
let indexerPlan = {};

globalThis.__TEST_RPC__ = async (url, tx) => {
  const networkId = chainOfRpc.get(url);
  const [calls] = MC3.decodeFunctionData("aggregate3", tx.data);
  const plan = rpcPlan[networkId];
  const results = calls.map((c) => {
    if (!plan) return [false, "0x"]; // allowFailure: unreadable, NOT a zero
    const raw = plan[String(c.target).toLowerCase()] ?? "0";
    return [true, ethers.zeroPadValue(ethers.toBeHex(BigInt(raw)), 32)];
  });
  return MC3.encodeFunctionResult("aggregate3", [results]);
};

globalThis.fetch = async (url) => {
  const m = String(url).match(/\/v1\/tokens\/([^/]+)\//);
  const tokens = m ? indexerPlan[m[1]] : undefined;
  // Anything unplanned is an upstream failure, exactly as the worker reports
  // it (502), so unrelated chains never look like authoritative empties.
  if (!m || tokens == null) return { ok: false, status: 502, json: async () => ({}) };
  return { ok: true, status: 200, json: async () => ({ tokens }) };
};

const ADDR = (n) => `0x${String(n).repeat(40).slice(0, 40)}`;
const BASE_USDC = tokensOf("base")[0].address.toLowerCase();
const BASE_DAI  = tokensOf("base")[1].address.toLowerCase();

const usdcRow = (balance) => ({
  symbol: "USDC", name: "USD Coin", address: BASE_USDC,
  decimals: 6, balance, priceUsd: 1,
});

/** Seed the on-disk sweep cache as an EARLIER session would have left it. */
async function seedCache(address, data) {
  // ts 0 = long stale, so the freshness gate never short-circuits the sweep.
  await setItem(AUTOTOK_CACHE_PFX + address.toLowerCase(), JSON.stringify({ ts: 0, data }));
}
async function readCache(address) {
  const raw = await getItem(AUTOTOK_CACHE_PFX + address.toLowerCase());
  return raw ? JSON.parse(raw).data : null;
}

/** Run one sweep, recording every update it emitted. */
async function run(address) {
  const updates = [];
  await sweepAllChainTokens(address, (chainId, tokens, final) => {
    updates.push({ chainId, tokens, final: final === true });
  });
  return {
    updates,
    /** The list the caller is left showing for a chain. */
    last: (chainId) => [...updates].reverse().find((u) => u.chainId === chainId),
    finals: (chainId) => updates.filter((u) => u.chainId === chainId && u.final),
  };
}

// ── 1. The reported bug: the whole balance swapped away on Base ─────────────
// The previous session cached USDC, and the indexer still lists it because its
// answer is up to 5 minutes old. On chain, both Base default tokens are zero.
{
  const addr = ADDR(1);
  await seedCache(addr, { base: [usdcRow("12.5")] });
  rpcPlan = { base: { [BASE_USDC]: "0", [BASE_DAI]: "0" } };
  indexerPlan = { base: [usdcRow("12.5")] };

  const r = await run(addr);
  const last = r.last("base");
  check("a chain emptied on-chain still gets an update", !!last);
  check("...and it is marked final (authoritative)", last?.final === true);
  check("...carrying an empty list", last?.tokens.length === 0,
    JSON.stringify(last?.tokens?.map((t) => `${t.symbol} ${t.balance}`)));

  const cache = await readCache(addr);
  check("...persisted as an explicit empty, not just dropped from the cache",
    Array.isArray(cache?.base) && cache.base.length === 0, JSON.stringify(cache?.base));
}

// ── 2. Control: a token still held is never removed ─────────────────────────
// Same shape as 1, but the on-chain balance is real. Without this, "delete
// everything" would pass test 1.
{
  const addr = ADDR(2);
  await seedCache(addr, { base: [usdcRow("12.5")] });
  rpcPlan = { base: { [BASE_USDC]: "9000000", [BASE_DAI]: "0" } }; // 9 USDC
  indexerPlan = { base: [usdcRow("12.5")] };

  const r = await run(addr);
  const last = r.last("base");
  check("a held token survives the sweep", last?.tokens.length === 1,
    JSON.stringify(last?.tokens?.map((t) => t.symbol)));
  check("...with the on-chain balance, not the stale indexer one",
    last?.tokens[0]?.balance === "9.0", last?.tokens[0]?.balance);
  check("...keeping the indexer's price metadata", last?.tokens[0]?.priceUsd === 1);
}

// ── 3. Control: sources that FAILED remove nothing ─────────────────────────
// The blip case. Nothing answered for Base: the proxy 502s and every balanceOf
// in the multicall came back allowFailure. A cached holding must survive that
// untouched, or one bad network moment reads as "you sold it".
{
  const addr = ADDR(3);
  await seedCache(addr, { base: [usdcRow("12.5")] });
  rpcPlan = {};      // unreadable, not zero
  indexerPlan = {};  // 502

  const r = await run(addr);
  check("a failed sweep never claims a chain is empty",
    r.finals("base").every((u) => u.tokens.length > 0),
    JSON.stringify(r.finals("base").map((u) => u.tokens.length)));

  const cache = await readCache(addr);
  check("...and the cached holding is retained", cache?.base?.length === 1,
    JSON.stringify(cache?.base?.map((t) => t.symbol)));
  check("...with its balance intact", cache?.base?.[0]?.balance === "12.5");
}

// ── 4. An indexer's empty answer is authoritative on its own ───────────────
// Gnosis has no DEFAULT_TOKENS, so there is no RPC layer to back the indexer
// up: the 200 with an empty array is the only evidence, and the worker
// documents it as a real answer (upstream failures are 502s).
{
  const addr = ADDR(4);
  const ghost = { symbol: "GNO", name: "Gnosis", address: ADDR(9), decimals: 18, balance: "3" };
  await seedCache(addr, { gnosis: [ghost] });
  rpcPlan = {};
  indexerPlan = { gnosis: [] };

  const r = await run(addr);
  const last = r.last("gnosis");
  check("an indexer's empty answer clears the chain", last?.final === true && last?.tokens.length === 0,
    JSON.stringify(last));
  const cache = await readCache(addr);
  check("...and the cache follows", cache?.gnosis?.length === 0, JSON.stringify(cache?.gnosis));
}

// ── 5. The last word on an enumerated chain is always final ────────────────
// What the client relies on to know when a shorter list means a removal rather
// than a source that has not answered yet.
{
  const addr = ADDR(5);
  rpcPlan = { base: { [BASE_USDC]: "5000000", [BASE_DAI]: "0" } };
  indexerPlan = { base: [usdcRow("5.0")] };

  const r = await run(addr);
  const baseUpdates = r.updates.filter((u) => u.chainId === "base");
  check("a chain we enumerated emits at least one update", baseUpdates.length > 0);
  check("...and its LAST update is the authoritative one",
    baseUpdates[baseUpdates.length - 1]?.final === true);
  check("...while the streaming updates are not marked authoritative",
    baseUpdates.slice(0, -1).every((u) => !u.final));
}

rmSync(out, { recursive: true, force: true });
console.log(`\ntoken-removal: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
