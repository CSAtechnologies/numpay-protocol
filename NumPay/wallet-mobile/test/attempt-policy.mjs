/**
 * Unit tests for the wrong-PIN policy (src/vault/attemptPolicy.ts):
 *
 *   node test/attempt-policy.mjs
 *
 * This is the arithmetic behind a self-destruct, so the properties worth pinning
 * are the ones where being wrong either deletes a wallet early or fails to
 * throttle an attacker:
 *
 *   1. the free tier is free, and the ladder starts exactly where the shipped
 *      vault has always started it (the 5th failure, NOT the 6th: see the
 *      fencepost note in attemptPolicy.ts). Pinned deliberately, so a later
 *      "doc fix" cannot quietly hand an attacker an extra free guess;
 *   2. the ladder is 30 s / 5 min / 30 min and then STAYS at 30 min, rather
 *      than growing without bound or wrapping back to the start;
 *   3. the wipe fires on exactly the 10th failure, never the 9th;
 *   4. the wipe NEVER fires when the setting is off, at any failure count,
 *      including far past the threshold (the default-OFF guarantee);
 *   5. a correct PIN's reset is total, so yesterday's near-miss cannot combine
 *      with today's typo to erase a wallet;
 *   6. isLockedOut is exclusive at the boundary, so a lockout that expired this
 *      exact millisecond does not block the user for another tick.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-attempt-test-"));

const file = join(out, "policy.cjs");
await build({
  entryPoints: [join(root, "src/vault/attemptPolicy.ts")],
  bundle: true,
  format: "cjs",
  outfile: file,
  logLevel: "error",
  platform: "node",
});

const {
  nextFailureState, isLockedOut, attemptsBeforeWipe,
  FREE_ATTEMPTS, BACKOFF_MS, WIPE_AFTER_ATTEMPTS, FRESH,
} = createRequire(import.meta.url)(file);

let passed = 0;
let failed = 0;
const NOW = 1_800_000_000_000;

function ok(cond, name) {
  if (cond) { passed++; return; }
  failed++;
  console.error(`  FAIL  ${name}`);
}

function eq(actual, expected, name) {
  ok(actual === expected, `${name} (got ${actual}, want ${expected})`);
}

/** Replays `n` consecutive failures from a clean slate. */
function replay(n, wipeArmed) {
  let state = FRESH;
  for (let i = 0; i < n; i++) {
    const r = nextFailureState(state, NOW, wipeArmed);
    if (r.wipe) return { state: r.next, wipedAt: i + 1 };
    state = r.next;
  }
  return { state, wipedAt: null };
}

// ── 1. the free tier is free, and ends where it has always ended ─────────────
{
  let state = FRESH;
  // Failures 1..4 cost nothing.
  for (let i = 1; i < FREE_ATTEMPTS; i++) {
    const r = nextFailureState(state, NOW, false);
    eq(r.next.fails, i, `failure ${i} increments the counter`);
    eq(r.next.lockUntil, 0, `failure ${i} of the free tier opens no lockout`);
    state = r.next;
  }
  // The 5th is the first to cost time. Asserting the exact fencepost, because
  // this is where a "5 free attempts" reading of the plan would slide it.
  const fifth = nextFailureState(state, NOW, false);
  eq(fifth.next.fails, FREE_ATTEMPTS, "the 5th failure is counted");
  eq(fifth.next.lockUntil, NOW + BACKOFF_MS[0], "failure 5 starts the ladder at 30 s");
}

// ── 2. the ladder climbs, then holds ─────────────────────────────────────────
{
  const rungFor = (failureNumber) =>
    nextFailureState({ fails: failureNumber - 1, lockUntil: 0 }, NOW, false).next.lockUntil - NOW;

  const lockAt = (failureNumber) =>
    nextFailureState({ fails: failureNumber - 1, lockUntil: 0 }, NOW, false).next.lockUntil;

  eq(lockAt(4), 0, "4th failure: no window at all");
  eq(rungFor(5), 30_000, "5th failure: 30 s");
  eq(rungFor(6), 300_000, "6th failure: 5 min");
  eq(rungFor(7), 1_800_000, "7th failure: 30 min");
  // Past the last rung it must PIN to 30 min. Both a wrap to 30 s (an attacker
  // gets a cheap retry every attempt) and unbounded growth (a user locked out
  // for days) would be wrong, and an off-by-one in the clamp gives one of them.
  eq(rungFor(8), 1_800_000, "8th failure holds at 30 min");
  eq(rungFor(40), 1_800_000, "40th failure still holds at 30 min");
  ok(
    rungFor(8) === BACKOFF_MS[BACKOFF_MS.length - 1],
    "the held value is the last rung, not a coincidence",
  );
}

// ── 3. the wipe fires on exactly the Nth failure ─────────────────────────────
{
  const armed = replay(WIPE_AFTER_ATTEMPTS + 5, true);
  eq(armed.wipedAt, WIPE_AFTER_ATTEMPTS, `wipe fires on failure ${WIPE_AFTER_ATTEMPTS}`);

  const oneShort = nextFailureState(
    { fails: WIPE_AFTER_ATTEMPTS - 2, lockUntil: 0 }, NOW, true,
  );
  eq(oneShort.next.fails, WIPE_AFTER_ATTEMPTS - 1, "the attempt before last counts");
  ok(oneShort.wipe === false, "one attempt short does NOT wipe");

  const onIt = nextFailureState({ fails: WIPE_AFTER_ATTEMPTS - 1, lockUntil: 0 }, NOW, true);
  ok(onIt.wipe === true, "the threshold attempt wipes");

  // A counter already past the threshold (setting armed mid-streak) still wipes
  // rather than sailing past it on a strict equality check.
  ok(
    nextFailureState({ fails: WIPE_AFTER_ATTEMPTS + 3, lockUntil: 0 }, NOW, true).wipe === true,
    "a count already past the threshold still wipes",
  );
}

// ── 4. default OFF means never, at any count ─────────────────────────────────
{
  const disarmed = replay(WIPE_AFTER_ATTEMPTS * 4, false);
  eq(disarmed.wipedAt, null, "disarmed: no wipe after 40 failures");
  eq(disarmed.state.fails, WIPE_AFTER_ATTEMPTS * 4, "disarmed: the counter still climbs");
  eq(attemptsBeforeWipe(disarmed.state, false), null, "disarmed: no countdown to show");
}

// ── 5. a correct PIN resets everything ───────────────────────────────────────
{
  // FRESH is what the vault writes on a correct PIN, so it stands in for one.
  eq(FRESH.fails, 0, "reset clears the counter");
  eq(FRESH.lockUntil, 0, "reset clears the lockout");
  const after = nextFailureState(FRESH, NOW, true);
  eq(after.next.fails, 1, "a failure after a reset starts from 1");
  ok(after.wipe === false, "a single failure after a reset cannot wipe");
  eq(
    attemptsBeforeWipe(FRESH, true),
    WIPE_AFTER_ATTEMPTS,
    "the countdown is full again after a reset",
  );
}

// ── 6. countdown + lockout boundaries ────────────────────────────────────────
{
  eq(attemptsBeforeWipe({ fails: 3, lockUntil: 0 }, true), WIPE_AFTER_ATTEMPTS - 3, "countdown counts down");
  eq(attemptsBeforeWipe({ fails: 99, lockUntil: 0 }, true), 0, "countdown floors at 0, never negative");

  ok(isLockedOut({ fails: 6, lockUntil: NOW + 1 }, NOW) === true, "locked while the window is open");
  ok(isLockedOut({ fails: 6, lockUntil: NOW }, NOW) === false, "not locked at the exact expiry ms");
  ok(isLockedOut({ fails: 6, lockUntil: NOW - 1 }, NOW) === false, "not locked after expiry");
  ok(isLockedOut(FRESH, NOW) === false, "a fresh state is never locked");
}

// ── control: the suite can actually fail ─────────────────────────────────────
// Without this, a broken harness (a bad import, ok() never called) reports a
// clean run and the tests above prove nothing.
{
  const control = nextFailureState(FRESH, NOW, true);
  ok(control.next.fails !== 0, "CONTROL: a failure never leaves the counter at 0");
  ok(
    typeof nextFailureState === "function" && typeof isLockedOut === "function",
    "CONTROL: the module under test actually loaded",
  );
}

rmSync(out, { recursive: true, force: true });

console.log(`\nattempt-policy: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
