// The receive watcher's runner (push scope doc, Option A: local notifications,
// no backend). Runs headless from the background-fetch task: reads the CACHED
// public addresses (never key material — the vault stays locked), sweeps
// native balances with the same core primitives the dashboard uses, diffs
// against the stored snapshot (receiveDiff.ts rules), and fires a local
// notification on growth. Per the user's privacy decision the notification is
// BARE — no amount, no chain — details live behind the unlock.

import * as Notifications from "expo-notifications";
import { sweepEvmNativeBalances } from "@numpay/core/balanceSweep";
import {
  fetchNonEvmBalancesByAddress,
  type NonEvmAddressMap,
} from "@numpay/core/chains";
import { getItem, setItem } from "@numpay/core/storage";
import { computeReceiveDiff } from "./receiveDiff";

const ADDRS_KEY = "numpay_notify_addrs";      // public addresses only
const SNAPSHOT_KEY = "numpay_notify_snapshot"; // chainId -> native balance

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
  await setItem(ADDRS_KEY, "");
  await setItem(SNAPSHOT_KEY, "");
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

/**
 * One watcher pass. Returns true when a notification was shown. Never throws:
 * the background scheduler treats exceptions as task failures and may back off.
 */
export async function runReceiveCheck(): Promise<boolean> {
  try {
    const cached = await loadJson<CachedAddrs>(ADDRS_KEY);
    if (!cached?.evm) return false; // no wallet yet (or wiped)

    const [evmSweep, nonEvm] = await Promise.all([
      sweepEvmNativeBalances(cached.evm, {}, new Map()),
      fetchNonEvmBalancesByAddress(cached.nonEvm),
    ]);

    // Failed EVM chains are simply absent from results (no prev passed), so
    // they never enter the readings. Failed non-EVM reads surface as 0 and are
    // neutralised by the diff's conservative zero rule.
    const readings: Record<string, number> = {};
    for (const row of evmSweep.results) readings[row.networkId] = row.balanceNum;
    for (const row of nonEvm) readings[row.id] = row.balance;

    const prev = await loadJson<Record<string, number>>(SNAPSHOT_KEY);
    const { increased, nextSnapshot } = computeReceiveDiff(prev, readings);
    await setItem(SNAPSHOT_KEY, JSON.stringify(nextSnapshot));

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
