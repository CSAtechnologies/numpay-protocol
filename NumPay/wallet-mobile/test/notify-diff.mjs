/**
 * Unit tests for the receive watcher's diff rules (src/notify/receiveDiff.ts):
 *
 *   node test/notify-diff.mjs
 *
 * These rules decide when the phone says "you got paid" — a false positive
 * (failed RPC read recovering) is the failure mode that matters, so the
 * conservative-zero rule gets the most attention.
 */
import { build } from "esbuild";
import { fileURLToPath, pathToFileURL } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-notify-test-"));
const file = join(out, "receiveDiff.mjs");
await build({
  entryPoints: [join(root, "src/notify/receiveDiff.ts")],
  bundle: true, format: "esm", outfile: file, logLevel: "error",
});
const { computeReceiveDiff } = await import(pathToFileURL(file).href);

let pass = 0, fail = 0;
const ok = (cond, label) => { if (cond) pass++; else { fail++; console.log("FAIL " + label); } };

// First run ever: everything is baseline, nothing notifies.
{
  const r = computeReceiveDiff(null, { base: 0.5, solana: 2 });
  ok(r.increased.length === 0, "baseline run never notifies");
  ok(r.nextSnapshot.base === 0.5 && r.nextSnapshot.solana === 2, "baseline stores all readings");
}

// Growth notifies and updates the snapshot.
{
  const r = computeReceiveDiff({ base: 0.5 }, { base: 0.75 });
  ok(r.increased.length === 1 && r.increased[0] === "base", "growth notifies");
  ok(r.nextSnapshot.base === 0.75, "growth updates snapshot");
}

// A new chain appearing later is a baseline for that chain only.
{
  const r = computeReceiveDiff({ base: 0.5 }, { base: 0.9, sui: 3 });
  ok(r.increased.length === 1 && r.increased[0] === "base", "new chain is baseline, existing growth still notifies");
  ok(r.nextSnapshot.sui === 3, "new chain stored");
}

// A spend (lower but positive) is silent and accepted.
{
  const r = computeReceiveDiff({ base: 0.5 }, { base: 0.2 });
  ok(r.increased.length === 0, "spend never notifies");
  ok(r.nextSnapshot.base === 0.2, "spend accepted into snapshot");
}

// THE rule: ~0 over a positive snapshot is not trusted (failed read), so the
// old value stays and the eventual recovery is NOT a fake deposit.
{
  const r1 = computeReceiveDiff({ base: 0.5 }, { base: 0 });
  ok(r1.increased.length === 0 && r1.nextSnapshot.base === 0.5, "zero over positive keeps snapshot");
  const r2 = computeReceiveDiff(r1.nextSnapshot, { base: 0.5 });
  ok(r2.increased.length === 0, "recovery after untrusted zero does not notify");
}

// A verified-empty chain (baseline 0) that then receives DOES notify.
{
  const base = computeReceiveDiff(null, { tron: 0 });
  const r = computeReceiveDiff(base.nextSnapshot, { tron: 10 });
  ok(r.increased.length === 1 && r.increased[0] === "tron", "0 -> positive notifies");
}

// Sub-epsilon jitter never notifies.
{
  const r = computeReceiveDiff({ base: 0.5 }, { base: 0.5 + 1e-12 });
  ok(r.increased.length === 0, "float jitter below epsilon ignored");
}

// Hostile readings (NaN / negative / non-number) are ignored entirely.
{
  const r = computeReceiveDiff({ base: 0.5 }, { base: NaN, solana: -3, sui: "9" });
  ok(r.increased.length === 0, "hostile readings never notify");
  ok(r.nextSnapshot.base === 0.5 && r.nextSnapshot.solana === undefined && r.nextSnapshot.sui === undefined,
    "hostile readings never enter the snapshot");
}

// Chains missing from the readings (failed EVM RPCs) are left untouched.
{
  const r = computeReceiveDiff({ base: 0.5, ethereum: 1 }, { base: 0.5 });
  ok(r.nextSnapshot.ethereum === 1, "missing chain keeps its snapshot");
}

rmSync(out, { recursive: true, force: true });
console.log("\n" + pass + " passed, " + fail + " failed");
if (fail > 0) process.exit(1);
