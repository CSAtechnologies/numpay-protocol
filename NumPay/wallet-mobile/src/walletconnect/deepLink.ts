// `wc:` deep-link entry point (Slice 4). Android opens NumPay for two link
// shapes (app.json: scheme "numpay" + an intent filter for scheme "wc"):
//   • raw `wc:<topic>@2?...` — the standard WalletConnect handoff.
//   • `numpay://wc?uri=<url-encoded wc: uri>` — our own scheme, used by
//     "open in wallet" buttons that wrap the URI.
// The approval host subscribes once per unlock and feeds every extracted URI
// into pair(); the resulting session_proposal then flows through the normal
// approval sheet. Nothing here approves or signs.
import * as Linking from "expo-linking";

/** Pull a `wc:` pairing URI out of any URL NumPay can be opened with. */
export function extractWcUri(url: string | null | undefined): string | null {
  if (!url) return null;
  const s = url.trim();
  if (s.startsWith("wc:")) return s;
  try {
    const parsed = Linking.parse(s);
    const uri = parsed.queryParams?.uri;
    if (typeof uri === "string" && uri.trim().startsWith("wc:")) return uri.trim();
  } catch {
    /* not a parseable link */
  }
  return null;
}

// The cold-start URL must pair exactly once. The host unmounts on every lock
// and remounts on unlock, so without this a re-unlock would replay the same
// (already consumed) pairing URI and surface a spurious error.
let initialConsumed = false;

// The subscriber (the approval host) only exists while the wallet is UNLOCKED,
// but wc: links land whenever the OS routes them — including at the lock
// screen (observed live: scan/tap while locked -> unlock -> nothing happened).
// So the OS listener is permanent, registered at module load, and stashes the
// latest URI until a subscriber shows up to consume it.
let activeSubscriber: ((uri: string) => void) | null = null;
let stashedUri: string | null = null;

Linking.addEventListener("url", (e) => {
  const wc = extractWcUri(e.url);
  if (!wc) return;
  if (activeSubscriber) activeSubscriber(wc);
  else stashedUri = wc;
});

/**
 * Watch for `wc:` links: the one the app was launched with, any that arrived
 * while the wallet was locked (stashed above), and live ones while unlocked.
 * Returns an unsubscribe.
 */
export function subscribeWcDeepLinks(onWcUri: (uri: string) => void): () => void {
  activeSubscriber = onWcUri;
  if (stashedUri) {
    const uri = stashedUri;
    stashedUri = null;
    onWcUri(uri);
  }
  if (!initialConsumed) {
    initialConsumed = true;
    Linking.getInitialURL()
      .then((url) => {
        const wc = extractWcUri(url);
        if (wc) onWcUri(wc);
      })
      .catch(() => {});
  }
  return () => {
    if (activeSubscriber === onWcUri) activeSubscriber = null;
  };
}
