// WalletConnect transport for NumPay mobile (Reown WalletKit).
//
// Slice 0 scope: bring WalletKit up and pair against a dApp to prove transport.
// NOTHING here signs or auto-approves. Session proposals and per-request signing
// are Slices 2-3 and land in the approval UI, which will subscribe to the
// events wired below and drive approveSession / respondSessionRequest through
// the same gated getUnlockedMnemonic -> getSigner vault path Send/BPAN use.
//
// Coded against the installed @reown/walletkit@1.5.6 type declarations, not the
// scope doc: Core({ projectId }) + WalletKit.init({ core, metadata }), events
// via wk.on("session_proposal" | "session_request" | "session_delete", ...).

import { Core } from "@walletconnect/core";
import { WalletKit, type WalletKitTypes } from "@reown/walletkit";
import { WALLETCONNECT_PROJECT_ID, WC_METADATA, hasProjectId } from "./config";

// `WalletKit` is exported as a const value (a class factory), so its instance
// type must be pulled out with InstanceType rather than used as a type directly.
type WalletKitInstance = InstanceType<typeof WalletKit>;

let wkPromise: Promise<WalletKitInstance> | null = null;
let wk: WalletKitInstance | null = null;

/** Listeners the approval UI registers once WalletKit is up (Slices 2-3). */
export type WcHandlers = {
  onSessionProposal?: (p: WalletKitTypes.SessionProposal) => void;
  onSessionRequest?: (r: WalletKitTypes.SessionRequest) => void;
  onSessionDelete?: (d: WalletKitTypes.SessionDelete) => void;
  /** dApp-side expiry: a sheet for this id is now dead and must dismiss. */
  onProposalExpire?: (e: WalletKitTypes.ProposalExpire) => void;
  onRequestExpire?: (e: WalletKitTypes.SessionRequestExpire) => void;
};

let handlers: WcHandlers = {};

/** Register approval-UI handlers. Safe to call before or after init. */
export function setWcHandlers(next: WcHandlers): void {
  handlers = next;
}

/**
 * Initialise WalletKit once (idempotent). Throws a clear error if the projectId
 * has not been configured yet, so the transport fails loud, never silently.
 */
export function initWalletKit(): Promise<WalletKitInstance> {
  if (wkPromise) return wkPromise;
  if (!hasProjectId()) {
    return Promise.reject(
      new Error(
        "WalletConnect projectId is not set. Add WALLETCONNECT_PROJECT_ID to " +
          "the __NUMPAY_ENV__ block in polyfills.ts (get one free at " +
          "cloud.reown.com).",
      ),
    );
  }

  wkPromise = (async () => {
    const core = new Core({ projectId: WALLETCONNECT_PROJECT_ID });
    const kit = await WalletKit.init({ core, metadata: WC_METADATA });

    // Fan events out to whatever handlers the approval UI has registered. In
    // Slice 0 with no UI these just no-op (or log in dev), which is enough to
    // observe that pairing traffic is arriving.
    kit.on("session_proposal", (proposal) => {
      if (__DEV__) console.log("[wc] session_proposal", proposal.id);
      handlers.onSessionProposal?.(proposal);
    });
    kit.on("session_request", (request) => {
      if (__DEV__) console.log("[wc] session_request", request.id, request.params?.request?.method);
      handlers.onSessionRequest?.(request);
    });
    kit.on("session_delete", (event) => {
      if (__DEV__) console.log("[wc] session_delete", event.topic);
      handlers.onSessionDelete?.(event);
    });
    // WalletConnect requests are time-boxed (~5 min). When one expires before
    // the user decides, the sheet must dismiss itself — answering a dead
    // request errors, and a zombie sheet blocks every later request (observed
    // live: tx sheet left open past expiry).
    kit.on("proposal_expire", (event) => {
      if (__DEV__) console.log("[wc] proposal_expire", event.id);
      handlers.onProposalExpire?.(event);
    });
    kit.on("session_request_expire", (event) => {
      if (__DEV__) console.log("[wc] session_request_expire", event.id);
      handlers.onRequestExpire?.(event);
    });

    wk = kit;
    return kit;
  })();

  return wkPromise;
}

/** The initialised WalletKit instance, or null if init has not resolved yet. */
export function getWalletKit(): WalletKitInstance | null {
  return wk;
}

/**
 * Pair with a dApp from a `wc:` URI (scanned QR in Slice 4, pasted for now).
 * Inits WalletKit on demand. A successful pair triggers a `session_proposal`
 * event; approving it is the approval UI's job, not this call's.
 */
export async function pair(uri: string): Promise<void> {
  const kit = await initWalletKit();
  await kit.pair({ uri });
}

/** Active dApp sessions, keyed by topic (for the sessions list, Slice 2). */
export function getActiveSessions(): ReturnType<WalletKitInstance["getActiveSessions"]> {
  if (!wk) return {};
  return wk.getActiveSessions();
}

/** Disconnect a dApp session by topic (sessions list, Slice 2). */
export async function disconnectSession(topic: string): Promise<void> {
  if (!wk) return;
  await wk.disconnectSession({
    topic,
    reason: { code: 6000, message: "User disconnected." },
  });
}
