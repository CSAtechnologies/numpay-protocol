// Shared token-logo cache, keyed by lowercased token address.
//
// Long-tail memecoins (e.g. a fresh Base token) have no logo on coincap or the
// balance indexers (Moralis/GoldRush/Alchemy), so the symbol-keyed icon resolver
// falls through to the drawn monogram. But DexScreener DOES carry a logo for
// virtually every tradeable token, and we already call it for prices. This cache
// lets that image, captured once during a price/market fetch, be reused by every
// icon across the app (dashboard, swap, send, detail) without any extra request.
//
// It is a tiny subscribable store: setTokenLogo notifies subscribers so icons
// that already rendered pick up a logo the moment it resolves, and the map is
// persisted to chrome.storage.local so logos survive a popup reopen.

const STORAGE_KEY = "numpay_token_logos";

const mem = new Map<string, string>(); // addressLower -> logo URL
const listeners = new Set<() => void>();
let loaded = false;
let persistTimer: ReturnType<typeof setTimeout> | null = null;

function notify(): void {
  for (const l of listeners) l();
}

/** Subscribe to cache changes (shape matches React's useSyncExternalStore). */
export function subscribeLogos(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

/** Current cached logo URL for a token address, or undefined. */
export function getTokenLogo(address?: string): string | undefined {
  if (!address) return undefined;
  return mem.get(address.toLowerCase());
}

/** Record a resolved logo. No-op if unchanged; persists + notifies otherwise. */
export function setTokenLogo(address: string | undefined, url: string | undefined): void {
  if (!address || !url) return;
  const key = address.toLowerCase();
  if (mem.get(key) === url) return;
  mem.set(key, url);
  persist();
  notify();
}

function persist(): void {
  try {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    if (persistTimer) return; // coalesce a burst of sets into one write
    persistTimer = setTimeout(() => {
      persistTimer = null;
      const obj: Record<string, string> = {};
      for (const [k, v] of mem) obj[k] = v;
      try { chrome.storage.local.set({ [STORAGE_KEY]: obj }); } catch { /* ignore */ }
    }, 500);
  } catch { /* not in an extension context */ }
}

/** Load persisted logos into memory once, then notify so live icons refresh. */
export async function primeLogoCache(): Promise<void> {
  if (loaded) return;
  loaded = true;
  try {
    if (typeof chrome === "undefined" || !chrome.storage?.local) return;
    const got = await chrome.storage.local.get(STORAGE_KEY);
    const obj = got?.[STORAGE_KEY] as Record<string, string> | undefined;
    if (!obj) return;
    let added = false;
    for (const [k, v] of Object.entries(obj)) {
      if (v && !mem.has(k)) { mem.set(k, v); added = true; }
    }
    if (added) notify();
  } catch { /* ignore */ }
}

// Warm the cache as soon as this module loads in the popup.
void primeLogoCache();
