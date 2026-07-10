// Fills globalThis.__NUMPAY_ENV__ from Vite's import.meta.env. This module has
// NO imports and must stay that way: it is evaluated via platform/init.ts as
// the first import of every bundle entry, before any @numpay/core module bakes
// these values into module-load-time constants (see @numpay/core/env).

globalThis.__NUMPAY_ENV__ = {
  ALCHEMY_KEY: import.meta.env.VITE_ALCHEMY_KEY ?? "",
  MORALIS_KEY: import.meta.env.VITE_MORALIS_KEY ?? "",
  GOLDRUSH_KEY: import.meta.env.VITE_GOLDRUSH_KEY ?? "",
  HELIUS_KEY: import.meta.env.VITE_HELIUS_KEY ?? "",
  API_BASE: import.meta.env.VITE_API_BASE ?? "",
};

if (import.meta.env.DEV && !import.meta.env.VITE_ALCHEMY_KEY) {
  console.warn("[NumPay] VITE_ALCHEMY_KEY is not set — Alchemy-backed RPCs will fail. Copy .env.example to .env.");
}

export {};
