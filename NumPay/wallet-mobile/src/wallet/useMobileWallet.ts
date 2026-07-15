/**
 * Phase 1 dashboard data: a lean mobile counterpart of the extension's
 * useWallet, calling the same core primitives. Deliberately NOT a port of the
 * extension hook — no boot cache, no balance bus, no dapp notify, no
 * multi-wallet session yet. One unlocked wallet, one refresh path.
 *
 * Data sources (mobile is proxy-only, zero bundled provider keys):
 *  - EVM native balances: core balanceSweep over keyless public RPCs.
 *  - Non-EVM native balances: core chains/* public endpoints, addresses only
 *    (key material is dropped immediately after derivation).
 *  - ERC-20 discovery: core autoTokens -> wallet API proxy (/v1/tokens).
 *  - Fiat rates: core currency -> wallet API proxy (/v1/prices).
 *  - Visibility: core hiddenTokens (per-wallet) + tokenSpam + the dashboard
 *    dust rule (hide sub-$0.01 token rows, same cutoff as the extension).
 *
 * Slice 1 scope: EVM tokens only. SPL/TRC-20/Sui token rows follow with the
 * Send work (they share core fetchers already).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { importFromMnemonic } from "@numpay/core/wallet";
import {
  deriveNonEvmAddresses,
  fetchNonEvmBalancesByAddress,
  fetchSolanaTokens,
  fetchTronTokens,
  fetchSuiTokens,
  type NonEvmAddressMap,
  type NonEvmChain,
} from "@numpay/core/chains";
import { sweepEvmNativeBalances, type ChainBalance } from "@numpay/core/balanceSweep";
import { sweepAllChainTokens, type AutoToken } from "@numpay/core/autoTokens";
import { fetchRates, getUsdPrice, type Rates } from "@numpay/core/currency";
import { loadHiddenTokens, tokenHideKey } from "@numpay/core/hiddenTokens";
import { classifyToken } from "@numpay/core/tokenSpam";
import { chainNameOf } from "@numpay/core/txLog";
import { getOwnedBPANCount, findOwnedBPANs } from "@numpay/core/bpan";
import { getItem, setItem } from "@numpay/core/storage";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import { savePublicAddresses } from "../notify/receiveWatch";

const DUST_USD = 0.01; // same cutoff as the extension dashboard

// Hard ceiling on the busy-guarded refresh phase. Found on-device: a hung
// upstream (no per-call timeout) kept `busy` true for minutes, so the refresh
// fired by the next unlock bailed silently and the dashboard stayed empty.
const REFRESH_TIMEOUT_MS = 45_000;
const DISCOVERY_TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    ),
  ]);
}

export interface AssetRow {
  key: string; // unique per row
  chainId: string;
  chainName: string;
  symbol: string;
  name: string;
  isNative: boolean;
  balanceNum: number;
  usdValue: number;
  logo?: string; // remote URL when the indexer provides one
}

export interface MobileWalletState {
  evmAddress: string;
  nonEvmAddresses: NonEvmAddressMap | null;
  /** First owned BPAN (raw 11 digits), "" when none / not yet known. */
  bpan: string;
  rows: AssetRow[];
  chainIds: string[]; // chains with anything to show, dashboard filter chips
  /** Raw discovered tokens per chain (address/decimals intact) for pickers. */
  tokensByChain: Record<string, AutoToken[]>;
  portfolioUsd: number;
  rates: Rates | null;
  loading: boolean;
  error: string;
  refresh: () => void;
}

// Non-EVM token fetchers return priceUsd only where the source provides it
// (Solana); everywhere else the shared symbol→rate table prices majors like
// USDT/USDC, and the dust rule keeps the rest off (same as the extension).
function tokenRows(
  byChain: Record<string, AutoToken[]>,
  hidden: Set<string>,
  rates: Rates | null
): AssetRow[] {
  const rows: AssetRow[] = [];
  for (const [chainId, tokens] of Object.entries(byChain)) {
    for (const t of tokens) {
      if (hidden.has(tokenHideKey(chainId, t.address))) continue;
      if (classifyToken(t).hidden) continue;
      const bal = parseFloat(t.balance) || 0;
      const price = t.priceUsd ?? (rates ? getUsdPrice(t.symbol, rates) : 0);
      const usd = price * bal;
      if (usd < DUST_USD) continue; // dust rule: unpriced or near-zero rows stay off
      rows.push({
        key: `${chainId}:${t.address.toLowerCase()}`,
        chainId,
        chainName: chainNameOf(chainId) ?? chainId,
        symbol: t.symbol,
        name: t.name,
        isNative: false,
        balanceNum: bal,
        usdValue: usd,
        logo: t.logo,
      });
    }
  }
  return rows;
}

// ── Own-BPAN lookup (auto-display rule): cached per wallet, then a count-gated
// on-chain ownership scan, mirroring the extension's BPAN page bootstrap. ────
function bpanCacheKey(owner: string): string {
  return `bpan_numbers_${owner.toLowerCase()}`;
}

async function loadOwnBPAN(owner: string): Promise<string> {
  try {
    const raw = await getItem(bpanCacheKey(owner));
    const cached: string[] = raw ? JSON.parse(raw) : [];
    if (cached.length > 0) return cached[0];
  } catch { /* cache is best-effort */ }
  try {
    const count = await getOwnedBPANCount(owner);
    if (count === 0) return "";
    const found = await findOwnedBPANs(owner);
    if (found.length > 0) {
      await setItem(bpanCacheKey(owner), JSON.stringify(found)).catch(() => {});
      return found[0];
    }
  } catch { /* non-fatal: the dashboard just shows the address */ }
  return "";
}

export function useMobileWallet(unlocked: boolean): MobileWalletState {
  const [evmAddress, setEvmAddress] = useState("");
  const [bpan, setBpan] = useState("");
  const [nonEvmAddresses, setNonEvmAddresses] = useState<NonEvmAddressMap | null>(null);
  const [natives, setNatives] = useState<AssetRow[]>([]);
  const [tokensByChain, setTokensByChain] = useState<Record<string, AutoToken[]>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [rates, setRates] = useState<Rates | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const discoveryBusy = useRef(false);
  // Address cache, filled on the first refresh after an unlock. Deriving all
  // seven chains from the mnemonic is JS-thread CPU (measured ~10 s for the
  // EVM account alone on a dev-mode emulator) — doing it once per unlock
  // instead of every refresh is what makes refreshes paint promptly. Only
  // PUBLIC addresses are cached; keys are re-derived per send.
  const addrCache = useRef<{ evm: string; addrs: NonEvmAddressMap } | null>(null);
  // Last successful balance rows. Core's sweep/fetch retention ("a failed
  // read never zeroes a row") only engages when the caller passes the
  // previous results back in — without these, one network blip painted every
  // real balance as 0 (observed on-device 2026-07-13).
  const prevEvmByChain = useRef(new Map<string, ChainBalance>());
  const prevNonEvm = useRef<NonEvmChain[] | undefined>(undefined);

  const refresh = useCallback(() => {
    if (!unlocked || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError("");
    (async () => {
      // Macrotask yield: everything below runs in microtask continuations,
      // which Hermes executes BEFORE the pending "loading" state can paint —
      // without this the dashboard looks dead during the first derivation.
      await new Promise((r) => setTimeout(r, 0));

      let cached = addrCache.current;
      if (!cached) {
        const mnemonic = await getUnlockedMnemonic();
        if (!mnemonic) throw new Error("locked");
        const evm = importFromMnemonic(mnemonic).address;
        setEvmAddress(evm);
        const derived = await deriveNonEvmAddresses(mnemonic);
        // Addresses only from here on; the secret keys in `derived` go out of
        // scope now and are never stored in hook state.
        cached = {
          evm,
          addrs: {
            bitcoin: derived.bitcoin.address,
            solana: derived.solana.address,
            sui: derived.sui.address,
            tron: derived.tron.address,
            xrp: derived.xrp.address,
            litecoin: derived.litecoin.address,
          },
        };
        addrCache.current = cached;
        // Public addresses only: lets the background receive watcher sweep
        // while the vault is locked (notify/receiveWatch.ts).
        void savePublicAddresses(cached.evm, cached.addrs);
      }
      const { evm, addrs } = cached;
      setEvmAddress(evm);
      setNonEvmAddresses(addrs);

      const [liveRates, hiddenSet] = await withTimeout(Promise.all([
        fetchRates(),
        loadHiddenTokens(evm.toLowerCase()),
      ]), REFRESH_TIMEOUT_MS, "Rates fetch");
      setRates(liveRates);
      setHidden(hiddenSet);

      // Own-BPAN display is independent of balances; let it land whenever the
      // quorum read finishes (cached after the first success).
      void loadOwnBPAN(evm).then(setBpan);

      const [evmSweep, nonEvm] = await withTimeout(Promise.all([
        sweepEvmNativeBalances(evm, {}, prevEvmByChain.current),
        fetchNonEvmBalancesByAddress(addrs, prevNonEvm.current),
      ]), REFRESH_TIMEOUT_MS, "Balance sweep");
      prevEvmByChain.current = new Map(evmSweep.results.map((c) => [c.networkId, c]));
      prevNonEvm.current = nonEvm;

      const nativeRows: AssetRow[] = [
        ...evmSweep.results.map((c) => ({
          key: `native:${c.networkId}`,
          chainId: c.networkId,
          chainName: c.name,
          symbol: c.symbol,
          name: c.name,
          isNative: true,
          balanceNum: c.balanceNum,
          usdValue: c.usdValue,
        })),
        ...nonEvm.map((c: NonEvmChain) => ({
          key: `native:${c.id}`,
          chainId: c.id,
          chainName: c.name,
          symbol: c.symbol,
          name: c.name,
          isNative: true,
          balanceNum: c.balance,
          usdValue: c.balance * getUsdPrice(c.symbol, liveRates),
        })),
      ];
      setNatives(nativeRows);

      // Token discovery paints as it lands but runs OUTSIDE the busy-guarded
      // phase, with its own single-flight guard: a slow or hung endpoint here
      // must never block the next refresh (the on-device failure mode was
      // exactly that — busy stayed true for minutes and the unlock-triggered
      // refresh bailed silently, leaving the dashboard empty).
      if (!discoveryBusy.current) {
        discoveryBusy.current = true;
        const discovery = Promise.all([
          sweepAllChainTokens(evm, (chainId, tokens) => {
            setTokensByChain((prev) => ({ ...prev, [chainId]: tokens }));
          }),
          // Non-EVM lists query their public endpoints directly. null =
          // provider unreachable → keep the last-known list; [] =
          // authoritative empty.
          (async () => {
            const [spl, trc, sui] = await Promise.all([
              fetchSolanaTokens(addrs.solana).catch(() => null),
              fetchTronTokens(addrs.tron).catch(() => null),
              fetchSuiTokens(addrs.sui).catch(() => null),
            ]);
            setTokensByChain((prev) => {
              const next = { ...prev };
              if (spl) next.solana = spl as AutoToken[];
              if (trc) next.tron = trc as AutoToken[];
              if (sui) next.sui = sui as AutoToken[];
              return next;
            });
          })(),
        ]);
        void withTimeout(discovery, DISCOVERY_TIMEOUT_MS, "Token discovery")
          .catch(() => { /* partial lists already painted; next refresh retries */ })
          .finally(() => { discoveryBusy.current = false; });
      }
    })()
      .catch((e) => setError(String(e)))
      .finally(() => {
        busy.current = false;
        setLoading(false);
      });
  }, [unlocked]);

  useEffect(() => {
    if (unlocked) refresh();
    else {
      // Lock: cached addresses die with the session, and so does balance
      // retention — a wipe→import could unlock a DIFFERENT wallet next, which
      // must not inherit this one's last-known rows.
      addrCache.current = null;
      prevEvmByChain.current = new Map();
      prevNonEvm.current = undefined;
    }
  }, [unlocked, refresh]);

  const tokens = tokenRows(tokensByChain, hidden, rates);
  // Natives with a balance always show; zero-balance natives only clutter a
  // phone screen, but keep ETH so an empty wallet is not a blank page.
  const visibleNatives = natives.filter(
    (r) => r.balanceNum > 0 || r.chainId === "ethereum"
  );
  const rows = [...visibleNatives, ...tokens].sort((a, b) => b.usdValue - a.usdValue);
  const portfolioUsd = rows.reduce((s, r) => s + r.usdValue, 0);
  const chainIds = [...new Set(rows.map((r) => r.chainId))];

  return {
    evmAddress,
    bpan,
    nonEvmAddresses,
    rows,
    chainIds,
    tokensByChain,
    portfolioUsd,
    rates,
    loading,
    error,
    refresh,
  };
}
