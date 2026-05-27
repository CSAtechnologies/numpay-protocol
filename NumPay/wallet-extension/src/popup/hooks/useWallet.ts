import { useState, useEffect, useCallback, useMemo } from "react";
import { ethers } from "ethers";
import { type WalletData, type VaultMeta, listVaultMeta, getActiveId, setActiveId, updateWalletAvatar } from "@/lib/wallet";
import { getItem, setItem } from "@/lib/storage";
import { NETWORKS, DEFAULT_NETWORK, type Network } from "@/lib/networks";
import { DEFAULT_TOKENS, getTokenBalance, type Token } from "@/lib/tokens";
import {
  deriveNonEvmAddresses,
  fetchNonEvmBalances,
  fetchSolanaTokens,
  fetchTronTokens,
  type NonEvmWallet,
  type NonEvmChain,
} from "@/lib/chains";
import { getCustomTokens } from "@/lib/customTokens";
import { getCustomChains, type CustomChain } from "@/lib/customChains";
import { sweepAllChainTokens } from "@/lib/autoTokens";

const NETWORK_KEY      = "numpay_network";
const ACTIVE_CHAIN_KEY = "numpay_active_chain";
const ASSET_FILTER_KEY = "numpay_asset_filter";
const EVM_TIMEOUT_MS   = 5000;
const EVM_CACHE_PFX    = "numpay_balcache_";
const NONEVMCACHE_PFX  = "numpay_nonevmcache_";

export interface ChainBalance {
  networkId: string;
  name: string;
  symbol: string;
  logo: string;
  balance: string;
  balanceNum: number;
  usdValue: number;
}

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
  switchActiveWallet: (id: string) => Promise<void>;
  addWalletToSession: (wallet: WalletData, id: string, meta: VaultMeta) => Promise<void>;
  removeWalletMeta: (id: string) => void;
  setWalletAvatar: (id: string, avatar: string) => Promise<void>;
  customChains: CustomChain[];
}

const NATIVE_USD_PRICES: Record<string, number> = {
  ETH: 1800, BTC: 65000, SOL: 140, SUI: 1.2, POL: 0.45,
  AVAX: 25, BNB: 300, FTM: 0.35, MNT: 0.55, SEI: 0.35,
  TRX: 0.12, XRP: 0.50, LTC: 80,
};

const AGGREGATE_CHAINS = [
  "ethereum", "polygon", "arbitrum", "optimism", "base",
  "avalanche", "bsc", "zksync", "scroll", "linea",
  "mantle", "blast", "polygonzkevm", "fantom", "sei",
];

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

  // Load wallet and settings from storage on mount
  useEffect(() => {
    (async () => {
      const saved = await getItem(NETWORK_KEY);
      if (saved) setNetworkId(saved);

      const savedChain = await getItem(ACTIVE_CHAIN_KEY);
      if (savedChain) setActiveChainId(savedChain);

      const savedFilter = await getItem(ASSET_FILTER_KEY);
      if (savedFilter && savedFilter !== "all") setFilterChainIdState(savedFilter);

      // Load custom chains early so network resolution works correctly
      try {
        const chains = await getCustomChains();
        setCustomChains(chains);
      } catch {}

      const cached = await getItem("numpay_session");
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
        } catch {}
      }

      try {
        const metas = await listVaultMeta();
        setWalletMetas(metas);
        const savedActiveId = await getActiveId();
        if (savedActiveId) setActiveWalletId((prev) => prev || savedActiveId);
      } catch {}
    })();
  }, []);

  // Fetch current-network balance + tokens (built-in + custom)
  const refresh = useCallback(async () => {
    if (!wallet) return;
    setLoading(true);
    const provider = new ethers.JsonRpcProvider(network.rpcUrl);

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
    try {
      const raw = await getItem(cacheKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed.chainBalances) && typeof parsed.portfolioUsd === "number") {
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

    const allChainIds = [...AGGREGATE_CHAINS, ...customChainList.map((c) => c.id)];

    const promises = allChainIds.map(async (chainId) => {
      const net = NETWORKS[chainId] || customNetMap[chainId];
      if (!net) return null;
      try {
        const provider = new ethers.JsonRpcProvider(net.rpcUrl);
        const bal = await Promise.race([
          provider.getBalance(wallet.address),
          new Promise<never>((_, r) => setTimeout(() => r(new Error("timeout")), EVM_TIMEOUT_MS)),
        ]) as bigint;
        const formatted = ethers.formatUnits(bal, net.decimals);
        const num = parseFloat(formatted);
        return {
          networkId: chainId, name: net.name, symbol: net.symbol, logo: net.logo,
          balance: formatted, balanceNum: num, usdValue: num * (NATIVE_USD_PRICES[net.symbol] || 0),
        } as ChainBalance;
      } catch {
        return {
          networkId: chainId, name: net.name, symbol: net.symbol, logo: net.logo,
          balance: "0", balanceNum: 0, usdValue: 0,
        } as ChainBalance;
      }
    });

    const settled = await Promise.all(promises);
    const results: ChainBalance[] = [];
    for (const r of settled) { if (r) results.push(r); }
    results.sort((a, b) => b.usdValue - a.usdValue);
    const total = results.reduce((s, c) => s + c.usdValue, 0);

    setChainBalances(results);
    setPortfolioUsd(total);
    setMultiChainLoading(false);

    try {
      await setItem(cacheKey, JSON.stringify({ ts: Date.now(), chainBalances: results, portfolioUsd: total }));
    } catch {}
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

  // Non-EVM chain derivation + SPL token fetch — stale-while-revalidate
  useEffect(() => {
    if (!wallet?.mnemonic) { setNonEvmLoading(false); return; }
    const mnemonic = wallet.mnemonic;
    const address  = wallet.address;
    (async () => {
      const cacheKey = NONEVMCACHE_PFX + address;
      let hasCache = false;
      try {
        const raw = await getItem(cacheKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (Array.isArray(parsed.chains)) {
            setNonEvmChains(parsed.chains);
            setNonEvmLoading(false);
            hasCache = true;
          }
        }
      } catch {}

      if (!hasCache) setNonEvmLoading(true);

      try {
        const nev = await deriveNonEvmAddresses(mnemonic);
        setNonEvmWallet(nev);

        // Fetch native balances + SPL tokens + TRC-20 tokens in parallel
        const [chains, splTokens, trc20Tokens] = await Promise.all([
          fetchNonEvmBalances(nev),
          fetchSolanaTokens(nev.solana.address).catch(() => []),
          fetchTronTokens(nev.tron.address).catch(() => []),
        ]);

        setNonEvmChains(chains);
        setTokensByChain((prev) => ({
          ...prev,
          ...(splTokens.length > 0  ? { solana: splTokens }      : {}),
          ...(trc20Tokens.length > 0 ? { tron: trc20Tokens }     : {}),
        }));

        try { await setItem(cacheKey, JSON.stringify({ ts: Date.now(), chains })); } catch {}
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
      const [chains, splTokens, trc20Tokens] = await Promise.all([
        fetchNonEvmBalances(nonEvmWallet),
        fetchSolanaTokens(nonEvmWallet.solana.address).catch(() => []),
        fetchTronTokens(nonEvmWallet.tron.address).catch(() => []),
      ]);
      setNonEvmChains(chains);
      setTokensByChain((prev) => ({
        ...prev,
        ...(splTokens.length > 0   ? { solana: splTokens }  : {}),
        ...(trc20Tokens.length > 0 ? { tron: trc20Tokens }  : {}),
      }));
    } catch {}
    finally { setNonEvmLoading(false); }
  }, [nonEvmWallet]);

  function switchNetwork(id: string) {
    if (NETWORKS[id]) { setNetworkId(id); setItem(NETWORK_KEY, id); }
  }

  function switchChain(id: string) {
    setActiveChainId(id);
    setItem(ACTIVE_CHAIN_KEY, id);
    // Always update networkId; network memo resolves built-in + custom chains
    setNetworkId(id);
    setItem(NETWORK_KEY, id);
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

  const switchActiveWallet = useCallback(async (id: string) => {
    const raw = await getItem("numpay_session");
    if (!raw) return;
    try {
      const session: WalletSession = JSON.parse(raw);
      const walletData = session.wallets?.[id];
      if (!walletData) return;

      session.activeId = id;
      await setItem("numpay_session", JSON.stringify(session));
      await setActiveId(id);

      setWallet(walletData);
      setActiveWalletId(id);
      setBalance("0");
      setTokens([]);
      setTokensByChain({});
      setChainBalances([]);
      setNonEvmWallet(null);
      setNonEvmChains([]);
    } catch {}
  }, []);

  const addWalletToSession = useCallback(async (walletData: WalletData, id: string, meta: VaultMeta) => {
    const raw = await getItem("numpay_session");
    let session: WalletSession = { activeId: id, wallets: {} };
    if (raw) {
      try {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.activeId && typeof parsed.wallets === "object") {
          session = parsed;
        }
      } catch {}
    }
    if (!session.wallets || typeof session.wallets !== "object") session.wallets = {};
    session.wallets[id] = walletData;
    session.activeId = id;
    await setItem("numpay_session", JSON.stringify(session));
    await setActiveId(id);

    setWallet(walletData);
    setActiveWalletId(id);
    setWalletMetas((prev) => [...prev.filter((m) => m.id !== id), meta]);
    setBalance("0");
    setTokens([]);
    setTokensByChain({});
    setChainBalances([]);
    setNonEvmWallet(null);
    setNonEvmChains([]);
  }, []);

  const removeWalletMeta = useCallback((id: string) => {
    setWalletMetas((prev) => prev.filter((m) => m.id !== id));
  }, []);

  const setWalletAvatar = useCallback(async (id: string, avatar: string) => {
    await updateWalletAvatar(id, avatar);
    setWalletMetas((prev) => prev.map((m) => m.id === id ? { ...m, avatar: avatar || undefined } : m));
  }, []);

  return {
    wallet, network, balance, tokens, tokensByChain, loading, switchNetwork,
    activeChainId, activeAddress, switchChain, filterChainId, setAssetFilter,
    refresh, refreshNonEvm, portfolioUsd, chainBalances, multiChainLoading,
    nonEvmWallet, nonEvmChains, nonEvmLoading,
    walletMetas, activeWalletId, switchActiveWallet, addWalletToSession, removeWalletMeta,
    setWalletAvatar, customChains,
  };
}

export async function cacheAllWalletSessions(
  wallets: Array<{ id: string; wallet: WalletData }>,
  activeId: string
): Promise<void> {
  const session: WalletSession = { activeId, wallets: {} };
  for (const { id, wallet } of wallets) session.wallets[id] = wallet;
  await setItem("numpay_session", JSON.stringify(session));
}

export async function cacheWalletSession(wallet: WalletData, id: string): Promise<void> {
  const session: WalletSession = { activeId: id, wallets: { [id]: wallet } };
  await setItem("numpay_session", JSON.stringify(session));
}
