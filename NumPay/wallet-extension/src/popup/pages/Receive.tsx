import { useState, useEffect, useRef } from "react";
import QRCode from "qrcode";
import { useLocation } from "react-router-dom";
import { useWallet } from "../hooks/useWallet";
import Layout from "../components/Layout";
import { CopyIcon, CheckIcon, ChevronDownIcon, ChainIcon } from "../components/Icons";
import { NETWORKS, DEFAULT_NETWORK } from "@/lib/networks";

const TW = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";

interface ReceiveChain {
  id: string;
  name: string;
  symbol: string;
  logo: string;
  isEVM: boolean;
}

const PRIORITY: string[] = [
  "ethereum", "bitcoin", "solana", "polygon", "arbitrum",
  "optimism", "base", "bsc", "avalanche", "sui",
  "tron", "xrp", "litecoin",
];

const EVM_CHAINS: ReceiveChain[] = Object.values(NETWORKS)
  .filter((n) => n.id !== "sepolia")
  .map((n) => ({ id: n.id, name: n.name, symbol: n.symbol, logo: n.logo, isEVM: true }));

const NON_EVM_CHAINS: ReceiveChain[] = [
  { id: "bitcoin",  name: "Bitcoin",    symbol: "BTC", logo: `${TW}/bitcoin/info/logo.png`,   isEVM: false },
  { id: "solana",   name: "Solana",     symbol: "SOL", logo: `${TW}/solana/info/logo.png`,    isEVM: false },
  { id: "sui",      name: "Sui",        symbol: "SUI", logo: `${TW}/sui/info/logo.png`,       isEVM: false },
  { id: "tron",     name: "Tron",       symbol: "TRX", logo: `${TW}/tron/info/logo.png`,      isEVM: false },
  { id: "xrp",      name: "XRP Ledger", symbol: "XRP", logo: `${TW}/ripple/info/logo.png`,    isEVM: false },
  { id: "litecoin", name: "Litecoin",   symbol: "LTC", logo: `${TW}/litecoin/info/logo.png`,  isEVM: false },
];

const ALL_CHAINS: ReceiveChain[] = [...EVM_CHAINS, ...NON_EVM_CHAINS].sort((a, b) => {
  const ai = PRIORITY.indexOf(a.id);
  const bi = PRIORITY.indexOf(b.id);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return 0;
});

export default function Receive() {
  const { wallet, nonEvmWallet, activeChainId, switchChain } = useWallet();
  const location = useLocation();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState(false);
  const [showChainPicker, setShowChainPicker] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Local chain selection — initialised from navigation state so the correct
  // chain is shown immediately on first render without waiting for any effect.
  const navChainId = (location.state as { chainId?: string } | null)?.chainId;
  const [selectedChainId, setSelectedChainId] = useState(
    () => navChainId ?? activeChainId,
  );
  // Sync once when storage finishes loading (activeChainId changes from the
  // default to the persisted value). Skip if navigation state seeded the chain.
  const chainSynced = useRef(false);
  useEffect(() => {
    if (!navChainId && !chainSynced.current && activeChainId !== DEFAULT_NETWORK) {
      chainSynced.current = true;
      setSelectedChainId(activeChainId);
    }
  }, [activeChainId, navChainId]);

  const selectedChain = ALL_CHAINS.find((c) => c.id === selectedChainId) ?? ALL_CHAINS[0];

  const filteredChains = searchQuery.trim()
    ? ALL_CHAINS.filter((c) => {
        const q = searchQuery.toLowerCase();
        return c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q);
      })
    : ALL_CHAINS;

  useEffect(() => {
    if (showChainPicker) {
      setTimeout(() => searchRef.current?.focus(), 50);
    } else {
      setSearchQuery("");
    }
  }, [showChainPicker]);

  // Resolve the address for the selected chain
  const currentAddress = (() => {
    if (selectedChain.isEVM) return wallet?.address || "";
    if (!nonEvmWallet) return "";
    if (selectedChainId === "bitcoin")  return nonEvmWallet.bitcoin.address;
    if (selectedChainId === "solana")   return nonEvmWallet.solana.address;
    if (selectedChainId === "sui")      return nonEvmWallet.sui.address;
    if (selectedChainId === "tron")     return nonEvmWallet.tron.address;
    if (selectedChainId === "xrp")      return nonEvmWallet.xrp.address;
    if (selectedChainId === "litecoin") return nonEvmWallet.litecoin.address;
    return "";
  })();

  const chainLabel = `${selectedChain.symbol} on ${selectedChain.name}`;
  const chainDisplayName = selectedChain.name;

  // Generate QR code whenever address changes
  useEffect(() => {
    if (currentAddress && canvasRef.current) {
      const isDark = document.documentElement.getAttribute("data-theme") !== "light";
      QRCode.toCanvas(canvasRef.current, currentAddress, {
        width: 180,
        margin: 2,
        color: {
          dark: isDark ? "#e4e4e8" : "#111113",
          light: isDark ? "#111113" : "#f7f7f8",
        },
        errorCorrectionLevel: "M",
      });
    }
  }, [currentAddress]);

  async function handleCopy() {
    if (!currentAddress) return;
    try {
      await navigator.clipboard.writeText(currentAddress);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = currentAddress;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }


  return (
    <Layout title="Receive" showBack>
      <div className="app-bg min-h-full">
      <div className="flex flex-col items-center px-5 py-6 animate-slide-up">
        <p className="text-[13px] text-muted mb-4">
          Receive <span className="text-text-primary font-medium">{chainLabel}</span>
        </p>

        {/* Chain selector */}
        <div className="w-full mb-5 relative">
          <button
            onClick={() => setShowChainPicker(!showChainPicker)}
            className="w-full premium-card px-3.5 py-2.5 text-left flex items-center gap-2.5"
          >
            <ChainIcon chainId={selectedChainId} logo={selectedChain.logo} size={20} />
            <span className="text-[13px] font-medium text-text-primary flex-1">{chainDisplayName}</span>
            <ChevronDownIcon size={14} className={`text-muted transition-transform duration-200 ${showChainPicker ? "rotate-180" : ""}`} />
          </button>

          {showChainPicker && (
            <div className="absolute top-full left-0 right-0 mt-1 premium-card overflow-hidden z-10 animate-slide-up">
              <div className="px-3 py-2 border-b border-surface-3">
                <input
                  ref={searchRef}
                  type="text"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder="Search networks..."
                  className="w-full bg-surface-2 text-[12px] text-text-primary placeholder:text-muted rounded-lg px-3 py-1.5 outline-none"
                />
              </div>
              <div className="max-h-52 overflow-y-auto">
              {filteredChains.length === 0 && (
                <p className="text-[12px] text-muted text-center py-4">No results</p>
              )}
              {filteredChains.map((c) => {
                const isDisabled = !c.isEVM && !nonEvmWallet;
                return (
                  <button
                    key={c.id}
                    onClick={() => {
                      if (!isDisabled) {
                        setSelectedChainId(c.id);
                        switchChain(c.id);
                        setShowChainPicker(false);
                        setCopied(false);
                      }
                    }}
                    disabled={isDisabled}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] transition-colors ${
                      c.id === selectedChainId
                        ? "text-brand-400 bg-brand-500/5"
                        : isDisabled
                        ? "text-muted/40 cursor-not-allowed"
                        : "text-text-primary hover:bg-surface-2"
                    }`}
                  >
                    <ChainIcon chainId={c.id} logo={c.logo} size={20} />
                    <span className="font-medium flex-1 text-left">{c.name} ({c.symbol})</span>
                    {c.id === selectedChainId && <CheckIcon size={14} className="text-brand-400" />}
                    {isDisabled && <span className="text-[10px] text-muted">No mnemonic</span>}
                  </button>
                );
              })}
              </div>
            </div>
          )}
        </div>

        {/* QR Code */}
        <div className="premium-card p-4 mb-5">
          <canvas ref={canvasRef} className="rounded-lg" />
        </div>

        {/* Address */}
        <div className="premium-card w-full px-4 py-3 mb-5 text-center">
          <p className="text-[11px] text-muted mb-1 font-medium uppercase tracking-wider">
            Your {chainDisplayName} Address
          </p>
          <p className="text-xs font-mono text-text-primary break-all leading-relaxed">
            {currentAddress || "---"}
          </p>
        </div>

        <button
          onClick={handleCopy}
          className={`flex items-center justify-center gap-2 w-full py-3 rounded-xl font-semibold text-[13px] transition-all duration-150 ${
            copied
              ? "bg-accent-green/10 text-accent-green border border-accent-green/15"
              : "btn-primary-premium"
          }`}
        >
          {copied ? (
            <>
              <CheckIcon size={16} />
              Copied!
            </>
          ) : (
            <>
              <CopyIcon size={16} />
              Copy Address
            </>
          )}
        </button>
      </div>
      </div>
    </Layout>
  );
}
