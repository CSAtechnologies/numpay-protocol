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
const summaryKeyFor = (walletId: string) => `numpay_portfolio_summary::${walletId}`;

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

interface PortfolioSummary {
  v: 1;
  walletId: string;
  portfolioUsd: number;
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
  const walletId = walletCacheId(activeWalletId);
  try {
    await Promise.all([
      setItem(keyFor(walletId), ""),
      setItem(summaryKeyFor(walletId), ""),
    ]);
  } catch {}
}

/**
 * Persist only the public portfolio total used by the wallet switcher. Keeping
 * this separate from the larger dashboard snapshot lets the active wallet
 * update its switcher row whenever prices or balances move, without rewriting
 * addresses and token metadata a second time.
 */
export async function saveWalletPortfolioSummary(
  activeWalletId: string | null | undefined,
  portfolioUsd: number,
): Promise<void> {
  if (!Number.isFinite(portfolioUsd) || portfolioUsd < 0) return;
  const walletId = walletCacheId(activeWalletId);
  try {
    await setItem(summaryKeyFor(walletId), JSON.stringify({
      v: 1, walletId, portfolioUsd, savedAt: Date.now(),
    } satisfies PortfolioSummary));
  } catch {}
}

/** Last verified total for an inactive wallet; never decrypts or switches it. */
export async function loadWalletPortfolioSummary(
  activeWalletId: string | null | undefined,
): Promise<number | null> {
  const walletId = walletCacheId(activeWalletId);
  try {
    const raw = await getItem(summaryKeyFor(walletId));
    if (raw) {
      const saved = JSON.parse(raw) as PortfolioSummary;
      if (saved?.v === 1 && saved.walletId === walletId &&
          Number.isFinite(saved.portfolioUsd) && saved.portfolioUsd >= 0) {
        return saved.portfolioUsd;
      }
    }
  } catch {}

  // Upgrade fallback: older installs already have per-wallet dashboard
  // snapshots but no small summary record. Their native/token USD values are
  // sufficient for the first switcher opening; the next live refresh writes
  // the exact dashboard total above.
  const snap = await loadBalanceSnapshot(activeWalletId);
  if (!snap) return null;
  const nativeUsd = snap.natives.reduce((sum, row) => sum + (Number.isFinite(row.usdValue) ? row.usdValue : 0), 0);
  const tokenUsd = Object.values(snap.tokensByChain).flat().reduce((sum, token) => {
    const balance = Number(token.balance);
    const price = Number(token.priceUsd ?? 0);
    return sum + (Number.isFinite(balance) && Number.isFinite(price) ? balance * price : 0);
  }, 0);
  const total = nativeUsd + tokenUsd;
  return Number.isFinite(total) && total >= 0 ? total : null;
}
