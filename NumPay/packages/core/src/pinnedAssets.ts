/**
 * Assets the user explicitly put ON the home list, per wallet.
 *
 * The counterpart to hiddenTokens, and it exists because the two questions are
 * NOT inverses of each other. A row can be off the home list for two different
 * reasons: the user hid it, or a RULE kept it off (zero balance, dust, spam).
 * Deleting a key from the hidden set only answers the first. Without a positive
 * set there is no way to say "show me Polygon even though it is empty", because
 * nothing ever hid it in the first place.
 *
 * Same storage shape and per-wallet scoping as hiddenTokens (hiding an asset in
 * wallet A must not affect wallet B), and the same key builder — a native has no
 * contract address, and tokenHideKey already yields a stable "chainId:" for it.
 *
 * Invariant, enforced by the caller: a key is never in both sets. Setting one
 * clears the other, so the two can never disagree about a row.
 */
import { getItem, setItem } from "./storage";

const keyFor = (owner: string) => `numpay_pinned_assets::${owner.toLowerCase()}`;

function parseSet(raw: string | null): Set<string> | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((k) => typeof k === "string")) : null;
  } catch {
    return null;
  }
}

export async function loadPinnedAssets(owner: string): Promise<Set<string>> {
  try {
    return parseSet(await getItem(keyFor(owner))) ?? new Set<string>();
  } catch {
    return new Set();
  }
}

/** Add or remove a key; returns the updated set (for immediate state use). */
export async function setAssetPinned(owner: string, key: string, pinned: boolean): Promise<Set<string>> {
  const set = await loadPinnedAssets(owner);
  if (pinned) set.add(key); else set.delete(key);
  try { await setItem(keyFor(owner), JSON.stringify([...set])); } catch {}
  return set;
}
