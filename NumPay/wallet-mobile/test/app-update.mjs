/**
 * Unit tests for the update-notice decision (core/walletApi.ts):
 *
 *   node test/app-update.mjs
 *
 * This is the only server-driven message in the app, so the properties worth
 * pinning are mostly about what the server must NOT be able to cause:
 *
 *   1. Silence is the default. Every failure and every malformed payload
 *      resolves to "none". An outage must never be able to tell a user their
 *      wallet is out of date, and must never gate anything.
 *   2. A payload is VALIDATED, not cast. A string versionCode, a float, a
 *      negative, an unknown severity or an incoherent minSupported/latest pair
 *      is a broken answer, not an urgent one.
 *   3. "critical" is reachable only two ways: the release says so, or the
 *      installed build is below minSupported. Nothing else escalates.
 *   4. Being current, or ahead of latest (a local build), says nothing.
 *
 * The fetch half is exercised through a stubbed global fetch rather than the
 * network, because the thing under test is the PARSER: whether a hostile or
 * broken response can produce a banner.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-update-test-"));

// walletApi pulls in env (for API_BASE) and storage (for the install ID).
// API_BASE must be non-empty or apiGet short-circuits to null before it ever
// reaches the parser, which would make every assertion below pass vacuously.
writeFileSync(join(out, "env-stub.cjs"), `
module.exports = { API_BASE: "https://stub.invalid" };
`);
writeFileSync(join(out, "storage-stub.cjs"), `
let v = null;
module.exports = { getItem: async () => v, setItem: async (_k, x) => { v = x; } };
`);

const file = join(out, "walletApi.cjs");
await build({
  entryPoints: [join(root, "../packages/core/src/walletApi.ts")],
  bundle: true,
  format: "cjs",
  outfile: file,
  logLevel: "error",
  platform: "node",
  // walletApi imports these RELATIVELY ("./env", "./storage"), and esbuild's
  // `alias` only accepts package specifiers, so the redirect has to happen at
  // resolve time instead.
  plugins: [{
    name: "numpay-stubs",
    setup(b) {
      b.onResolve({ filter: /^\.\/env$/ }, () => ({ path: join(out, "env-stub.cjs") }));
      b.onResolve({ filter: /^\.\/storage$/ }, () => ({ path: join(out, "storage-stub.cjs") }));
    },
  }],
});
const { fetchAndroidAppVersion, updateSeverityFor } =
  createRequire(import.meta.url)(file);

let pass = 0, fail = 0;
function is(label, got, want) {
  if (got === want) { pass++; return; }
  fail++;
  console.error(`FAIL  ${label}\n      got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`);
}

// crypto.randomUUID exists in modern node; the install ID path needs it.
if (typeof globalThis.crypto?.randomUUID !== "function") {
  globalThis.crypto = { randomUUID: () => "00000000-0000-4000-8000-000000000000" };
}

/** Serve one payload to the next fetch. `body` undefined = a network failure. */
function stubFetch(body, { ok = true } = {}) {
  globalThis.fetch = async () => {
    if (body === undefined) throw new Error("network down");
    return { ok, json: async () => body };
  };
}

// ── 1. The parser: only a well-formed payload survives ───────────────────────
const GOOD = { android: { latest: 5, minSupported: 1, severity: "recommended" } };

stubFetch(GOOD);
is("a well-formed payload parses", (await fetchAndroidAppVersion())?.latest, 5);

stubFetch(undefined);
is("network failure -> null", await fetchAndroidAppVersion(), null);

stubFetch(GOOD, { ok: false });
is("non-2xx -> null", await fetchAndroidAppVersion(), null);

stubFetch({});
is("missing android key -> null", await fetchAndroidAppVersion(), null);

stubFetch({ android: null });
is("null android -> null", await fetchAndroidAppVersion(), null);

stubFetch({ android: { latest: "5", minSupported: 1, severity: "none" } });
is("string latest -> null", await fetchAndroidAppVersion(), null);

stubFetch({ android: { latest: 5.5, minSupported: 1, severity: "none" } });
is("float latest -> null", await fetchAndroidAppVersion(), null);

stubFetch({ android: { latest: -1, minSupported: 1, severity: "none" } });
is("negative latest -> null", await fetchAndroidAppVersion(), null);

stubFetch({ android: { latest: 5, minSupported: 0, severity: "none" } });
is("zero minSupported -> null", await fetchAndroidAppVersion(), null);

stubFetch({ android: { latest: 5, minSupported: 1, severity: "URGENT!!!" } });
is("unknown severity -> null", await fetchAndroidAppVersion(), null);

stubFetch({ android: { latest: 5, minSupported: 9, severity: "critical" } });
is("minSupported above latest is incoherent -> null", await fetchAndroidAppVersion(), null);

// The endpoint sends no URL and no text. If a compromised worker adds them,
// they must be ignored rather than surfacing anywhere.
stubFetch({
  android: {
    latest: 6, minSupported: 1, severity: "critical",
    url: "https://evil.example/numpay.apk",
    title: "Your funds are at risk",
  },
});
const withExtras = await fetchAndroidAppVersion();
is("extra url field is not carried through", withExtras.url, undefined);
is("extra title field is not carried through", withExtras.title, undefined);
is("the legitimate fields still parse", withExtras.latest, 6);

// ── 2. The decision ──────────────────────────────────────────────────────────
const rec = { latest: 5, minSupported: 1, severity: "recommended" };
const crit = { latest: 5, minSupported: 1, severity: "critical" };
const quiet = { latest: 5, minSupported: 1, severity: "none" };

is("no info -> none", updateSeverityFor(null, 4), "none");
is("unknown installed -> none", updateSeverityFor(rec, null), "none");
is("non-integer installed -> none", updateSeverityFor(rec, 4.2), "none");
is("current build -> none", updateSeverityFor(rec, 5), "none");
is("ahead of latest (local build) -> none", updateSeverityFor(rec, 99), "none");
is("behind, release recommended -> recommended", updateSeverityFor(rec, 4), "recommended");
is("behind, release critical -> critical", updateSeverityFor(crit, 4), "critical");
is("behind, release says none -> none", updateSeverityFor(quiet, 4), "none");

// The floor outranks the release's own flag, in both directions.
const floored = { latest: 9, minSupported: 5, severity: "recommended" };
is("below minSupported escalates to critical", updateSeverityFor(floored, 4), "critical");
is("at minSupported does not escalate", updateSeverityFor(floored, 5), "recommended");
is("above minSupported does not escalate", updateSeverityFor(floored, 6), "recommended");

const flooredQuiet = { latest: 9, minSupported: 5, severity: "none" };
is("below minSupported escalates even from none",
  updateSeverityFor(flooredQuiet, 4), "critical");

// ── 3. CONTROL: prove the assertions above can actually fail ─────────────────
// Without this, a helper that always returned "none" would make most of
// section 2 pass while the feature did nothing at all.
{
  const got = updateSeverityFor(crit, 1);
  if (got === "critical") pass++;
  else { fail++; console.error(`FAIL  control: a genuinely stale build must escalate, got ${got}`); }
}

rmSync(out, { recursive: true, force: true });
console.log(`\napp-update: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
