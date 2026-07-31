/**
 * Copy-then-forget clipboard, per NUMPAY_MOBILE_PLAN_2026-07-10.md §3.2.
 *
 * The Android clipboard is shared process state: every app on the phone can
 * read it, and on older releases without the Android 12+ read notification the
 * user is not even told. Anything the wallet puts there is therefore a leak with
 * a timer on it, and the only lever the app has is to make that timer short.
 *
 * Two rules this module exists to enforce:
 *
 *  1. NOTHING is written to the clipboard without a scheduled clear. Call sites
 *     use `copyEphemeral`, never `Clipboard.setStringAsync` directly.
 *  2. A clear only ever removes THE VALUE WE WROTE. It re-reads the clipboard
 *     first and bails if the contents changed, so a wallet address expiring
 *     cannot wipe the shopping list a user copied ten seconds later.
 *
 * Honest limits, because this is defence in depth and not a guarantee:
 *  - The timer is a JS timer. If the OS kills the app first, the value stays on
 *    the clipboard until something else overwrites it.
 *  - Any app that was already watching could have read the value in the first
 *    millisecond. Clearing shrinks the window; it does not close it.
 *  - expo-clipboard exposes no `clearPrimaryClip`, so a clear writes an empty
 *    string. That empties the contents but leaves a clipboard entry behind.
 */
import * as Clipboard from "expo-clipboard";

/**
 * Addresses, BPANs, tx hashes. Long enough to switch apps and paste, short
 * enough that it is gone before the phone is put down.
 */
export const CLIPBOARD_TTL_MS = 60_000;

/**
 * Recovery phrases. Deliberately matched to the reveal screen's 30 s auto-hide
 * (REVEAL_AUTO_HIDE_MS) so the words leave the screen and the clipboard at the
 * same moment: two different lifetimes for the same secret is how one of them
 * gets forgotten.
 */
export const SECRET_CLIPBOARD_TTL_MS = 30_000;

/** Pending clear, so a second copy replaces the first timer instead of racing it. */
let pending: ReturnType<typeof setTimeout> | null = null;

/**
 * Puts `value` on the clipboard and schedules its removal.
 *
 * @returns the TTL actually applied, so callers can tell the user how long they
 *          have without hardcoding the number in copy.
 */
export async function copyEphemeral(
  value: string,
  ttlMs: number = CLIPBOARD_TTL_MS,
): Promise<number> {
  await Clipboard.setStringAsync(value);

  if (pending) clearTimeout(pending);
  pending = setTimeout(() => {
    pending = null;
    void clearIfUnchanged(value);
  }, ttlMs);

  return ttlMs;
}

/**
 * Clears the clipboard only if it still holds `value`.
 *
 * Exported for the case where something is done with a secret early and there is
 * no reason to wait out the TTL (hiding a revealed phrase, for instance).
 */
export async function clearIfUnchanged(value: string): Promise<void> {
  try {
    const current = await Clipboard.getStringAsync();
    if (current === value) await Clipboard.setStringAsync("");
  } catch {
    // A clipboard read can fail (no permission on some OEM skins, or the app is
    // backgrounded). Failing to clear is not worth surfacing to the user, and
    // there is nothing to retry against.
  }
}

/** Seconds, for interpolating a TTL into user-facing copy. */
export function ttlSeconds(ttlMs: number): number {
  return Math.round(ttlMs / 1000);
}
