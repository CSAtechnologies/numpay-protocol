/**
 * The single rule for which assets get a row on the home list.
 *
 * Kept in its own platform-free module (no React, no RN) so the decision that
 * controls what a user believes they own is readable in one place and testable
 * on its own — see test/asset-visibility.mjs.
 *
 * Three outcomes, not two:
 *   home   — a row on the dashboard.
 *   hidden — a row in the collapsible "Hidden (n)" section, one tap from coming
 *            back. Anything a user might reasonably want to recover goes here.
 *   drop   — not rendered at all. Reserved for zero-balance discovered TOKENS:
 *            an indexer sweep returns these by the hundred, and parking them in
 *            Hidden would bury the handful of rows that section exists for.
 *            Natives are never dropped; there are ~18 of them and each one is a
 *            chain the user can receive on.
 */

/** Assets that earn a home row on an EMPTY wallet: ETH, SOL, BTC, BNB, SUI. */
export const DEFAULT_HOME_CHAINS: ReadonlySet<string> = new Set([
  "ethereum", "solana", "bitcoin", "bsc", "sui",
]);

/** Below one displayable cent. Matches the extension dashboard's cutoff. */
export const DUST_USD = 0.01;

export type HomeSection = "home" | "hidden" | "drop";

export interface VisibilityInput {
  chainId: string;
  isNative: boolean;
  /** Contract address for tokens; absent for natives. */
  address?: string;
  balanceNum: number;
  /** 0 means "no price known", which is NOT the same as worthless. */
  usdValue: number;
  /** Spam / thin-liquidity verdict from the shared classifier. */
  spam?: boolean;
}

/** Same shape as core's tokenHideKey, which already tolerates a missing address. */
export function assetKey(chainId: string, address?: string): string {
  return `${chainId}:${(address ?? "").toLowerCase()}`;
}

export function homeSection(
  a: VisibilityInput,
  hidden: ReadonlySet<string>,
  pinned: ReadonlySet<string>,
): HomeSection {
  const key = assetKey(a.chainId, a.address);

  // The user's own choices come first, in both directions, and outrank every
  // heuristic below. A classifier guess must never overrule a deliberate act.
  if (hidden.has(key)) return a.isNative || a.balanceNum > 0 ? "hidden" : "drop";
  if (pinned.has(key)) return "home";

  // A native earns its place by holding something or by being one of the five
  // defaults. The rest wait in Hidden rather than padding a fresh wallet's home
  // list with a wall of zeros.
  if (a.isNative) {
    return a.balanceNum > 0 || DEFAULT_HOME_CHAINS.has(a.chainId) ? "home" : "hidden";
  }

  if (a.spam) return a.balanceNum > 0 ? "hidden" : "drop";
  if (a.balanceNum <= 0) return "drop";
  // Only a PRICED-but-negligible balance is dust. An unpriced balance is money
  // we cannot value yet, not money worth nothing — treating price-unknown as $0
  // made every token the indexer could not price (fresh memecoins, RWA,
  // long-tail stables) invisible, which the extension deliberately avoids.
  if (a.usdValue > 0 && a.usdValue < DUST_USD) return "hidden";
  return "home";
}
