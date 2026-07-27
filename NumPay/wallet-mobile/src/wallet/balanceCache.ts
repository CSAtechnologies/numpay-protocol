/**
 * Last-known dashboard snapshot, so opening the wallet paints instantly.
 *
 * The cold-open path used to be strictly serial and entirely blocking:
 *   unlock (Argon2id) -> derive 7 addresses (BIP39 seed + BIP32/SLIP-10, once
 *   per chain) -> fetch rates -> sweep every chain's native balance -> paint.
 * Nothing survived a process kill except the hidden/pinned/custom lists, so
 * every launch redid all of it from scratch behind an empty screen.
 *
 * This snapshot breaks that in two places:
 *   1. the balances paint from cache before any network call, and
 *   2. `addrs` seeds the address cache, so the balance sweep can start WITHOUT
 *      waiting on key derivation.
 *
 * Only PUBLIC data is stored — addresses, balances, prices. No key material,
 * ever. Even so, treat the cached addresses as untrusted until verified: a
 * wrong address here would be shown on the Receive screen. useMobileWallet
 * re-derives in the background and discards the snapshot on any mismatch.
 */
import { getItem, setItem } from "@numpay/core/storage";
import type { AutoToken } from "@numpay/core/autoTokens";
import type { Rates } from "@numpay/core/currency";
import type { NonEvmAddressMap } from "@numpay/core/chains";
import type { AssetRow } from "./useMobileWallet";

/** Bumped when the shape changes; an older snapshot is ignored, not migrated. */
const VERSION = 1;

const keyFor = (walletId: string) => `numpay_balance_cache::${walletId}`;

/** Multi-wallet: a snapshot is only ever read back for the wallet that wrote it. */
export const walletCacheId = (activeWalletId?: string | null) =>
  activeWalletId != null ? String(activeWalletId) : "default";

export interface BalanceSnapshot {
  v: number;
  walletId: string;
  evmAddress: string;
  addrs: NonEvmAddressMap;
  natives: AssetRow[];
  tokensByChain: Record<string, AutoToken[]>;
  customBal: Record<string, string>;
  rates: Rates | null;
  savedAt: number;
}

export async function loadBalanceSnapshot(
  activeWalletId?: string | null,
): Promise<BalanceSnapshot | null> {
  const walletId = walletCacheId(activeWalletId);
  try {
    const raw = await getItem(keyFor(walletId));
    if (!raw) return null;
    const snap = JSON.parse(raw) as BalanceSnapshot;
    // Version and ownership are both hard gates. A snapshot that cannot be
    // proven to belong to THIS wallet is worse than no snapshot at all.
    if (snap?.v !== VERSION) return null;
    if (snap.walletId !== walletId) return null;
    if (!snap.evmAddress || !snap.addrs?.solana) return null;
    return snap;
  } catch {
    return null;
  }
}

export async function saveBalanceSnapshot(
  activeWalletId: string | null | undefined,
  data: Omit<BalanceSnapshot, "v" | "walletId" | "savedAt">,
): Promise<void> {
  const walletId = walletCacheId(activeWalletId);
  try {
    await setItem(keyFor(walletId), JSON.stringify({
      ...data, v: VERSION, walletId, savedAt: Date.now(),
    } satisfies BalanceSnapshot));
  } catch {
    // A cache write must never break a refresh that already succeeded.
  }
}

export async function clearBalanceSnapshot(activeWalletId?: string | null): Promise<void> {
  try { await setItem(keyFor(walletCacheId(activeWalletId)), ""); } catch {}
}
