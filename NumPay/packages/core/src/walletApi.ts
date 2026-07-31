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

/** How urgent the newest published build is. The CLIENT owns the wording. */
export type UpdateSeverity = "none" | "recommended" | "critical";

export interface AppVersionInfo {
  /** versionCode of the newest published build. */
  latest: number;
  /** Oldest build not known to be broken. Raises severity; disables nothing. */
  minSupported: number;
  severity: UpdateSeverity;
}

const SEVERITIES: readonly UpdateSeverity[] = ["none", "recommended", "critical"];

/**
 * The newest published Android build, or null when it cannot be established.
 *
 * Null is the safe answer and every failure resolves to it: no proxy
 * configured, network down, rate limited, malformed JSON, or a payload that
 * does not typecheck. A caller must read null as "say nothing", never as
 * "you are out of date" - an outage here must not be able to nag every user,
 * and must never gate the wallet.
 *
 * The shape is validated rather than cast. This is the one response in the app
 * that drives a security-flavoured message, so a field arriving as a string, a
 * float, a negative, or an unknown severity is treated as a broken answer
 * instead of being coerced into a banner. Note what is NOT read here: no URL
 * and no text, because the endpoint does not send any. Adding either to this
 * parser would hand a compromised worker a way to word its own message and
 * point it wherever it liked.
 */
export async function fetchAndroidAppVersion(): Promise<AppVersionInfo | null> {
  const raw = await apiGet<{ android?: unknown }>("/v1/app-version");
  const a = raw?.android;
  if (typeof a !== "object" || a === null) return null;

  const { latest, minSupported, severity } = a as Record<string, unknown>;
  if (!Number.isInteger(latest) || (latest as number) < 1) return null;
  if (!Number.isInteger(minSupported) || (minSupported as number) < 1) return null;
  if (typeof severity !== "string"
      || !SEVERITIES.includes(severity as UpdateSeverity)) return null;
  // A minSupported above latest is incoherent: it would mark the newest build
  // itself as unsupported, so the payload is wrong rather than urgent.
  if ((minSupported as number) > (latest as number)) return null;

  return {
    latest: latest as number,
    minSupported: minSupported as number,
    severity: severity as UpdateSeverity,
  };
}

/**
 * What the app should show, given the newest published build and the build the
 * user is actually running.
 *
 * Kept pure and separate from the fetch so the decision itself is testable
 * without a network, which is the part that has to be right: this is what
 * decides whether a user is told their wallet is unsafe.
 */
export function updateSeverityFor(
  info: AppVersionInfo | null,
  installed: number | null,
): UpdateSeverity {
  // No answer, or we cannot tell what we are running: say nothing.
  if (info === null || installed === null || !Number.isInteger(installed)) return "none";
  // Already current, or somehow ahead of it (a local build). Nothing to say.
  if (installed >= info.latest) return "none";
  // Below the supported floor outranks the release's own severity: the build in
  // hand is known-broken, whatever the newest release happens to be flagged as.
  if (installed < info.minSupported) return "critical";
  return info.severity;
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
