/**
 * Origin-trust and page-bridge tests for the in-app browser:
 *
 *   node test/browser-origin.mjs
 *
 * The in-app browser is the biggest attack surface in the wallet, and almost
 * every way it can go wrong routes through one of two questions: "which site is
 * this really?" and "can the page make me execute something?". So the
 * properties pinned here are:
 *
 *   1. https ONLY — http, file:, javascript: and app schemes never yield an
 *      origin, so a page on any of them can never reach the router at all;
 *   2. a look-alike host is a DIFFERENT origin (no prefix/suffix matching, no
 *      accidental subdomain trust);
 *   3. a malformed or hostile bridge payload is rejected on shape, before the
 *      router sees it;
 *   4. an outbound payload cannot break out of its JS string literal and
 *      execute in the page — the injection path is the one place where a
 *      quoting bug is remote code execution.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
import vm from "node:vm";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-browser-origin-"));
const file = join(out, "bundle.cjs");

await build({
  stdin: {
    contents: `
      export { originOf, displayHost } from "./src/browser/session";
      export { parseBridgeRequest, deliverJs, BRIDGE_SHIM_JS } from "./src/browser/bridgeShim";
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

const { originOf, displayHost, parseBridgeRequest, deliverJs, BRIDGE_SHIM_JS } =
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

// ── 1. https only ────────────────────────────────────────────────────────────
is("https URL yields its origin", originOf("https://app.uniswap.org/swap?x=1"), "https://app.uniswap.org");
is("https with a port keeps the port", originOf("https://localhost:8443/x"), "https://localhost:8443");
is("http is refused", originOf("http://app.uniswap.org/"), null);
is("file: is refused", originOf("file:///android_asset/index.html"), null);
is("javascript: is refused", originOf("javascript:alert(1)"), null);
is("app scheme is refused", originOf("numpay://send"), null);
is("data: is refused", originOf("data:text/html,<h1>hi</h1>"), null);
is("about:blank is refused", originOf("about:blank"), null);
is("garbage is refused", originOf("not a url"), null);
is("empty is refused", originOf(""), null);
is("undefined is refused", originOf(undefined), null);
is("null is refused", originOf(null), null);

// ── 2. look-alikes are distinct origins ──────────────────────────────────────
check(
  "a subdomain is a different origin from its parent",
  originOf("https://evil.uniswap.org.attacker.com/") !== originOf("https://uniswap.org/"),
);
check(
  "http and https of the same host are not interchangeable",
  originOf("http://uniswap.org/") !== originOf("https://uniswap.org/"),
);
is("port changes the origin", originOf("https://a.com:8443/"), "https://a.com:8443");
check(
  "default port is not confused with an explicit odd port",
  originOf("https://a.com/") !== originOf("https://a.com:8443/"),
);
is("display drops www.", displayHost("https://www.uniswap.org"), "uniswap.org");
is("display keeps a real subdomain", displayHost("https://app.uniswap.org"), "app.uniswap.org");

// ── 3. bridge payloads are shape-checked ─────────────────────────────────────
const good = JSON.stringify({
  kind: "request", id: "1", channel: "c", method: "eth_chainId",
  params: [], pageOrigin: "https://a.com",
});
check("a well-formed request parses", parseBridgeRequest(good) !== null);
is("parsed method survives", parseBridgeRequest(good).method, "eth_chainId");

is("non-JSON is rejected", parseBridgeRequest("}{"), null);
is("a JSON string is rejected", parseBridgeRequest('"hello"'), null);
is("null is rejected", parseBridgeRequest("null"), null);
is("an array is rejected", parseBridgeRequest("[1,2]"), null);
is("wrong kind is rejected", parseBridgeRequest(JSON.stringify({ kind: "event", id: "1", channel: "c", method: "m", pageOrigin: "https://a.com" })), null);
is("missing id is rejected", parseBridgeRequest(JSON.stringify({ kind: "request", channel: "c", method: "m", pageOrigin: "https://a.com" })), null);
is("numeric id is rejected", parseBridgeRequest(JSON.stringify({ kind: "request", id: 1, channel: "c", method: "m", pageOrigin: "https://a.com" })), null);
is("missing method is rejected", parseBridgeRequest(JSON.stringify({ kind: "request", id: "1", channel: "c", pageOrigin: "https://a.com" })), null);
is("missing pageOrigin is rejected", parseBridgeRequest(JSON.stringify({ kind: "request", id: "1", channel: "c", method: "m" })), null);

check(
  "non-array params are normalised to []",
  Array.isArray(parseBridgeRequest(JSON.stringify({
    kind: "request", id: "1", channel: "c", method: "m",
    params: { evil: true }, pageOrigin: "https://a.com",
  })).params),
);

// ── 4. outbound injection cannot break out of its string literal ─────────────
// If this ever regresses, a dApp-controlled value becomes code running in the
// page with the wallet bridge already installed. String-matching the generated
// source proves nothing here (the hostile bytes SHOULD appear, safely, as data)
// so actually RUN it against a fake window and assert on the effects.
function runDeliver(msg) {
  const received = [];
  const sandbox = {
    window: {
      __numpayDeliver: (raw) => received.push(raw),
    },
    pwned: false,
  };
  vm.createContext(sandbox);
  vm.runInContext(deliverJs(msg), sandbox, { timeout: 1000 });
  return { received, sandbox };
}

const hostilePayloads = [
  { name: "quote-and-paren breakout", result: `'); pwned = true; ('` },
  { name: "double-quote breakout", result: `"); pwned = true; ("` },
  { name: "newline statement split", result: "a\n; pwned = true;" },
  { name: "backslash escape", result: 'a\\"); pwned = true; ("' },
  { name: "script tag", result: '"</script><script>pwned = true;</script>' },
  { name: "template literal", result: "${pwned = true}" },
  { name: "unicode line separator", result: "a pwned = true;" },
];

for (const p of hostilePayloads) {
  const msg = { kind: "response", channel: "c", id: "1", result: p.result };
  let ran;
  try {
    ran = runDeliver(msg);
  } catch (e) {
    check(`${p.name}: generated JS is valid`, false, String(e.message));
    continue;
  }
  check(`${p.name}: nothing executed`, ran.sandbox.pwned === false);
  check(
    `${p.name}: payload arrives intact as data`,
    ran.received.length === 1 && JSON.parse(ran.received[0]).result === p.result,
    `received: ${ran.received[0]}`,
  );
}

check(
  "injection ends with true; (react-native-webview requirement)",
  deliverJs({ kind: "event", name: "accountsChanged", data: [] }).trim().endsWith("true;"),
);

// A page that has not been injected yet must not throw on delivery: the guard
// is what stops an early event from breaking the bridge for the whole session.
const bare = { window: {} };
vm.createContext(bare);
vm.runInContext(deliverJs({ kind: "event", name: "chainChanged", data: "0x1" }), bare);
check("delivery to an uninjected page is a silent no-op", bare.window.__numpayDeliver === undefined);

// ── the shim itself ──────────────────────────────────────────────────────────
check("shim is idempotent", BRIDGE_SHIM_JS.includes("if (window.__numpayInjected) return;"));
check("shim stamps the page origin", BRIDGE_SHIM_JS.includes("window.location.origin"));
check("shim exposes the delivery hook", BRIDGE_SHIM_JS.includes("window.__numpayDeliver"));

if (fail) {
  console.error(`\nbrowser-origin: ${pass} passed, ${fail} FAILED`);
  process.exit(1);
}
console.log(`browser-origin: ${pass}/${pass} passed`);
