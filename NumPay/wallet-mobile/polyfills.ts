// Runtime polyfills + core env injection. MUST be the first import of the app
// entry (index.ts): @numpay/core reads globalThis.__NUMPAY_ENV__ at module
// evaluation time, and ethers/@noble/@solana need crypto.getRandomValues and
// Buffer before their modules load.

import "react-native-get-random-values";
// TextEncoder/TextDecoder for WalletConnect (Reown WalletKit) crypto. Hermes'
// built-ins are incomplete for its use; fast-text-encoding is the SDK's own
// recommended polyfill.
import "fast-text-encoding";
import { Buffer } from "buffer";

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;

if (typeof g.Buffer === "undefined") g.Buffer = Buffer;
// RN provides a minimal global process; fill it in if absent (release builds).
if (typeof g.process === "undefined") g.process = require("process");
if (!g.process.env) g.process.env = {};

// Hermes' Intl has no PluralRules; @mysten/sui constructs one at module scope
// (client/utils.mjs, only to format "1st/2nd/3rd" in Move abort messages).
// Minimal en-US shim: cardinal "one/other", ordinal "one/two/few/other".
if (typeof g.Intl === "undefined") g.Intl = {};
if (typeof g.Intl.PluralRules === "undefined") {
  g.Intl.PluralRules = class PluralRules {
    private readonly ordinal: boolean;
    constructor(_locales?: unknown, options?: { type?: string }) {
      this.ordinal = options?.type === "ordinal";
    }
    select(n: number): string {
      if (!this.ordinal) return n === 1 ? "one" : "other";
      const mod10 = Math.abs(n) % 10;
      const mod100 = Math.abs(n) % 100;
      if (mod10 === 1 && mod100 !== 11) return "one";
      if (mod10 === 2 && mod100 !== 12) return "two";
      if (mod10 === 3 && mod100 !== 13) return "few";
      return "other";
    }
  };
}

// Mobile ships proxy-only: NO provider keys, ever (plan section on key
// hygiene). Core's RPC tables fall back to keyless public endpoints when the
// keys are empty, and price/token reads route through the wallet API proxy.
g.__NUMPAY_ENV__ = {
  API_BASE: "https://numpay-wallet-api.numpay.workers.dev",
  // WalletConnect (Reown) projectId: a PUBLIC client id, not a provider secret.
  // Get one free at cloud.reown.com and paste it here. Empty = WalletConnect
  // transport stays disabled and fails loud with a clear message (see
  // src/walletconnect/client.ts).
  WALLETCONNECT_PROJECT_ID: "aab075734c7a1dd54fcecd98fe5bbdc7",
};

export {};
