// Core platform injection. Each app calls initCorePlatform() once, from a
// module that is the FIRST import of every bundle entry, before using any
// other core module.
//
// NOTE: API keys are NOT injected here. They must be set even earlier — on
// globalThis.__NUMPAY_ENV__ before any core module evaluates — because
// networks.ts and chains/solana.ts bake them into module-load-time constants.
// See env.ts.

import { type KVStore, setStorageBackends } from "./storage";
import { setAssetUrlResolver } from "./icons/assets";

export interface CorePlatform {
  /** Persistent storage (disk). Extension: chrome.storage.local. Mobile: MMKV. */
  storage: KVStore;
  /**
   * Session storage. MUST be RAM-only and cleared on app/browser restart:
   * decrypted wallet material lives here while unlocked. Extension:
   * chrome.storage.session. Mobile: in-memory store.
   */
  session: KVStore;
  /** Turns a packaged asset path (e.g. "chain-logos/base.svg") into a loadable URL. */
  assetUrl?: (packagedPath: string) => string;
}

export function initCorePlatform(p: CorePlatform): void {
  setStorageBackends(p.storage, p.session);
  if (p.assetUrl) setAssetUrlResolver(p.assetUrl);
}
