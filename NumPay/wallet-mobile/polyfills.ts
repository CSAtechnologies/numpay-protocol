// Runtime polyfills + core env injection. MUST be the first import of the app
// entry (index.ts): @numpay/core reads globalThis.__NUMPAY_ENV__ at module
// evaluation time, and ethers/@noble/@solana need crypto.getRandomValues and
// Buffer before their modules load.

import "react-native-get-random-values";
import { Buffer } from "buffer";

/* eslint-disable @typescript-eslint/no-explicit-any */
const g = globalThis as any;

if (typeof g.Buffer === "undefined") g.Buffer = Buffer;
// RN provides a minimal global process; fill it in if absent (release builds).
if (typeof g.process === "undefined") g.process = require("process");
if (!g.process.env) g.process.env = {};

// Mobile ships proxy-only: NO provider keys, ever (plan section on key
// hygiene). Core's RPC tables fall back to keyless public endpoints when the
// keys are empty, and price/token reads route through the wallet API proxy.
g.__NUMPAY_ENV__ = {
  API_BASE: "https://numpay-wallet-api.numpay.workers.dev",
};

export {};
