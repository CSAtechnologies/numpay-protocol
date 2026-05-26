"use client";

import { useState, useEffect, useRef } from "react";
import { ethers } from "ethers";
import { useWallet } from "../hooks/useWallet";
import { isBPANInput, isValidBPAN, resolveBPAN, formatBPAN } from "@/lib/bpan";
import { BPAN_CHAINS, DEFAULT_NETWORK, type BPANChainId } from "@/lib/networks";
import { getSigner } from "@/lib/wallet";
import { sendToken, type Token } from "@/lib/tokens";
import { sendSolanaTransfer } from "@/lib/chains";
import Layout from "../components/Layout";
import {
  CheckIcon, ExternalLinkIcon, HashIcon, ChevronDownIcon,
  TokenIcon, AlertIcon,
} from "../components/Icons";

// Symbol + decimals for non-EVM chains (BPAN_CHAINS has no symbol field)
const NON_EVM_META: Record<string, { symbol: string; decimals: number; explorer: string }> = {
  solana:   { symbol: "SOL", decimals: 9,  explorer: "https://solscan.io/tx" },
  bitcoin:  { symbol: "BTC", decimals: 8,  explorer: "https://blockstream.info/tx" },
  sui:      { symbol: "SUI", decimals: 9,  explorer: "https://suiscan.xyz/mainnet/tx" },
  tron:     { symbol: "TRX", decimals: 6,  explorer: "https://tronscan.org/#/transaction" },
  xrp:      { symbol: "XRP", decimals: 6,  explorer: "https://xrpscan.com/tx" },
  litecoin: { symbol: "LTC", decimals: 8,  explorer: "https://litecoinspace.org/tx" },
};

// Native send is live only for Solana right now
const CAN_SEND_NATIVE: Record<string, boolean> = { solana: true };

function isValidNonEvmAddress(addr: string, chainId: string): boolean {
  if (!addr) return false;
  if (chainId === "solana")   return /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(addr);
  if (chainId === "bitcoin")  return /^(bc1|[13])[a-zA-HJ-NP-Z0-9]{25,62}$/.test(addr);
  if (chainId === "sui")      return /^0x[0-9a-fA-F]{64}$/.test(addr);
  if (chainId === "tron")     return /^T[1-9A-HJ-NP-Za-km-z]{33}$/.test(addr);
  if (chainId === "xrp")      return /^r[1-9A-HJ-NP-Za-km-z]{24,34}$/.test(addr);
  if (chainId === "litecoin") return /^(ltc1|[LM])[a-zA-HJ-NP-Z0-9]{26,90}$/.test(addr);
  return false;
}

export default function Send() {
  const {
    wallet, network, balance, tokens,
    activeChainId, nonEvmWallet, nonEvmChains, nonEvmLoading,
    switchChain,
  } = useWallet();

  // Default to the globally selected chain; sync once when storage finishes loading
  const [selectedChainId, setSelectedChainId] = useState<BPANChainId>(
    activeChainId as BPANChainId
  );
  const chainSynced = useRef(false);
  useEffect(() => {
    if (!chainSynced.current && activeChainId !== DEFAULT_NETWORK) {
      chainSynced.current = true;
      setSelectedChainId(activeChainId as BPANChainId);
    }
  }, [activeChainId]);

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [resolvedAddr, setResolvedAddr] = useState("");
  const [resolvedBPAN, setResolvedBPAN] = useState("");
  const [resolving, setResolving] = useState(false);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [showTokenPicker, setShowTokenPicker] = useState(false);

  const chainInfo  = BPAN_CHAINS.find((c) => c.id === selectedChainId)!;
  const isEvmChain = chainInfo?.isEVM ?? true;

  // Non-EVM metadata
  const nonEvmMeta      = NON_EVM_META[selectedChainId];
  const activeNonEvmChain = !isEvmChain ? nonEvmChains.find((c) => c.id === selectedChainId) : null;

  // Unified send values — work for both EVM and non-EVM
  const sendSymbol = isEvmChain
    ? (selectedToken ? selectedToken.symbol : network.symbol)
    : (nonEvmMeta?.symbol ?? selectedChainId.toUpperCase());
  const sendBalance = isEvmChain
    ? (selectedToken ? parseFloat(selectedToken.balance || "0") : parseFloat(balance))
    : (activeNonEvmChain?.balance ?? 0);
  const sendDecimals = isEvmChain
    ? (selectedToken ? selectedToken.decimals : network.decimals)
    : (nonEvmMeta?.decimals ?? 9);

  const canSendNative = !isEvmChain && !!CAN_SEND_NATIVE[selectedChainId];

  function handleChainChange(id: BPANChainId) {
    setSelectedChainId(id);
    switchChain(id);
    setTo(""); setResolvedAddr(""); setResolvedBPAN("");
    setError(""); setAmount(""); setSelectedToken(null); setTxHash("");
    chainSynced.current = true;
  }

  function setPercent(pct: number) {
    const val = sendBalance * pct;
    setAmount(val > 0 ? val.toFixed(Math.min(sendDecimals, 8)) : "0");
  }

  async function handleToChange(value: string) {
    setTo(value);
    setResolvedAddr(""); setResolvedBPAN(""); setError("");

    const clean = value.trim().replace(/\D/g, "");
    if (isBPANInput(value) && isValidBPAN(clean)) {
      setResolving(true);
      try {
        const addr = await resolveBPAN(clean, selectedChainId);
        if (addr) {
          setResolvedAddr(addr);
          setResolvedBPAN(clean);
        } else {
          setError(
            `No ${chainInfo.name} address mapped to BPAN ${formatBPAN(clean)}. ` +
            `The owner needs to add a "${selectedChainId}" mapping in their profile.`
          );
        }
      } catch {
        setError("BPAN lookup failed. Check your connection and try again.");
      } finally {
        setResolving(false);
      }
    }
  }

  const destinationAddress =
    resolvedAddr ||
    (isEvmChain
      ? (ethers.isAddress(to) ? to : "")
      : (isValidNonEvmAddress(to.trim(), selectedChainId) ? to.trim() : ""));

  async function handleEvmSend() {
    if (!wallet) return;
    if (!destinationAddress) { setError("Enter a valid address or 11-digit BPAN"); return; }
    if (!amount || parseFloat(amount) <= 0) { setError("Enter an amount greater than zero"); return; }
    if (parseFloat(amount) > sendBalance) { setError("Insufficient balance"); return; }
    setSending(true); setError(""); setTxHash("");
    try {
      const signer = getSigner(wallet.privateKey, network.rpcUrl);
      if (selectedToken) {
        const tx = await sendToken(selectedToken.address, destinationAddress, amount, selectedToken.decimals, signer);
        setTxHash(tx.hash);
      } else {
        const tx = await signer.sendTransaction({
          to: destinationAddress,
          value: ethers.parseUnits(amount, network.decimals),
        });
        setTxHash(tx.hash);
      }
    } catch (e: any) {
      setError(e.reason || e.message || "Transaction failed");
    } finally {
      setSending(false);
    }
  }

  async function handleNonEvmSend() {
    if (!nonEvmWallet) { setError("Wallet not loaded"); return; }
    if (!destinationAddress) { setError("Enter a valid address or 11-digit BPAN"); return; }
    if (!amount || parseFloat(amount) <= 0) { setError("Enter an amount greater than zero"); return; }
    if (parseFloat(amount) > sendBalance) { setError("Insufficient balance"); return; }
    setSending(true); setError(""); setTxHash("");
    try {
      if (selectedChainId === "solana") {
        const lamports = BigInt(Math.round(parseFloat(amount) * 1e9));
        const sig = await sendSolanaTransfer(nonEvmWallet.solana.secretKey, destinationAddress, lamports);
        setTxHash(sig);
      }
    } catch (e: any) {
      setError(e.message || "Transaction failed");
    } finally {
      setSending(false);
    }
  }

  const explorerUrl = isEvmChain
    ? `${network.explorer}/tx/${txHash}`
    : `${nonEvmMeta?.explorer ?? ""}/${txHash}`;

  return (
    <Layout title="Send" showBack>
      <div className="app-bg min-h-full">
        <div className="px-4 py-4 animate-slide-up">

          {/* Chain selector */}
          <label className="text-xs text-text-secondary mb-1.5 block font-medium">Network</label>
          <div className="flex gap-2 overflow-x-auto pb-2 mb-4" style={{ scrollbarWidth: "none" }}>
            {BPAN_CHAINS.map((chain) => (
              <button
                key={chain.id}
                onClick={() => handleChainChange(chain.id)}
                className={`flex-shrink-0 flex items-center gap-1.5 rounded-xl border px-3 py-1.5 text-[12px] font-medium transition-colors ${
                  selectedChainId === chain.id
                    ? "border-brand-500 bg-brand-500/15 text-brand-400"
                    : "border-border bg-surface-1 text-muted hover:border-brand-500/40 hover:text-text-secondary"
                }`}
              >
                <img
                  src={chain.logo}
                  alt={chain.name}
                  className="w-4 h-4 rounded-full"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                {chain.name}
              </button>
            ))}
          </div>

          {/* Recipient */}
          <label className="text-xs text-text-secondary mb-1.5 block font-medium">Recipient</label>
          <div className="relative mb-1">
            <input
              value={to}
              onChange={(e) => handleToChange(e.target.value)}
              placeholder={isEvmChain
                ? "0x address or 11-digit BPAN"
                : `${sendSymbol} address or 11-digit BPAN`}
              className="input-field pr-10"
            />
            {isBPANInput(to) && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <HashIcon size={16} className="text-brand-400" />
              </div>
            )}
          </div>

          {/* BPAN resolution status */}
          {resolving && (
            <div className="flex items-center gap-2 mb-3 animate-fade-in">
              <div className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <p className="text-brand-400 text-xs">
                Resolving {chainInfo?.name} address from BPAN registry...
              </p>
            </div>
          )}

          {resolvedAddr && resolvedBPAN && (
            <div className="mb-3 px-3 py-2.5 rounded-xl bg-brand-500/5 border border-brand-500/15 animate-slide-up">
              <div className="flex items-center gap-1.5 mb-1">
                <CheckIcon size={12} className="text-brand-400" />
                <p className="text-[11px] text-brand-400 font-medium">
                  BPAN {formatBPAN(resolvedBPAN)} resolved — {chainInfo?.name}
                </p>
              </div>
              <p className="text-xs text-text-primary font-mono break-all">{resolvedAddr}</p>
            </div>
          )}

          {!resolving && !resolvedAddr && to && <div className="mb-3" />}

          {/* EVM: token picker + amount + send */}
          {isEvmChain && (
            <>
              <label className="text-xs text-text-secondary mb-1.5 block font-medium">Token</label>
              <button
                onClick={() => setShowTokenPicker(!showTokenPicker)}
                className="w-full input-field mb-1.5 text-left flex items-center justify-between"
              >
                <div className="flex items-center gap-2">
                  <TokenIcon symbol={sendSymbol} logo={selectedToken?.logo} size={20} />
                  <span className="text-[13px] text-text-primary font-medium">{sendSymbol}</span>
                </div>
                <ChevronDownIcon
                  size={14}
                  className={`text-muted transition-transform duration-200 ${showTokenPicker ? "rotate-180" : ""}`}
                />
              </button>

              {showTokenPicker && (
                <div className="premium-card mb-3 overflow-hidden animate-slide-up">
                  <button
                    onClick={() => { setSelectedToken(null); setShowTokenPicker(false); setAmount(""); }}
                    className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] hover:bg-surface-2 transition-colors ${!selectedToken ? "text-brand-400" : "text-text-primary"}`}
                  >
                    <TokenIcon symbol={network.symbol} size={22} />
                    <div className="flex-1 text-left">
                      <span className="font-medium">{network.symbol}</span>
                      <span className="text-[11px] text-muted ml-2">{parseFloat(balance).toFixed(4)}</span>
                    </div>
                    {!selectedToken && <CheckIcon size={14} className="text-brand-400" />}
                  </button>
                  {tokens.map((t) => (
                    <button
                      key={t.address}
                      onClick={() => { setSelectedToken(t); setShowTokenPicker(false); setAmount(""); }}
                      className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] hover:bg-surface-2 transition-colors ${selectedToken?.address === t.address ? "text-brand-400" : "text-text-primary"}`}
                    >
                      <TokenIcon symbol={t.symbol} logo={t.logo} size={22} />
                      <div className="flex-1 text-left">
                        <span className="font-medium">{t.symbol}</span>
                        <span className="text-[11px] text-muted ml-2">{parseFloat(t.balance || "0").toFixed(4)}</span>
                      </div>
                      {selectedToken?.address === t.address && <CheckIcon size={14} className="text-brand-400" />}
                    </button>
                  ))}
                </div>
              )}

              {!showTokenPicker && <div className="mb-1.5" />}

              <label className="text-xs text-text-secondary mb-1.5 block font-medium">Amount</label>
              <div className="relative mb-1">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  step="any"
                  className="input-field pr-14"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted font-medium">
                  {sendSymbol}
                </span>
              </div>

              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-muted">
                  Balance:{" "}
                  <span className="text-text-secondary font-medium">
                    {sendBalance.toFixed(sendBalance < 1 ? 6 : 4)} {sendSymbol}
                  </span>
                </p>
                <p className="text-[11px] text-muted">{network.name}</p>
              </div>

              <div className="flex gap-2 mb-5">
                {[{ label: "25%", pct: 0.25 }, { label: "50%", pct: 0.5 }, { label: "75%", pct: 0.75 }, { label: "MAX", pct: 1 }].map(({ label, pct }) => (
                  <button key={label} onClick={() => setPercent(pct)} className="pill flex-1 justify-center py-2 text-[11px] font-semibold hover:text-brand-400">
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}

          {/* Non-EVM: amount + send */}
          {!isEvmChain && (
            <>
              <label className="text-xs text-text-secondary mb-1.5 block font-medium">Amount</label>
              <div className="relative mb-1">
                <input
                  type="number"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder="0.0"
                  step="any"
                  className="input-field pr-14"
                />
                <span className="absolute right-3.5 top-1/2 -translate-y-1/2 text-xs text-muted font-medium">
                  {sendSymbol}
                </span>
              </div>

              <div className="flex items-center justify-between mb-2">
                <p className="text-[11px] text-muted">
                  Balance:{" "}
                  <span className="text-text-secondary font-medium">
                    {nonEvmLoading
                      ? "..."
                      : `${sendBalance.toFixed(sendBalance < 1 ? 6 : 4)} ${sendSymbol}`}
                  </span>
                </p>
                <p className="text-[11px] text-muted">{chainInfo?.name}</p>
              </div>

              <div className="flex gap-2 mb-4">
                {[{ label: "25%", pct: 0.25 }, { label: "50%", pct: 0.5 }, { label: "75%", pct: 0.75 }, { label: "MAX", pct: 1 }].map(({ label, pct }) => (
                  <button key={label} onClick={() => setPercent(pct)} className="pill flex-1 justify-center py-2 text-[11px] font-semibold hover:text-brand-400">
                    {label}
                  </button>
                ))}
              </div>

              {!canSendNative && (
                <div className="mb-4 px-3 py-2.5 rounded-xl bg-surface-1 border border-border">
                  <p className="text-[11px] text-muted leading-relaxed">
                    Native {sendSymbol} sending is coming soon. Copy the resolved address and send from your {chainInfo?.name} wallet.
                  </p>
                </div>
              )}
            </>
          )}

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 mb-3 px-3 py-2.5 rounded-xl bg-accent-red/5 border border-accent-red/15 animate-fade-in">
              <AlertIcon size={13} className="text-accent-red mt-0.5 flex-shrink-0" />
              <p className="text-accent-red text-xs leading-relaxed">{error}</p>
            </div>
          )}

          {/* Send button / success — EVM */}
          {isEvmChain && (
            txHash ? (
              <div className="premium-card p-4 animate-slide-up">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-accent-green/15 flex items-center justify-center">
                    <CheckIcon size={14} className="text-accent-green" />
                  </div>
                  <p className="text-accent-green text-[13px] font-semibold">Transaction Sent!</p>
                </div>
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-brand-400 text-xs break-all hover:underline">
                  {txHash.slice(0, 20)}...{txHash.slice(-8)}
                  <ExternalLinkIcon size={12} />
                </a>
              </div>
            ) : (
              <button
                onClick={handleEvmSend}
                disabled={sending || !destinationAddress || !amount || parseFloat(amount) <= 0}
                className="btn-primary-premium"
              >
                {sending ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Sending...
                  </span>
                ) : `Send ${sendSymbol}`}
              </button>
            )
          )}

          {/* Send button / success — non-EVM */}
          {!isEvmChain && (
            txHash ? (
              <div className="premium-card p-4 animate-slide-up">
                <div className="flex items-center gap-2 mb-2">
                  <div className="w-6 h-6 rounded-full bg-accent-green/15 flex items-center justify-center">
                    <CheckIcon size={14} className="text-accent-green" />
                  </div>
                  <p className="text-accent-green text-[13px] font-semibold">Transaction Sent!</p>
                </div>
                <a href={explorerUrl} target="_blank" rel="noopener noreferrer"
                  className="flex items-center gap-1 text-brand-400 text-xs break-all hover:underline">
                  {txHash.slice(0, 20)}...{txHash.slice(-8)}
                  <ExternalLinkIcon size={12} />
                </a>
              </div>
            ) : (
              <button
                onClick={handleNonEvmSend}
                disabled={sending || !canSendNative || !destinationAddress || !amount || parseFloat(amount) <= 0}
                className="btn-primary-premium"
              >
                {sending ? (
                  <span className="flex items-center gap-2">
                    <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                    Sending...
                  </span>
                ) : canSendNative
                  ? `Send ${sendSymbol}`
                  : `${sendSymbol} send coming soon`}
              </button>
            )
          )}
        </div>
      </div>
    </Layout>
  );
}
