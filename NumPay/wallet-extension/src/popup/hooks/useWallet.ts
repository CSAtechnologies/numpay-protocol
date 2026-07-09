import {
  useState, useEffect, useCallback, useMemo, useSyncExternalStore, useRef,
  createContext, useContext, createElement, type ReactNode,
} from "react";
import { ethers } from "ethers";
import { type WalletData, type VaultMeta, setActiveId, updateWalletAvatar, touchActivity, unlockActiveVault, SESSION_KEY } from "@/lib/wallet";
import { notifyDappState } from "@/lib/dapp/notify";
import { deriveSolanaAddress } from "@/lib/chains/solana";
import { getItem, setItem, getSession, setSession } from "@/lib/storage";
import {
  balancesDirty, subscribeBalanceBus, overlayVersion, hasPendingOverlays, pendingDeltaFor,
  clearBalanceOverlays,
} from "@/lib/balanceBus";
import { NETWORKS, DEFAULT_NETWORK, type Network } from "@/lib/networks";
import { DEFAULT_TOKENS, getTokenBalance, type Token } from "@/lib/tokens";
import {
  deriveNonEvmAddresses,
  fetchNonEvmBalances,
  fetchSolanaTokens,
  fetchTronTokens,
  fetchSuiTokens,
  type NonEvmWallet,
  type NonEvmChain,
} from "@/lib/chains";
import { getCustomTokens } from "@/lib/customTokens";
import { getCustomChains, type CustomChain } from "@/lib/customChains";
import { sweepEvmNativeBalances, type ChainBalance } from "@/lib/balanceSweep";
import { updateWatchAddresses } from "@/lib/watchAddresses";
import { sweepAllChainTokens } from "@/lib/autoTokens";
import {
  bootData, takeBootBalanceCache, takeBootNonEvmCache, takeBootSession,
  NETWORK_KEY, ACTIVE_CHAIN_KEY, ASSET_FILTER_KEY, EVM_CACHE_PFX, NONEVMCACHE_PFX,
} from "../boot";

export type { ChainBalance };

export interface WalletState {
  wallet: WalletData | null;
  network: Network;
  balance: string;
  tokens: Token[];
  tokensByChain: Record<string, Token[]>;
  loading: boolean;
  switchNetwork: (id: string) => void;
  activeChainId: string;
  activeAddress: string;
  switchChain: (id: string) => void;
  filterChainId: string | null;
  setAssetFilter: (id: string | null) => void;
  refresh: () => void;
  refreshNonEvm: (showLoading?: boolean) => Promise<void>;
  /** Manual refresh: run every fetcher, token sweep bypasses its TTL gate. */
  forceRefreshAll: () => void;
  portfolioUsd: number;
  chainBalances: ChainBalance[];
  multiChainLoading: boolean;
  nonEvmWallet: NonEvmWallet | null;
  nonEvmChains: NonEvmChain[];
  nonEvmLoading: boolean;
  walletMetas: VaultMeta[];
  activeWalletId: string;
  switchActiveWallet: (id: string, password?: string) => Promise<void>;
  addWalletToSession: (wallet: WalletData, id: string, meta: VaultMeta) => Promise<void>;
  removeWalletMeta: (id: string) => void;
  setWalletAvatar: (id: string, avatar: string) => Promise<void>;
  customChains: CustomChain[];
}

interface WalletSession {
  activeId: string;
  wallets: Record<string, WalletData>;
}

function useWalletState(): WalletState {
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [networkId, setNetworkId] = useState(DEFAULT_NETWORK);
  const [balance, setBalance] = useState("0");
  const [tokens, setTokens] = useState<Token[]>([]);
  const [tokensByChain, setTokensByChain] = useState<Record<string, Token[]>>({});
  const [loading, setLoading] = useState(true);

  const [chainBalances, setChainBalances] = useState<ChainBalance[]>([]);
  const [portfolioUsd, setPortfolioUsd] = useState(0);
  const [multiChainLoading, setMultiChainLoading] = useState(true);

  const [nonEvmWallet, setNonEvmWallet] = useState<NonEvmWallet | null>(null);
  const [nonEvmChains, setNonEvmChains] = useState<NonEvmChain[]>([]);
  const [nonEvmLoading, setNonEvmLoading] = useState(true);

  const [activeChainId, setActiveChainId] = useState<string>(DEFAULT_NETWORK);
  const [filterChainId, setFilterChainIdState] = useState<string | null>(null);

  const [walletMetas, setWalletMetas] = useState<VaultMeta[]>([]);
  const [activeWalletId, setActiveWalletId] = useState("");
  const [customChains, setCustomChains] = useState<CustomChain[]>([]);

  // The lowercased address of the wallet that is active RIGHT NOW, updated
  // synchronously at every setWallet site (mount, switch, add). The async
  // balance/token fetchers capture the address they started for and compare it
  // against this ref before committing: a fetch begun for wallet A that resolves
  // after a switch to B is dropped, so A's tokens/balances never paint into B's
  // (just-cleared) view. `isStale(addr)` is the guard.
  const activeAddrRef = useRef<string>("");
  const isStale = useCallback(
    (addr: string) => activeAddrRef.current !== addr.toLowerCase(),
    [],
  );

  // Resolve current network — supports built-in and custom chains
  const network = useMemo<Network>(() => {
    if (NETWORKS[networkId]) return NETWORKS[networkId];
    const custom = customChains.find((c) => c.id === networkId);
    if (custom) {
      return {
        id: custom.id, name: custom.name, chainId: custom.chainId,
        rpcUrl: custom.rpcUrl, symbol: custom.symbol, decimals: custom.decimals,
        explorer: custom.explorer, logo: custom.logo || "",
      };
    }
    return NETWORKS[DEFAULT_NETWORK];
  }, [networkId, customChains]);

  // Load wallet and settings from storage on mount. The boot preload already
  // read everything in parallel at import time, so this usually resolves with
  // zero additional storage round-trips.
  useEffect(() => {
    (async () => {
      const boot = await bootData;
      if (boot.networkId) setNetworkId(boot.networkId);
      if (boot.activeChainId) setActiveChainId(boot.activeChainId);
      if (boot.assetFilter && boot.assetFilter !== "all") setFilterChainIdState(boot.assetFilter);
      setCustomChains(boot.customChains);

      // The boot session is a snapshot from popup-open: present when the popup
      // opened unlocked, null when it opened locked (the unlock flow wrote the
      // session after the snapshot). takeBootSession() hands it to the FIRST
      // mount only; any later mount reads live storage, so a wallet switch is
      // never rewound by a remount reading the frozen snapshot.
      const cached = (await takeBootSession()) ?? await getSession(SESSION_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.wallets && parsed.activeId) {
            const walletData = parsed.wallets[parsed.activeId] as WalletData | undefined;
            if (walletData) { activeAddrRef.current = walletData.address.toLowerCase(); setWallet(walletData); }
            setActiveWalletId(parsed.activeId);
          } else if (parsed.address) {
            activeAddrRef.current = (parsed as WalletData).address.toLowerCase();
            setWallet(parsed as WalletData);
            setActiveWalletId("wallet-1");
          }
          await touchActivity(); // opening the popup counts as activity
        } catch {}
      }

      setWalletMetas(boot.vaultMetas);
      if (boot.activeId) setActiveWalletId((prev) => prev || boot.activeId!);
    })();
  }, []);

  // Fetch current-network balance + tokens (built-in + custom)
  const refresh = useCallback(async () => {
    if (!wallet) return;
    const addr = wallet.address;
    setLoading(true);
    // staticNetwork: skip the eth_chainId auto-detect round-trip — we already know
    // the chain id, so there's no reason to ask the RPC for it on every provider.
    const provider = new ethers.JsonRpcProvider(network.rpcUrl, network.chainId, { staticNetwork: true });

    try {
      const bal = await provider.getBalance(wallet.address);
      if (!isStale(addr)) setBalance(ethers.formatUnits(bal, network.decimals));
    } catch (e) {
      console.error("Failed to fetch balance:", e);
    }

    const chainTokens = DEFAULT_TOKENS[network.chainId] || [];

    // Merge in any custom EVM tokens the user added for this chain
    const customList = await getCustomTokens().catch(() => []);
    const customForChain = customList
      .filter((ct) => ct.chainId === network.id)
      .map((ct) => ({ symbol: ct.symbol, name: ct.name, address: ct.address, decimals: ct.decimals, logo: ct.logo }));

    const allTokens = [...chainTokens, ...customForChain];

    // `failed` marks a balanceOf that threw (public RPCs throttle under the
    // parallel load of this + the sweeps) — a failure is NOT a zero balance.
    const withBalances = await Promise.all(
      allTokens.map(async (t) => {
        try {
          const b = await getTokenBalance(t.address, wallet.address, provider);
          return { ...t, balance: b, failed: false };
        } catch {
          return { ...t, balance: "0", failed: true };
        }
      })
    );
    // A switch that happened while the balances were in flight: drop this
    // wallet's now-stale reads instead of painting them onto the new wallet.
    if (isStale(addr)) return;
    setTokens(withBalances.map(({ failed, ...t }) => t));
    // Merge into the chain's token list instead of replacing it: replacement
    // dropped every auto-detected token and stripped priceUsd/spam metadata
    // off the defaults until the next sweep re-merged them, which made the
    // portfolio total dip and recover (visible oscillation at popup open and
    // in the post-tx fast-poll window).
    setTokensByChain((prev) => {
      const existing = prev[network.id] ?? [];
      const existingByAddr = new Map(existing.map((t) => [t.address.toLowerCase(), t]));
      const withMeta = withBalances.map(({ failed, ...t }) => {
        const old = existingByAddr.get(t.address.toLowerCase());
        if (!old) return t;
        // A failed read keeps the last-known balance instead of zeroing the
        // row — zeroing made held tokens (SHIB etc.) vanish for a poll cycle
        // and swing the portfolio total.
        const balance = failed ? (old.balance ?? t.balance) : t.balance;
        return { ...old, ...t, balance, logo: t.logo ?? old.logo };
      });
      const covered = new Set(withBalances.map((t) => t.address.toLowerCase()));
      const rest = existing.filter((t) => !covered.has(t.address.toLowerCase()));
      return { ...prev, [network.id]: [...withMeta, ...rest] };
    });
    setLoading(false);
  }, [wallet, network]);

  useEffect(() => { refresh(); }, [refresh]);

  // Multi-chain aggregate balance — stale-while-revalidate, includes custom chains
  const refreshMultiChain = useCallback(async () => {
    if (!wallet) return;
    const addr = wallet.address;

    const cacheKey = EVM_CACHE_PFX + wallet.address;
    let hasCache = false;
    // Last-known balances, kept so a failed/offline fetch doesn't zero them out.
    const prevByChain = new Map<string, ChainBalance>();
    try {
      // First run consumes the boot-preloaded snapshot (already in memory);
      // later runs read storage fresh.
      const raw = (await takeBootBalanceCache(wallet.address)) ?? await getItem(cacheKey);
      if (raw && !isStale(addr)) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.chainBalances) && typeof parsed.portfolioUsd === "number") {
          for (const cb of parsed.chainBalances as ChainBalance[]) prevByChain.set(cb.networkId, cb);
          setChainBalances(parsed.chainBalances);
          setPortfolioUsd(parsed.portfolioUsd);
          setMultiChainLoading(false);
          hasCache = true;
        }
      }
    } catch {}

    if (!hasCache) setMultiChainLoading(true);

    // Load custom chains to include in sweep
    const customChainList = await getCustomChains().catch(() => []);
    const customNetMap: Record<string, Network> = {};
    for (const cc of customChainList) {
      customNetMap[cc.id] = {
        id: cc.id, name: cc.name, chainId: cc.chainId,
        rpcUrl: cc.rpcUrl, symbol: cc.symbol, decimals: cc.decimals,
        explorer: cc.explorer, logo: cc.logo || "",
      };
    }

    // Shared with the background refresher — one sweep implementation.
    const { results, portfolioUsd: total, anySuccess } =
      await sweepEvmNativeBalances(wallet.address, customNetMap, prevByChain);

    // Drop the display update if the wallet changed mid-sweep; the cache write
    // below still goes to THIS wallet's (address-keyed) cache, so it is correct.
    if (!isStale(addr)) {
      setChainBalances(results);
      setPortfolioUsd(total);
      setMultiChainLoading(false);
    }

    // Only persist when something actually succeeded (or there was no cache yet),
    // so a fully-offline refresh never overwrites good cached balances.
    if (anySuccess || !hasCache) {
      try {
        await setItem(cacheKey, JSON.stringify({ ts: Date.now(), chainBalances: results, portfolioUsd: total }));
      } catch {}
    }
  }, [wallet]);

  useEffect(() => { refreshMultiChain(); }, [refreshMultiChain]);

  // Auto-sweep all EVM chains for ERC-20 tokens (memecoins, alts, anything).
  // `force` (manual refresh) bypasses the sweep's freshness gate.
  const refreshAutoTokens = useCallback(async (force = false) => {
    if (!wallet) return;
    const addr = wallet.address;
    await sweepAllChainTokens(wallet.address, (chainId, autoTokens) => {
      // The sweep streams per-chain results over time; a switch mid-sweep must
      // not let the previous wallet's tokens land in the new wallet's list.
      if (isStale(addr)) return;
      setTokensByChain((prev) => {
        const existing = prev[chainId] ?? [];
        const existingByAddr = new Map(existing.map((t) => [t.address.toLowerCase(), t]));
        // Sticky enrichment: a sweep source that carries no price/logo/spam
        // metadata (RPC layer, or Moralis over quota) must not strip fields the
        // previous update already had — that made the portfolio total oscillate
        // by the value of every token whose price flashed away mid-sweep.
        // Balance always comes from the incoming (fresh) row.
        const autoTokensSticky = autoTokens.map((t) => {
          const old: any = existingByAddr.get(t.address.toLowerCase());
          if (!old) return t;
          return {
            ...t,
            priceUsd:         t.priceUsd         ?? old.priceUsd,
            logo:             t.logo             ?? old.logo,
            possibleSpam:     t.possibleSpam     ?? old.possibleSpam,
            securityScore:    t.securityScore    ?? old.securityScore,
            verifiedContract: t.verifiedContract ?? old.verifiedContract,
          };
        });
        // Merge: keep custom tokens not overwritten by auto-detection
        const autoAddrs = new Set(autoTokens.map((t) => t.address.toLowerCase()));
        const onlyCustom = existing.filter((t) => !autoAddrs.has(t.address.toLowerCase()));
        const merged = [...autoTokensSticky, ...onlyCustom];
        // Avoid unnecessary state updates
        if (JSON.stringify(merged) === JSON.stringify(existing)) return prev;
        return { ...prev, [chainId]: merged };
      });
    }, force);
  }, [wallet]);

  useEffect(() => { refreshAutoTokens(); }, [refreshAutoTokens]);

  // Non-EVM chain derivation + SPL token fetch — stale-while-revalidate.
  // Also the single writer of the watch-address registry the background
  // refresher reads (public addresses only).
  useEffect(() => {
    if (!wallet?.mnemonic) {
      setNonEvmLoading(false);
      if (wallet?.address) void updateWatchAddresses({ evm: wallet.address });
      return;
    }
    const mnemonic = wallet.mnemonic;
    const address  = wallet.address;
    (async () => {
      const cacheKey = NONEVMCACHE_PFX + address;
      let hasCache = false;
      // Last-known tokens + chain rows, kept so a failed/offline fetch doesn't
      // drop them (chain rows feed fetchNonEvmBalances' per-chain retention).
      let prevSol: any[] = [];
      let prevTrx: any[] = [];
      let prevSui: any[] = [];
      let prevChains: NonEvmChain[] = [];
      try {
        // Same boot-preload consumption as the multi-chain cache above.
        const raw = (await takeBootNonEvmCache(address)) ?? await getItem(cacheKey);
        if (raw && !isStale(address)) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.solanaTokens)) prevSol = parsed.solanaTokens;
          if (Array.isArray(parsed.tronTokens))   prevTrx = parsed.tronTokens;
          if (Array.isArray(parsed.suiTokens))    prevSui = parsed.suiTokens;
          if (Array.isArray(parsed.chains)) {
            prevChains = parsed.chains;
            setNonEvmChains(parsed.chains);
            // Restore cached SPL/TRC-20/Sui tokens so they show instantly / when offline
            if (prevSol.length || prevTrx.length || prevSui.length) {
              setTokensByChain((prev) => ({
                ...prev,
                ...(prevSol.length ? { solana: prevSol } : {}),
                ...(prevTrx.length ? { tron: prevTrx }   : {}),
                ...(prevSui.length ? { sui: prevSui }    : {}),
              }));
            }
            setNonEvmLoading(false);
            hasCache = true;
          }
        }
      } catch {}

      if (!hasCache) setNonEvmLoading(true);

      try {
        const nev = await deriveNonEvmAddresses(mnemonic);
        if (isStale(address)) return; // switched wallets while deriving
        setNonEvmWallet(nev);
        void updateWatchAddresses({
          evm: address,
          solana: nev.solana.address, tron: nev.tron.address, sui: nev.sui.address,
          bitcoin: nev.bitcoin.address, xrp: nev.xrp.address, litecoin: nev.litecoin.address,
        });

        // Fetch native balances + SPL + TRC-20 + Sui tokens in parallel
        const [chains, splTokens, trc20Tokens, suiCoins] = await Promise.all([
          fetchNonEvmBalances(nev, prevChains),
          fetchSolanaTokens(nev.solana.address).catch(() => null),
          fetchTronTokens(nev.tron.address).catch(() => null),
          fetchSuiTokens(nev.sui.address).catch(() => null),
        ]);

        // null = fetch failed: keep last-known so holdings don't vanish on a
        // bad refresh. [] = provider answered "no tokens": take it, so a token
        // swapped/sent away in full doesn't ghost in the list forever.
        const sol = splTokens   ?? prevSol;
        const trx = trc20Tokens ?? prevTrx;
        const sui = suiCoins    ?? prevSui;

        if (!isStale(address)) {
          setNonEvmChains(chains);
          setTokensByChain((prev) => ({ ...prev, solana: sol, tron: trx, sui: sui }));
        }

        // Persist tokens too (not just native chains) so they survive offline.
        try {
          await setItem(cacheKey, JSON.stringify({
            ts: Date.now(), chains, solanaTokens: sol, tronTokens: trx, suiTokens: sui,
          }));
        } catch {}
      } catch (e) {
        console.error("Non-EVM derivation failed:", e);
      } finally {
        setNonEvmLoading(false);
      }
    })();
  }, [wallet?.mnemonic]);

  // Re-fetch non-EVM balances + SPL tokens without re-deriving addresses.
  // Silent by default: background polls must not flash the "syncing…" header
  // on data that is already on screen. Pass true (manual refresh button) to
  // show the indicator.
  const refreshNonEvm = useCallback(async (showLoading = false) => {
    if (!nonEvmWallet) return;
    if (showLoading) setNonEvmLoading(true);
    try {
      // Read last-known values (tokens AND chain rows) from cache BEFORE the
      // fetch: the chain rows feed fetchNonEvmBalances' per-chain retention so
      // a rate-limited RPC never zeroes a native balance (TRX flapping).
      const addr = wallet?.address;
      const cacheKey = addr ? NONEVMCACHE_PFX + addr : null;
      let prevSol: any[] = [], prevTrx: any[] = [], prevSui: any[] = [];
      let prevChains: NonEvmChain[] = [];
      if (cacheKey) {
        try {
          const raw = await getItem(cacheKey);
          if (raw) {
            const p = JSON.parse(raw);
            prevSol = p.solanaTokens ?? []; prevTrx = p.tronTokens ?? []; prevSui = p.suiTokens ?? [];
            if (Array.isArray(p.chains)) prevChains = p.chains;
          }
        } catch {}
      }

      const [chains, splTokens, trc20Tokens, suiCoins] = await Promise.all([
        fetchNonEvmBalances(nonEvmWallet, prevChains),
        fetchSolanaTokens(nonEvmWallet.solana.address).catch(() => null),
        fetchTronTokens(nonEvmWallet.tron.address).catch(() => null),
        fetchSuiTokens(nonEvmWallet.sui.address).catch(() => null),
      ]);

      // null = fetch failed (keep last-known); [] = authoritative empty (clear).
      const sol = splTokens   ?? prevSol;
      const trx = trc20Tokens ?? prevTrx;
      const sui = suiCoins    ?? prevSui;

      // Drop the display update if the wallet switched mid-fetch; the cache
      // write below is address-keyed, so it stays correct for this wallet.
      if (!addr || !isStale(addr)) {
        setNonEvmChains(chains);
        setTokensByChain((prev) => ({ ...prev, solana: sol, tron: trx, sui: sui }));
      }

      if (cacheKey) {
        try {
          await setItem(cacheKey, JSON.stringify({ ts: Date.now(), chains, solanaTokens: sol, tronTokens: trx, suiTokens: sui }));
        } catch {}
      }
    } catch {}
    finally { setNonEvmLoading(false); }
  }, [nonEvmWallet, wallet?.address]);

  // Manual refresh: the user asked for truth NOW, so every fetcher runs and
  // the token sweep bypasses its freshness gate (itself rate-limited). The
  // old button only refreshed the active chain + non-EVM, which made a fresh
  // deposit invisible until the 3-min sweep TTL expired no matter how often
  // the user pressed it.
  const forceRefreshAll = useCallback(() => {
    refresh();
    refreshMultiChain();
    refreshAutoTokens(true);
    void refreshNonEvm(true);
  }, [refresh, refreshMultiChain, refreshAutoTokens, refreshNonEvm]);

  // Keep balances current while the popup is open. Idle cadence is 25s; after a
  // send/swap marks balances dirty (balanceBus) we refresh at once and poll fast
  // (6s) for a short window, so the new balance appears within seconds instead of
  // lingering until the next tick. Each refresher is stale-while-revalidate, so
  // this never blanks displayed data — it only updates values in place.
  useEffect(() => {
    if (!wallet) return;
    let timer: ReturnType<typeof setTimeout>;
    // During the post-tx dirty window also re-read the active network's native
    // balance + token list (refresh) — they otherwise only load on mount/network
    // change, which would leave the Send/Swap MAX figures stale after a send.
    const runAll = () => {
      refreshMultiChain(); refreshAutoTokens(); refreshNonEvm();
      if (balancesDirty()) refresh();
    };
    const tick = () => {
      runAll();
      timer = setTimeout(tick, balancesDirty() ? 6_000 : 25_000);
    };
    timer = setTimeout(tick, balancesDirty() ? 6_000 : 25_000);
    // A broadcast tx wakes us immediately and drops us into the fast cadence.
    const unsub = subscribeBalanceBus(() => {
      runAll();
      clearTimeout(timer);
      timer = setTimeout(tick, 6_000);
    });
    // Incoming-funds event from the background WS watcher (wsWatch.ts): a
    // deposit landed, refresh now instead of waiting out the idle cadence.
    // Only the background sends this (sender has our id and no tab).
    const onFunds = (msg: unknown, sender: chrome.runtime.MessageSender) => {
      if ((msg as { type?: string })?.type !== "NUMPAY_FUNDS_EVENT") return;
      if (sender.id !== chrome.runtime.id || sender.tab) return;
      runAll();
    };
    const hasRuntime = typeof chrome !== "undefined" && !!chrome.runtime?.onMessage;
    if (hasRuntime) chrome.runtime.onMessage.addListener(onFunds);
    return () => {
      clearTimeout(timer);
      unsub();
      if (hasRuntime) chrome.runtime.onMessage.removeListener(onFunds);
    };
  }, [wallet, refreshMultiChain, refreshAutoTokens, refreshNonEvm, refresh]);

  function switchNetwork(id: string) {
    if (NETWORKS[id]) { setNetworkId(id); setItem(NETWORK_KEY, id); }
  }

  function switchChain(id: string) {
    setActiveChainId(id);
    setItem(ACTIVE_CHAIN_KEY, id);
    // Always update networkId; network memo resolves built-in + custom chains
    setNetworkId(id);
    setItem(NETWORK_KEY, id);
    notifyDappState(); // emit chainChanged to connected dApps
  }

  function setAssetFilter(id: string | null) {
    setFilterChainIdState(id);
    setItem(ASSET_FILTER_KEY, id ?? "all");
  }

  const activeAddress = useMemo(() => {
    if (NETWORKS[activeChainId] || customChains.find((c) => c.id === activeChainId))
      return wallet?.address ?? "";
    if (activeChainId === "bitcoin")     return nonEvmWallet?.bitcoin.address  ?? "";
    if (activeChainId === "solana")      return nonEvmWallet?.solana.address   ?? "";
    if (activeChainId === "sui")         return nonEvmWallet?.sui.address      ?? "";
    if (activeChainId === "tron")        return nonEvmWallet?.tron.address     ?? "";
    if (activeChainId === "xrp")         return nonEvmWallet?.xrp.address      ?? "";
    if (activeChainId === "litecoin")    return nonEvmWallet?.litecoin.address ?? "";
    return "";
  }, [activeChainId, wallet, nonEvmWallet, customChains]);

  // Switch to another wallet. With "unlock all" semantics every wallet that
  // shares the unlock password is already decrypted in the session, so the
  // switch is instant and needs no password: it just re-points activeId while
  // leaving the other unlocked wallets in place. A wallet that is NOT in the
  // session (encrypted under a different password) throws PasswordRequired so
  // the caller can prompt; passing `password` then decrypts it on demand and
  // adds it to the session.
  const switchActiveWallet = useCallback(async (id: string, password?: string) => {
    if (id === activeWalletId) return;

    const raw = await getSession(SESSION_KEY);
    const session: WalletSession = raw ? JSON.parse(raw) : { activeId: id, wallets: {} };

    let walletData = session.wallets?.[id];
    if (!walletData) {
      if (!password) {
        const err = new Error("PasswordRequired");
        err.name = "PasswordRequired";
        throw err;
      }
      walletData = (await unlockActiveVault(password, id)).wallet;
      session.wallets = { ...session.wallets, [id]: walletData };
    }

    session.activeId = id;
    await setSession(SESSION_KEY, JSON.stringify(session));
    await setActiveId(id);
    await touchActivity();

    // Drop the previous wallet's optimistic balance overlays: they are keyed
    // by chain|token, not by wallet, so leaving them would apply the old
    // wallet's pending deltas to the new wallet's balances.
    clearBalanceOverlays();
    // Point the staleness guard at the new wallet BEFORE any of its fetchers
    // run, so any still-in-flight fetch from the previous wallet is dropped.
    activeAddrRef.current = walletData.address.toLowerCase();

    setWallet(walletData);
    setActiveWalletId(id);
    setBalance("0");
    setTokens([]);
    setTokensByChain({});
    setChainBalances([]);
    setNonEvmWallet(null);
    setNonEvmChains([]);
    // emit accountsChanged (EVM) + accountChanged (Solana) to connected dApps
    notifyDappState(await solAddressForNotify(walletData));
  }, [activeWalletId]);

  // Adding a freshly created/imported wallet makes it active. We already hold
  // its plaintext, so no decrypt is needed; it is merged into the session
  // alongside the other unlocked wallets so switching between them stays instant.
  const addWalletToSession = useCallback(async (walletData: WalletData, id: string, meta: VaultMeta) => {
    const raw = await getSession(SESSION_KEY);
    const session: WalletSession = raw ? JSON.parse(raw) : { activeId: id, wallets: {} };
    session.wallets = { ...session.wallets, [id]: walletData };
    session.activeId = id;
    await setSession(SESSION_KEY, JSON.stringify(session));
    await setActiveId(id);
    await touchActivity();

    // A newly added/imported wallet becomes active: clear any overlays from the
    // previously active wallet (keyed by chain|token, not by wallet).
    clearBalanceOverlays();
    activeAddrRef.current = walletData.address.toLowerCase();

    setWallet(walletData);
    setActiveWalletId(id);
    setWalletMetas((prev) => [...prev.filter((m) => m.id !== id), meta]);
    setBalance("0");
    setTokens([]);
    setTokensByChain({});
    setChainBalances([]);
    setNonEvmWallet(null);
    setNonEvmChains([]);
    // new active wallet => accountsChanged (EVM) + accountChanged (Solana)
    notifyDappState(await solAddressForNotify(walletData));
  }, []);

  const removeWalletMeta = useCallback((id: string) => {
    setWalletMetas((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const setWalletAvatar = useCallback(async (id: string, avatar: string) => {
    await updateWalletAvatar(id, avatar);
    setWalletMetas((prev) => prev.map((m) => m.id === id ? { ...m, avatar: avatar || undefined } : m));
  }, []);

  // ── Optimistic balance overlay ────────────────────────────────────────────
  // A just-broadcast send/swap registers its expected deltas on the balance bus;
  // these memos apply them on top of the fetched state so the displayed numbers
  // move the instant the tx is sent. pendingDeltaFor also advances the entry
  // lifecycle: once the fetched value moves (the chain caught up) the delta
  // stops being applied and truth takes over. Each asset lives in exactly one
  // of the three structures, so an entry's baseline is pinned to one source.
  const overlayVer = useSyncExternalStore(subscribeBalanceBus, overlayVersion);

  const fmtBal = (n: number) => {
    const s = n.toFixed(8).replace(/\.?0+$/, "");
    return s === "" || s === "-" ? "0" : s;
  };

  const [displayChainBalances, displayPortfolioUsd] = useMemo((): [ChainBalance[], number] => {
    if (!hasPendingOverlays()) return [chainBalances, portfolioUsd];
    let usdShift = 0;
    const list = chainBalances.map((cb) => {
      const d = pendingDeltaFor(cb.networkId, undefined, cb.balanceNum);
      if (!d) return cb;
      const price = cb.balanceNum > 0 ? cb.usdValue / cb.balanceNum : 0;
      const num = Math.max(0, cb.balanceNum + d);
      const usd = num * price;
      usdShift += usd - cb.usdValue;
      return { ...cb, balanceNum: num, balance: fmtBal(num), usdValue: usd };
    });
    return [list, Math.max(0, portfolioUsd + usdShift)];
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chainBalances, portfolioUsd, overlayVer]);

  const displayNonEvmChains = useMemo(() => {
    if (!hasPendingOverlays()) return nonEvmChains;
    return nonEvmChains.map((c) => {
      const d = pendingDeltaFor(c.id, undefined, c.balance);
      return d ? { ...c, balance: Math.max(0, c.balance + d) } : c;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nonEvmChains, overlayVer]);

  const displayTokensByChain = useMemo(() => {
    if (!hasPendingOverlays()) return tokensByChain;
    const out: Record<string, Token[]> = {};
    for (const [chainId, list] of Object.entries(tokensByChain)) {
      out[chainId] = list.map((t) => {
        if (!t.address) return t;
        const bal = parseFloat(t.balance || "0");
        const d = pendingDeltaFor(chainId, t.address, bal);
        return d ? { ...t, balance: fmtBal(Math.max(0, bal + d)) } : t;
      });
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tokensByChain, overlayVer]);

  return {
    wallet, network, balance, tokens, tokensByChain: displayTokensByChain, loading, switchNetwork,
    activeChainId, activeAddress, switchChain, filterChainId, setAssetFilter,
    refresh, refreshNonEvm, forceRefreshAll, portfolioUsd: displayPortfolioUsd, chainBalances: displayChainBalances, multiChainLoading,
    nonEvmWallet, nonEvmChains: displayNonEvmChains, nonEvmLoading,
    walletMetas, activeWalletId, switchActiveWallet, addWalletToSession, removeWalletMeta,
    setWalletAvatar, customChains,
  };
}

// ── Shared instance ─────────────────────────────────────────────────────────
// The heavy hook above must run exactly ONCE per popup, above the router, so
// every page reads the same wallet state. Previously each page called the hook
// directly and got its own private copy seeded from the frozen boot snapshot,
// so navigating to a page (Send, TokenDetail, …) after switching wallets
// re-seeded a stale copy and silently reverted to the wallet that was active at
// popup-open. A single provider fixes that and collapses N duplicate
// balance-polling loops (one per mounted page) into one.
const WalletContext = createContext<WalletState | null>(null);

export function WalletProvider({ children }: { children: ReactNode }) {
  const value = useWalletState();
  return createElement(WalletContext.Provider, { value }, children);
}

export function useWallet(): WalletState {
  const ctx = useContext(WalletContext);
  if (!ctx) throw new Error("useWallet must be used within <WalletProvider>");
  return ctx;
}

// Derive the new active wallet's Solana address for a wallet-change dApp
// notification, so the router can emit Solana accountChanged. Returns "" when
// the wallet has no mnemonic (no derivable Solana account), which tells the
// router to drop any stale Solana connections rather than expose them.
async function solAddressForNotify(wallet: WalletData): Promise<string> {
  try {
    if (wallet.mnemonic) return (await deriveSolanaAddress(wallet.mnemonic)).address;
  } catch {
    /* fall through to "" */
  }
  return "";
}

export async function cacheWalletSession(wallet: WalletData, id: string): Promise<void> {
  const session: WalletSession = { activeId: id, wallets: { [id]: wallet } };
  await setSession(SESSION_KEY, JSON.stringify(session));
  await touchActivity();
  // unlock/create/import changes the exposed account (EVM + Solana)
  notifyDappState(await solAddressForNotify(wallet));
}

// Unlock-all: cache every decrypted wallet in one session blob so account
// switching afterwards needs no password. `preferredActiveId` (the previously
// active wallet) stays active when present, else the first decrypted wallet is.
export async function cacheUnlockedWallets(
  decrypted: Array<{ id: string; wallet: WalletData }>,
  preferredActiveId?: string
): Promise<void> {
  const wallets: Record<string, WalletData> = {};
  for (const { id, wallet } of decrypted) wallets[id] = wallet;
  const activeId =
    preferredActiveId && wallets[preferredActiveId] ? preferredActiveId : decrypted[0].id;
  const session: WalletSession = { activeId, wallets };
  await setSession(SESSION_KEY, JSON.stringify(session));
  await touchActivity();
  notifyDappState(await solAddressForNotify(wallets[activeId]));
}
