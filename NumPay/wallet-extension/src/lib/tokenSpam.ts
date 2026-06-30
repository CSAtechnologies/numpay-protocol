/**
 * Shared spam / low-value token classification.
 *
 * Used by the Dashboard token list and the Send token picker to decide which
 * held tokens to surface and which to tuck into a collapsible "Hidden" section.
 * The goal is to declutter obvious junk (airdropped spam, worthless dust,
 * pump-and-dump tokens with a fake market cap and no real liquidity) WITHOUT
 * hiding a legitimate token we simply could not price.
 *
 * A token is hidden only when we have positive evidence against it:
 *   - an indexer flags it as spam AND nothing corroborates real value (it is
 *     unpriced, or the holding is worth under $0.10). Indexers (Moralis in
 *     particular) flag a large share of legitimate memecoins as possible_spam,
 *     so the flag alone is treated as a suspicion, not a verdict: a flagged
 *     token that is priced and worth a meaningful amount stays VISIBLE and
 *     surfaces its risk via the badge on the token detail page, or
 *   - it is priced and the holding is worth under $0.01, or
 *   - it has a sizable market cap but almost no liquidity backing it (a classic
 *     fake: e.g. $100k "market cap" propped up by $200 of liquidity).
 *
 * A token with no price and no liquidity data is left VISIBLE — absence of data
 * is not evidence of spam — unless an indexer has also flagged it.
 *
 * The liquidity-vs-market-cap rule is gated on LOW ABSOLUTE liquidity. A global
 * market cap (e.g. USDT's ~$180B) dwarfs any single chain's pool, so the ratio
 * alone would wrongly flag legitimate large-cap and bridged tokens that have a
 * modest but perfectly real pool. The scam pattern is thin liquidity in
 * absolute terms, so we only apply the ratio when the pool itself is tiny.
 */

export const SPAM_MIN_VALUE_USD = 0.01;
// A token an indexer flagged as possible spam is only hidden when it is unpriced
// or worth less than this. Priced flagged tokens worth at least this much are a
// memecoin the user plausibly bought, not airdrop dust, so they stay visible.
export const SPAM_FLAGGED_MIN_VALUE_USD = 0.10;
// Liquidity below this fraction of market cap reads as manipulable / fake...
export const SPAM_MIN_LIQ_MC_RATIO = 0.005; // 0.5%
// ...but only when the pool is also tiny in absolute terms. A real token (even
// a stablecoin pool worth tens of thousands) sits well above this floor.
export const SPAM_THIN_LIQ_USD = 10_000;

export interface SpamSignals {
  balance?: string | number;
  priceUsd?: number;
  liquidityUsd?: number;
  marketCapUsd?: number;
  possibleSpam?: boolean;
}

export interface SpamVerdict {
  hidden: boolean;
  reason?: string;
}

function toNum(v: string | number | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") { const n = parseFloat(v); return Number.isFinite(n) ? n : 0; }
  return 0;
}

/** Decide whether a held token should be hidden, with a short human reason. */
export function classifyToken(t: SpamSignals): SpamVerdict {
  // 1. Indexer-flagged spam (Moralis/GoldRush possible_spam). The flag is a
  //    suspicion, not a verdict: indexers over-flag legitimate memecoins. Hide
  //    only when nothing corroborates real value — the token is unpriced (can't
  //    tell it apart from airdrop dust) or its holding is worth under the floor.
  //    A priced, meaningfully valuable flagged token stays visible; its risk is
  //    surfaced by the badge on the token detail page.
  if (t.possibleSpam) {
    const priced = typeof t.priceUsd === "number" && t.priceUsd > 0;
    const value = priced ? toNum(t.balance) * t.priceUsd! : 0;
    if (!priced || value < SPAM_FLAGGED_MIN_VALUE_USD) {
      return { hidden: true, reason: "Flagged as possible spam" };
    }
  }

  // 2. Priced, but the holding is worth essentially nothing.
  if (typeof t.priceUsd === "number" && t.priceUsd > 0) {
    const value = toNum(t.balance) * t.priceUsd;
    if (value > 0 && value < SPAM_MIN_VALUE_USD) {
      return { hidden: true, reason: "Holding worth under $0.01" };
    }
  }

  // 3. A tiny pool whose liquidity is also a negligible fraction of a sizable
  //    market cap — a fake/manipulable token. Both conditions are required so
  //    big-cap and bridged tokens (USDT/USDC) with real pools are never hidden.
  if (
    typeof t.liquidityUsd === "number" && t.liquidityUsd >= 0 &&
    typeof t.marketCapUsd === "number" && t.marketCapUsd > 0 &&
    t.liquidityUsd < SPAM_THIN_LIQ_USD &&
    t.liquidityUsd / t.marketCapUsd < SPAM_MIN_LIQ_MC_RATIO
  ) {
    return { hidden: true, reason: "Tiny liquidity behind its market cap" };
  }

  return { hidden: false };
}

/** Convenience boolean for call sites that only need to filter. */
export function isHiddenToken(t: SpamSignals): boolean {
  return classifyToken(t).hidden;
}
