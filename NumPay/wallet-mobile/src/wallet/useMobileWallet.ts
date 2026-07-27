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
 *    dust rule (hide priced sub-$0.01 rows; unpriced balances stay visible,
 *    same semantics as the extension Dashboard).
 *
 * Slice 1 scope: EVM tokens only. SPL/TRC-20/Sui token rows follow with the
 * Send work (they share core fetchers already).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { importFromMnemonic } from "@numpay/core/wallet";
import { NETWORKS, type Network } from "@numpay/core/networks";
import { getTokenBalance } from "@numpay/core/tokens";
import { getCustomTokens, type CustomToken } from "@numpay/core/customTokens";
import { getCustomChains, type CustomChain } from "@numpay/core/customChains";
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
import { fetchRates, getAnyUsdPrice, getUsdPrice, type Rates } from "@numpay/core/currency";
import { loadHiddenTokens, setTokenHidden, tokenHideKey } from "@numpay/core/hiddenTokens";
import { loadPinnedAssets, setAssetPinned } from "@numpay/core/pinnedAssets";
import { homeSection } from "./assetVisibility";
import { clearBalanceSnapshot, loadBalanceSnapshot, saveBalanceSnapshot } from "./balanceCache";
import { classifyToken } from "@numpay/core/tokenSpam";
import { chainNameOf } from "@numpay/core/txLog";
import { getOwnedBPANCount, findOwnedBPANs } from "@numpay/core/bpan";
import { getItem, setItem } from "@numpay/core/storage";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import { savePublicAddresses } from "../notify/receiveWatch";

// The home/hidden/drop rule (and the dust cutoff and default-five list behind
// it) lives in ./assetVisibility so it can be read and tested on its own.

// Zero-balance display order for the natives list: the majors a wallet user
// expects to see first, then everything else in sweep order.
const MAJOR_ORDER = [
  "ethereum", "bitcoin", "solana", "bsc", "base", "polygon", "arbitrum",
  "optimism", "avalanche", "tron", "sui", "xrp", "litecoin",
];

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
  /** Set on dust rows the USER hid by hand, as opposed to ones the dust/spam
   *  rules filtered out. Only these get an "Unhide" control (ext parity). */
  manualHidden?: boolean;
  // Risk signals carried through from discovery so TokenDetail can raise the
  // extension's caution banner. Undefined means "the indexer told us nothing",
  // which is NOT the same as a clean result — only explicit flags warn.
  possibleSpam?: boolean;
  securityScore?: number;
  verifiedContract?: boolean;
}

export interface MobileWalletState {
  evmAddress: string;
  nonEvmAddresses: NonEvmAddressMap | null;
  /** First owned BPAN (raw 11 digits), "" when none / not yet known. */
  bpan: string;
  rows: AssetRow[];
  /** Everything kept off the home list: dust, spam, user-hidden tokens, and the
   *  zero-balance natives outside the default five. Feeds the dashboard's
   *  collapsible "Hidden (n)" section, where any of them can be added back. */
  dustRows: AssetRow[];
  /** Remove a row from the home list, or add it back. Works on natives too. */
  setRowHidden: (row: AssetRow, hidden: boolean) => Promise<void>;
  chainIds: string[]; // chains with anything to show, dashboard filter chips
  /** Raw discovered tokens per chain (address/decimals intact) for pickers.
   *  Custom (user-added) tokens are merged in, so Send can pick them. */
  tokensByChain: Record<string, AutoToken[]>;
  /** User-added EVM networks (Manage assets), keyed by network id, in core
   *  Network shape so Send/fee code can treat them like built-ins. */
  customNets: Record<string, Network>;
  portfolioUsd: number;
  rates: Rates | null;
  loading: boolean;
  error: string;
  /** `force` skips the token sweep's 3-minute freshness gate. Pass it whenever
   *  the user asked for the truth (pull-to-refresh, the refresh button) — a
   *  plain refresh inside the window re-paints the cache and looks frozen. */
  refresh: (force?: boolean) => void;
  /** Re-check after a send/swap of our own. The native balances are right
   *  immediately (they come off the RPC), but ERC-20 discovery runs through an
   *  indexer that lags the block, so one refresh at t=0 would just re-cache the
   *  pre-swap balance. This re-checks as the indexer catches up. */
  refreshAfterTx: () => void;
  /** Re-read user-added tokens/networks from storage without a full sweep. */
  reloadCustom: () => Promise<void>;
}

// Non-EVM token fetchers return priceUsd only where the source provides it
// (Solana); everywhere else the shared symbol→rate table prices majors like
// USDT/USDC, and the dust rule keeps the rest off (same as the extension).
function tokenRows(
  byChain: Record<string, AutoToken[]>,
  hidden: Set<string>,
  pinned: Set<string>,
  rates: Rates | null
): { rows: AssetRow[]; dust: AssetRow[] } {
  const rows: AssetRow[] = [];
  // Dust + manually hidden tokens. The extension keeps these reachable behind
  // a "Hidden (n)" disclosure rather than dropping them, so a token hidden by
  // mistake (or auto-classified as spam) can always be brought back.
  const dust: AssetRow[] = [];
  for (const [chainId, tokens] of Object.entries(byChain)) {
    for (const t of tokens) {
      const bal = parseFloat(t.balance) || 0;
      // Indexer price first; otherwise the shared symbol tables. getAnyUsdPrice
      // covers ERC-20s (USDC/USDT/WETH/…) that getUsdPrice alone cannot —
      // without it a held stablecoin valued at $0 and vanished from the total.
      const price = t.priceUsd ?? (rates ? getAnyUsdPrice(t.symbol, rates) : 0);
      const mkRow = (manualHidden?: boolean): AssetRow => ({
        key: `${chainId}:${t.address.toLowerCase()}`,
        chainId,
        chainName: chainNameOf(chainId) ?? chainId,
        symbol: t.symbol,
        name: t.name,
        isNative: false,
        balanceNum: bal,
        usdValue: price * bal,
        logo: t.logo,
        manualHidden,
        possibleSpam: t.possibleSpam,
        securityScore: t.securityScore,
        verifiedContract: t.verifiedContract,
      });
      const hideKey = tokenHideKey(chainId, t.address);
      const section = homeSection({
        chainId, isNative: false, address: t.address,
        balanceNum: bal, usdValue: price * bal,
        spam: classifyToken(t).hidden,
      }, hidden, pinned);
      if (section === "drop") continue;
      // manualHidden marks the row as the USER's call rather than a rule's,
      // which is what TokenDetail reads to word its caution banner.
      if (section === "hidden") { dust.push(mkRow(hidden.has(hideKey))); continue; }
      rows.push(mkRow());
    }
  }
  return { rows, dust };
}

// User-added networks, in core Network shape (same mapping the extension's
// useWallet does) so the native sweep and Send treat them like built-ins.
function toNetMap(list: CustomChain[]): Record<string, Network> {
  const netMap: Record<string, Network> = {};
  for (const cc of list) {
    netMap[cc.id] = {
      id: cc.id, name: cc.name, chainId: cc.chainId,
      rpcUrl: cc.rpcUrl, symbol: cc.symbol, decimals: cc.decimals,
      explorer: cc.explorer, logo: cc.logo || "",
    };
  }
  return netMap;
}

// Custom (user-added) EVM token balances, read straight from the chain RPC —
// custom tokens exist precisely because no indexer reports them, so the
// discovery sweep cannot cover them. Solana customs skip this: held mints
// arrive priced via fetchSolanaTokens, and an unheld one just shows 0.
async function fetchCustomEvmTokenBalances(
  owner: string,
  tokens: CustomToken[],
  customNets: Record<string, Network>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(tokens.map(async (ct) => {
    const net = NETWORKS[ct.chainId] ?? customNets[ct.chainId];
    if (!net) return; // solana / unknown chain: no RPC read here
    try {
      const provider = new ethers.JsonRpcProvider(net.rpcUrl, net.chainId, { staticNetwork: true });
      const bal = await withTimeout(
        getTokenBalance(ct.address, owner, provider), 8_000, `${ct.symbol} balance`,
      );
      out[`${ct.chainId}:${ct.address.toLowerCase()}`] = bal;
    } catch { /* failed read: the state merge keeps the last-known balance */ }
  }));
  return out;
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

export function useMobileWallet(unlocked: boolean, activeWalletId?: string | null): MobileWalletState {
  const [evmAddress, setEvmAddress] = useState("");
  const [bpan, setBpan] = useState("");
  const [nonEvmAddresses, setNonEvmAddresses] = useState<NonEvmAddressMap | null>(null);
  const [natives, setNatives] = useState<AssetRow[]>([]);
  const [tokensByChain, setTokensByChain] = useState<Record<string, AutoToken[]>>({});
  // Manage-assets state: re-read from core storage on every refresh, so adds/
  // removes made on the ManageAssets screen land on the next sweep.
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [customNets, setCustomNets] = useState<Record<string, Network>>({});
  const [customBal, setCustomBal] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  // Rows the user put on the home list by hand. Kept separate from `hidden`
  // rather than inverted out of it — see pinnedAssets.ts for why the two are
  // not the same question.
  const [pinned, setPinned] = useState<Set<string>>(new Set());
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
  // The disk snapshot is read once per unlock. Re-reading it after the first
  // live sweep would paint older numbers over newer ones.
  const hydratedRef = useRef(false);
  // Pending post-tx re-checks, so a lock or an unmount cancels them.
  const txRecheck = useRef<ReturnType<typeof setTimeout>[]>([]);
  const clearTxRecheck = () => {
    for (const t of txRecheck.current) clearTimeout(t);
    txRecheck.current = [];
  };

  const refresh = useCallback((force = false) => {
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

      // Local storage reads only — no network, so this phase is ~instant. It
      // has to finish first because the sweep needs netMap.
      const [hiddenSet, pinnedSet, ccList, ctList] = await Promise.all([
        loadHiddenTokens(evm.toLowerCase()),
        loadPinnedAssets(evm.toLowerCase()),
        getCustomChains().catch(() => []),
        getCustomTokens().catch(() => []),
      ]);
      setHidden(hiddenSet);
      setPinned(pinnedSet);

      const netMap = toNetMap(ccList);
      setCustomNets(netMap);
      setCustomTokens(ctList);

      // Own-BPAN display is independent of balances; let it land whenever the
      // quorum read finishes (cached after the first success).
      void loadOwnBPAN(evm).then(setBpan);

      // Prices and balances go out TOGETHER. Rates used to be awaited in its
      // own earlier phase, which put a full network round-trip in front of
      // every sweep for no reason: the sweep does not consume rates, only the
      // usdValue math below does, and that runs after both have landed.
      const [liveRates, evmSweep, nonEvm] = await withTimeout(Promise.all([
        fetchRates(),
        sweepEvmNativeBalances(evm, netMap, prevEvmByChain.current),
        fetchNonEvmBalancesByAddress(addrs, prevNonEvm.current),
      ]), REFRESH_TIMEOUT_MS, "Balance sweep");
      setRates(liveRates);
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

      // Custom-token balances ride outside the busy phase like discovery:
      // per-token 8 s timeouts, and a failed read keeps the previous value
      // (prev-merge below) instead of zeroing the row.
      if (ctList.length > 0) {
        void fetchCustomEvmTokenBalances(evm, ctList, netMap).then((bals) => {
          setCustomBal((prev) => ({ ...prev, ...bals }));
        });
      }

      // Token discovery paints as it lands but runs OUTSIDE the busy-guarded
      // phase, with its own single-flight guard: a slow or hung endpoint here
      // must never block the next refresh (the on-device failure mode was
      // exactly that — busy stayed true for minutes and the unlock-triggered
      // refresh bailed silently, leaving the dashboard empty).
      if (!discoveryBusy.current) {
        discoveryBusy.current = true;
        const discovery = Promise.all([
          sweepAllChainTokens(evm, (chainId, tokens, final) => {
            setTokensByChain((prev) => {
              // Only an AUTHORITATIVE list may shorten the chain's row set.
              // That is the update that clears a token swapped or sent down to
              // zero: every other emission carries just what one source found,
              // so replacing on those made held tokens blink out and back while
              // the slower sources were still in flight.
              if (final) return { ...prev, [chainId]: tokens };
              const byAddr = new Map(
                (prev[chainId] ?? []).map((t) => [t.address.toLowerCase(), t]),
              );
              for (const t of tokens) byAddr.set(t.address.toLowerCase(), t);
              return { ...prev, [chainId]: Array.from(byAddr.values()) };
            });
          }, force),
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

  /**
   * Re-check balances after a send/swap/bridge of our own.
   *
   * The native rows come off the RPC and are correct on the next refresh, but
   * ERC-20 rows come from an indexer that trails the block by seconds to
   * minutes (the proxy alone caches /v1/tokens for 5 minutes). A single refresh
   * fired the moment the tx lands therefore re-reads the PRE-swap token balance
   * and caches it, which is what left a swapped-away token sitting on the
   * dashboard. So: ask again as the indexer catches up.
   *
   * Forced, because these re-checks exist precisely to beat the freshness gate;
   * core rate-limits the bypass itself, and the spacing clears that limit.
   */
  const refreshAfterTx = useCallback(() => {
    clearTxRecheck();
    refresh(true);
    for (const ms of [8_000, 25_000]) {
      txRecheck.current.push(setTimeout(() => refresh(true), ms));
    }
  }, [refresh]);

  /**
   * Re-read the user's custom tokens and networks from storage, and fetch
   * balances for them.
   *
   * Adding a token in Manage assets is a purely LOCAL change, so surfacing it
   * must not depend on the full refresh() network sweep: that is slow, it can
   * be in-flight already (busy guard), and it made a freshly added token look
   * like it had not been saved. Cheap enough to call on every exit from
   * Manage assets.
   */
  const reloadCustom = useCallback(async () => {
    const [ccList, ctList] = await Promise.all([
      getCustomChains().catch(() => []),
      getCustomTokens().catch(() => []),
    ]);
    const netMap = toNetMap(ccList);
    setCustomNets(netMap);
    setCustomTokens(ctList);
    if (ctList.length > 0 && addrCache.current?.evm) {
      void fetchCustomEvmTokenBalances(addrCache.current.evm, ctList, netMap)
        .then((bals) => setCustomBal((prev) => ({ ...prev, ...bals })))
        .catch(() => {});
    }
  }, []);

  /**
   * Persist whatever the dashboard is currently showing.
   *
   * Deliberately an effect on the painted values rather than a line at the end
   * of refresh(): token discovery lands AFTER refresh resolves, so saving
   * inside it would snapshot a dashboard with no tokens on it. Debounced,
   * because discovery paints once per chain as each list arrives.
   *
   * The `natives.length` guard is what stops a wallet switch (which clears
   * state before the new sweep) from overwriting a good snapshot with nothing.
   */
  useEffect(() => {
    if (!unlocked || !evmAddress || !nonEvmAddresses || natives.length === 0) return;
    const t = setTimeout(() => {
      void saveBalanceSnapshot(activeWalletId, {
        evmAddress, addrs: nonEvmAddresses, natives, tokensByChain, customBal, rates,
      });
    }, 1200);
    return () => clearTimeout(t);
  }, [unlocked, activeWalletId, evmAddress, nonEvmAddresses, natives, tokensByChain, customBal, rates]);

  /**
   * Prove the snapshot's addresses really belong to this wallet.
   *
   * Runs off the critical path, after the cached balances are already on
   * screen. A mismatch means the snapshot is stale or belongs to another
   * wallet, and since these addresses reach the Receive screen that has to be
   * treated as a hard failure: drop the cache, drop the derived state, and
   * refresh from the addresses we just derived for real.
   */
  const verifyCachedAddresses = useCallback(async (cachedEvm: string) => {
    try {
      const mnemonic = await getUnlockedMnemonic();
      if (!mnemonic) return; // relocked; nothing to prove, cache stays unused
      const real = importFromMnemonic(mnemonic).address;
      if (real.toLowerCase() === cachedEvm.toLowerCase()) return;
      await clearBalanceSnapshot(activeWalletId);
      addrCache.current = null;
      prevEvmByChain.current = new Map();
      prevNonEvm.current = undefined;
      setNatives([]); setTokensByChain({}); setCustomBal({});
      refresh();
    } catch {
      // Verification is a safety net, not a gate: if it cannot run, the next
      // full refresh re-derives anyway.
    }
  }, [activeWalletId, refresh]);

  /**
   * Paint the last-known dashboard from disk, THEN refresh over the network.
   *
   * The snapshot's public addresses seed `addrCache`, which is the part that
   * actually removes the wait: without it every launch re-derived seven
   * addresses (BIP39 seed + BIP32/SLIP-10 per chain) before the first request
   * could even be sent, with nothing on screen the whole time.
   *
   * Seeding means the sweep trusts an address that came off disk, and a wrong
   * one would be shown on Receive. So derivation still runs — just in the
   * BACKGROUND, off the critical path — purely to prove the cache right. Any
   * mismatch throws the snapshot away and starts over from the real addresses.
   */
  const hydrateThenRefresh = useCallback(async () => {
    if (!hydratedRef.current) {
      hydratedRef.current = true;
      const snap = await loadBalanceSnapshot(activeWalletId);
      if (snap && !addrCache.current) {
        addrCache.current = { evm: snap.evmAddress, addrs: snap.addrs };
        setEvmAddress(snap.evmAddress);
        setNonEvmAddresses(snap.addrs);
        setNatives(snap.natives);
        setTokensByChain(snap.tokensByChain);
        setCustomBal(snap.customBal);
        if (snap.rates) setRates(snap.rates);
        // Seed EVM retention too, or the first sweep has no previous value to
        // fall back on and one network blip repaints real balances as 0.
        // EVM only: a NonEvmChain carries fields (decimals, address) an
        // AssetRow does not, and handing core a half-built one would be worse
        // than handing it nothing.
        prevEvmByChain.current = new Map(
          snap.natives
            .filter((r) => r.isNative && NETWORKS[r.chainId])
            .map((r) => [r.chainId, {
              networkId: r.chainId, name: r.chainName, symbol: r.symbol,
              logo: NETWORKS[r.chainId]?.logo ?? "",
              balance: String(r.balanceNum), balanceNum: r.balanceNum,
              usdValue: r.usdValue,
            } satisfies ChainBalance]),
        );
        void verifyCachedAddresses(snap.evmAddress);
      }
    }
    refresh();
  }, [activeWalletId, refresh, verifyCachedAddresses]);

  useEffect(() => {
    if (unlocked) { void hydrateThenRefresh(); }
    else {
      // Lock: cached addresses die with the session, and so does balance
      // retention — a wipe→import could unlock a DIFFERENT wallet next, which
      // must not inherit this one's last-known rows.
      clearTxRecheck();
      addrCache.current = null;
      prevEvmByChain.current = new Map();
      prevNonEvm.current = undefined;
      // Re-read the snapshot on the next unlock: a wipe→import could bring up a
      // DIFFERENT wallet, and the ownership check only runs on a fresh read.
      hydratedRef.current = false;
      setCustomBal({});
    }
  }, [unlocked, hydrateThenRefresh]);

  // Unmount: a pending post-tx re-check must not fire into a dead hook.
  useEffect(() => clearTxRecheck, []);

  // Active wallet switched (multi-wallet): the mnemonic behind
  // getUnlockedMnemonic now differs, so drop the derived addresses + last-known
  // balances (they belong to the previous wallet) and re-derive. Only a genuine
  // id CHANGE while unlocked triggers this; the initial null→id at unlock is
  // already handled by the main refresh effect above (no double-refresh).
  const prevWalletId = useRef(activeWalletId);
  useEffect(() => {
    const prev = prevWalletId.current;
    prevWalletId.current = activeWalletId;
    if (!unlocked || prev == null || prev === activeWalletId) return;
    addrCache.current = null;
    prevEvmByChain.current = new Map();
    prevNonEvm.current = undefined;
    setNatives([]); setTokensByChain({}); setBpan(""); setEvmAddress("");
    setNonEvmAddresses(null); setCustomBal({});
    // The new wallet has its own snapshot; hydrate from THAT rather than
    // leaving the previous wallet's rows on screen while its sweep runs.
    hydratedRef.current = false;
    void hydrateThenRefresh();
  }, [activeWalletId, unlocked, hydrateThenRefresh]);

  // Remove from / add back to the home list. The SINGLE writer for both sets,
  // which is what keeps them from disagreeing: every call sets one and clears
  // the other, so a key can never be hidden and pinned at once.
  //
  // Natives are included now. They used to be exempt so majors could never
  // disappear; the default-five rule covers that intent, and the user asked to
  // be able to remove those too. A native has no contract address, and
  // tokenHideKey already yields a stable "chainId:" for that case.
  //
  // Optimistic: state updates first so the row moves between sections on the
  // next render rather than the next sweep, and rolls back if persistence fails
  // so the UI keeps telling the truth about what survives a reload.
  const setRowHidden = useCallback(async (row: AssetRow, hide: boolean) => {
    if (!evmAddress) return;
    const addr = row.isNative ? undefined : row.key.split(":")[1];
    const key = tokenHideKey(row.chainId, addr);
    const owner = evmAddress.toLowerCase();
    const apply = (h: boolean) => {
      setHidden((prev) => {
        const next = new Set(prev);
        if (h) next.add(key); else next.delete(key);
        return next;
      });
      setPinned((prev) => {
        const next = new Set(prev);
        if (h) next.delete(key); else next.add(key);
        return next;
      });
    };
    apply(hide);
    try {
      await Promise.all([
        setTokenHidden(owner, key, hide),
        setAssetPinned(owner, key, !hide),
      ]);
    } catch {
      apply(!hide);
    }
  }, [evmAddress]);

  const { rows: tokens, dust: tokenDust } = tokenRows(tokensByChain, hidden, pinned, rates);
  // Custom (user-added) token rows. Deliberately EXEMPT from the dust rule and
  // spam classification: the user explicitly asked for this token, so an
  // unpriced balance must not vanish (that reads as "add token is broken").
  // A token discovery also found is skipped — the discovered row carries the
  // indexer's price/logo metadata and would otherwise duplicate.
  const customRows: AssetRow[] = [];
  const customDust: AssetRow[] = [];
  for (const ct of customTokens) {
    const addrLc = ct.address.toLowerCase();
    if ((tokensByChain[ct.chainId] ?? []).some((t) => t.address.toLowerCase() === addrLc)) continue;
    const bal = parseFloat(customBal[`${ct.chainId}:${addrLc}`] ?? "0") || 0;
    const price = rates ? getAnyUsdPrice(ct.symbol, rates) : 0;
    const row: AssetRow = {
      key: `${ct.chainId}:${addrLc}`,
      chainId: ct.chainId,
      chainName: NETWORKS[ct.chainId]?.name ?? customNets[ct.chainId]?.name ?? (chainNameOf(ct.chainId) ?? ct.chainId),
      symbol: ct.symbol,
      name: ct.name,
      isNative: false,
      balanceNum: bal,
      usdValue: price * bal,
      logo: ct.logo,
    };
    // A hidden custom token still belongs in the Hidden section, not gone: the
    // user added it deliberately, so unhiding must stay one tap away.
    if (hidden.has(tokenHideKey(ct.chainId, ct.address))) customDust.push({ ...row, manualHidden: true });
    else customRows.push(row);
  }
  // A native earns its home row by holding something, by being one of the
  // default five, or by an explicit pin — in that order, with a manual hide
  // beating all three. The zero-balance rest wait in the Hidden section instead
  // of padding the list, and every one of them carries a way back.
  //
  // `manualHidden: true` on the hidden ones is deliberate: it is what marks a
  // row as "the user's call", and natives parked here by the default-five rule
  // are still user-recoverable, so they must not read as classifier output.
  const nativeVisible: AssetRow[] = [];
  const nativeHidden: AssetRow[] = [];
  for (const n of natives) {
    const section = homeSection({
      chainId: n.chainId, isNative: true,
      balanceNum: n.balanceNum, usdValue: n.usdValue,
    }, hidden, pinned);
    if (section === "home") nativeVisible.push(n);
    else nativeHidden.push({ ...n, manualHidden: true });
  }
  // Holders sort to the top by USD value; the zero-balance tail follows a fixed
  // major-chain order instead of alphabet soup.
  const rows = [...nativeVisible, ...tokens, ...customRows].sort((a, b) => {
    if (b.usdValue !== a.usdValue) return b.usdValue - a.usdValue;
    const aHolds = a.balanceNum > 0 ? 0 : 1;
    const bHolds = b.balanceNum > 0 ? 0 : 1;
    if (aHolds !== bHolds) return aHolds - bHolds;
    const ai = MAJOR_ORDER.indexOf(a.chainId);
    const bi = MAJOR_ORDER.indexOf(b.chainId);
    return (ai === -1 ? MAJOR_ORDER.length : ai) - (bi === -1 ? MAJOR_ORDER.length : bi);
  });
  // Hidden NATIVES still count toward the total. Taking a chain off the home
  // list is a display choice, not a claim that the coins stopped existing, and
  // a total that silently drops when you tidy the list is a total you cannot
  // trust. (Dust and spam stay out, as in the extension.)
  const portfolioUsd = [...rows, ...nativeHidden].reduce((s, r) => s + r.usdValue, 0);
  const chainIds = [...new Set(rows.map((r) => r.chainId))];
  // Hidden section: biggest first, so anything worth recovering is at the top.
  // Zero-value rows (the empty natives parked here) fall back to major order so
  // the tail is stable rather than reshuffling on every price tick.
  const dustRows = [...nativeHidden, ...tokenDust, ...customDust].sort((a, b) => {
    if (b.usdValue !== a.usdValue) return b.usdValue - a.usdValue;
    const ai = MAJOR_ORDER.indexOf(a.chainId);
    const bi = MAJOR_ORDER.indexOf(b.chainId);
    return (ai === -1 ? MAJOR_ORDER.length : ai) - (bi === -1 ? MAJOR_ORDER.length : bi);
  });

  // Merge customs into the picker lists so Send/TokenDetail can select them.
  // Derived here (not in setTokensByChain) so the discovery sweep's per-chain
  // list replacement can never race the merge away.
  const mergedTokensByChain: Record<string, AutoToken[]> = { ...tokensByChain };
  for (const ct of customTokens) {
    const list = mergedTokensByChain[ct.chainId] ?? [];
    if (list.some((t) => t.address.toLowerCase() === ct.address.toLowerCase())) continue;
    mergedTokensByChain[ct.chainId] = [...list, {
      symbol: ct.symbol, name: ct.name, address: ct.address, decimals: ct.decimals,
      balance: customBal[`${ct.chainId}:${ct.address.toLowerCase()}`] ?? "0", logo: ct.logo,
    }];
  }

  return {
    evmAddress,
    bpan,
    nonEvmAddresses,
    rows,
    dustRows,
    setRowHidden,
    chainIds,
    tokensByChain: mergedTokensByChain,
    customNets,
    portfolioUsd,
    rates,
    loading,
    error,
    refresh,
    refreshAfterTx,
    reloadCustom,
  };
}
