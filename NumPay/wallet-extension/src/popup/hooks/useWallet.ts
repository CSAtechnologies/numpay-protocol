import { useState, useEffect, useCallback, useMemo, useSyncExternalStore } from "react";
import { ethers } from "ethers";
import { type WalletData, type VaultMeta, setActiveId, updateWalletAvatar, touchActivity, unlockActiveVault, SESSION_KEY } from "@/lib/wallet";
import { notifyDappState } from "@/lib/dapp/notify";
import { deriveSolanaAddress } from "@/lib/chains/solana";
import { getItem, setItem, getSession, setSession } from "@/lib/storage";
import {
  balancesDirty, subscribeBalanceBus, overlayVersion, hasPendingOverlays, pendingDeltaFor,
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
  bootData, takeBootBalanceCache, takeBootNonEvmCache,
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
  refreshNonEvm: () => Promise<void>;
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

export function useWallet(): WalletState {
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
      // session after the snapshot) — so fall back to a fresh read.
      const cached = boot.sessionRaw ?? await getSession(SESSION_KEY);
      if (cached) {
        try {
          const parsed = JSON.parse(cached);
          if (parsed.wallets && parsed.activeId) {
            const walletData = parsed.wallets[parsed.activeId] as WalletData | undefined;
            if (walletData) setWallet(walletData);
            setActiveWalletId(parsed.activeId);
          } else if (parsed.address) {
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
    setLoading(true);
    // staticNetwork: skip the eth_chainId auto-detect round-trip — we already know
    // the chain id, so there's no reason to ask the RPC for it on every provider.
    const provider = new ethers.JsonRpcProvider(network.rpcUrl, network.chainId, { staticNetwork: true });

    try {
      const bal = await provider.getBalance(wallet.address);
      setBalance(ethers.formatUnits(bal, network.decimals));
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

    const withBalances = await Promise.all(
      allTokens.map(async (t) => {
        try {
          const b = await getTokenBalance(t.address, wallet.address, provider);
          return { ...t, balance: b };
        } catch {
          return { ...t, balance: "0" };
        }
      })
    );
    setTokens(withBalances);
    setTokensByChain((prev) => ({ ...prev, [network.id]: withBalances }));
    setLoading(false);
  }, [wallet, network]);

  useEffect(() => { refresh(); }, [refresh]);

  // Multi-chain aggregate balance — stale-while-revalidate, includes custom chains
  const refreshMultiChain = useCallback(async () => {
    if (!wallet) return;

    const cacheKey = EVM_CACHE_PFX + wallet.address;
    let hasCache = false;
    // Last-known balances, kept so a failed/offline fetch doesn't zero them out.
    const prevByChain = new Map<string, ChainBalance>();
    try {
      // First run consumes the boot-preloaded snapshot (already in memory);
      // later runs read storage fresh.
      const raw = (await takeBootBalanceCache(wallet.address)) ?? await getItem(cacheKey);
      if (raw) {
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

    setChainBalances(results);
    setPortfolioUsd(total);
    setMultiChainLoading(false);

    // Only persist when something actually succeeded (or there was no cache yet),
    // so a fully-offline refresh never overwrites good cached balances.
    if (anySuccess || !hasCache) {
      try {
        await setItem(cacheKey, JSON.stringify({ ts: Date.now(), chainBalances: results, portfolioUsd: total }));
      } catch {}
    }
  }, [wallet]);

  useEffect(() => { refreshMultiChain(); }, [refreshMultiChain]);

  // Auto-sweep all EVM chains for ERC-20 tokens (memecoins, alts, anything)
  const refreshAutoTokens = useCallback(async () => {
    if (!wallet) return;
    await sweepAllChainTokens(wallet.address, (chainId, autoTokens) => {
      setTokensByChain((prev) => {
        const existing = prev[chainId] ?? [];
        // Merge: keep custom tokens not overwritten by auto-detection
        const autoAddrs = new Set(autoTokens.map((t) => t.address.toLowerCase()));
        const onlyCustom = existing.filter((t) => !autoAddrs.has(t.address.toLowerCase()));
        const merged = [...autoTokens, ...onlyCustom];
        // Avoid unnecessary state updates
        if (JSON.stringify(merged) === JSON.stringify(existing)) return prev;
        return { ...prev, [chainId]: merged };
      });
    });
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
      // Last-known tokens, kept so a failed/offline fetch doesn't drop them.
      let prevSol: any[] = [];
      let prevTrx: any[] = [];
      let prevSui: any[] = [];
      try {
        // Same boot-preload consumption as the multi-chain cache above.
        const raw = (await takeBootNonEvmCache(address)) ?? await getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.solanaTokens)) prevSol = parsed.solanaTokens;
          if (Array.isArray(parsed.tronTokens))   prevTrx = parsed.tronTokens;
          if (Array.isArray(parsed.suiTokens))    prevSui = parsed.suiTokens;
          if (Array.isArray(parsed.chains)) {
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
        setNonEvmWallet(nev);
        void updateWatchAddresses({
          evm: address,
          solana: nev.solana.address, tron: nev.tron.address, sui: nev.sui.address,
          bitcoin: nev.bitcoin.address, xrp: nev.xrp.address, litecoin: nev.litecoin.address,
        });

        // Fetch native balances + SPL + TRC-20 + Sui tokens in parallel
        const [chains, splTokens, trc20Tokens, suiCoins] = await Promise.all([
          fetchNonEvmBalances(nev),
          fetchSolanaTokens(nev.solana.address).catch(() => []),
          fetchTronTokens(nev.tron.address).catch(() => []),
          fetchSuiTokens(nev.sui.address).catch(() => []),
        ]);

        // Keep last-known tokens when a fetch came back empty (offline/flaky),
        // so SPL/TRC-20/Sui holdings don't vanish on a bad refresh.
        const sol = splTokens.length  ? splTokens  : prevSol;
        const trx = trc20Tokens.length ? trc20Tokens : prevTrx;
        const sui = suiCoins.length ? suiCoins : prevSui;

        setNonEvmChains(chains);
        setTokensByChain((prev) => ({
          ...prev,
          ...(sol.length ? { solana: sol } : {}),
          ...(trx.length ? { tron: trx }   : {}),
          ...(sui.length ? { sui: sui }    : {}),
        }));

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

  // Re-fetch non-EVM balances + SPL tokens without re-deriving addresses
  const refreshNonEvm = useCallback(async () => {
    if (!nonEvmWallet) return;
    setNonEvmLoading(true);
    try {
      const [chains, splTokens, trc20Tokens, suiCoins] = await Promise.all([
        fetchNonEvmBalances(nonEvmWallet),
        fetchSolanaTokens(nonEvmWallet.solana.address).catch(() => []),
        fetchTronTokens(nonEvmWallet.tron.address).catch(() => []),
        fetchSuiTokens(nonEvmWallet.sui.address).catch(() => []),
      ]);

      // Preserve last-known tokens (from cache) when a fetch returns empty.
      const addr = wallet?.address;
      const cacheKey = addr ? NONEVMCACHE_PFX + addr : null;
      let prevSol: any[] = [], prevTrx: any[] = [], prevSui: any[] = [];
      if (cacheKey) {
        try {
          const raw = await getItem(cacheKey);
          if (raw) { const p = JSON.parse(raw); prevSol = p.solanaTokens ?? []; prevTrx = p.tronTokens ?? []; prevSui = p.suiTokens ?? []; }
        } catch {}
      }
      const sol = splTokens.length  ? splTokens  : prevSol;
      const trx = trc20Tokens.length ? trc20Tokens : prevTrx;
      const sui = suiCoins.length ? suiCoins : prevSui;

      setNonEvmChains(chains);
      setTokensByChain((prev) => ({
        ...prev,
        ...(sol.length ? { solana: sol } : {}),
        ...(trx.length ? { tron: trx }   : {}),
        ...(sui.length ? { sui: sui }    : {}),
      }));

      if (cacheKey) {
        try {
          await setItem(cacheKey, JSON.stringify({ ts: Date.now(), chains, solanaTokens: sol, tronTokens: trx, suiTokens: sui }));
        } catch {}
      }
    } catch {}
    finally { setNonEvmLoading(false); }
  }, [nonEvmWallet, wallet?.address]);

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
    return () => { clearTimeout(timer); unsub(); };
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
    refresh, refreshNonEvm, portfolioUsd: displayPortfolioUsd, chainBalances: displayChainBalances, multiChainLoading,
    nonEvmWallet, nonEvmChains: displayNonEvmChains, nonEvmLoading,
    walletMetas, activeWalletId, switchActiveWallet, addWalletToSession, removeWalletMeta,
    setWalletAvatar, customChains,
  };
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
