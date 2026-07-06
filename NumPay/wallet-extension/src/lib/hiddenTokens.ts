/**
 * User-hidden tokens: a persisted set of `${chainId}:${addressLower}` keys the
 * user explicitly hid from the home asset list. This is the manual backstop
 * for spam that slips past the automatic classifier (tokenSpam.ts); hidden
 * tokens move to the collapsible "Hidden" section, where they can be unhidden.
 */
import { getItem, setItem } from "./storage";

const KEY = "numpay_hidden_tokens";

export function tokenHideKey(chainId: string, address?: string): string {
  return `${chainId}:${(address ?? "").toLowerCase()}`;
}

export async function loadHiddenTokens(): Promise<Set<string>> {
  try {
    const raw = await getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(arr) ? arr.filter((k) => typeof k === "string") : []);
  } catch {
    return new Set();
  }
}

/** Add or remove a key; returns the updated set (for immediate state use). */
export async function setTokenHidden(key: string, hidden: boolean): Promise<Set<string>> {
  const set = await loadHiddenTokens();
  if (hidden) set.add(key); else set.delete(key);
  try { await setItem(KEY, JSON.stringify([...set])); } catch {}
  return set;
}
