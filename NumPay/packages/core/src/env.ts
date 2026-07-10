// Centralised public client API keys, injected by the platform.
//
// These are client-side provider keys (Alchemy, Moralis), not server secrets:
// they ship in the bundle by nature. Each platform sets
// globalThis.__NUMPAY_ENV__ BEFORE any core module evaluates — it must be the
// very first import of every bundle entry — because RPC URL tables
// (networks.ts, chains/solana.ts) bake these values into module-load-time
// constants. The extension fills it from import.meta.env (see
// wallet-extension/src/platform/env.ts); mobile fills it from its own config.

export interface NumpayEnv {
  ALCHEMY_KEY?: string;
  MORALIS_KEY?: string;
  GOLDRUSH_KEY?: string;
  HELIUS_KEY?: string;
  API_BASE?: string;
}

declare global {
  // eslint-disable-next-line no-var
  var __NUMPAY_ENV__: NumpayEnv | undefined;
}

const env: NumpayEnv = globalThis.__NUMPAY_ENV__ ?? {};

export const ALCHEMY_KEY = env.ALCHEMY_KEY ?? "";
export const MORALIS_KEY = env.MORALIS_KEY ?? "";
// GoldRush (Covalent) — free-tier held-token + price indexer. Acts as a
// fallback to Moralis so token detection survives one provider's quota.
// Optional: when empty, the GoldRush layer is simply skipped.
export const GOLDRUSH_KEY = env.GOLDRUSH_KEY ?? "";
// Helius — preferred Solana mainnet RPC for balances + token reads. When set it
// replaces the Alchemy Solana endpoint (see chains/solana.ts); when empty,
// Solana falls back to Alchemy. Optional, like the others.
export const HELIUS_KEY = env.HELIUS_KEY ?? "";
// NumPay wallet API proxy base URL (see walletApi.ts). Empty = call providers
// directly with the keys above. When set, price (and later token) reads route
// through the proxy and fall back to the direct path on any proxy failure.
// No trailing slash.
export const API_BASE = (env.API_BASE ?? "").replace(/\/+$/, "");
