// Recently visited sites in the in-app browser.
//
// Deliberately thin: origin, a title and a timestamp. No full history, no
// per-page URLs, no query strings. A wallet keeping a detailed browsing log on
// disk is a liability, not a feature, and the only thing the empty state
// actually needs is "take me back to the dApp I was using".

import { getItem, setItem } from "@numpay/core/storage";
import { originOf } from "./session";

const RECENTS_KEY = "numpay_browser_recents";
const MAX_RECENTS = 12;
const MAX_TITLE = 60;

export interface RecentSite {
  origin: string;
  title: string;
  lastAt: number;
}

export async function listRecents(): Promise<RecentSite[]> {
  try {
    const raw = await getItem(RECENTS_KEY);
    if (!raw) return [];
    const v = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!Array.isArray(v)) return [];
    return (v as RecentSite[])
      .filter((r) => r && typeof r.origin === "string")
      .sort((a, b) => b.lastAt - a.lastAt);
  } catch {
    return [];
  }
}

/**
 * Record a visit. Keyed by ORIGIN, so revisiting a site moves it up rather than
 * filling the list with one entry per page. The title comes from the page and
 * is therefore untrusted: it is length-capped and stripped of newlines so a
 * hostile site cannot inject a fake extra row into the recents list.
 */
export async function recordVisit(url: string, title: string): Promise<void> {
  const origin = originOf(url);
  if (!origin) return; // non-https never reaches the router, so never the list
  const clean = (title || "").replace(/\s+/g, " ").trim().slice(0, MAX_TITLE);
  const list = await listRecents();
  const next = [
    { origin, title: clean, lastAt: Date.now() },
    ...list.filter((r) => r.origin !== origin),
  ].slice(0, MAX_RECENTS);
  await setItem(RECENTS_KEY, JSON.stringify(next));
}

export async function removeRecent(origin: string): Promise<void> {
  const list = await listRecents();
  await setItem(RECENTS_KEY, JSON.stringify(list.filter((r) => r.origin !== origin)));
}

export async function clearRecents(): Promise<void> {
  await setItem(RECENTS_KEY, JSON.stringify([]));
}

// ── the address bar ──────────────────────────────────────────────────────────

/** Privacy-preserving default search, matching the wallet's no-tracking stance. */
const SEARCH = "https://duckduckgo.com/?q=";

/**
 * Turn whatever the user typed into a URL to load.
 *
 * https is forced, never assumed away: typing "app.uniswap.org" gets https, and
 * typing an explicit "http://..." is treated as a SEARCH rather than silently
 * upgraded, so the user is never quietly redirected to a different site than
 * the one they asked for. Anything without a dot is a search term.
 */
export function normalizeUrlInput(raw: string): string | null {
  const s = (raw || "").trim();
  if (!s) return null;

  // Already a URL with a scheme.
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) {
    return s.toLowerCase().startsWith("https://") ? s : SEARCH + encodeURIComponent(s);
  }
  // Bare host (optionally with a path): "app.uniswap.org", "uniswap.org/swap".
  // Requires a dot and no whitespace, so "how to bridge usdc" is a search.
  if (!/\s/.test(s) && /^[^/\s]+\.[^/\s]{2,}(\/.*)?$/.test(s)) {
    return "https://" + s;
  }
  return SEARCH + encodeURIComponent(s);
}

// ── curated shortcuts ────────────────────────────────────────────────────────

/**
 * The empty state's starting points. Hand-picked and hard-coded on purpose:
 * a remote list would be one compromised endpoint away from serving a drainer
 * to every NumPay user, and shipping it in the binary means it is reviewable.
 *
 * Being listed is a convenience, not an endorsement, and the UI says so.
 */
export interface Shortcut {
  name: string;
  url: string;
}

export const SHORTCUTS: Shortcut[] = [
  { name: "Uniswap", url: "https://app.uniswap.org" },
  { name: "Aave", url: "https://app.aave.com" },
  { name: "Curve", url: "https://curve.finance" },
  { name: "Lido", url: "https://stake.lido.fi" },
  { name: "1inch", url: "https://app.1inch.io" },
  { name: "OpenSea", url: "https://opensea.io" },
  { name: "Aerodrome", url: "https://aerodrome.finance" },
  { name: "Etherscan", url: "https://etherscan.io" },
];
