// Popup boot preload.
//
// Everything the first paint depends on lives in extension storage, and the old
// path read it serially inside App/useWallet mount effects: hasWallet, isLocked,
// saved network/chain/filter, custom chains, the decrypted session, vault metas,
// and then — only once the wallet was known — the per-address balance caches.
// Each await is its own chrome.storage round-trip, so cached balances painted
// many round-trips after mount.
//
// This module starts ONE parallel read of all of it at import time (main.tsx
// imports it before anything else), so the data is typically resolved before
// App/useWallet even mount. The session here is a snapshot from popup-open:
// when the popup opened locked it is null, and useWallet re-reads it fresh
// after the unlock flow writes a new session.

import { hasWallet, isLocked, listVaultMeta, getActiveId, SESSION_KEY, type VaultMeta } from "@/lib/wallet";
import { getItem, getSession } from "@/lib/storage";
import { getCustomChains, type CustomChain } from "@/lib/customChains";

// Popup settings keys, owned here; the per-address cache keys live in
// lib/balanceSweep (shared with the background refresher) and are re-exported
// so useWallet keeps a single import site.
import { EVM_CACHE_PFX, NONEVMCACHE_PFX } from "@/lib/balanceSweep";
export { EVM_CACHE_PFX, NONEVMCACHE_PFX };
export const NETWORK_KEY      = "numpay_network";
export const ACTIVE_CHAIN_KEY = "numpay_active_chain";
export const ASSET_FILTER_KEY = "numpay_asset_filter";

export interface BootData {
  walletExists: boolean;
  locked: boolean;
  networkId: string | null;
  activeChainId: string | null;
  assetFilter: string | null;
  customChains: CustomChain[];
  sessionRaw: string | null;
  vaultMetas: VaultMeta[];
  activeId: string | null;
  /** Address the two cache reads below were keyed on (from the session snapshot). */
  cacheAddress: string | null;
  balCacheRaw: string | null;
  nonEvmCacheRaw: string | null;
}

async function load(): Promise<BootData> {
  const [walletExists, locked, networkId, activeChainId, assetFilter, customChains, sessionRaw, vaultMetas, activeId] =
    await Promise.all([
      hasWallet().catch(() => false),
      isLocked().catch(() => true),
      getItem(NETWORK_KEY).catch(() => null),
      getItem(ACTIVE_CHAIN_KEY).catch(() => null),
      getItem(ASSET_FILTER_KEY).catch(() => null),
      getCustomChains().catch(() => [] as CustomChain[]),
      getSession(SESSION_KEY).catch(() => null),
      listVaultMeta().catch(() => [] as VaultMeta[]),
      getActiveId().catch(() => null),
    ]);

  // Derive the active address from the session snapshot so the balance caches
  // are already in hand when useWallet's first refresh runs.
  let cacheAddress: string | null = null;
  if (sessionRaw) {
    try {
      const parsed = JSON.parse(sessionRaw);
      const w = parsed.wallets && parsed.activeId ? parsed.wallets[parsed.activeId] : parsed;
      if (w?.address) cacheAddress = w.address as string;
    } catch {}
  }

  const [balCacheRaw, nonEvmCacheRaw] = cacheAddress
    ? await Promise.all([
        getItem(EVM_CACHE_PFX + cacheAddress).catch(() => null),
        getItem(NONEVMCACHE_PFX + cacheAddress).catch(() => null),
      ])
    : [null, null];

  return {
    walletExists, locked, networkId, activeChainId, assetFilter, customChains,
    sessionRaw, vaultMetas, activeId, cacheAddress, balCacheRaw, nonEvmCacheRaw,
  };
}

export const bootData: Promise<BootData> = load();

// One-shot consumers for the preloaded per-address caches. First call for the
// matching address returns the snapshot; every later call (poll cycles, wallet
// switches) returns null so the caller falls through to a fresh storage read.
let balCacheTaken = false;
export async function takeBootBalanceCache(address: string): Promise<string | null> {
  const b = await bootData;
  if (balCacheTaken || b.cacheAddress !== address) return null;
  balCacheTaken = true;
  return b.balCacheRaw;
}

let nonEvmCacheTaken = false;
export async function takeBootNonEvmCache(address: string): Promise<string | null> {
  const b = await bootData;
  if (nonEvmCacheTaken || b.cacheAddress !== address) return null;
  nonEvmCacheTaken = true;
  return b.nonEvmCacheRaw;
}

// One-shot consumer for the preloaded decrypted-session snapshot. The snapshot
// is frozen at popup-open, so after a wallet switch it is STALE. Only the first
// caller (the initial WalletProvider mount) may use it for an instant paint;
// every later mount (e.g. a re-unlock after auto-lock, when the user may have
// switched wallets earlier in the same popup session) gets null and reads live
// storage instead. This is what stops a navigation/remount from silently
// rewinding to the wallet that was active when the popup first opened.
let sessionTaken = false;
export async function takeBootSession(): Promise<string | null> {
  const b = await bootData;
  if (sessionTaken) return null;
  sessionTaken = true;
  return b.sessionRaw;
}
