/**
 * "There is a newer build" - the client half of /v1/app-version.
 *
 * NumPay is distributed as a sideloaded APK, so there is no store to tell
 * anyone a security fix exists. This closes that gap, and it is deliberately
 * the weakest mechanism that closes it.
 *
 * THE THREE RULES, in the order they matter:
 *
 *   1. It can only ever SHOW A MESSAGE. It cannot download, install, prompt an
 *      install, or block any part of the wallet. A non-custodial wallet whose
 *      server can stop it from opening is one a compromise can use to separate
 *      somebody from their funds, and "temporarily" is not a defence when the
 *      funds are time-sensitive.
 *   2. The URL and every word of copy are CONSTANTS IN THIS FILE. The endpoint
 *      sends integers and one enum, nothing else (see wallet-api/appVersion.ts
 *      for why). A compromised worker can make this nag; it cannot make it lie
 *      about where to go.
 *   3. Silence on failure. No answer means no banner, never "you are out of
 *      date". fetchAndroidAppVersion resolves null on every failure path.
 *
 * Not wired to a background task on purpose: it runs when the dashboard mounts
 * and no more often. An update check is not worth a wakeup, and a wallet that
 * phones home on a timer is a wallet with a traffic pattern worth watching.
 */
import * as Application from "expo-application";
import { getItem, setItem } from "@numpay/core/storage";
import {
  fetchAndroidAppVersion, updateSeverityFor, type UpdateSeverity,
} from "@numpay/core/walletApi";

/**
 * Where a user is sent to get the build. A CONSTANT, never a server value.
 *
 * Keep it pointing at the human download PAGE rather than straight at the APK:
 * the page is where the checksum and the signing fingerprint live, and a
 * sideloaded wallet binary that nobody can verify is the thing this whole
 * feature is supposed to protect people from.
 */
export const DOWNLOAD_URL = "https://numpay-site.pages.dev/#download";

/** Copy, per severity. Lives here, not on the wire. */
export const UPDATE_COPY: Record<Exclude<UpdateSeverity, "none">, {
  title: string;
  body: string;
}> = {
  recommended: {
    title: "Update available",
    body: "A newer version of NumPay is ready. Your wallet keeps working either way.",
  },
  critical: {
    // Says what to do and does not dress it up. No countdown, no "your funds
    // are at risk": a message that frightens people into rushing a download is
    // the same message an attacker would want to send.
    title: "Important update",
    body: "This version has a fix you should not skip. Download the new build when you can.",
  },
};

const DISMISS_KEY = "numpay_update_dismissed";

export interface UpdateState {
  severity: UpdateSeverity;
  /** The build being offered, for the dismiss record. */
  latest: number;
}

/** The installed build number, or null if it cannot be read. */
export function installedVersionCode(): number | null {
  // Android: nativeBuildVersion is the versionCode as a string.
  const raw = Application.nativeBuildVersion;
  if (raw === null || raw === undefined) return null;
  const n = Number.parseInt(String(raw), 10);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/**
 * What to show right now, or null for nothing.
 *
 * A dismissal is remembered PER BUILD, so dismissing does not silence the next
 * release. `critical` ignores the record: the one case where repeating
 * ourselves is justified is the one where the build in hand is known-broken,
 * and it is still only a banner the user can scroll past.
 */
export async function checkForUpdate(): Promise<UpdateState | null> {
  const info = await fetchAndroidAppVersion();
  const severity = updateSeverityFor(info, installedVersionCode());
  if (severity === "none" || info === null) return null;

  if (severity !== "critical") {
    const dismissed = await getItem(DISMISS_KEY);
    if (dismissed !== null && Number.parseInt(dismissed, 10) === info.latest) return null;
  }
  return { severity, latest: info.latest };
}

/** Remembers that this build's offer was dismissed. */
export async function dismissUpdate(latest: number): Promise<void> {
  await setItem(DISMISS_KEY, String(latest));
}
