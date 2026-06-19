// NumPay content bridge. Runs in the ISOLATED world of every page. It is the
// trust boundary between the untrusted page and the extension: it stamps the
// REAL page origin (never trusting an origin from the page message), validates
// message shape, and relays request/response/event traffic over a chrome.runtime
// port to the background router. It never sees key material.

import {
  TO_CONTENT,
  TO_INPAGE,
  DAPP_PORT,
  type RequestMessage,
} from "../lib/dapp/types";

const ORIGIN = window.location.origin;

let port: chrome.runtime.Port | null = null;

function connect(): chrome.runtime.Port {
  if (port) return port;
  const p = chrome.runtime.connect({ name: DAPP_PORT });
  port = p;

  p.onMessage.addListener((msg: any) => {
    if (!msg || typeof msg !== "object") return;
    if (msg.kind === "event") {
      window.postMessage(
        { target: TO_INPAGE, kind: "event", name: msg.name, data: msg.data },
        ORIGIN
      );
    } else {
      // response to a specific request
      window.postMessage(
        {
          target: TO_INPAGE,
          kind: "response",
          channel: msg.channel,
          id: msg.id,
          result: msg.result,
          error: msg.error,
        },
        ORIGIN
      );
    }
  });

  p.onDisconnect.addListener(() => {
    // Worker suspended or extension reloaded. Drop the handle; the next message
    // (or the registration below) reconnects so events keep flowing.
    port = null;
  });

  // Register this tab's origin with the router so it can target events.
  p.postMessage({ kind: "register", origin: ORIGIN });
  return p;
}

function send(msg: object): void {
  try {
    connect().postMessage(msg);
  } catch {
    // Reconnect once if the port went away between calls.
    port = null;
    try {
      connect().postMessage(msg);
    } catch {
      /* extension context gone; drop silently */
    }
  }
}

// Page -> background. Only accept well-formed request messages addressed to us
// and originating from this same window.
window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window) return;
  const d = e.data as Partial<RequestMessage> | undefined;
  if (!d || d.target !== TO_CONTENT) return;
  if (typeof d.method !== "string" || typeof d.id !== "string" || typeof d.channel !== "string") return;

  send({
    kind: "request",
    id: d.id,
    channel: d.channel,
    origin: ORIGIN,
    method: d.method,
    params: Array.isArray(d.params) ? d.params : [],
  });
});

// Establish the port up front so the page can receive events without first
// having made a request.
connect();
