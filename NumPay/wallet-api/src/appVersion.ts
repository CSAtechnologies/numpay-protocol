/**
 * /v1/app-version - what the newest shipped build is, and how urgent it is.
 *
 * This is the ONLY server-driven surface in a non-custodial wallet, so its
 * design is mostly about what it deliberately cannot do.
 *
 * WHAT IT RETURNS, AND WHAT IT MUST NEVER RETURN. Integers and one enum. No
 * URL, no title, no body text. Every word the user reads and the download
 * location they are sent to are compile-time constants in the app.
 *
 * The reason is the attack this endpoint would otherwise be: whoever controls
 * the worker can make every wallet on earth display an urgent message. If that
 * message carried a URL, a compromised key or a bad deploy turns into "critical
 * security update, download here" pointing at an attacker's APK, delivered with
 * the app's own credibility, to an audience holding funds. Shipping only a
 * version number means the worst a compromised endpoint can do is nag people
 * about an update that does not exist.
 *
 * WHY THE VALUES ARE A CONSTANT AND NOT KV. Changing them requires a
 * `wrangler deploy`, so the change is a reviewed commit in git rather than an
 * API call. A leaked API token cannot flip a "critical" banner on for every
 * user; it would also need push access to this repo. Deploys are fast, so the
 * remote part of "push it remotely" is not lost, only slowed to the speed of a
 * deploy, which is the same speed as publishing the build it points at.
 *
 * FAIL-OPEN IS THE CLIENT'S JOB, and it is enforced there: apiGet resolves null
 * on any failure, and a null means no banner. An outage of this endpoint must
 * never be able to imply "you are out of date", and must never gate the wallet.
 */

/** Severity ladder. The client owns the copy for each of these. */
export type Severity = "none" | "recommended" | "critical";

/**
 * The published Android build.
 *
 * KEEP `latest` IN STEP WITH android.versionCode IN wallet-mobile/app.json,
 * and only raise it once the build it names is actually downloadable. A latest
 * that is ahead of what the site serves sends people to a page that cannot give
 * them the thing the banner just told them to get.
 *
 * `minSupported` is the oldest build that is not known-broken. It raises the
 * severity the client shows; it does NOT disable anything. There is no kill
 * switch here on purpose: a non-custodial wallet that a server can brick is a
 * wallet that can be used to separate somebody from their funds, whether by
 * compromise or by a typo in this file.
 *
 * `severity` is the release's own urgency:
 *   none         nothing to say. The default, and what ships between releases.
 *   recommended  a normal update. A quiet, dismissible line.
 *   critical     a security fix. Louder and it comes back after dismissal, but
 *                it still cannot block use of the wallet.
 */
const ANDROID = {
  latest: 5,
  minSupported: 1,
  severity: "none" as Severity,
};

/**
 * Cached hard at the edge: this changes a few times a year, and every install
 * asks on launch. A stale answer for an hour is harmless in the direction that
 * matters (a user hears about an update slightly late), which is not true in
 * reverse, so nothing here is ever cached as "critical" longer than it is true.
 */
const CACHE_SECONDS = 3600;

export function handleAppVersion(): Response {
  return new Response(
    JSON.stringify({ android: ANDROID }),
    {
      status: 200,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": `public, max-age=${CACHE_SECONDS}`,
      },
    },
  );
}
