// Pure balance-diff rules for the receive watcher (push scope doc, Option A).
// No RN imports so the rules are unit-testable in node
// (wallet-mobile/test/notify-diff.mjs). The runner feeds it native-balance
// readings; this decides what counts as "you received funds" and what the
// next stored snapshot is.
//
// The conservative rule that matters: a reading of ~0 where the snapshot was
// positive is NOT trusted. At this layer a failed RPC read and a genuinely
// emptied account are indistinguishable (non-EVM fetchers surface failures as
// 0 when no previous rows are passed), and accepting the 0 would make the
// eventual recovery look like a deposit — a FALSE "you got paid" is worse
// than a missed one. The cost: after a real full spend, a later top-up smaller
// than the old balance goes unnotified (the app's next open still shows it).

export const RECEIVE_EPS = 1e-9;

export interface ReceiveDiff {
  /** Chain ids whose balance grew vs the snapshot — worth a notification. */
  increased: string[];
  /** What to store for next time. */
  nextSnapshot: Record<string, number>;
}

/**
 * Compare fresh readings against the stored snapshot.
 * - First sighting of a chain (or no snapshot at all) is a BASELINE: stored,
 *   never notified — otherwise the first run after install would "notify"
 *   every existing balance.
 * - Growth beyond RECEIVE_EPS notifies and updates the snapshot.
 * - A positive-but-lower reading is a spend: accepted silently.
 * - A ~0 reading over a positive snapshot is ignored (see module comment).
 * - Non-finite / negative readings are hostile or broken: ignored.
 */
export function computeReceiveDiff(
  prev: Record<string, number> | null,
  readings: Record<string, number>,
): ReceiveDiff {
  const base = prev ?? {};
  const nextSnapshot: Record<string, number> = { ...base };
  const increased: string[] = [];

  for (const [chain, val] of Object.entries(readings)) {
    if (typeof val !== "number" || !Number.isFinite(val) || val < 0) continue;
    const before = base[chain];
    if (before === undefined) {
      nextSnapshot[chain] = val; // baseline
      continue;
    }
    if (val > before + RECEIVE_EPS) {
      increased.push(chain);
      nextSnapshot[chain] = val;
      continue;
    }
    if (val > RECEIVE_EPS) {
      nextSnapshot[chain] = val; // spend or unchanged
    }
    // else: ~0 over a positive snapshot — keep the old value.
  }

  return { increased, nextSnapshot };
}
