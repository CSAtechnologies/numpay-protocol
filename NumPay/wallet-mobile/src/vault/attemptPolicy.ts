/**
 * Wrong-PIN policy: the lockout ladder and the optional self-destruct, as pure
 * arithmetic.
 *
 * Split out of mobileVault so it can be tested. The vault module itself pulls in
 * expo-secure-store, react-native-argon2 and @noble, none of which load under
 * node, and this is the one piece of that file where an off-by-one deletes
 * somebody's wallet. It has NO imports on purpose: keep it that way, or the
 * tests stop being able to reach it (same reason browser/rpcTypes.ts stays
 * import-free).
 *
 * Policy, from NUMPAY_MOBILE_PLAN_2026-07-10.md §3.1:
 *   5 free attempts, then 30 s / 5 min / 30 min, the last repeating forever.
 *   Optionally, at 10 cumulative failures, erase the vault. Default OFF.
 *
 * MIND THE FENCEPOST. The shipped ladder is one attempt tighter than the plan's
 * sentence reads. `FREE_ATTEMPTS = 5` is the failure count at which the ladder
 * STARTS, so failures 1 to 4 are free and the 5th already costs 30 s:
 *
 *   failure   1  2  3  4    5      6      7      8+
 *   lockout   -  -  -  -    30 s   5 min  30 min 30 min
 *
 * This is the behaviour the vault has always had; it is written down here rather
 * than corrected, because loosening a lockout is a security change and not a
 * doc fix. If the plan's reading is the intended one, the fix is
 * `over = fails - FREE_ATTEMPTS - 1` and it needs to be a deliberate decision.
 */

export interface AttemptState {
  /** Cumulative wrong PINs since the last correct one. */
  fails: number;
  /** Epoch ms until which unlocking is refused. 0 when not locked out. */
  lockUntil: number;
}

/** Failure count at which the ladder starts. See the fencepost note above. */
export const FREE_ATTEMPTS = 5;

/** The ladder. The last entry repeats for every attempt past it. */
export const BACKOFF_MS = [30_000, 300_000, 1_800_000] as const;

/**
 * Wrong PINs before an opted-in vault destroys itself.
 *
 * 10 sits well past the ladder above, so reaching it takes 35+ minutes of
 * deliberate guessing rather than a phone in a tight pocket. Default OFF stands:
 * the Keystore binding already blocks the offline attack, so this only covers a
 * stolen powered-on phone, and it buys that at the price of a self-DoS when
 * somebody forgets their own PIN.
 */
export const WIPE_AFTER_ATTEMPTS = 10;

/** A clean slate. Frozen: it is handed out as a shared reference by readAttempts. */
export const FRESH: AttemptState = Object.freeze({ fails: 0, lockUntil: 0 });

/**
 * The state after one wrong PIN, and whether that attempt tripped the wipe.
 *
 * `wipe: true` means the CALLER must destroy the vault and must not persist
 * `next`: the counter it describes is about to stop existing.
 */
export function nextFailureState(
  prev: AttemptState,
  now: number,
  wipeArmed: boolean,
): { next: AttemptState; wipe: boolean } {
  const fails = prev.fails + 1;
  // First failure past the free tier gets BACKOFF_MS[0]; everything beyond the
  // last rung stays on the last rung rather than growing without bound.
  const over = fails - FREE_ATTEMPTS;
  const lockUntil =
    over >= 0 ? now + BACKOFF_MS[Math.min(over, BACKOFF_MS.length - 1)] : 0;
  return {
    next: { fails, lockUntil },
    wipe: wipeArmed && fails >= WIPE_AFTER_ATTEMPTS,
  };
}

/** Whether a lockout window is currently open. */
export function isLockedOut(s: AttemptState, now: number): boolean {
  return s.lockUntil > now;
}

/** Attempts left before the wipe fires, or null when it is disarmed. */
export function attemptsBeforeWipe(s: AttemptState, wipeArmed: boolean): number | null {
  return wipeArmed ? Math.max(0, WIPE_AFTER_ATTEMPTS - s.fails) : null;
}
