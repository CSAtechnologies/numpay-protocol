/**
 * User-hidden tokens: a persisted set of `${chainId}:${addressLower}` keys the
 * user explicitly hid from the home asset list. This is the manual backstop
 * for spam that slips past the automatic classifier (tokenSpam.ts); hidden
 * tokens move to the collapsible "Hidden" section, where they can be unhidden.
 *
 * Scoped PER WALLET (owner = the vault's EVM address, the same stable id the
 * tx log uses): hiding a token in wallet A must not hide it in wallet B —
 * B may genuinely hold and want to see it. The pre-scoping global list seeds
 * each wallet's list on its first read, so existing hides carry over instead
 * of resurfacing as spam.
 */
import { getItem, setItem } from "./storage";

const LEGACY_KEY = "numpay_hidden_tokens";
const keyFor = (owner: string) => `numpay_hidden_tokens::${owner.toLowerCase()}`;

export function tokenHideKey(chainId: string, address?: string): string {
  return `${chainId}:${(address ?? "").toLowerCase()}`;
}

function parseSet(raw: string | null): Set<string> | null {
  if (!raw) return null;
  try {
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr.filter((k) => typeof k === "string")) : null;
  } catch {
    return null;
  }
}

export async function loadHiddenTokens(owner: string): Promise<Set<string>> {
  try {
    const own = parseSet(await getItem(keyFor(owner)));
    if (own) return own;
    // First read for this wallet: seed from the legacy global list (kept in
    // place so other wallets can seed from it too — it is tiny and inert).
    const legacy = parseSet(await getItem(LEGACY_KEY)) ?? new Set<string>();
    try { await setItem(keyFor(owner), JSON.stringify([...legacy])); } catch {}
    return legacy;
  } catch {
    return new Set();
  }
}

/** Add or remove a key; returns the updated set (for immediate state use). */
export async function setTokenHidden(owner: string, key: string, hidden: boolean): Promise<Set<string>> {
  const set = await loadHiddenTokens(owner);
  if (hidden) set.add(key); else set.delete(key);
  try { await setItem(keyFor(owner), JSON.stringify([...set])); } catch {}
  return set;
}
