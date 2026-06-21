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
 *   - an indexer explicitly flags it as spam, or
 *   - it is priced and the holding is worth under $0.01, or
 *   - it has a market cap but almost no liquidity backing it (a classic fake:
 *     e.g. $100k "market cap" propped up by $200 of liquidity).
 *
 * A token with no price and no liquidity data is left VISIBLE — absence of data
 * is not evidence of spam.
 */

export const SPAM_MIN_VALUE_USD = 0.01;
// Liquidity below this fraction of market cap reads as manipulable / fake.
export const SPAM_MIN_LIQ_MC_RATIO = 0.005; // 0.5%

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
  // 1. Indexer-flagged spam (Moralis/GoldRush possible_spam).
  if (t.possibleSpam) return { hidden: true, reason: "Flagged as possible spam" };

  // 2. Priced, but the holding is worth essentially nothing.
  if (typeof t.priceUsd === "number" && t.priceUsd > 0) {
    const value = toNum(t.balance) * t.priceUsd;
    if (value > 0 && value < SPAM_MIN_VALUE_USD) {
      return { hidden: true, reason: "Holding worth under $0.01" };
    }
  }

  // 3. Market cap with almost no liquidity behind it.
  if (
    typeof t.liquidityUsd === "number" && t.liquidityUsd >= 0 &&
    typeof t.marketCapUsd === "number" && t.marketCapUsd > 0
  ) {
    if (t.liquidityUsd / t.marketCapUsd < SPAM_MIN_LIQ_MC_RATIO) {
      return { hidden: true, reason: "Very low liquidity vs market cap" };
    }
  }

  return { hidden: false };
}

/** Convenience boolean for call sites that only need to filter. */
export function isHiddenToken(t: SpamSignals): boolean {
  return classifyToken(t).hidden;
}
