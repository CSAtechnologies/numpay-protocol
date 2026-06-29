// NumPay injected EIP-1193 provider. Runs in the page MAIN world. Holds NO key
// material and does NO signing; it only forwards requests to the content bridge
// (which forwards to the background router) and relays provider events back to
// the page. Discovery is via EIP-6963; window.ethereum is set only if nothing
// else claimed it, and we never pretend to be MetaMask.

import {
  TO_CONTENT,
  TO_INPAGE,
  type RequestMessage,
  type ResponseMessage,
  type EventMessage,
  type ProviderEventName,
} from "../lib/dapp/types";

type Listener = (...args: unknown[]) => void;

interface RequestArgs {
  method: string;
  params?: unknown[];
}

class NumPayProvider {
  public readonly isNumPay = true;
  // Intentionally NOT isMetaMask. We never impersonate another wallet.
  public chainId: string | null = null;
  public selectedAddress: string | null = null;

  private readonly channel =
    (crypto as Crypto).randomUUID?.() ?? Math.random().toString(36).slice(2);
  private readonly listeners = new Map<string, Set<Listener>>();
  private readonly pending = new Map<
    string,
    { resolve: (v: unknown) => void; reject: (e: unknown) => void }
  >();
  private connected = false;

  constructor() {
    window.addEventListener("message", this.handleMessage);
  }

  request = (args: RequestArgs): Promise<unknown> => {
    if (!args || typeof args.method !== "string") {
      return Promise.reject({ code: -32602, message: "Invalid request" });
    }
    const id =
      (crypto as Crypto).randomUUID?.() ?? Math.random().toString(36).slice(2);
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const msg: RequestMessage = {
        target: TO_CONTENT,
        channel: this.channel,
        id,
        method: args.method,
        params: Array.isArray(args.params) ? args.params : [],
      };
      window.postMessage(msg, window.location.origin);
    });
  };

  on = (event: string, cb: Listener): this => {
    if (!this.listeners.has(event)) this.listeners.set(event, new Set());
    this.listeners.get(event)!.add(cb);
    return this;
  };

  removeListener = (event: string, cb: Listener): this => {
    this.listeners.get(event)?.delete(cb);
    return this;
  };

  // Legacy convenience some dApps still probe.
  isConnected = (): boolean => this.connected;

  private emit(event: string, ...args: unknown[]): void {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(...args);
      } catch {
        /* a faulty dApp listener must not break others */
      }
    });
  }

  private handleMessage = (e: MessageEvent): void => {
    if (e.source !== window) return;
    const d = e.data as ResponseMessage | EventMessage | undefined;
    if (!d || d.target !== TO_INPAGE) return;

    if (d.kind === "response") {
      if (d.channel !== this.channel) return;
      const p = this.pending.get(d.id);
      if (!p) return;
      this.pending.delete(d.id);
      if (d.error) p.reject(d.error);
      else {
        this.cacheFromResult(d.id, d.result);
        p.resolve(d.result);
      }
    } else if (d.kind === "event") {
      this.handleEvent(d.name, d.data);
    }
  };

  // Keep selectedAddress/chainId fresh from accounts/chain responses.
  private cacheFromResult(_id: string, result: unknown): void {
    if (Array.isArray(result) && (result.length === 0 || typeof result[0] === "string")) {
      const next = (result[0] as string) ?? null;
      if (next !== this.selectedAddress) this.selectedAddress = next;
      if (next && !this.connected) {
        this.connected = true;
        this.emit("connect", { chainId: this.chainId });
      }
    } else if (typeof result === "string" && result.startsWith("0x") && result.length <= 12) {
      // looks like an eth_chainId response
      this.chainId = result;
    }
  }

  private handleEvent(name: ProviderEventName, data: unknown): void {
    switch (name) {
      case "accountsChanged": {
        const accounts = (data as string[]) ?? [];
        this.selectedAddress = accounts[0] ?? null;
        if (accounts.length === 0 && this.connected) {
          this.connected = false;
          this.emit("disconnect", { code: 4900, message: "Disconnected" });
        }
        this.emit("accountsChanged", accounts);
        break;
      }
      case "chainChanged": {
        this.chainId = String(data);
        this.emit("chainChanged", this.chainId);
        break;
      }
      case "connect": {
        this.connected = true;
        this.emit("connect", data);
        break;
      }
      case "disconnect": {
        this.connected = false;
        this.emit("disconnect", data);
        break;
      }
    }
  }
}

// ── Inject + EIP-6963 announce ─────────────────────────────────────────────────

const provider = new NumPayProvider();

// The real NumPay brand mark (rounded tile + N body with its foot bump), traced
// from logo.png, as an inline SVG data URI (no remote fetch), so dApp wallet
// pickers show the logo rather than a drawn glyph.
const ICON =
  "data:image/svg+xml;base64," +
  btoa(
    '<svg xmlns="http://www.w3.org/2000/svg" width="96" height="96" viewBox="6 6 88 88">' +
      '<rect x="6" y="6" width="88" height="88" rx="13.2" fill="#786EE9"/>' +
      '<path fill="#fff" d="M23.22 22.93 L35.14 22.93 L66.37 53.79 L66.56 23.12 L76.4 23.12 L76.4 62.68 L60.88 62.68 L33.63 35.62 L33.44 62.3 L23.22 62.3 Z"/>' +
      '<path fill="#fff" d="M41.39 53.3 L56.72 67.98 L76.4 67.98 L76.4 77.07 L23.22 77.07 L23.22 67.98 L41.39 67.98 Z"/>' +
      "</svg>"
  );

const providerInfo = Object.freeze({
  uuid: (crypto as Crypto).randomUUID?.() ?? Math.random().toString(36).slice(2),
  name: "NumPay",
  icon: ICON,
  rdns: "io.numpay.wallet",
});

function announce(): void {
  window.dispatchEvent(
    new CustomEvent("eip6963:announceProvider", {
      detail: Object.freeze({ info: providerInfo, provider }),
    })
  );
}

window.addEventListener("eip6963:requestProvider", announce);
announce();

// Legacy compatibility: only claim window.ethereum if no other wallet has.
try {
  if (!(window as unknown as { ethereum?: unknown }).ethereum) {
    Object.defineProperty(window, "ethereum", {
      value: provider,
      configurable: true,
      writable: false,
    });
  }
} catch {
  /* another provider locked the property; EIP-6963 still works */
}
