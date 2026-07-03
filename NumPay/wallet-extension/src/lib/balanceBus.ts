// Balance freshness bus + optimistic overlay.
//
// After a send or swap the on-chain balance changes, but the wallet only re-reads
// on its poll cycle, so the old balance lingers until the next tick (or a manual
// reload). Send/Swap don't await the tx receipt either, so a single refresh right
// after broadcast usually reads the pre-confirmation balance.
//
// Pages call markBalancesDirty() when they broadcast a transaction, optionally
// passing the expected balance deltas. The wallet hook subscribes: it refreshes
// immediately and polls fast for a short window, and while the chain catches up
// it OVERLAYS the deltas on the displayed balances so the number moves the
// instant the user hits send — the way Phantom/MetaMask feel — then hands back
// to fetched truth.
//
// Overlay lifecycle: an entry is applied on top of the fetched value until that
// fetched value moves (the chain now reflects the tx — or something else changed;
// either way the fetch wins) or the entry expires. The first application records
// the fetched value it overlaid as the baseline for that movement check.

export interface BalanceDelta {
  /** Our network id ("ethereum", "base", "solana", "tron", ...). */
  chainId: string;
  /** Token contract / mint / coinType; omit for the chain's native coin. */
  tokenAddress?: string;
  /** Signed change in display units (e.g. -0.05 for sending 0.05 ETH). */
  delta: number;
}

interface OverlayEntry extends BalanceDelta {
  baseline: number | null; // fetched value first overlaid; movement ⇒ consumed
  consumed: boolean;
  expiresAt: number;
}

const listeners = new Set<() => void>();
let dirtyUntil = 0;

const overlays: OverlayEntry[] = [];
let version = 0;

const OVERLAY_TTL_MS = 90_000; // covers a slow ETH-mainnet confirmation
const EPSILON = 1e-12;

const keyOf = (chainId: string, tokenAddress?: string) =>
  chainId + "|" + (tokenAddress ? tokenAddress.toLowerCase() : "");

/**
 * Mark balances stale for `ms` (default 40s): wakes every listener to refresh
 * now, and opens a fast-poll window so the confirmed balance is caught within
 * seconds regardless of block time. Pass `deltas` (from a just-broadcast tx) to
 * overlay the expected change on the displayed balances immediately.
 */
export function markBalancesDirty(deltas?: BalanceDelta[], ms = 40_000): void {
  dirtyUntil = Math.max(dirtyUntil, Date.now() + ms);
  if (deltas?.length) {
    const expiresAt = Date.now() + OVERLAY_TTL_MS;
    for (const d of deltas) {
      if (!d.delta || !Number.isFinite(d.delta)) continue;
      overlays.push({ ...d, baseline: null, consumed: false, expiresAt });
    }
    version++;
  }
  for (const l of listeners) l();
}

/** True while inside the post-transaction fast-refresh window. */
export function balancesDirty(): boolean {
  return Date.now() < dirtyUntil;
}

/** Subscribe to dirty/overlay signals; the wallet hook refreshes on each. */
export function subscribeBalanceBus(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Monotonic overlay version, for useSyncExternalStore re-renders. */
export function overlayVersion(): number {
  return version;
}

/** Cheap guard so display memos can skip mapping when nothing is pending. */
export function hasPendingOverlays(): boolean {
  const now = Date.now();
  return overlays.some((o) => !o.consumed && o.expiresAt > now);
}

/**
 * Total pending delta to add on top of `fetched` for one asset. Called from the
 * display memos, so it also advances the lifecycle: first call per entry pins
 * the baseline to `fetched`; once `fetched` moves off that baseline the entry
 * is consumed (the fetch now reflects the tx) and no longer applied.
 */
export function pendingDeltaFor(chainId: string, tokenAddress: string | undefined, fetched: number): number {
  if (overlays.length === 0) return 0;
  const key = keyOf(chainId, tokenAddress);
  const now = Date.now();
  let sum = 0;
  for (const o of overlays) {
    if (o.consumed || o.expiresAt <= now) continue;
    if (keyOf(o.chainId, o.tokenAddress) !== key) continue;
    if (o.baseline === null) o.baseline = fetched;
    else if (Math.abs(fetched - o.baseline) > EPSILON) { o.consumed = true; continue; }
    sum += o.delta;
  }
  // Opportunistic cleanup so the array can't grow across a long popup session.
  if (overlays.length > 32) {
    for (let i = overlays.length - 1; i >= 0; i--) {
      if (overlays[i].consumed || overlays[i].expiresAt <= now) overlays.splice(i, 1);
    }
  }
  return sum;
}
