// Client for the NumPay wallet API proxy (NUMPAY_WALLET_API_SPEC_2026-07-04.md).
//
// The proxy is optional: when VITE_API_BASE is unset every helper resolves
// null and callers use their existing direct-provider path. Any proxy
// failure (network, 429, 5xx) also resolves null, so an outage degrades to
// today's behavior instead of breaking the wallet (spec section 7).

import { API_BASE } from "./env";
import { getItem, setItem } from "./storage";

const INSTALL_KEY = "numpay_install_id";

// Anonymous install ID for rate limiting (spec section 5). Random UUID,
// never derived from addresses or keys; carries no identity.
let installIdPromise: Promise<string> | null = null;

export function getInstallId(): Promise<string> {
  installIdPromise ??= (async () => {
    const existing = await getItem(INSTALL_KEY);
    if (existing) return existing;
    const id = crypto.randomUUID();
    await setItem(INSTALL_KEY, id);
    return id;
  })();
  return installIdPromise;
}

/** GET a proxy endpoint. Resolves the parsed JSON, or null on any failure. */
export async function apiGet<T>(path: string, timeoutMs = 8000): Promise<T | null> {
  if (!API_BASE) return null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${API_BASE}${path}`, {
      signal: ctrl.signal,
      headers: { "X-NumPay-Install": await getInstallId() },
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
