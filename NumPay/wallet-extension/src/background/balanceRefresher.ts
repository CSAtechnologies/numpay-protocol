// Background balance refresher.
//
// The popup's data engine only runs while the popup is open, so without this
// the caches it paints from are "whenever you last opened the wallet" old. A
// chrome.alarms tick (1 min) wakes this worker to re-fetch balances into the
// SAME storage caches the popup's boot preload reads — so opening the popup
// lands on data at most ~1-2 minutes old, and the stale-while-revalidate
// refresh only has to close a small gap. This is the structural piece that
// makes the wallet feel like MetaMask/Phantom, whose controllers live in the
// background.
//
// Security posture: reads ONLY the watch-address registry (public receive
// addresses) and writes balance caches. Never touches chrome.storage.session,
// key material, or the vault — it runs the same whether locked or unlocked.
//
// Quota discipline:
// - Skips entirely while a popup port is connected (the popup polls itself).
// - Native sweeps (cheap single RPC calls) run when their cache is >50s old.
// - The indexer-backed token sweep (Moralis/GoldRush free tiers) only runs
//   when its cache is >12 min old.
// - fetchRates has its own 15-min cache and is effectively free here.

import { sweepEvmNativeBalances, EVM_CACHE_PFX, NONEVMCACHE_PFX, type ChainBalance } from "../lib/balanceSweep";
import {
  fetchNonEvmBalancesByAddress, fetchSolanaTokens, fetchTronTokens, fetchSuiTokens,
  type NonEvmAddressMap, type NonEvmChain,
} from "../lib/chains";
import { sweepAllChainTokens, AUTOTOK_CACHE_PFX } from "../lib/autoTokens";
import { fetchRates } from "../lib/currency";
import { getCustomChains } from "../lib/customChains";
import { getWatchAddresses } from "../lib/watchAddresses";
import { getItem, setItem } from "../lib/storage";
import type { Network } from "../lib/networks";

const ALARM_NAME = "numpay-balance-refresh";
const NATIVE_STALE_MS = 50_000;        // just under the 1-min alarm period
const TOKEN_SWEEP_STALE_MS = 12 * 60_000;

let popupPorts = 0;
let running = false;

/** index.ts reports popup ports so the refresher can yield to the live popup. */
export function noteBalancePopupPort(port: chrome.runtime.Port): void {
  popupPorts++;
  port.onDisconnect.addListener(() => { popupPorts = Math.max(0, popupPorts - 1); });
}

/** True while a popup is connected (wsWatch defers fetching to it then). */
export function hasPopupOpen(): boolean {
  return popupPorts > 0;
}

// Event-driven entry points for the incoming-funds watcher: same sweeps, but
// bypassing the staleness gates — a WS event IS the evidence they are stale.
export async function forceRefreshEvm(evmAddress: string): Promise<void> {
  return refreshEvm(evmAddress, true);
}
export async function forceRefreshNonEvm(evmAddress: string, addrs: NonEvmAddressMap): Promise<void> {
  return refreshNonEvm(evmAddress, addrs, true);
}

async function cacheTs(key: string): Promise<number> {
  try {
    const raw = await getItem(key);
    if (!raw) return 0;
    const ts = JSON.parse(raw)?.ts;
    return typeof ts === "number" ? ts : 0;
  } catch {
    return 0;
  }
}

async function refreshEvm(evmAddress: string, force = false): Promise<void> {
  const cacheKey = EVM_CACHE_PFX + evmAddress;
  const age = Date.now() - (await cacheTs(cacheKey));
  if (!force && age < NATIVE_STALE_MS) return;

  // Last-known balances so a failed RPC keeps its row (same rule as the popup).
  const prevByChain = new Map<string, ChainBalance>();
  let hasCache = false;
  try {
    const raw = await getItem(cacheKey);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.chainBalances)) {
        for (const cb of parsed.chainBalances as ChainBalance[]) prevByChain.set(cb.networkId, cb);
        hasCache = true;
      }
    }
  } catch {}

  const customChainList = await getCustomChains().catch(() => []);
  const customNetMap: Record<string, Network> = {};
  for (const cc of customChainList) {
    customNetMap[cc.id] = {
      id: cc.id, name: cc.name, chainId: cc.chainId,
      rpcUrl: cc.rpcUrl, symbol: cc.symbol, decimals: cc.decimals,
      explorer: cc.explorer, logo: cc.logo || "",
    };
  }

  const { results, portfolioUsd, anySuccess } =
    await sweepEvmNativeBalances(evmAddress, customNetMap, prevByChain);

  // Never overwrite a good cache with an all-failed (offline) sweep.
  if (anySuccess || !hasCache) {
    await setItem(cacheKey, JSON.stringify({ ts: Date.now(), chainBalances: results, portfolioUsd }));
  }
}

async function refreshNonEvm(evmAddress: string, addrs: NonEvmAddressMap, force = false): Promise<void> {
  const cacheKey = NONEVMCACHE_PFX + evmAddress;
  const age = Date.now() - (await cacheTs(cacheKey));
  if (!force && age < NATIVE_STALE_MS) return;

  // Last-known tokens + chain rows, kept when a fetch fails (same rule as the
  // popup); the chain rows feed fetchNonEvmBalancesByAddress' retention so a
  // rate-limited RPC never writes a zeroed native balance into the cache.
  let prevSol: unknown[] = [], prevTrx: unknown[] = [], prevSui: unknown[] = [];
  let prevChains: NonEvmChain[] = [];
  try {
    const raw = await getItem(cacheKey);
    if (raw) {
      const p = JSON.parse(raw);
      prevSol = Array.isArray(p.solanaTokens) ? p.solanaTokens : [];
      prevTrx = Array.isArray(p.tronTokens)   ? p.tronTokens   : [];
      prevSui = Array.isArray(p.suiTokens)    ? p.suiTokens    : [];
      if (Array.isArray(p.chains)) prevChains = p.chains;
    }
  } catch {}

  const [chains, splTokens, trc20Tokens, suiCoins] = await Promise.all([
    fetchNonEvmBalancesByAddress(addrs, prevChains),
    fetchSolanaTokens(addrs.solana).catch(() => null),
    fetchTronTokens(addrs.tron).catch(() => null),
    fetchSuiTokens(addrs.sui).catch(() => null),
  ]);

  // null = fetch failed (keep last-known); [] = authoritative empty (clear).
  const sol = splTokens   ?? prevSol;
  const trx = trc20Tokens ?? prevTrx;
  const sui = suiCoins    ?? prevSui;

  await setItem(cacheKey, JSON.stringify({
    ts: Date.now(), chains, solanaTokens: sol, tronTokens: trx, suiTokens: sui,
  }));
}

async function refreshTokenSweep(evmAddress: string): Promise<void> {
  const age = Date.now() - (await cacheTs(AUTOTOK_CACHE_PFX + evmAddress.toLowerCase()));
  if (age < TOKEN_SWEEP_STALE_MS) return;
  // Writes its own cache; the onUpdate stream has no UI to feed here.
  await sweepAllChainTokens(evmAddress, () => {});
}

async function refreshIfStale(): Promise<void> {
  if (popupPorts > 0 || running) return;
  const watch = await getWatchAddresses();
  if (!watch?.evm) return; // no wallet has ever loaded in the popup

  running = true;
  try {
    const jobs: Promise<unknown>[] = [
      refreshEvm(watch.evm),
      refreshTokenSweep(watch.evm),
      fetchRates().catch(() => null), // 15-min internal cache; pre-warms prices
    ];
    if (watch.solana && watch.tron && watch.sui && watch.bitcoin && watch.xrp && watch.litecoin) {
      jobs.push(refreshNonEvm(watch.evm, {
        solana: watch.solana, tron: watch.tron, sui: watch.sui,
        bitcoin: watch.bitcoin, xrp: watch.xrp, litecoin: watch.litecoin,
      }));
    }
    await Promise.allSettled(jobs);
  } finally {
    running = false;
  }
}

export function initBalanceRefresher(): void {
  // periodInMinutes persists across worker suspensions; re-creating with the
  // same name is idempotent.
  chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === ALARM_NAME) void refreshIfStale();
  });
  // Opportunistic run on worker wake (staleness gates make it a no-op when
  // the caches are fresh, e.g. the wake was the popup connecting).
  void refreshIfStale();
}
