// The receive watcher's runner (push scope doc, Option A: local notifications,
// no backend). Runs headless from the background-fetch task: reads the CACHED
// public addresses (never key material — the vault stays locked), sweeps
// native AND token balances with the same core primitives the dashboard uses,
// diffs against the stored snapshot (receiveDiff.ts rules), and fires a local
// notification on growth. Per the user's privacy decision the notification is
// BARE — no amount, no chain — details live behind the unlock.

import * as Notifications from "expo-notifications";
import { sweepEvmNativeBalances } from "@numpay/core/balanceSweep";
import {
  fetchNonEvmBalancesByAddress,
  fetchSolanaTokens,
  fetchTronTokens,
  fetchSuiTokens,
  type NonEvmAddressMap,
} from "@numpay/core/chains";
import { sweepAllChainTokens, type AutoToken } from "@numpay/core/autoTokens";
import { getItem, setItem } from "@numpay/core/storage";
import { computeReceiveDiff } from "./receiveDiff";

const ADDRS_KEY = "numpay_notify_addrs";      // public addresses only
const LEGACY_SNAPSHOT_KEY = "numpay_notify_snapshot";
const SNAPSHOT_VERSION = 2;
// Leave headroom inside the short background-execution window used by mobile
// operating systems. EVM discovery streams partial results as providers land.
const TOKEN_SWEEP_TIMEOUT_MS = 25_000;

interface ReceiveSnapshotV2 {
  v: typeof SNAPSHOT_VERSION;
  readings: Record<string, number>;
}

const snapshotKey = (evm: string) =>
  `${LEGACY_SNAPSHOT_KEY}:${evm.toLowerCase()}`;

function isSnapshotV2(
  value: ReceiveSnapshotV2 | Record<string, number> | null,
): value is ReceiveSnapshotV2 {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ReceiveSnapshotV2>;
  return candidate.v === SNAPSHOT_VERSION &&
    !!candidate.readings && typeof candidate.readings === "object";
}

interface CachedAddrs {
  evm: string;
  nonEvm: NonEvmAddressMap;
}

/**
 * Persist the wallet's PUBLIC addresses so the headless task can sweep without
 * unlocking anything. Called by useMobileWallet right after derivation.
 */
export async function savePublicAddresses(evm: string, nonEvm: NonEvmAddressMap): Promise<void> {
  await setItem(ADDRS_KEY, JSON.stringify({ evm, nonEvm } satisfies CachedAddrs));
}

/** Wipe-vault hygiene: forget the addresses and the balance snapshot. */
export async function clearReceiveWatch(): Promise<void> {
  const cached = await loadJson<CachedAddrs>(ADDRS_KEY);
  await setItem(ADDRS_KEY, "");
  await setItem(LEGACY_SNAPSHOT_KEY, "");
  if (cached?.evm) await setItem(snapshotKey(cached.evm), "");
}

async function loadJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await getItem(key);
    if (!raw) return null;
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

const tokenKey = (chainId: string, address: string) =>
  `token:${chainId}:${address.toLowerCase()}`;

function addTokenReadings(
  readings: Record<string, number>,
  chainId: string,
  tokens: ReadonlyArray<Pick<AutoToken, "address" | "balance">>,
): void {
  for (const token of tokens) {
    const balance = Number(token.balance);
    if (Number.isFinite(balance) && balance >= 0) {
      readings[tokenKey(chainId, token.address)] = balance;
    }
  }
}

/**
 * Collect held-token balances using the same discovery paths as the dashboard.
 * Partial results are useful and safe: missing readings never erase the prior
 * snapshot, so an unavailable provider cannot manufacture a receive event.
 */
async function fetchTokenReadings(
  evm: string,
  nonEvm: NonEvmAddressMap,
): Promise<Record<string, number>> {
  const readings: Record<string, number> = {};
  const work = Promise.all([
    sweepAllChainTokens(evm, (chainId, tokens) => {
      addTokenReadings(readings, chainId, tokens);
    }, true),
    (async () => {
      const [solana, tron, sui] = await Promise.all([
        fetchSolanaTokens(nonEvm.solana).catch(() => null),
        fetchTronTokens(nonEvm.tron).catch(() => null),
        fetchSuiTokens(nonEvm.sui).catch(() => null),
      ]);
      if (solana) addTokenReadings(readings, "solana", solana);
      if (tron) addTokenReadings(readings, "tron", tron);
      if (sui) addTokenReadings(readings, "sui", sui);
    })(),
  ]);

  // Background-fetch windows are finite. Return any progressive EVM results
  // already collected instead of letting a single provider hold the task open.
  await new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, TOKEN_SWEEP_TIMEOUT_MS);
    void work
      .catch(() => { /* partial readings remain valid */ })
      .finally(() => {
        clearTimeout(timer);
        resolve();
      });
  });
  return readings;
}

/**
 * One watcher pass. Returns true when a notification was shown. Never throws:
 * the background scheduler treats exceptions as task failures and may back off.
 */
export async function runReceiveCheck(): Promise<boolean> {
  try {
    const cached = await loadJson<CachedAddrs>(ADDRS_KEY);
    if (!cached?.evm) return false; // no wallet yet (or wiped)

    const [evmSweep, nonEvm, tokenReadings] = await Promise.all([
      sweepEvmNativeBalances(cached.evm, {}, new Map()),
      fetchNonEvmBalancesByAddress(cached.nonEvm),
      fetchTokenReadings(cached.evm, cached.nonEvm),
    ]);

    // Failed EVM chains are simply absent from results (no prev passed), so
    // they never enter the readings. Failed non-EVM reads surface as 0 and are
    // neutralised by the diff's conservative zero rule.
    const readings: Record<string, number> = {};
    for (const row of evmSweep.results) readings[row.networkId] = row.balanceNum;
    for (const row of nonEvm) readings[row.id] = row.balance;
    Object.assign(readings, tokenReadings);

    const scopedKey = snapshotKey(cached.evm);
    const scoped = await loadJson<ReceiveSnapshotV2 | Record<string, number>>(scopedKey);
    const legacy = scoped ? null : await loadJson<Record<string, number>>(LEGACY_SNAPSHOT_KEY);
    const stored = scoped ?? legacy;
    const isV2 = isSnapshotV2(stored);
    // Legacy snapshots contain native balances only. Migrate by taking one
    // silent full baseline, otherwise an upgrade would announce every token the
    // wallet already owned as a new deposit.
    const prev = isV2 ? stored.readings : null;
    const { increased, nextSnapshot } = computeReceiveDiff(prev, readings, {
      notifyFirstSeen: isV2,
    });
    await setItem(scopedKey, JSON.stringify({
      v: SNAPSHOT_VERSION,
      readings: nextSnapshot,
    } satisfies ReceiveSnapshotV2));

    if (increased.length === 0) return false;

    // Bare text by decision: nothing about amounts or chains on the lock screen.
    await Notifications.scheduleNotificationAsync({
      content: { title: "NumPay", body: "Balance updated" },
      trigger: null,
    });
    return true;
  } catch {
    return false;
  }
}
