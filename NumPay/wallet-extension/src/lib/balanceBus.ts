// Balance freshness bus.
//
// After a send or swap the on-chain balance changes, but the wallet only re-reads
// on its poll cycle, so the old balance lingers until the next tick (or a manual
// reload). Send/Swap don't await the tx receipt either, so a single refresh right
// after broadcast usually reads the pre-confirmation balance.
//
// Pages call markBalancesDirty() when they broadcast a transaction. The wallet
// hook subscribes: it refreshes immediately and then polls fast for a short
// window (to catch the tx confirming) before returning to its idle cadence.

const listeners = new Set<() => void>();
let dirtyUntil = 0;

/**
 * Mark balances stale for `ms` (default 40s): wakes every listener to refresh
 * now, and opens a fast-poll window so the confirmed balance is caught within
 * seconds regardless of block time.
 */
export function markBalancesDirty(ms = 40_000): void {
  dirtyUntil = Math.max(dirtyUntil, Date.now() + ms);
  for (const l of listeners) l();
}

/** True while inside the post-transaction fast-refresh window. */
export function balancesDirty(): boolean {
  return Date.now() < dirtyUntil;
}

/** Subscribe to dirty signals; the wallet hook refreshes on each. */
export function subscribeBalanceBus(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}
