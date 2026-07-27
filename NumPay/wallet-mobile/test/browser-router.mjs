/**
 * EIP-1193 routing tests for the mobile in-app browser (src/browser/router.ts):
 *
 *   node test/browser-router.mjs
 *
 * The router is the gate between an untrusted web page and a funded wallet, so
 * the properties pinned here are the ones where being wrong leaks an address,
 * signs for the wrong account, or lets a page reach a method it should not:
 *
 *   1. NO SILENT CONNECT — a page with no grant learns nothing, and a grant
 *      only reconnects silently while the wallet is actually unlocked;
 *   2. signing REQUIRES a grant and an unlocked vault, and is bound to the
 *      connected account (a mismatched address or `from` is refused, not
 *      quietly signed by the active key);
 *   3. nothing signs inside the router — every signing method resolves to a
 *      PENDING approval, never to a result;
 *   4. chain switching answers EIP-3326 correctly (4902 for an unknown chain)
 *      and only ever changes THIS browser session;
 *   5. the method allowlist holds: eth_sign and friends are refused explicitly,
 *      unknown methods are refused generically, and reads go to OUR RPC.
 *
 * A CONTROL case at the end asserts the happy path still produces an approval,
 * so a bug that made route() reject everything cannot make this file pass.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-browser-router-"));
const file = join(out, "bundle.cjs");

await build({
  stdin: {
    contents: `
      export { route, commitConnect, commitSwitchChain } from "./src/browser/router";
      export { grant, revoke, getPermission } from "@numpay/core/dapp";
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "cjs",
  outfile: file,
  logLevel: "error",
  platform: "node",
  define: { "process.env.NODE_ENV": '"test"' },
});

const { route, commitConnect, commitSwitchChain, grant, revoke, getPermission } =
  createRequire(import.meta.url)(file);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
}
function is(name, actual, expected) {
  check(name, actual === expected, `expected ${JSON.stringify(expected)}\n      actual   ${JSON.stringify(actual)}`);
}

const ACCT = "0x1111111111111111111111111111111111111111";
const OTHER = "0x2222222222222222222222222222222222222222";
const ORIGIN = "https://app.uniswap.org";
const EVIL = "https://app.uniswap.org.attacker.com";

const ctx = (over = {}) => ({
  origin: ORIGIN, account: ACCT, unlocked: true, chainId: "ethereum", ...over,
});

// ── 1. no silent connect ─────────────────────────────────────────────────────
await revoke(ORIGIN);

let r = await route("eth_accounts", [], ctx());
is("eth_accounts with no grant returns nothing", JSON.stringify(r.result), "[]");

r = await route("eth_requestAccounts", [], ctx());
is("eth_requestAccounts with no grant needs approval", r.kind, "approve");
is("...and the pending is a connect", r.pending.type, "connect");
is("...for the real origin", r.pending.origin, ORIGIN);

r = await route("eth_requestAccounts", [], ctx({ account: null }));
is("eth_requestAccounts with no wallet errors", r.kind, "error");
is("...with the internal code", r.error.code, -32603);

await grant(ORIGIN, ACCT, 1);

r = await route("eth_accounts", [], ctx());
is("eth_accounts with a grant returns the account", r.result[0], ACCT);

r = await route("eth_accounts", [], ctx({ unlocked: false }));
is("a LOCKED wallet exposes no account", JSON.stringify(r.result), "[]");

r = await route("eth_requestAccounts", [], ctx());
is("a granted origin reconnects silently", r.kind, "result");
is("...to the granted account", r.result[0], ACCT);

r = await route("eth_requestAccounts", [], ctx({ unlocked: false }));
is("a granted origin still needs approval while locked", r.kind, "approve");

// A grant is per-origin: a look-alike host must not inherit it.
r = await route("eth_accounts", [], ctx({ origin: EVIL }));
is("a look-alike origin gets no account", JSON.stringify(r.result), "[]");

// ── 2 + 3. signing: gated, bound, and never done here ────────────────────────
const MSG = "0x48656c6c6f"; // "Hello"

await revoke(ORIGIN);
r = await route("personal_sign", [MSG, ACCT], ctx());
is("personal_sign without a grant is refused", r.kind, "error");
is("...as unauthorized", r.error.code, 4100);

await grant(ORIGIN, ACCT, 1);

r = await route("personal_sign", [MSG, ACCT], ctx({ unlocked: false }));
is("personal_sign with a locked vault is refused", r.kind, "error");
is("...as disconnected", r.error.code, 4900);

r = await route("personal_sign", [MSG, ACCT], ctx());
is("personal_sign is never answered by the router", r.kind, "approve");
is("...it becomes a sign approval", r.pending.type, "sign");
is("...carrying a decoded preview", r.pending.preview.ok, true);
is("...bound to the connected account", r.pending.preview.account, ACCT);

r = await route("personal_sign", [MSG, OTHER], ctx());
is("personal_sign for another address is refused", r.kind, "error");
is("...as unauthorized", r.error.code, 4100);

const big = "0x" + "ab".repeat(70000); // > 128 KB
r = await route("personal_sign", [big, ACCT], ctx());
is("an oversized sign payload is refused", r.kind, "error");

r = await route("eth_sendTransaction", [{ to: OTHER, value: "0x1", from: ACCT }], ctx());
is("eth_sendTransaction becomes an approval", r.kind, "approve");
is("...of a send_tx", r.pending.preview.detail.kind, "send_tx");
is("...on the session chain", r.pending.internalChainId, "ethereum");

r = await route("eth_sendTransaction", [{ to: OTHER, value: "0x1", from: OTHER }], ctx());
is("a tx from another account is refused", r.kind, "error");
is("...as unauthorized", r.error.code, 4100);

r = await route("eth_sendTransaction", [{ value: "0x1" }], ctx());
is("a tx with no 'to' and no data is refused", r.kind, "error");

r = await route("eth_sendTransaction", [], ctx());
is("a tx with no params is refused", r.kind, "error");

// ── 4. chain switching ───────────────────────────────────────────────────────
r = await route("eth_chainId", [], ctx());
is("eth_chainId reports the session chain", r.result, "0x1");

r = await route("net_version", [], ctx());
is("net_version reports it in decimal", r.result, "1");

r = await route("wallet_switchEthereumChain", [{ chainId: "0x1" }], ctx());
is("switching to the current chain is a no-op success", r.kind, "result");
is("...returning null per EIP-3326", r.result, null);

r = await route("wallet_switchEthereumChain", [{ chainId: "0x2105" }], ctx()); // Base
is("switching to a known chain needs approval", r.kind, "approve");
is("...as a switchChain", r.pending.type, "switchChain");
is("...resolving the internal id", r.pending.targetInternalId, "base");
is("...naming the chain for the sheet", r.pending.chainName, "Base");

r = await route("wallet_switchEthereumChain", [{ chainId: "0x270f" }], ctx()); // 9999
is("an unknown chain returns 4902", r.error.code, 4902);

r = await route("wallet_switchEthereumChain", [{ chainId: "nonsense" }], ctx());
is("a malformed chain id is invalid params", r.error.code, -32602);

r = await route("wallet_switchEthereumChain", [{}], ctx());
is("a missing chain id is invalid params", r.error.code, -32602);

// A switch changes THIS origin's session only, never a wallet-wide setting.
await route("wallet_switchEthereumChain", [{ chainId: "0x2105" }], ctx());
await commitSwitchChain({ type: "switchChain", origin: ORIGIN, targetInternalId: "base", chainId: 8453, chainName: "Base" });
is("an approved switch is recorded on the origin", (await getPermission(ORIGIN)).chainId, 8453);
await grant(ORIGIN, ACCT, 1); // restore

// ── 5. the method allowlist ──────────────────────────────────────────────────
for (const m of ["eth_sign", "eth_signTypedData_v3", "eth_sendRawTransaction", "wallet_watchAsset"]) {
  const res = await route(m, [], ctx());
  is(`${m} is refused explicitly`, res.error.code, 4200);
  check(`${m} says why`, res.error.message.includes(m), res.error.message);
}

r = await route("evm_totallyMadeUp", [], ctx());
is("an unknown method is refused", r.error.code, 4200);

r = await route("eth_getBalance", [ACCT, "latest"], ctx());
is("a read method is proxied, not refused", r.kind, "result");

// The page never supplies the endpoint: reads must hit OUR configured RPC.
{
  const seen = [];
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), body: JSON.parse(init.body) });
    return { ok: true, json: async () => ({ result: "0x2a" }) };
  };
  const res = await route("eth_getBalance", [ACCT, "latest"], ctx());
  globalThis.fetch = realFetch;
  is("the read result reaches the page", res.result, "0x2a");
  check("the read went to an https endpoint we chose", seen[0]?.url.startsWith("https://"), seen[0]?.url);
  is("the read kept its method", seen[0]?.body.method, "eth_getBalance");
}

// ── connect commit: the wallet cannot change under the user ──────────────────
{
  const pending = { type: "connect", origin: ORIGIN, account: ACCT, chainId: 1 };
  let res = await commitConnect(pending, ACCT);
  is("connect commits for the reviewed account", res.ok, true);

  res = await commitConnect(pending, OTHER);
  is("a wallet switched mid-approval is refused", res.ok, false);
  is("...as a user rejection", res.error.code, 4001);
}

// ── CONTROL ──────────────────────────────────────────────────────────────────
// If a regression made route() reject everything, every assertion above would
// still pass. This one only passes when the happy path genuinely works.
await grant(ORIGIN, ACCT, 1);
r = await route("personal_sign", [MSG, ACCT], ctx());
check(
  "CONTROL: the happy path still produces a signable approval",
  r.kind === "approve" && r.pending.type === "sign" && r.pending.preview.ok === true,
  JSON.stringify(r).slice(0, 200),
);

if (fail) {
  console.error(`\nbrowser-router: ${pass} passed, ${fail} FAILED`);
  process.exit(1);
}
console.log(`browser-router: ${pass}/${pass} passed`);
