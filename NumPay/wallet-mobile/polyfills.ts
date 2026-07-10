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

// The spike runs fully offline (derivation + offline signing only), so no
// provider keys. The real app will fill this from its config before core loads.
g.__NUMPAY_ENV__ = {};

export {};
