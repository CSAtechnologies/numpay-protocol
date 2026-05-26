import { useState, useEffect, useMemo } from "react";
import { useNavigate } from "react-router-dom";
import {
  lockWallet, addEncryptedWallet,
  createWallet, importFromMnemonic, importFromPrivateKey,
  type VaultMeta,
} from "@/lib/wallet";
import { NETWORKS, BPAN_CHAINS } from "@/lib/networks";
import { findOwnedBPANs } from "@/lib/bpan";
import { type Rates, usdToDisplayCurrency } from "@/lib/currency";

const SYMBOL_TO_COINGECKO: Record<string, string> = {
  ETH: "ethereum", BTC: "bitcoin", SOL: "solana", SUI: "sui",
  MATIC: "matic-network", POL: "matic-network",
  AVAX: "avalanche-2", BNB: "binancecoin", FTM: "fantom",
  MNT: "mantle", SEI: "sei-network",
  TRX: "tron", XRP: "ripple", LTC: "litecoin",
};

function getConvertedPrice(symbol: string, targetCurrency: string, rates: Rates): number {
  const coinId = SYMBOL_TO_COINGECKO[symbol] || "ethereum";
  return rates[coinId]?.[targetCurrency] || 0;
}

import { useWallet } from "../hooks/useWallet";
import { useCurrency } from "../hooks/useCurrency";
import Layout from "../components/Layout";
import {
  LockIcon, CopyIcon, ReceiveIcon, RefreshIcon,
  ChevronDownIcon, ChevronRightIcon, ArrowUpRightIcon, ChainIcon, CheckIcon, TokenIcon,
  SwapIcon, LayersIcon, HashIcon,
} from "../components/Icons";

interface Props {
  onLock: () => void;
}

function getSavedBPANs(address: string): string[] {
  try { return JSON.parse(localStorage.getItem(`bpan_numbers_${address.toLowerCase()}`) || "[]"); }
  catch { return []; }
}

function saveBPANs(address: string, numbers: string[]) {
  try { localStorage.setItem(`bpan_numbers_${address.toLowerCase()}`, JSON.stringify(numbers)); }
  catch {}
}

async function copyToClipboard(text: string) {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

interface DisplayToken {
  symbol: string;
  name: string;
  logo?: string;
  balance: string;
  usdValue: number;
  chainName?: string;
  chainLogo?: string;
  chainId?: string;
  isNative: boolean;
}

export default function Dashboard({ onLock }: Props) {
  const navigate = useNavigate();
  const {
    wallet, network, tokens, tokensByChain, loading, switchNetwork, refresh, refreshNonEvm,
    activeChainId, activeAddress, switchChain, filterChainId, setAssetFilter,
    portfolioUsd, chainBalances, multiChainLoading,
    nonEvmChains, nonEvmLoading,
    walletMetas, activeWalletId, switchActiveWallet, addWalletToSession, setWalletAvatar,
    customChains,
  } = useWallet();
  const { rates, currencyCode, currency } = useCurrency();
  const [showNetworks, setShowNetworks] = useState(false);

  const NON_EVM_CHAINS = BPAN_CHAINS.filter((c) => !c.isEVM);
  // Derive display info for whatever chain is currently active
  const activeEvmNetwork = NETWORKS[activeChainId] ?? null;
  const activeNonEvmChain = !activeEvmNetwork
    ? NON_EVM_CHAINS.find((c) => c.id === activeChainId) ?? null
    : null;
  const activeChainName = activeEvmNetwork ? activeEvmNetwork.name : (activeNonEvmChain?.name ?? "Unknown");
  const activeChainLogo = activeEvmNetwork ? activeEvmNetwork.logo : (activeNonEvmChain?.logo ?? "");
  const [showWallets, setShowWallets] = useState(false);
  const [copied, setCopied] = useState("");
  const [bpan, setBpan] = useState<string | null>(null);
  const [showDust, setShowDust] = useState(false);

  // Add account inline form
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const [emojiTargetId, setEmojiTargetId] = useState<string | null>(null);

  const [showAddWallet, setShowAddWallet] = useState(false);
  const [addTab, setAddTab] = useState<"create" | "import">("create");
  const [addName, setAddName] = useState("");
  const [addInput, setAddInput] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  // Reset and reload BPAN whenever the active wallet address changes.
  // Remove the old address-less key if it still exists so stale data cannot leak.
  useEffect(() => {
    setBpan(null);
    if (!wallet?.address) return;
    localStorage.removeItem("bpan_numbers");
    const saved = getSavedBPANs(wallet.address);
    if (saved.length > 0) setBpan(saved[0]);
  }, [wallet?.address]);

  // Query on-chain for BPANs owned by this wallet address and merge into
  // the per-address cache so future loads are instant.
  useEffect(() => {
    const addr = wallet?.address;
    if (!addr) return;

    let cancelled = false;
    (async () => {
      try {
        const owned = await findOwnedBPANs(addr);
        if (cancelled || owned.length === 0) return;

        const saved = getSavedBPANs(addr);
        const merged = Array.from(new Set([...saved, ...owned]));
        if (merged.length !== saved.length) saveBPANs(addr, merged);
        setBpan((prev) => prev || owned[0]);
      } catch (e) {
        console.warn("BPAN discovery failed:", e);
      }
    })();

    return () => { cancelled = true; };
  }, [wallet?.address]);

  async function handleLock() {
    await lockWallet();
    onLock();
  }

  async function handleCopy(text: string, label: string) {
    await copyToClipboard(text);
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  }

  async function handleAddWallet() {
    setAddError("");
    setAddLoading(true);
    try {
      let walletData;
      if (addTab === "create") {
        walletData = createWallet();
      } else {
        const raw = addInput.trim();
        if (!raw) throw new Error("Enter a recovery phrase or private key");
        walletData = raw.includes(" ") ? importFromMnemonic(raw) : importFromPrivateKey(raw);
      }
      const name = addName.trim() || `Wallet ${walletMetas.length + 1}`;
      const id = await addEncryptedWallet(walletData, addPassword, name);
      const meta: VaultMeta = { id, name, address: walletData.address };
      await addWalletToSession(walletData, id, meta);
      setShowAddWallet(false);
      setAddName(""); setAddInput(""); setAddPassword("");
    } catch (e: any) {
      setAddError(e.message || "Failed to add wallet");
    } finally {
      setAddLoading(false);
    }
  }

  const displayAddr = activeAddress || wallet?.address || "";
  const shortAddr = displayAddr
    ? `${displayAddr.slice(0, 6)}…${displayAddr.slice(-4)}`
    : "——";

  const bpanFormatted = bpan
    ? `${bpan.slice(0, 3)}-${bpan.slice(3, 7)}-${bpan.slice(7)}`
    : null;

  // Live portfolio in selected currency — includes native + ERC-20 tokens (not SPL/unknown price)
  const livePortfolio = useMemo(() => {
    let total = 0;
    for (const cb of chainBalances) {
      const price = getConvertedPrice(cb.symbol, currencyCode, rates);
      total += cb.balanceNum * (price || 0);
    }
    for (const nc of nonEvmChains) {
      const price = getConvertedPrice(nc.symbol, currencyCode, rates);
      total += nc.balance * (price || 0);
    }
    // Only count EVM chain tokens (chainId in NETWORKS or customChains) — SPL tokens lack reliable USD price
    for (const [chainId, chainTokens] of Object.entries(tokensByChain)) {
      const isEvmChain = !!NETWORKS[chainId] || customChains.some((c) => c.id === chainId);
      if (!isEvmChain) continue;
      for (const t of chainTokens) {
        const bal = parseFloat(t.balance || "0");
        if (bal > 0) total += usdToDisplayCurrency(bal, currencyCode, rates);
      }
    }
    return total || portfolioUsd;
  }, [chainBalances, nonEvmChains, tokensByChain, rates, portfolioUsd, currencyCode, customChains]);

  // Build token list from all chains, then apply optional chain filter
  const { visibleTokens, dustTokens } = useMemo(() => {
    const all: DisplayToken[] = [];

    for (const cb of chainBalances) {
      const price = getConvertedPrice(cb.symbol, currencyCode, rates);
      all.push({
        symbol: cb.symbol, name: cb.name, logo: cb.logo,
        balance: cb.balance, usdValue: cb.balanceNum * (price || 0),
        chainName: cb.name, chainId: cb.networkId, isNative: true,
      });
    }
    for (const nc of nonEvmChains) {
      const price = getConvertedPrice(nc.symbol, currencyCode, rates);
      all.push({
        symbol: nc.symbol, name: nc.name, logo: nc.logo,
        balance: nc.balance.toString(), usdValue: nc.balance * (price || 0),
        chainName: nc.name, chainId: nc.id, isNative: true,
      });
    }
    // Tokens accumulated across all visited chains (EVM ERC-20 + SPL + custom)
    for (const [chainId, chainTokens] of Object.entries(tokensByChain)) {
      // Resolve chain display info: built-in EVM > non-EVM > custom chain
      const net = NETWORKS[chainId];
      const nonEvm = !net ? nonEvmChains.find((c) => c.id === chainId) : null;
      const custom = !net && !nonEvm ? customChains.find((c) => c.id === chainId) : null;
      const chainName = net?.name ?? nonEvm?.name ?? custom?.name;
      const chainLogo = net?.logo ?? nonEvm?.logo ?? custom?.logo ?? "";
      if (!chainName) continue;

      const isEvmChain = !!net || !!custom;

      for (const t of chainTokens) {
        const bal = parseFloat(t.balance || "0");
        // SPL and other non-EVM tokens: show in list but don't guess USD value
        const usdValue = isEvmChain ? usdToDisplayCurrency(bal, currencyCode, rates) : 0;
        all.push({
          symbol: t.symbol, name: t.name, logo: t.logo,
          balance: t.balance || "0",
          usdValue,
          chainName, chainLogo, chainId, isNative: false,
        });
      }
    }

    // Apply chain filter (null = show all)
    const filtered = filterChainId ? all.filter((t) => t.chainId === filterChainId) : all;

    const visible: DisplayToken[] = [];
    const dust: DisplayToken[] = [];
    for (const t of filtered) {
      const bal = parseFloat(t.balance);
      if (bal <= 0) { dust.push(t); continue; }
      if (t.usdValue > 0 && t.usdValue < 0.10) { dust.push(t); continue; }
      visible.push(t);
    }
    visible.sort((a, b) => b.usdValue - a.usdValue);
    dust.sort((a, b) => b.usdValue - a.usdValue);
    return { visibleTokens: visible, dustTokens: dust };
  }, [chainBalances, nonEvmChains, tokensByChain, rates, currencyCode, filterChainId]);

  // When on a non-EVM chain, find that chain's balance data
  const activeNonEvmData = activeEvmNetwork
    ? null
    : nonEvmChains.find((c) => c.id === activeChainId) ?? null;

  // Native balance entry for the active EVM chain (from multi-chain fetch)
  const activeEvmBalance = activeEvmNetwork
    ? chainBalances.find((cb) => cb.networkId === activeChainId) ?? null
    : null;

  // USD value of the currently active chain's native balance (live rates)
  const activeChainUsd = (() => {
    if (activeEvmBalance) {
      return activeEvmBalance.balanceNum * getConvertedPrice(activeEvmBalance.symbol, currencyCode, rates);
    }
    if (activeNonEvmData) {
      return activeNonEvmData.balance * getConvertedPrice(activeNonEvmData.symbol, currencyCode, rates);
    }
    return 0;
  })();

  const sym = currency?.symbol || "$";
  const portfolioDisplay = livePortfolio >= 1000
    ? `${sym}${livePortfolio.toLocaleString("en", { maximumFractionDigits: 0 })}`
    : livePortfolio >= 1
    ? `${sym}${livePortfolio.toFixed(2)}`
    : `${sym}${livePortfolio.toFixed(4)}`;

  const syncing = multiChainLoading || nonEvmLoading;

  const PRESET_EMOJIS = [
    "💎","🦊","🐉","🦁","🌙","⚡",
    "🔥","🌊","🎯","🦄","🐺","🦅",
    "🤖","👾","🎭","🌺","🔮","💜",
    "🏆","💰","🪙","🌟","✨","🎮",
    "🎲","🐸","🐝","🦋","🐯","👑",
  ];

  function WalletAvatar({ meta, size = "md" }: { meta: VaultMeta; size?: "sm" | "md" }) {
    const dim   = size === "sm" ? "w-5 h-5 text-[9px]"  : "w-6 h-6 text-[10px]";
    const emoji = size === "sm" ? "text-[14px]" : "text-[15px]";
    const isActive = meta.id === activeWalletId;
    if (meta.avatar) {
      return (
        <span className={`${size === "sm" ? "w-5 h-5" : "w-6 h-6"} flex items-center justify-center ${emoji} flex-shrink-0`}>
          {meta.avatar}
        </span>
      );
    }
    return (
      <div
        className={`wallet-avatar ${isActive ? "" : "inactive"} ${dim} rounded-[10px] flex-shrink-0`}
      >
        {meta.name.charAt(0).toUpperCase()}
      </div>
    );
  }

  return (
    <Layout>
      {/* ── Hero gradient section ── */}
      <div className="hero-section px-4 pt-5 pb-7">

        {/* Top bar: wallet selector + lock */}
        <div className="flex items-center justify-between mb-4">
          <button
            onClick={() => { setShowWallets(!showWallets); setShowNetworks(false); setShowAddWallet(false); setShowEmojiPicker(false); }}
            className="pill"
          >
            {(() => {
              const active = walletMetas.find((m) => m.id === activeWalletId);
              if (!active) return null;
              return active.avatar ? (
                <span className="text-[14px] leading-none">{active.avatar}</span>
              ) : (
                <div className="wallet-avatar w-4 h-4 text-[8px] rounded-[6px]">
                  {active.name.charAt(0).toUpperCase()}
                </div>
              );
            })()}
            <span className="font-medium text-text-primary max-w-[100px] truncate">
              {walletMetas.find((m) => m.id === activeWalletId)?.name ?? "Wallet"}
            </span>
            <ChevronDownIcon
              size={11}
              className={`text-muted transition-transform duration-200 ${showWallets ? "rotate-180" : ""}`}
            />
          </button>

          <button
            onClick={handleLock}
            className="w-8 h-8 rounded-xl flex items-center justify-center text-muted hover:text-text-primary bg-surface-2 border border-border transition-colors"
            title="Lock wallet"
          >
            <LockIcon size={15} />
          </button>
        </div>

        {/* Wallet dropdown */}
        {showWallets && !showEmojiPicker && (
          <div className="premium-card mb-4 overflow-hidden animate-slide-up">
            {walletMetas.map((meta) => (
              <div key={meta.id} className="flex items-center">
                {/* Avatar — click to open emoji picker */}
                <button
                  onClick={(e) => { e.stopPropagation(); setEmojiTargetId(meta.id); setShowEmojiPicker(true); }}
                  className="relative group ml-2 p-1.5 rounded-xl hover:bg-surface-3 transition-colors flex-shrink-0"
                  title="Set avatar"
                >
                  <WalletAvatar meta={meta} />
                  <span className="absolute inset-0 rounded-xl flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none">
                    <span className="text-[9px] text-text-primary bg-surface-4/80 rounded px-0.5">✏</span>
                  </span>
                </button>

                {/* Wallet name + address — click to switch */}
                <button
                  onClick={() => { switchActiveWallet(meta.id); setShowWallets(false); }}
                  className={`flex-1 flex items-center gap-2 px-2 py-2.5 text-[13px] hover:bg-surface-3 transition-colors ${
                    meta.id === activeWalletId ? "text-brand-400" : "text-text-primary"
                  }`}
                >
                  <div className="flex-1 text-left">
                    <span className="font-medium">{meta.name}</span>
                    {meta.address && (
                      <span className="text-muted ml-2 text-[10px] font-mono">
                        {meta.address.slice(0, 6)}…{meta.address.slice(-4)}
                      </span>
                    )}
                  </div>
                  {meta.id === activeWalletId && <CheckIcon size={13} className="text-brand-400 flex-shrink-0" />}
                </button>
              </div>
            ))}
            <div className="border-t border-border/50">
              <button
                onClick={() => { setShowWallets(false); setShowAddWallet(true); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] text-brand-400 hover:bg-surface-3 transition-colors"
              >
                <div className="w-6 h-6 rounded-full flex items-center justify-center text-brand-400 border border-dashed border-brand-500/50">
                  <span className="text-[14px] leading-none">+</span>
                </div>
                <span className="font-medium">Add Account</span>
              </button>
            </div>
          </div>
        )}

        {/* Emoji picker (replaces wallet list when open) */}
        {showWallets && showEmojiPicker && (
          <div className="premium-card mb-4 overflow-hidden animate-slide-up">
            <div className="flex items-center gap-2 px-3.5 py-2.5 border-b border-border/50">
              <button
                onClick={() => setShowEmojiPicker(false)}
                className="text-muted hover:text-text-primary transition-colors text-[13px] leading-none mr-1"
              >
                ←
              </button>
              <p className="text-[13px] font-semibold text-text-primary flex-1">Choose Avatar</p>
              <p className="text-[10px] text-muted">
                {walletMetas.find((m) => m.id === emojiTargetId)?.name}
              </p>
            </div>
            <div className="p-3 grid grid-cols-6 gap-1.5">
              {PRESET_EMOJIS.map((emoji) => {
                const isCurrent = walletMetas.find((m) => m.id === emojiTargetId)?.avatar === emoji;
                return (
                  <button
                    key={emoji}
                    onClick={() => { if (emojiTargetId) setWalletAvatar(emojiTargetId, emoji); setShowEmojiPicker(false); }}
                    className={`w-9 h-9 rounded-xl flex items-center justify-center text-[20px] transition-colors ${
                      isCurrent
                        ? "bg-brand-500/15 ring-1 ring-brand-500/30"
                        : "hover:bg-surface-3"
                    }`}
                  >
                    {emoji}
                  </button>
                );
              })}
              {/* Reset to letter */}
              <button
                onClick={() => { if (emojiTargetId) setWalletAvatar(emojiTargetId, ""); setShowEmojiPicker(false); }}
                className="w-9 h-9 rounded-xl flex items-center justify-center text-[11px] font-bold text-muted hover:bg-surface-3 transition-colors"
                title="Reset to letter"
              >
                {walletMetas.find((m) => m.id === emojiTargetId)?.name?.charAt(0)?.toUpperCase() ?? "A"}
              </button>
            </div>
          </div>
        )}

        {/* Add account inline form */}
        {showAddWallet && (
          <div className="mb-4 premium-card px-3.5 py-3 space-y-2.5 animate-slide-up">
            <p className="text-[13px] font-semibold text-text-primary">Add Account</p>

            <div className="flex bg-surface-1 rounded-xl p-1 border border-border">
              <button
                onClick={() => setAddTab("create")}
                className={`flex-1 py-1.5 text-[12px] rounded-lg font-medium transition-all ${addTab === "create" ? "bg-brand-500 text-white" : "text-muted"}`}
              >
                Create New
              </button>
              <button
                onClick={() => setAddTab("import")}
                className={`flex-1 py-1.5 text-[12px] rounded-lg font-medium transition-all ${addTab === "import" ? "bg-brand-500 text-white" : "text-muted"}`}
              >
                Import
              </button>
            </div>

            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder={`Wallet ${walletMetas.length + 1}`}
              className="input-field"
            />

            {addTab === "import" && (
              <textarea
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                placeholder="Recovery phrase or private key"
                rows={2}
                className="input-field resize-none"
              />
            )}

            <input
              type="password"
              value={addPassword}
              onChange={(e) => setAddPassword(e.target.value)}
              placeholder="Current wallet password"
              className="input-field"
            />

            {addError && <p className="text-accent-red text-xs">{addError}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddWallet(false); setAddError(""); setAddInput(""); setAddPassword(""); setAddName(""); }}
                className="flex-1 py-2 rounded-lg bg-surface-2 text-text-secondary text-[12px] border border-border"
              >
                Cancel
              </button>
              <button
                onClick={handleAddWallet}
                disabled={addLoading}
                className="flex-1 btn-primary-premium text-[12px]"
              >
                {addLoading ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        )}

        {/* Balance display — always total portfolio in preset currency */}
        <div className="text-center mb-4">
          {(loading && chainBalances.length === 0) ? (
            <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto my-3" />
          ) : (
            <>
              <p
                className="font-bold tracking-tight leading-none mb-1.5 gradient-text"
                style={{ fontSize: 42 }}
              >
                {portfolioDisplay}
              </p>
              <p className="text-[12px]" style={{ color: "var(--text-secondary)" }}>
                Total Portfolio
                {syncing && <span className="ml-1.5 opacity-60">· syncing…</span>}
              </p>
            </>
          )}
        </div>

        {/* Chain toggle + BPAN pill — single row, address removed */}
        <div className="flex items-center justify-center gap-2 mb-4">
          <button
            onClick={() => { setShowNetworks(!showNetworks); setShowAddWallet(false); }}
            className="pill"
            style={{ fontSize: 12 }}
          >
            {filterChainId === null ? (
              <div className="w-[15px] h-[15px] rounded-full bg-surface-3 flex items-center justify-center">
                <span className="text-[7px] font-bold text-muted leading-none">All</span>
              </div>
            ) : activeEvmNetwork ? (
              <ChainIcon chainId={activeEvmNetwork.id} logo={activeEvmNetwork.logo} size={15} />
            ) : (
              <img
                src={activeChainLogo}
                alt={activeChainName}
                className="w-[15px] h-[15px] rounded-full"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
            )}
            <span className="font-medium text-text-primary">
              {filterChainId === null ? "All Assets" : activeChainName}
            </span>
            <ChevronDownIcon
              size={10}
              className={`text-muted transition-transform duration-200 ${showNetworks ? "rotate-180" : ""}`}
            />
          </button>

          {bpanFormatted ? (
            <button
              onClick={() => bpan && handleCopy(bpan, "bpan")}
              className="pill pill-brand"
              style={{ fontSize: 11, padding: "5px 11px" }}
            >
              <HashIcon size={9} />
              <span className="font-mono">{bpanFormatted}</span>
              {copied === "bpan"
                ? <CheckIcon size={10} className="text-accent-green" />
                : <CopyIcon size={10} />}
            </button>
          ) : (
            <button
              onClick={() => navigate("/bpan")}
              className="pill"
              style={{ fontSize: 11, padding: "5px 11px", borderStyle: "dashed" }}
            >
              <HashIcon size={9} />
              <span>Get BPAN</span>
            </button>
          )}
        </div>

        {/* Network / filter dropdown */}
        {showNetworks && (
          <div className="premium-card mb-4 overflow-hidden animate-slide-up max-h-[220px] overflow-y-auto">
            {/* All Assets */}
            <button
              onClick={() => { setAssetFilter(null); setShowNetworks(false); }}
              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] hover:bg-surface-3 transition-colors ${
                filterChainId === null ? "text-brand-400" : "text-text-primary"
              }`}
            >
              <div className="w-[18px] h-[18px] rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0">
                <span className="text-[8px] font-bold text-muted leading-none">All</span>
              </div>
              <span className="font-medium">All Assets</span>
              {filterChainId === null && <CheckIcon size={14} className="ml-auto text-brand-400" />}
            </button>

            {/* EVM networks */}
            <div className="px-3.5 pt-2 pb-1 border-t border-border/30">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">EVM Networks</span>
            </div>
            {Object.values(NETWORKS).map((n) => (
              <button
                key={n.id}
                onClick={() => { switchChain(n.id); setAssetFilter(n.id); setShowNetworks(false); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] hover:bg-surface-3 transition-colors ${
                  filterChainId === n.id ? "text-brand-400" : "text-text-primary"
                }`}
              >
                <ChainIcon chainId={n.id} logo={n.logo} size={18} />
                <span className="font-medium">{n.name}</span>
                {filterChainId === n.id && <CheckIcon size={14} className="ml-auto text-brand-400" />}
              </button>
            ))}

            {/* Non-EVM chains */}
            <div className="px-3.5 pt-3 pb-1 border-t border-border/50 mt-1">
              <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Other Chains</span>
            </div>
            {NON_EVM_CHAINS.map((c) => (
              <button
                key={c.id}
                onClick={() => { switchChain(c.id); setAssetFilter(c.id); setShowNetworks(false); }}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] hover:bg-surface-3 transition-colors ${
                  filterChainId === c.id ? "text-brand-400" : "text-text-primary"
                }`}
              >
                <img
                  src={c.logo}
                  alt={c.name}
                  className="w-[18px] h-[18px] rounded-full flex-shrink-0"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <span className="font-medium">{c.name}</span>
                {filterChainId === c.id && <CheckIcon size={14} className="ml-auto text-brand-400" />}
              </button>
            ))}

            {/* Custom chains */}
            {customChains.length > 0 && (
              <>
                <div className="px-3.5 pt-3 pb-1 border-t border-border/50 mt-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-muted">Custom Networks</span>
                </div>
                {customChains.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { switchChain(c.id); setAssetFilter(c.id); setShowNetworks(false); }}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] hover:bg-surface-3 transition-colors ${
                      filterChainId === c.id ? "text-brand-400" : "text-text-primary"
                    }`}
                  >
                    {c.logo ? (
                      <img src={c.logo} alt={c.name} className="w-[18px] h-[18px] rounded-full flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-[18px] h-[18px] rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0">
                        <span className="text-[8px] font-bold text-muted">{c.symbol.slice(0, 1)}</span>
                      </div>
                    )}
                    <span className="font-medium">{c.name}</span>
                    {filterChainId === c.id && <CheckIcon size={14} className="ml-auto text-brand-400" />}
                  </button>
                ))}
              </>
            )}

            {/* Manage assets link */}
            <div className="border-t border-border/30 mt-1">
              <button
                onClick={() => { setShowNetworks(false); navigate("/manage-assets"); }}
                className="w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[12px] text-brand-400 hover:bg-surface-3 transition-colors"
              >
                <div className="w-[18px] h-[18px] rounded-full border border-dashed border-brand-500/50 flex items-center justify-center flex-shrink-0">
                  <span className="text-[12px] leading-none">+</span>
                </div>
                <span className="font-medium">Manage Tokens &amp; Networks</span>
              </button>
            </div>
          </div>
        )}

        {/* Action row — Bold Primary layout */}
        <div className="px-4 pb-3" style={{ display: "flex", flexDirection: "column", gap: 7 }}>
          {/* Primary: Send */}
          <button
            type="button"
            onClick={() => navigate("/send")}
            style={{
              position: "relative",
              display: "flex",
              alignItems: "center",
              gap: 11,
              padding: "10px 14px",
              borderRadius: 14,
              background: "linear-gradient(135deg, #b5a8ff 0%, #7c6df0 50%, #5b4cdb 100%)",
              color: "#fff",
              border: "none",
              boxShadow: "0 10px 24px -10px rgba(124,109,240,0.85), inset 0 1px 0 rgba(255,255,255,0.22)",
              overflow: "hidden",
              width: "100%",
              cursor: "pointer",
              transition: "transform 150ms ease, box-shadow 150ms ease",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.transform = "translateY(-1px)";
              e.currentTarget.style.boxShadow = "0 14px 28px -10px rgba(124,109,240,1), inset 0 1px 0 rgba(255,255,255,0.22)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.transform = "translateY(0)";
              e.currentTarget.style.boxShadow = "0 10px 24px -10px rgba(124,109,240,0.85), inset 0 1px 0 rgba(255,255,255,0.22)";
            }}
            onMouseDown={(e) => { e.currentTarget.style.transform = "translateY(0)"; }}
          >
            {/* Specular gloss overlay */}
            <div style={{
              position: "absolute", inset: 0,
              background: "radial-gradient(120% 100% at 100% 0%, rgba(255,255,255,0.18), transparent 50%)",
              pointerEvents: "none",
            }} />
            {/* Icon chip */}
            <div style={{
              position: "relative",
              width: 32, height: 32, borderRadius: 9,
              background: "rgba(255,255,255,0.16)",
              display: "grid", placeItems: "center",
              boxShadow: "inset 0 0 0 1px rgba(255,255,255,0.18)",
              flexShrink: 0,
            }}>
              <ArrowUpRightIcon size={15} />
            </div>
            {/* Text */}
            <div style={{ position: "relative", textAlign: "left", flex: 1 }}>
              <div style={{ fontSize: 15, fontWeight: 600, letterSpacing: "-0.02em" }}>Send</div>
              <div style={{ fontSize: 11, opacity: 0.75, marginTop: 1 }}>Pay anyone, any chain</div>
            </div>
            {/* Chevron */}
            <ChevronRightIcon size={16} style={{ position: "relative", opacity: 0.7 }} />
          </button>

          {/* Secondary row: Receive / Swap / DeFi */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 7 }}>
            {([
              { label: "Receive", Ic: ReceiveIcon, path: "/receive" },
              { label: "Swap",    Ic: SwapIcon,    path: "/swap" },
              { label: "DeFi",   Ic: LayersIcon,  path: "/defi" },
            ] as const).map(({ label, Ic, path }) => (
              <button
                key={label}
                type="button"
                onClick={() => navigate(path)}
                style={{
                  display: "flex", flexDirection: "column",
                  alignItems: "center", gap: 5,
                  padding: "8px 6px 7px",
                  borderRadius: 11,
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  color: "var(--text)",
                  cursor: "pointer",
                  fontFamily: "inherit",
                  transition: "border-color 150ms ease, background 150ms ease",
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.borderColor = "var(--brand)";
                  e.currentTarget.style.background = "var(--card-2)";
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                  e.currentTarget.style.background = "var(--card)";
                }}
              >
                <div style={{ color: "var(--muted)" }}><Ic size={14} /></div>
                <span style={{ fontSize: 11, fontWeight: 500 }}>{label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* ── Active chain balance strip ── */}
      {(activeEvmBalance !== null || activeNonEvmData !== null) && (
        <div className="px-4 pt-3 pb-2 flex items-center gap-2.5">
          {activeEvmNetwork && activeEvmBalance ? (
            <>
              <ChainIcon chainId={activeEvmNetwork.id} logo={activeEvmNetwork.logo} size={15} />
              <span className="text-[14px] font-semibold text-text-primary tabular-nums">
                {parseFloat(activeEvmBalance.balance) > 0
                  ? parseFloat(activeEvmBalance.balance).toFixed(4)
                  : "0.0000"
                } {activeEvmBalance.symbol}
              </span>
            </>
          ) : activeNonEvmData ? (
            <>
              <img
                src={activeNonEvmChain?.logo}
                alt={activeNonEvmChain?.name}
                className="w-[15px] h-[15px] rounded-full flex-shrink-0"
                onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
              />
              <span className="text-[14px] font-semibold text-text-primary tabular-nums">
                {activeNonEvmData.balance > 0
                  ? activeNonEvmData.balance.toFixed(activeNonEvmData.decimals <= 6 ? 4 : 6)
                  : "0.0000"
                } {activeNonEvmData.symbol}
              </span>
            </>
          ) : null}
          {activeChainUsd > 0 && (
            <span className="text-[12px] text-muted tabular-nums">
              · {sym}{activeChainUsd >= 1 ? activeChainUsd.toFixed(2) : activeChainUsd.toFixed(4)}
            </span>
          )}
          {!activeEvmNetwork && nonEvmLoading && (
            <span className="text-[11px] text-muted opacity-60">syncing…</span>
          )}
        </div>
      )}

      {/* ── Assets section ── */}
      <div className="px-4 py-4">
        <div className="flex items-center justify-between mb-3">
          <h3 className="section-label">Assets</h3>
          <div className="flex items-center gap-1">
            <button
              onClick={() => navigate("/manage-assets")}
              className="p-1.5 rounded-lg text-muted hover:text-brand-400 transition-colors"
              title="Manage tokens and networks"
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="16" /><line x1="8" y1="12" x2="16" y2="12" />
              </svg>
            </button>
            <button
              onClick={() => { refresh(); refreshNonEvm(); }}
              className="p-1.5 rounded-lg text-muted hover:text-brand-400 transition-colors"
            >
              <RefreshIcon size={14} />
            </button>
          </div>
        </div>

        {/* Empty state */}
        {visibleTokens.length === 0 && !loading && !multiChainLoading && (
          <div className="premium-card py-8 text-center">
            <p className="text-muted text-[13px]">No assets found</p>
          </div>
        )}

        {/* Visible tokens */}
        <div className="space-y-1.5">
          {visibleTokens.map((token, i) => (
            <div
              key={`${token.symbol}-${token.chainName}-${i}`}
              className="token-row"
            >
              <div className="flex items-center gap-3">
                <div className="relative flex-shrink-0">
                  <TokenIcon symbol={token.symbol} logo={token.logo} size={36} />
                  {!token.isNative && token.chainLogo && (
                    <div className="absolute -bottom-0.5 -right-0.5 w-[14px] h-[14px] rounded-full overflow-hidden ring-1 ring-surface-0">
                      <img src={token.chainLogo} alt={token.chainName} className="w-full h-full object-cover"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    </div>
                  )}
                </div>
                <div>
                  <p className="text-[13px] font-semibold text-text-primary">{token.symbol}</p>
                  <p className="text-[11px] text-muted">{token.chainName}</p>
                </div>
              </div>
              <div className="text-right">
                <p className="text-[13px] font-semibold text-text-primary tabular-nums">
                  {parseFloat(token.balance) > 0
                    ? parseFloat(token.balance).toFixed(4)
                    : "0"}
                </p>
                {token.usdValue > 0 && (
                  <p className="text-[11px] text-muted tabular-nums">
                    {sym}{token.usdValue.toFixed(2)}
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Dust / hidden tokens */}
        {dustTokens.length > 0 && (
          <div className="mt-4">
            <button
              onClick={() => setShowDust(!showDust)}
              className="flex items-center gap-1.5 mb-2.5 text-xs text-muted hover:text-text-secondary transition-colors"
            >
              <ChevronDownIcon
                size={12}
                className={`transition-transform duration-200 ${showDust ? "rotate-180" : ""}`}
              />
              <span className="font-medium">Hidden ({dustTokens.length})</span>
            </button>

            {showDust && (
              <div className="space-y-1.5 animate-slide-up">
                {dustTokens.map((token, i) => (
                  <div
                    key={`dust-${token.symbol}-${token.chainName}-${i}`}
                    className="token-row opacity-45 hover:opacity-80"
                  >
                    <div className="flex items-center gap-2.5">
                      <TokenIcon symbol={token.symbol} logo={token.logo} size={28} />
                      <div>
                        <p className="text-xs font-medium text-text-primary">{token.symbol}</p>
                        <p className="text-[10px] text-muted">{token.chainName}</p>
                      </div>
                    </div>
                    <div className="text-right">
                      <p className="text-xs font-medium text-text-primary tabular-nums">
                        {parseFloat(token.balance) > 0
                          ? parseFloat(token.balance).toFixed(6)
                          : "0"}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Loading skeleton */}
        {(loading || syncing) && visibleTokens.length === 0 && (
          <div className="space-y-1.5 mt-1">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="token-row opacity-40"
                style={{ animation: `fadeIn 0.4s ease-out ${i * 0.1}s both` }}
              >
                <div className="flex items-center gap-3">
                  <div className="w-9 h-9 rounded-full bg-surface-3" />
                  <div className="space-y-1.5">
                    <div className="w-14 h-3 rounded bg-surface-3" />
                    <div className="w-20 h-2.5 rounded bg-surface-2" />
                  </div>
                </div>
                <div className="space-y-1.5 text-right">
                  <div className="w-14 h-3 rounded bg-surface-3 ml-auto" />
                  <div className="w-10 h-2.5 rounded bg-surface-2 ml-auto" />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </Layout>
  );
}
