// Background dApp router. Owns the chrome.runtime ports from content bridges,
// routes EIP-1193 methods, manages the connect-approval handshake, and fans out
// provider events to connected origins. No key material is handled here: connect
// only exposes the active wallet's public address, reads are proxied to our RPC,
// and all signing methods are deferred to a later phase.

import {
  DAPP_PORT,
  MSG_DAPP_DECISION,
  MSG_DAPP_STATE_CHANGED,
  ERR,
  DEFERRED_METHODS,
  type ProviderEventName,
  type PendingConnect,
  type PendingSign,
  type PendingSendTx,
  type PendingSwitchChain,
  type PendingAddChain,
  type DappTxRequest,
  type DappPending,
  type RpcError,
} from "../lib/dapp/types";
import { getPermission, grant, updateAllConnected } from "../lib/dapp/permissions";
import { proxyRead, isReadMethod, evmChainIdHex, evmChainIdNumber } from "../lib/dapp/rpcProxy";
import {
  parseChainId,
  resolveInternalChainId,
  rpcServesChain,
  buildAddChainCandidate,
} from "../lib/dapp/chainOps";
import { setItem } from "../lib/storage";
import { saveCustomChain } from "../lib/customChains";
import { NETWORKS } from "../lib/networks";

const VAULTS_KEY = "numpay_vaults";
const ACTIVE_ID_KEY = "numpay_active_id";
const ACTIVE_CHAIN_KEY = "numpay_active_chain";
const NETWORK_KEY = "numpay_network";
const SESSION_KEY = "numpay_session";
const ACTIVITY_KEY = "numpay_lastActivity";
const AUTO_LOCK_MS = 15 * 60 * 1000;
const PENDING_PFX = "numpay_dapp_pending_";

// origin -> set of live content ports (one per tab/frame on that origin).
const portsByOrigin = new Map<string, Set<chrome.runtime.Port>>();
const originByPort = new WeakMap<chrome.runtime.Port, string>();

// ── Local state helpers (read storage directly; no heavy imports) ──────────────

async function localGet<T = string>(key: string): Promise<T | null> {
  const r = await chrome.storage.local.get(key);
  return (r[key] as T) ?? null;
}

async function sessionGet(key: string): Promise<string | null> {
  const r = await chrome.storage.session.get(key);
  return (r[key] as string) ?? null;
}

async function getActiveChainId(): Promise<string> {
  return (await localGet(ACTIVE_CHAIN_KEY)) ?? "ethereum";
}

// Active wallet's PUBLIC address, read from vault metadata (cleartext). No
// decryption, so this works whether or not the wallet is unlocked.
async function getActiveAccount(): Promise<string | null> {
  const raw = await localGet(VAULTS_KEY);
  if (!raw) return null;
  try {
    const list = JSON.parse(raw) as { wallets: Array<{ id: string; address: string }> };
    if (!list.wallets?.length) return null;
    const activeId = await localGet(ACTIVE_ID_KEY);
    const entry = list.wallets.find((w) => w.id === activeId) ?? list.wallets[0];
    return entry.address || null;
  } catch {
    return null;
  }
}

async function isUnlocked(): Promise<boolean> {
  const sess = await sessionGet(SESSION_KEY);
  if (!sess) return false;
  const last = Number((await sessionGet(ACTIVITY_KEY)) || 0);
  return !!last && Date.now() - last <= AUTO_LOCK_MS;
}

// ── Port registry + emit ───────────────────────────────────────────────────────

function registerPort(port: chrome.runtime.Port, origin: string): void {
  originByPort.set(port, origin);
  let set = portsByOrigin.get(origin);
  if (!set) {
    set = new Set();
    portsByOrigin.set(origin, set);
  }
  set.add(port);
}

function unregisterPort(port: chrome.runtime.Port): void {
  const origin = originByPort.get(port);
  if (!origin) return;
  portsByOrigin.get(origin)?.delete(port);
  originByPort.delete(port);
}

function respondToOrigin(
  origin: string,
  payload: { id: string; channel: string; result?: unknown; error?: unknown }
): void {
  portsByOrigin.get(origin)?.forEach((p) => {
    try {
      p.postMessage(payload);
    } catch {
      /* dead port */
    }
  });
}

function emitToOrigin(origin: string, name: ProviderEventName, data: unknown): void {
  portsByOrigin.get(origin)?.forEach((p) => {
    try {
      p.postMessage({ kind: "event", name, data });
    } catch {
      /* dead port */
    }
  });
}

// ── Address helpers ─────────────────────────────────────────────────────────────

function isHexAddress(s: unknown): s is string {
  return typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
}

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// ── Approval handshake (connect + sign) ─────────────────────────────────────────

async function openApproval(p: DappPending): Promise<void> {
  await chrome.storage.session.set({ [PENDING_PFX + p.requestId]: p });
  const url = chrome.runtime.getURL(`approval.html?requestId=${encodeURIComponent(p.requestId)}`);
  try {
    await chrome.windows.create({ url, type: "popup", width: 380, height: 600 });
  } catch {
    // If the window cannot open, fail the request rather than hang.
    respondToOrigin(p.origin, { id: p.id, channel: p.channel, error: ERR.internal });
    await chrome.storage.session.remove(PENDING_PFX + p.requestId);
  }
}

function newRequestId(): string {
  return (crypto as Crypto).randomUUID?.() ?? Math.random().toString(36).slice(2);
}

// Called when the approval window posts its decision. For "sign" and "sendTx"
// requests the window itself produces the result (the router never touches a
// key or broadcasts), so it passes a result string back here purely to relay:
// a signature for sign, a transaction hash for sendTx.
async function handleDecision(
  requestId: string,
  approved: boolean,
  result?: string
): Promise<void> {
  const key = PENDING_PFX + requestId;
  const p = (await chrome.storage.session.get(key))[key] as DappPending | undefined;
  if (!p) return;
  await chrome.storage.session.remove(key);

  if (!approved) {
    respondToOrigin(p.origin, { id: p.id, channel: p.channel, error: ERR.userRejected });
    return;
  }

  if (p.type === "sign" || p.type === "sendTx") {
    if (typeof result === "string" && result.startsWith("0x")) {
      respondToOrigin(p.origin, { id: p.id, channel: p.channel, result });
    } else {
      // Approved but the window failed to sign/broadcast (e.g. wallet changed,
      // RPC error). Surface a generic internal error rather than hang.
      respondToOrigin(p.origin, { id: p.id, channel: p.channel, error: ERR.internal });
    }
    return;
  }

  if (p.type === "switchChain") {
    // Make the requested chain active wallet-wide, then emit chainChanged to
    // every connected origin. Returns null per EIP-3326.
    await setItem(ACTIVE_CHAIN_KEY, p.targetInternalId);
    await setItem(NETWORK_KEY, p.targetInternalId);
    await broadcastDappState();
    respondToOrigin(p.origin, { id: p.id, channel: p.channel, result: null });
    return;
  }

  if (p.type === "addChain") {
    // The window has just requested the host permission for this RPC origin.
    // Confirm the endpoint actually serves the chain id it claims before saving,
    // so a site cannot register a chain id pointed at an unrelated node.
    const served = await rpcServesChain(p.chain.rpcUrl);
    if (served !== p.chain.chainId) {
      respondToOrigin(p.origin, {
        id: p.id,
        channel: p.channel,
        error: { code: ERR.invalidParams.code, message: `RPC does not serve chain ${p.chain.chainId}` },
      });
      return;
    }
    await saveCustomChain(p.chain);
    respondToOrigin(p.origin, { id: p.id, channel: p.channel, result: null });
    return;
  }

  // connect: re-read live account/chain at approval time (TOCTOU): the user may
  // have switched wallet/network while the approval window was open.
  const account = (await getActiveAccount()) ?? p.account;
  const chainId = evmChainIdNumber(await getActiveChainId());
  await grant(p.origin, account, chainId);
  respondToOrigin(p.origin, { id: p.id, channel: p.channel, result: [account] });
  emitToOrigin(p.origin, "connect", { chainId: "0x" + chainId.toString(16) });
}

// ── Request routing ────────────────────────────────────────────────────────────

async function handleRequest(
  port: chrome.runtime.Port,
  msg: { id: string; channel: string; origin: string; method: string; params: unknown[] }
): Promise<void> {
  const { id, channel, origin, method, params } = msg;
  const reply = (result?: unknown, error?: unknown) =>
    respondToOrigin(origin, { id, channel, result, error });

  try {
    switch (method) {
      case "eth_requestAccounts": {
        const existing = await getPermission(origin);
        if (existing && (await isUnlocked())) {
          reply([existing.account]);
          return;
        }
        const account = await getActiveAccount();
        if (!account) {
          reply(undefined, { code: ERR.internal.code, message: "No wallet set up" });
          return;
        }
        const connectPending: PendingConnect = {
          type: "connect",
          requestId: newRequestId(),
          origin,
          id,
          channel,
          account,
          chainId: evmChainIdNumber(await getActiveChainId()),
        };
        await openApproval(connectPending);
        return; // resolved later by handleDecision
      }

      case "eth_accounts": {
        const perm = await getPermission(origin);
        reply(perm && (await isUnlocked()) ? [perm.account] : []);
        return;
      }

      case "eth_chainId": {
        reply(evmChainIdHex(await getActiveChainId()));
        return;
      }
      case "net_version": {
        reply(String(evmChainIdNumber(await getActiveChainId())));
        return;
      }

      case "personal_sign":
      case "eth_signTypedData_v4": {
        // Signing requires an existing connection. We never expose a key to an
        // origin that has not been through the connect approval.
        const perm = await getPermission(origin);
        if (!perm) {
          reply(undefined, { code: ERR.unauthorized.code, message: "Connect the wallet first" });
          return;
        }

        // Extract + validate the target address and the payload, and bind the
        // signature to the connected account. Under decrypt-only-active we can
        // only sign for the active wallet anyway, so a request for any other
        // address is rejected rather than silently signed by the wrong key.
        let address: string | undefined;
        let payload: string | undefined;

        if (method === "personal_sign") {
          // Spec order is [message, address]; some libs reverse it. Detect the
          // address param and take the other as the message.
          let message: unknown;
          if (isHexAddress(params[1])) { message = params[0]; address = params[1]; }
          else if (isHexAddress(params[0])) { address = params[0]; message = params[1]; }
          else { message = params[0]; }
          if (typeof message !== "string") {
            reply(undefined, ERR.invalidParams);
            return;
          }
          payload = message;
        } else {
          // eth_signTypedData_v4: [address, typedData]
          if (isHexAddress(params[0])) address = params[0];
          const data = params[1];
          payload = typeof data === "string" ? data : data ? JSON.stringify(data) : undefined;
          if (payload === undefined) {
            reply(undefined, ERR.invalidParams);
            return;
          }
        }

        if (!address) {
          reply(undefined, { code: ERR.invalidParams.code, message: "Missing signing address" });
          return;
        }
        if (!eqAddr(address, perm.account)) {
          reply(undefined, {
            code: ERR.unauthorized.code,
            message: "Requested address is not the connected account",
          });
          return;
        }

        const signPending: PendingSign = {
          type: "sign",
          method,
          requestId: newRequestId(),
          origin,
          id,
          channel,
          account: perm.account,
          chainId: evmChainIdNumber(await getActiveChainId()),
          payload,
        };
        await openApproval(signPending);
        return; // resolved later by handleDecision (window signs)
      }

      case "eth_sendTransaction": {
        const perm = await getPermission(origin);
        if (!perm) {
          reply(undefined, { code: ERR.unauthorized.code, message: "Connect the wallet first" });
          return;
        }
        const raw = params[0];
        if (!raw || typeof raw !== "object") {
          reply(undefined, ERR.invalidParams);
          return;
        }
        const tx = raw as DappTxRequest;
        // A transaction must do something: have a recipient or carry calldata
        // (contract deploys without `to` still carry data).
        if (!tx.to && !tx.data) {
          reply(undefined, { code: ERR.invalidParams.code, message: "Transaction has no 'to' or 'data'" });
          return;
        }
        // Bind the sender to the connected account. If the dApp set `from`, it
        // must match; under decrypt-only-active we can only sign for the active
        // wallet anyway.
        if (tx.from && !eqAddr(tx.from, perm.account)) {
          reply(undefined, {
            code: ERR.unauthorized.code,
            message: "Transaction 'from' is not the connected account",
          });
          return;
        }

        const sendPending: PendingSendTx = {
          type: "sendTx",
          requestId: newRequestId(),
          origin,
          id,
          channel,
          account: perm.account,
          chainId: evmChainIdNumber(await getActiveChainId()),
          tx: { ...tx, from: perm.account },
        };
        await openApproval(sendPending);
        return; // resolved later by handleDecision (window signs + broadcasts)
      }

      case "wallet_switchEthereumChain": {
        const target = parseChainId((params[0] as { chainId?: unknown })?.chainId);
        if (!target) {
          reply(undefined, ERR.invalidParams);
          return;
        }
        const internalId = await resolveInternalChainId(target);
        if (!internalId) {
          // EIP-3326: 4902 = chain not added to the wallet.
          reply(undefined, { code: 4902, message: "Unrecognized chain ID. Add it to NumPay first." });
          return;
        }
        if (evmChainIdNumber(await getActiveChainId()) === target) {
          reply(null); // already on this chain: no-op success
          return;
        }
        const net = NETWORKS[internalId];
        const switchPending: PendingSwitchChain = {
          type: "switchChain",
          requestId: newRequestId(),
          origin,
          id,
          channel,
          targetInternalId: internalId,
          chainId: target,
          chainName: net ? net.name : `Chain ${target}`,
        };
        await openApproval(switchPending);
        return;
      }

      case "wallet_addEthereumChain": {
        let candidate;
        try {
          candidate = await buildAddChainCandidate(params[0]);
        } catch (e) {
          reply(undefined, e as RpcError);
          return;
        }
        if (candidate.alreadyExists) {
          reply(null); // already configured: no-op success
          return;
        }
        const addPending: PendingAddChain = {
          type: "addChain",
          requestId: newRequestId(),
          origin,
          id,
          channel,
          chain: candidate.chain,
        };
        await openApproval(addPending);
        return;
      }

      default: {
        if (isReadMethod(method)) {
          const result = await proxyRead(await getActiveChainId(), method, params);
          reply(result);
          return;
        }
        if (DEFERRED_METHODS.has(method)) {
          reply(undefined, {
            code: ERR.unsupportedMethod.code,
            message: `${method} is not supported in this version of NumPay yet`,
          });
          return;
        }
        reply(undefined, ERR.unsupportedMethod);
      }
    }
  } catch (e) {
    const err = e as { code?: number; message?: string };
    reply(undefined, { code: err.code ?? ERR.internal.code, message: err.message ?? "Request failed" });
  }
}

// ── State-change broadcast (wallet/network switch, lock/unlock) ─────────────────

export async function broadcastDappState(): Promise<void> {
  const account = await getActiveAccount();
  const unlocked = await isUnlocked();
  const chainId = evmChainIdNumber(await getActiveChainId());
  const accounts = account && unlocked ? [account] : [];
  if (account) await updateAllConnected(account, chainId);
  for (const origin of portsByOrigin.keys()) {
    emitToOrigin(origin, "accountsChanged", accounts);
    emitToOrigin(origin, "chainChanged", "0x" + chainId.toString(16));
  }
}

// Called from the auto-lock path: connected pages see accountsChanged [].
export function broadcastDappLock(): void {
  for (const origin of portsByOrigin.keys()) {
    emitToOrigin(origin, "accountsChanged", []);
  }
}

// ── Wiring ─────────────────────────────────────────────────────────────────────

export function initDappRouter(): void {
  chrome.runtime.onConnect.addListener((port) => {
    if (port.name !== DAPP_PORT) return;

    port.onMessage.addListener((raw: any) => {
      if (!raw || typeof raw !== "object") return;
      if (raw.kind === "register" && typeof raw.origin === "string") {
        registerPort(port, raw.origin);
      } else if (raw.kind === "request") {
        // Trust ONLY the origin we recorded for this port (or the registered
        // one), never an origin asserted in the message payload.
        const origin = originByPort.get(port) ?? (typeof raw.origin === "string" ? raw.origin : null);
        if (!origin) return;
        if (!originByPort.has(port)) registerPort(port, origin);
        void handleRequest(port, {
          id: String(raw.id),
          channel: String(raw.channel),
          origin,
          method: String(raw.method),
          params: Array.isArray(raw.params) ? raw.params : [],
        });
      }
    });

    port.onDisconnect.addListener(() => unregisterPort(port));
  });

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg?.type === MSG_DAPP_DECISION && typeof msg.requestId === "string") {
      void handleDecision(
        msg.requestId,
        !!msg.approved,
        typeof msg.result === "string" ? msg.result : undefined
      );
    } else if (msg?.type === MSG_DAPP_STATE_CHANGED) {
      void broadcastDappState();
    }
    return false;
  });
}
