// The mobile stand-in for the extension's content bridge
// (wallet-extension/src/content/bridge.ts). Runs in the WebView page, relaying
// the page-world provider's messages to the React Native side and back.
//
// It is the same trust boundary the extension's bridge is, with one important
// difference: it CANNOT be the authority on the page's origin. Anything running
// in the page can forge a postMessage, so the origin this stamps is only ever a
// cross-check. The authoritative origin is the one React Native reads from
// `event.nativeEvent.url` (see router.ts); a mismatch means the page navigated
// mid-request or is lying, and the request is dropped either way.
//
// Written as a JS source string rather than a module because it has to be
// injected into an untrusted page, not bundled into the app.

import { TO_CONTENT, TO_INPAGE } from "@numpay/core/dapp/rpcTypes";

/**
 * The page-side bridge. Idempotent: Android cannot guarantee that
 * `injectedJavaScriptBeforeContentLoaded` runs before the page's own scripts,
 * so BrowserScreen also re-injects on load. The guard makes the second run a
 * no-op instead of installing a duplicate listener that would double every
 * request.
 */
export const BRIDGE_SHIM_JS = `
(function () {
  if (window.__numpayInjected) return;
  window.__numpayInjected = true;

  var TO_CONTENT = ${JSON.stringify(TO_CONTENT)};
  var TO_INPAGE = ${JSON.stringify(TO_INPAGE)};

  // page -> native. The provider posts a well-formed request; we validate the
  // shape (so unrelated page chatter never reaches the wallet) and add the
  // origin the page claims to be, for the native side to cross-check.
  window.addEventListener('message', function (e) {
    if (e.source !== window) return;
    var d = e.data;
    if (!d || d.target !== TO_CONTENT) return;
    if (typeof d.method !== 'string' || typeof d.id !== 'string' || typeof d.channel !== 'string') return;
    try {
      window.ReactNativeWebView.postMessage(JSON.stringify({
        kind: 'request',
        id: d.id,
        channel: d.channel,
        method: d.method,
        params: Array.isArray(d.params) ? d.params : [],
        pageOrigin: window.location.origin
      }));
    } catch (err) {
      /* bridge gone (navigating away); the request simply never resolves */
    }
  });

  // native -> page. React Native calls this through injectJavaScript with an
  // already-serialised payload, and we replay it as the window message the
  // provider is already listening for, so the provider needs no mobile branch.
  window.__numpayDeliver = function (raw) {
    var msg;
    try { msg = JSON.parse(raw); } catch (err) { return; }
    if (!msg || typeof msg !== 'object') return;
    if (msg.kind === 'event') {
      window.postMessage({ target: TO_INPAGE, kind: 'event', name: msg.name, data: msg.data }, window.location.origin);
    } else {
      window.postMessage({
        target: TO_INPAGE,
        kind: 'response',
        channel: msg.channel,
        id: msg.id,
        result: msg.result,
        error: msg.error
      }, window.location.origin);
    }
  };
})();
`;

/** What the page sends us. `pageOrigin` is a CLAIM, never trusted on its own. */
export interface BridgeRequest {
  kind: "request";
  id: string;
  channel: string;
  method: string;
  params: unknown[];
  pageOrigin: string;
}

/** What we send back to the page, replayed by `__numpayDeliver`. */
export type BridgeOutbound =
  | { kind: "response"; channel: string; id: string; result?: unknown; error?: unknown }
  | { kind: "event"; name: string; data: unknown };

/**
 * Parse a raw `onMessage` payload into a request, or null if it is not one.
 * Everything here is untrusted page input, so every field is shape-checked
 * before the router sees it.
 */
export function parseBridgeRequest(raw: string): BridgeRequest | null {
  let d: unknown;
  try {
    d = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!d || typeof d !== "object") return null;
  const m = d as Record<string, unknown>;
  if (m.kind !== "request") return null;
  if (typeof m.id !== "string" || typeof m.channel !== "string") return null;
  if (typeof m.method !== "string" || typeof m.pageOrigin !== "string") return null;
  return {
    kind: "request",
    id: m.id,
    channel: m.channel,
    method: m.method,
    params: Array.isArray(m.params) ? m.params : [],
    pageOrigin: m.pageOrigin,
  };
}

/**
 * Wrap an outbound message as the `injectJavaScript` source that delivers it.
 * Double-serialised on purpose: the payload becomes a JS string literal, so no
 * value inside it can terminate the expression and execute in the page. The
 * trailing `true;` is required by react-native-webview to avoid a warning.
 */
export function deliverJs(msg: BridgeOutbound): string {
  return `window.__numpayDeliver && window.__numpayDeliver(${JSON.stringify(
    JSON.stringify(msg),
  )}); true;`;
}
