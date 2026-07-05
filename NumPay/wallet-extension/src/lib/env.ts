// Centralised public client API keys.
//
// These are client-side provider keys (Alchemy, Moralis), not server secrets:
// they ship in the bundle by nature. Keeping them in the gitignored .env (see
// .env.example) instead of hardcoded in source lets us rotate them, restrict
// them by origin in the provider dashboard, and use separate keys per
// environment without code changes. Restore on a fresh clone by copying
// .env.example to .env and pasting the keys.

export const ALCHEMY_KEY = import.meta.env.VITE_ALCHEMY_KEY ?? "";
export const MORALIS_KEY = import.meta.env.VITE_MORALIS_KEY ?? "";
// GoldRush (Covalent) — free-tier held-token + price indexer. Acts as a
// fallback to Moralis so token detection survives one provider's quota.
// Optional: when empty, the GoldRush layer is simply skipped.
export const GOLDRUSH_KEY = import.meta.env.VITE_GOLDRUSH_KEY ?? "";
// Helius — preferred Solana mainnet RPC for balances + token reads. When set it
// replaces the Alchemy Solana endpoint (see src/lib/chains/solana.ts); when
// empty, Solana falls back to Alchemy. Optional, like the others.
export const HELIUS_KEY = import.meta.env.VITE_HELIUS_KEY ?? "";
// NumPay wallet API proxy base URL (see src/lib/walletApi.ts). Empty = call
// providers directly with the keys above (current behavior). When set, price
// (and later token) reads route through the proxy and fall back to the
// direct path on any proxy failure. No trailing slash.
export const API_BASE = (import.meta.env.VITE_API_BASE ?? "").replace(/\/+$/, "");

if (import.meta.env.DEV && !ALCHEMY_KEY) {
  console.warn("[NumPay] VITE_ALCHEMY_KEY is not set — Alchemy-backed RPCs will fail. Copy .env.example to .env.");
}
