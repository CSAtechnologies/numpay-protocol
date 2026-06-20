// NumPay injected Solana provider. Runs in the page MAIN world alongside the EVM
// provider. Holds NO key material and does NO signing; it forwards requests to
// the content bridge (which forwards to the background router) and relays events
// back. Two discovery surfaces share one transport:
//   1. window.solana  — the legacy Phantom-style provider object.
//   2. Wallet Standard — what @solana/wallet-adapter discovers. Registered via
//      the wallet-standard:register-wallet / app-ready events.
// P1 is connect-only; signing features (solana:signMessage / signTransaction /
// signAndSendTransaction) are added in later phases.

import bs58 from "bs58";
import { TO_CONTENT, TO_INPAGE, SOL_METHODS, SOL_EVENTS, SOL_CLUSTER } from "../lib/dapp/types";

type Listener = (...args: unknown[]) => void;

// ── Shared transport (page -> content bridge -> background) ──────────────────────

const channel = (crypto as Crypto).randomUUID?.() ?? Math.random().toString(36).slice(2);
const pending = new Map<string, { resolve: (v: any) => void; reject: (e: unknown) => void }>();

function request(method: string, params: unknown[] = []): Promise<any> {
  const id = (crypto as Crypto).randomUUID?.() ?? Math.random().toString(36).slice(2);
  return new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject });
    window.postMessage({ target: TO_CONTENT, channel, id, method, params }, window.location.origin);
  });
}

window.addEventListener("message", (e: MessageEvent) => {
  if (e.source !== window) return;
  const d = e.data as any;
  if (!d || d.target !== TO_INPAGE) return;
  if (d.kind === "response") {
    if (d.channel !== channel) return; // not ours (e.g. the EVM provider's channel)
    const p = pending.get(d.id);
    if (!p) return;
    pending.delete(d.id);
    if (d.error) p.reject(d.error);
    else p.resolve(d.result);
  } else if (d.kind === "event") {
    handleEvent(String(d.name), d.data);
  }
});

// ── PublicKey-like shim (dApps call .toString()/.toBytes()/.toBase58()) ──────────

interface PublicKeyLike {
  toString(): string;
  toBase58(): string;
  toBytes(): Uint8Array;
  toBuffer(): Uint8Array;
  equals(other: { toString(): string }): boolean;
}

function makePublicKey(base58: string): PublicKeyLike {
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(base58);
  } catch {
    bytes = new Uint8Array(32);
  }
  return {
    toString: () => base58,
    toBase58: () => base58,
    toBytes: () => bytes,
    toBuffer: () => bytes,
    equals: (other) => !!other && other.toString() === base58,
  };
}

// ── Wallet Standard account ──────────────────────────────────────────────────────

interface WalletAccount {
  address: string;
  publicKey: Uint8Array;
  chains: readonly string[];
  features: readonly string[];
  label?: string;
}

function makeAccount(base58: string): WalletAccount {
  return {
    address: base58,
    publicKey: makePublicKey(base58).toBytes(),
    chains: [SOL_CLUSTER],
    features: [], // P1: no signing features yet
    label: "NumPay",
  };
}

// ── Shared connection state ──────────────────────────────────────────────────────

const legacyListeners = new Map<string, Set<Listener>>();
const standardListeners = new Map<string, Set<Listener>>(); // wallet-standard "change" etc.

let currentBase58: string | null = null;

function legacyEmit(event: string, ...args: unknown[]): void {
  legacyListeners.get(event)?.forEach((cb) => {
    try { cb(...args); } catch { /* a faulty dApp listener must not break others */ }
  });
}

function standardEmit(event: string, payload: unknown): void {
  standardListeners.get(event)?.forEach((cb) => {
    try { cb(payload); } catch { /* ignore */ }
  });
}

// Apply a new connection state and notify both surfaces.
function setAccount(base58: string | null): void {
  const changed = base58 !== currentBase58;
  currentBase58 = base58;

  // Legacy window.solana
  solana.publicKey = base58 ? makePublicKey(base58) : null;
  solana.isConnected = !!base58;

  // Wallet Standard accounts array
  wallet.accounts = base58 ? [makeAccount(base58)] : [];

  if (changed) standardEmit("change", { accounts: wallet.accounts });
}

function handleEvent(name: string, data: any): void {
  switch (name) {
    case SOL_EVENTS.connect: {
      const pk = data?.publicKey as string | undefined;
      if (pk) {
        setAccount(pk);
        legacyEmit("connect", solana.publicKey);
      }
      break;
    }
    case SOL_EVENTS.accountChanged: {
      const pk = (data?.publicKey as string | undefined) ?? null;
      setAccount(pk);
      legacyEmit("accountChanged", solana.publicKey);
      if (!pk) legacyEmit("disconnect");
      break;
    }
    case SOL_EVENTS.disconnect: {
      setAccount(null);
      legacyEmit("disconnect");
      break;
    }
    // Any non-Solana event name (the EVM provider's events) is ignored here.
  }
}

// ── Legacy window.solana provider ────────────────────────────────────────────────

interface SolanaProvider {
  isNumPay: boolean;
  isConnected: boolean;
  publicKey: PublicKeyLike | null;
  connect(opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKeyLike }>;
  disconnect(): Promise<void>;
  on(event: string, cb: Listener): SolanaProvider;
  off(event: string, cb: Listener): SolanaProvider;
  removeListener(event: string, cb: Listener): SolanaProvider;
}

const solana: SolanaProvider = {
  isNumPay: true,
  // Intentionally NOT isPhantom: we never impersonate another wallet.
  isConnected: false,
  publicKey: null,

  connect: async (opts?: { onlyIfTrusted?: boolean }): Promise<{ publicKey: PublicKeyLike }> => {
    const onlyIfTrusted = !!opts?.onlyIfTrusted;
    const method = onlyIfTrusted ? SOL_METHODS.accounts : SOL_METHODS.connect;
    const res = await request(method, [{ onlyIfTrusted }]);
    const pk = res?.publicKey as string | undefined;
    if (!pk) throw { code: 4001, message: "User rejected the request" };
    setAccount(pk);
    legacyEmit("connect", solana.publicKey);
    return { publicKey: solana.publicKey as PublicKeyLike };
  },

  disconnect: async (): Promise<void> => {
    try { await request(SOL_METHODS.disconnect, []); } catch { /* settle regardless */ }
    setAccount(null);
    legacyEmit("disconnect");
  },

  on: (event: string, cb: Listener): SolanaProvider => {
    if (!legacyListeners.has(event)) legacyListeners.set(event, new Set());
    legacyListeners.get(event)!.add(cb);
    return solana;
  },
  off: (event: string, cb: Listener): SolanaProvider => {
    legacyListeners.get(event)?.delete(cb);
    return solana;
  },
  removeListener: (event: string, cb: Listener): SolanaProvider => {
    legacyListeners.get(event)?.delete(cb);
    return solana;
  },
};

// ── Wallet Standard wallet ───────────────────────────────────────────────────────

const ICON =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="0 0 96 96">' +
      '<rect width="96" height="96" rx="22" fill="#6d28d9"/>' +
      '<path d="M30 68V28h7l22 27V28h7v40h-7L37 41v27z" fill="#fff"/></svg>'
  );

async function standardConnect(input?: { silent?: boolean }): Promise<{ accounts: readonly WalletAccount[] }> {
  if (input?.silent) {
    const res = await request(SOL_METHODS.accounts, [{ onlyIfTrusted: true }]);
    setAccount((res?.publicKey as string | undefined) ?? null);
    return { accounts: wallet.accounts };
  }
  const res = await request(SOL_METHODS.connect, [{ onlyIfTrusted: false }]);
  const pk = res?.publicKey as string | undefined;
  if (!pk) throw { code: 4001, message: "User rejected the request" };
  setAccount(pk);
  legacyEmit("connect", solana.publicKey);
  return { accounts: wallet.accounts };
}

async function standardDisconnect(): Promise<void> {
  try { await request(SOL_METHODS.disconnect, []); } catch { /* settle regardless */ }
  setAccount(null);
  legacyEmit("disconnect");
}

function standardOn(event: string, listener: Listener): () => void {
  if (!standardListeners.has(event)) standardListeners.set(event, new Set());
  standardListeners.get(event)!.add(listener);
  return () => standardListeners.get(event)?.delete(listener);
}

const wallet = {
  version: "1.0.0",
  name: "NumPay",
  icon: ICON,
  chains: [SOL_CLUSTER] as readonly string[],
  features: {
    "standard:connect": { version: "1.0.0", connect: standardConnect },
    "standard:disconnect": { version: "1.0.0", disconnect: standardDisconnect },
    "standard:events": { version: "1.0.0", on: standardOn },
  } as Record<string, unknown>,
  accounts: [] as readonly WalletAccount[],
};

// ── Inject + register ─────────────────────────────────────────────────────────────

// Legacy window.solana: only claim it if no other wallet has.
try {
  if (!(window as any).solana) {
    Object.defineProperty(window, "solana", { value: solana, configurable: true, writable: false });
  }
} catch {
  /* another provider locked it; Wallet Standard still works */
}

// Wallet Standard registration handshake.
function registerWallet(): void {
  try {
    window.dispatchEvent(
      new CustomEvent("wallet-standard:register-wallet", {
        detail: (api: { register: (w: unknown) => void }) => api.register(wallet),
      })
    );
  } catch {
    /* ignore */
  }
}
window.addEventListener("wallet-standard:app-ready", (e: Event) => {
  try {
    (e as CustomEvent).detail?.register?.(wallet);
  } catch {
    /* ignore */
  }
});
registerWallet();
