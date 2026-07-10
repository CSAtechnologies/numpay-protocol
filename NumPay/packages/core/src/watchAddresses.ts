// Watch-address registry: the ACTIVE wallet's public receive addresses,
// written by the popup whenever a wallet loads, read by the background
// refresher so it can keep balance caches warm while the popup is closed.
// Addresses only — they already appear in cache keys and cached data — never
// key material, so the registry needs no unlock and carries no secret.

import { getItem, setItem } from "./storage";

export interface WatchAddresses {
  evm: string;
  solana?: string;
  tron?: string;
  sui?: string;
  bitcoin?: string;
  xrp?: string;
  litecoin?: string;
  updated: number;
}

const KEY = "numpay_watch_addrs";

export async function getWatchAddresses(): Promise<WatchAddresses | null> {
  try {
    const raw = await getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return typeof parsed?.evm === "string" && parsed.evm ? (parsed as WatchAddresses) : null;
  } catch {
    return null;
  }
}

/**
 * Update the registry for the active wallet. A different `evm` address means
 * the active wallet changed, so the whole registry is REPLACED (stale non-EVM
 * addresses of the previous wallet must not keep being refreshed); the same
 * address merges, letting the non-EVM set arrive after the EVM one.
 */
export async function updateWatchAddresses(patch: Omit<WatchAddresses, "updated">): Promise<void> {
  try {
    const cur = await getWatchAddresses();
    const next: WatchAddresses =
      cur && cur.evm === patch.evm
        ? { ...cur, ...patch, updated: Date.now() }
        : { ...patch, updated: Date.now() };
    await setItem(KEY, JSON.stringify(next));
  } catch {}
}
