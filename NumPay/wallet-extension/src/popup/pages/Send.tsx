"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { ethers } from "ethers";
import { useLocation } from "react-router-dom";
import { useWallet } from "../hooks/useWallet";
import {
  isBPANInput, isValidBPAN, resolveBPANChecked, acceptBPANChange,
  BPANConsensusError, BPANInsufficientConfirmationError, formatBPAN,
} from "@/lib/bpan";
import { BPAN_CHAINS, DEFAULT_NETWORK, NETWORKS, type BPANChainId, type Network } from "@/lib/networks";
import { getSigner, isLocked } from "@/lib/wallet";
import { sendToken, type Token } from "@/lib/tokens";
import { markBalancesDirty } from "@/lib/balanceBus";
import {
  sendSolanaTransfer, sendTronTransfer, sendSuiTransfer,
  sendSolanaTokenTransfer, sendTronTokenTransfer, sendSuiTokenTransfer,
} from "@/lib/chains";
import { isValidNonEvmAddress } from "@/lib/addressValidation";
import { classifyToken } from "@/lib/tokenSpam";
import Layout from "../components/Layout";
import TxResultOverlay, { type TxFxStatus } from "../components/TxResultOverlay";
import {
  CheckIcon, ExternalLinkIcon, HashIcon, ChevronDownIcon,
  ChainIcon, AssetIcon, AlertIcon,
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

// Chains with native sending wired up. The rest fall back to "copy the address".
const CAN_SEND_NATIVE: Record<string, boolean> = { solana: true, tron: true, sui: true };

// Native-coin headroom to leave for the network fee on a percentage/MAX send.
// A native transfer pays its gas out of the same balance, so sending 100% leaves
// nothing for the fee and the tx fails. These are conservative heuristic buffers
// in native units (not a live gas estimate): erring slightly large just sends a
// hair under the true max, and the node still validates the final amount. Keyed by
// chain because the same symbol (ETH) spans pricey L1 and cheap L2s.
const NATIVE_FEE_RESERVE: Record<string, number> = {
  ethereum: 0.003,
  polygon: 0.2, avalanche: 0.02, bsc: 0.002, fantom: 0.5, cronos: 0.5,
  celo: 0.05, gnosis: 0.02, moonbeam: 0.05, klaytn: 0.5, sei: 0.1,
  mantle: 0.5, metis: 0.005,
  solana: 0.01, tron: 5, sui: 0.05,
};
// ETH L2s (arbitrum, optimism, base, zksync, scroll, linea, blast, ...) and any
// custom/unknown chain: gas is cheap, so a tiny buffer is enough. A too-small
// default only means MAX still fails and the user lowers the amount, as today.
const DEFAULT_FEE_RESERVE = 0.0005;

function nativeFeeReserve(chainId: string): number {
  return NATIVE_FEE_RESERVE[chainId] ?? DEFAULT_FEE_RESERVE;
}

// Parse a decimal amount string into an integer base-unit bigint without
// floating point, rejecting more fraction digits than the chain supports.
function toBaseUnits(amount: string, decimals: number): bigint {
  const v = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error("Invalid amount");
  const [whole, frac = ""] = v.split(".");
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimal places are supported`);
  const base = BigInt(whole + frac.padEnd(decimals, "0"));
  if (base <= 0n) throw new Error("Enter an amount greater than zero");
  return base;
}

export default function Send() {
  const {
    wallet, network, balance, tokens, tokensByChain,
    activeChainId, nonEvmWallet, nonEvmChains, nonEvmLoading,
    switchChain, customChains,
  } = useWallet();

  const location = useLocation();
  const navChainId = (location.state as { prefillChain?: string } | null)?.prefillChain as BPANChainId | undefined;

  // Seed from navigation state (e.g. coming from TokenDetail) or fall back to global chain.
  const [selectedChainId, setSelectedChainId] = useState<BPANChainId>(
    () => navChainId ?? (activeChainId as BPANChainId)
  );
  // Sync once when storage finishes loading. Skip if navigation state seeded the chain.
  const chainSynced = useRef(false);
  useEffect(() => {
    if (!navChainId && !chainSynced.current && activeChainId !== DEFAULT_NETWORK) {
      chainSynced.current = true;
      setSelectedChainId(activeChainId as BPANChainId);
    }
  }, [activeChainId, navChainId]);

  const [to, setTo] = useState("");
  const [amount, setAmount] = useState("");
  const [resolvedAddr, setResolvedAddr] = useState("");
  const [resolvedBPAN, setResolvedBPAN] = useState("");
  const [resolving, setResolving] = useState(false);
  // TRUST-1: non-blocking caution about how the BPAN mapping was verified
  // (single-source read, or the mapping changed since last seen).
  // When a BPAN mapping has CHANGED since last use, the user must explicitly
  // confirm the new address before a send is allowed (H-03). Holds the change
  // context; null when there is nothing pending acceptance.
  const [bpanChange, setBpanChange] = useState<
    { number: string; chain: string; oldAddr: string; newAddr: string } | null
  >(null);
  const [bpanChangeAck, setBpanChangeAck] = useState(false);
  const [sending, setSending] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  // Drives the animated result overlay. Only the actual send paths set it, so
  // field-validation errors never trigger the celebration overlay.
  const [txFx, setTxFx] = useState<TxFxStatus | null>(null);
  const [selectedToken, setSelectedToken] = useState<Token | null>(null);
  const [showTokenPicker, setShowTokenPicker] = useState(false);
  const [showHiddenTokens, setShowHiddenTokens] = useState(false);

  const chainInfo  = BPAN_CHAINS.find((c) => c.id === selectedChainId)!;
  const isEvmChain = chainInfo?.isEVM ?? true;

  // Resolve the EVM network from the chain the user actually selected, NOT the
  // global wallet network. Without this, arriving with a prefilled chain (or a
  // lagging global switch) could sign on the wrong RPC/chain id.
  const sendNetwork = useMemo<Network>(() => {
    if (NETWORKS[selectedChainId]) return NETWORKS[selectedChainId];
    const custom = customChains.find((c) => c.id === selectedChainId);
    if (custom) {
      return {
        id: custom.id, name: custom.name, chainId: custom.chainId,
        rpcUrl: custom.rpcUrl, symbol: custom.symbol, decimals: custom.decimals,
        explorer: custom.explorer, logo: custom.logo || "",
      };
    }
    return network;
  }, [selectedChainId, customChains, network]);

  // Keep the global wallet chain aligned with the selection so balances and the
  // signer reference the same chain (covers the navigation-prefill case).
  useEffect(() => {
    if (isEvmChain && activeChainId !== selectedChainId) switchChain(selectedChainId);
  }, [isEvmChain, selectedChainId, activeChainId, switchChain]);

  // Non-EVM metadata
  const nonEvmMeta      = NON_EVM_META[selectedChainId];
  const activeNonEvmChain = !isEvmChain ? nonEvmChains.find((c) => c.id === selectedChainId) : null;
  const nativeSymbol = isEvmChain ? sendNetwork.symbol : (nonEvmMeta?.symbol ?? selectedChainId.toUpperCase());

  // Held tokens for the selected non-EVM chain, split into visible vs. hidden
  // (spam / worthless / thin-liquidity) so the picker can collapse the junk.
  const nonEvmTokens = !isEvmChain ? (tokensByChain[selectedChainId] ?? []) : [];
  const visibleNonEvmTokens = nonEvmTokens.filter((t) => !classifyToken(t).hidden);
  const hiddenNonEvmTokens  = nonEvmTokens.filter((t) =>  classifyToken(t).hidden);

  // Unified send values — respect a selected token on either EVM or non-EVM,
  // otherwise fall back to the chain's native coin.
  const sendSymbol = selectedToken
    ? selectedToken.symbol
    : nativeSymbol;
  const sendBalance = selectedToken
    ? parseFloat(selectedToken.balance || "0")
    : isEvmChain ? parseFloat(balance) : (activeNonEvmChain?.balance ?? 0);
  const sendDecimals = selectedToken
    ? selectedToken.decimals
    : isEvmChain ? sendNetwork.decimals : (nonEvmMeta?.decimals ?? 9);

  const canSendNative = !isEvmChain && !!CAN_SEND_NATIVE[selectedChainId];

  function handleChainChange(id: BPANChainId) {
    setSelectedChainId(id);
    switchChain(id);
    setTo(""); setResolvedAddr(""); setResolvedBPAN("");
    setBpanChange(null); setBpanChangeAck(false);
    setError(""); setAmount(""); setSelectedToken(null); setTxHash("");
    setShowTokenPicker(false); setShowHiddenTokens(false);
    chainSynced.current = true;
  }

  function setPercent(pct: number) {
    // Native-coin sends pay gas out of this same balance, so a MAX (100%) send with
    // no headroom always fails. Reserve a small fee buffer for native sends; tokens
    // pay gas from the native coin, so a token's own balance needs no reserve.
    const reserve = selectedToken ? 0 : nativeFeeReserve(selectedChainId);
    const cap = Math.max(0, sendBalance - reserve);
    const val = Math.min(sendBalance * pct, cap);
    setAmount(val > 0 ? val.toFixed(Math.min(sendDecimals, 8)) : "0");
  }

  // Guards against out-of-order async BPAN resolutions (fast typing): only the
  // latest lookup may write state.
  const resolveSeq = useRef(0);

  async function handleToChange(value: string) {
    setTo(value);
    setResolvedAddr(""); setResolvedBPAN(""); setError("");
    setBpanChange(null); setBpanChangeAck(false);

    const clean = value.trim().replace(/\D/g, "");
    if (isBPANInput(value) && isValidBPAN(clean)) {
      const seq = ++resolveSeq.current;
      setResolving(true);
      try {
        // Cross-checks the mapping across independent mainnet providers and a
        // trust-on-first-use pin (TRUST-1) before it can become a send target.
        const res = await resolveBPANChecked(clean, selectedChainId);
        const addr = res.address;
        if (seq !== resolveSeq.current) return; // a newer lookup superseded this one
        if (addr) {
          // Registry mappings are free-form strings set by the BPAN owner.
          // Validate the resolved address against the selected chain's format
          // so a wrong-chain or malformed mapping can never become a send target.
          const looksValid = isEvmChain
            ? ethers.isAddress(addr)
            : isValidNonEvmAddress(addr.trim(), selectedChainId);
          if (!looksValid) {
            setError(
              `BPAN ${formatBPAN(clean)} has a "${selectedChainId}" mapping, but it is not a valid ` +
              `${chainInfo.name} address. Ask the owner to fix their mapping.`
            );
            return;
          }
          setResolvedAddr(addr.trim());
          setResolvedBPAN(clean);
          if (res.changed) {
            // The mapping moved since we last pinned it. Require an explicit,
            // out-of-band confirmation before this address can be used (H-03).
            setBpanChange({
              number: clean,
              chain: selectedChainId,
              oldAddr: (res.pinnedBefore ?? "").trim(),
              newAddr: addr.trim(),
            });
            setBpanChangeAck(false);
          }
        } else {
          setError(
            `No ${chainInfo.name} address mapped to BPAN ${formatBPAN(clean)}. ` +
            `The owner needs to add a "${selectedChainId}" mapping in their profile.`
          );
        }
      } catch (e) {
        if (seq !== resolveSeq.current) return;
        if (e instanceof BPANConsensusError) {
          // Independent providers disagreed on the address — refuse to offer a
          // send target rather than risk a redirect.
          setError(
            `Could not safely verify BPAN ${formatBPAN(clean)}: network providers returned ` +
            `conflicting addresses. Do not send. Try again later or contact the recipient.`
          );
        } else if (e instanceof BPANInsufficientConfirmationError) {
          // Fewer than two independent providers agreed, so the result is not
          // safe to use as a payment destination (TRUST-1). Block, do not warn.
          setError(
            `Could not verify BPAN ${formatBPAN(clean)} with enough independent providers. ` +
            `For your safety the address was not loaded. Check your connection and try again.`
          );
        } else {
          setError("BPAN lookup failed. Check your connection and try again.");
        }
      } finally {
        if (seq === resolveSeq.current) setResolving(false);
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
    if (bpanChange && !bpanChangeAck) {
      setError("This BPAN's address changed. Confirm you have verified the new address before sending.");
      return;
    }
    if (!destinationAddress) { setError("Enter a valid address or 11-digit BPAN"); return; }
    if (!amount || parseFloat(amount) <= 0) { setError("Enter an amount greater than zero"); return; }
    if (parseFloat(amount) > sendBalance) { setError("Insufficient balance"); return; }
    if (await isLocked()) { setError("Wallet is locked. Reopen NumPay to unlock, then try again."); return; }
    // User has acknowledged the changed mapping above: advance the trust pin so
    // it is treated as trusted from here on (deliberate acceptance, H-03).
    if (bpanChange) await acceptBPANChange(bpanChange.number, bpanChange.chain, bpanChange.newAddr);
    setSending(true); setError(""); setTxHash(""); setTxFx("pending");
    try {
      const signer = getSigner(wallet.privateKey, sendNetwork.rpcUrl);

      // Guard: confirm the RPC actually serves the selected chain before
      // signing, so a stale/wrong RPC can never produce a wrong-chain send.
      const providerNet = await signer.provider!.getNetwork();
      if (Number(providerNet.chainId) !== sendNetwork.chainId) {
        throw new Error(
          `Network mismatch: RPC reports chain ${providerNet.chainId}, expected ${sendNetwork.chainId} (${sendNetwork.name}). Send cancelled.`
        );
      }

      if (selectedToken) {
        const tx = await sendToken(selectedToken.address, destinationAddress, amount, selectedToken.decimals, signer);
        setTxHash(tx.hash);
      } else {
        const tx = await signer.sendTransaction({
          to: destinationAddress,
          value: ethers.parseUnits(amount, sendNetwork.decimals),
        });
        setTxHash(tx.hash);
      }
      markBalancesDirty(); setTxFx("success");
    } catch (e: any) {
      setError(e.reason || e.message || "Transaction failed");
      setTxFx("error");
    } finally {
      setSending(false);
    }
  }

  async function handleNonEvmSend() {
    if (!nonEvmWallet) { setError("Wallet not loaded"); return; }
    if (bpanChange && !bpanChangeAck) {
      setError("This BPAN's address changed. Confirm you have verified the new address before sending.");
      return;
    }
    if (!destinationAddress) { setError("Enter a valid address or 11-digit BPAN"); return; }
    if (!amount || parseFloat(amount) <= 0) { setError("Enter an amount greater than zero"); return; }
    if (parseFloat(amount) > sendBalance) { setError("Insufficient balance"); return; }
    if (await isLocked()) { setError("Wallet is locked. Reopen NumPay to unlock, then try again."); return; }
    // User has acknowledged the changed mapping above: advance the trust pin so
    // it is treated as trusted from here on (deliberate acceptance, H-03).
    if (bpanChange) await acceptBPANChange(bpanChange.number, bpanChange.chain, bpanChange.newAddr);
    setSending(true); setError(""); setTxHash(""); setTxFx("pending");
    try {
      if (selectedChainId === "solana") {
        if (selectedToken) {
          const amt = toBaseUnits(amount, selectedToken.decimals);
          const sig = await sendSolanaTokenTransfer(
            nonEvmWallet.solana.secretKey, selectedToken.address, destinationAddress, amt, selectedToken.decimals,
          );
          setTxHash(sig);
        } else {
          const lamports = toBaseUnits(amount, 9);
          const sig = await sendSolanaTransfer(nonEvmWallet.solana.secretKey, destinationAddress, lamports);
          setTxHash(sig);
        }
      } else if (selectedChainId === "tron") {
        if (selectedToken) {
          const amt = toBaseUnits(amount, selectedToken.decimals);
          const hash = await sendTronTokenTransfer(
            nonEvmWallet.tron.privateKey, nonEvmWallet.tron.address, selectedToken.address, destinationAddress, amt,
          );
          setTxHash(hash);
        } else {
          const sun = toBaseUnits(amount, 6);
          const hash = await sendTronTransfer(
            nonEvmWallet.tron.privateKey, nonEvmWallet.tron.address, destinationAddress, sun,
          );
          setTxHash(hash);
        }
      } else if (selectedChainId === "sui") {
        if (selectedToken) {
          const amt = toBaseUnits(amount, selectedToken.decimals);
          const digest = await sendSuiTokenTransfer(
            nonEvmWallet.sui.secretKey, nonEvmWallet.sui.address, selectedToken.address, destinationAddress, amt,
          );
          setTxHash(digest);
        } else {
          const mist = toBaseUnits(amount, 9);
          const digest = await sendSuiTransfer(
            nonEvmWallet.sui.secretKey, nonEvmWallet.sui.address, destinationAddress, mist,
          );
          setTxHash(digest);
        }
      } else {
        throw new Error(`Native ${selectedChainId} sending is not available yet`);
      }
      markBalancesDirty(); setTxFx("success");
    } catch (e: any) {
      setError(e.message || "Transaction failed");
      setTxFx("error");
    } finally {
      setSending(false);
    }
  }

  const explorerUrl = isEvmChain
    ? `${sendNetwork.explorer}/tx/${txHash}`
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
                <ChainIcon chainId={chain.id} logo={chain.logo} size={16} />
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

          {bpanChange && (
            <div className="mb-3 px-3 py-2.5 rounded-xl bg-amber/5 border border-amber/20 animate-fade-in">
              <div className="flex items-start gap-2">
                <AlertIcon size={13} className="mt-0.5 flex-shrink-0" style={{ color: "var(--amber)" }} />
                <div className="min-w-0">
                  <p className="text-[11px] leading-relaxed font-medium" style={{ color: "var(--amber)" }}>
                    This BPAN's {chainInfo?.name} address changed since you last sent to it. Verify with the
                    recipient before sending.
                  </p>
                  {bpanChange.oldAddr && (
                    <p className="mt-1.5 text-[10px] text-text-secondary font-mono break-all">
                      Was: {bpanChange.oldAddr}
                    </p>
                  )}
                  <p className="text-[10px] text-text-secondary font-mono break-all">
                    Now: {bpanChange.newAddr}
                  </p>
                </div>
              </div>
              <label className="mt-2 flex items-start gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  className="mt-0.5 flex-shrink-0"
                  checked={bpanChangeAck}
                  onChange={(e) => setBpanChangeAck(e.target.checked)}
                />
                <span className="text-[11px] leading-relaxed" style={{ color: "var(--amber)" }}>
                  I have verified this new address with the recipient.
                </span>
              </label>
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
                  <AssetIcon symbol={sendSymbol} logo={selectedToken?.logo} chainId={selectedChainId} address={selectedToken?.address} size={20} />
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
                    <AssetIcon symbol={sendNetwork.symbol} chainId={selectedChainId} size={22} />
                    <div className="flex-1 text-left">
                      <span className="font-medium">{sendNetwork.symbol}</span>
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
                      <AssetIcon symbol={t.symbol} logo={t.logo} chainId={selectedChainId} address={t.address} size={22} />
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
                <p className="text-[11px] text-muted">{isEvmChain ? sendNetwork.name : chainInfo?.name}</p>
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

          {/* Non-EVM: token picker (chains with token-send support) + amount + send */}
          {!isEvmChain && (
            <>
              {canSendNative && (
                <>
                  <label className="text-xs text-text-secondary mb-1.5 block font-medium">Token</label>
                  <button
                    onClick={() => setShowTokenPicker(!showTokenPicker)}
                    className="w-full input-field mb-1.5 text-left flex items-center justify-between"
                  >
                    <div className="flex items-center gap-2">
                      <AssetIcon symbol={sendSymbol} logo={selectedToken?.logo} chainId={selectedChainId} address={selectedToken?.address} size={20} />
                      <span className="text-[13px] text-text-primary font-medium">{sendSymbol}</span>
                    </div>
                    <ChevronDownIcon
                      size={14}
                      className={`text-muted transition-transform duration-200 ${showTokenPicker ? "rotate-180" : ""}`}
                    />
                  </button>

                  {showTokenPicker && (
                    <div className="premium-card mb-3 overflow-hidden animate-slide-up">
                      {/* Native coin */}
                      <button
                        onClick={() => { setSelectedToken(null); setShowTokenPicker(false); setAmount(""); }}
                        className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] hover:bg-surface-2 transition-colors ${!selectedToken ? "text-brand-400" : "text-text-primary"}`}
                      >
                        <AssetIcon symbol={nativeSymbol} chainId={selectedChainId} size={22} />
                        <div className="flex-1 text-left">
                          <span className="font-medium">{nativeSymbol}</span>
                          <span className="text-[11px] text-muted ml-2">{(activeNonEvmChain?.balance ?? 0).toFixed(4)}</span>
                        </div>
                        {!selectedToken && <CheckIcon size={14} className="text-brand-400" />}
                      </button>

                      {/* Held tokens */}
                      {visibleNonEvmTokens.map((t) => (
                        <button
                          key={t.address}
                          onClick={() => { setSelectedToken(t); setShowTokenPicker(false); setAmount(""); }}
                          className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] hover:bg-surface-2 transition-colors ${selectedToken?.address === t.address ? "text-brand-400" : "text-text-primary"}`}
                        >
                          <AssetIcon symbol={t.symbol} logo={t.logo} chainId={selectedChainId} address={t.address} size={22} />
                          <div className="flex-1 text-left">
                            <span className="font-medium">{t.symbol}</span>
                            <span className="text-[11px] text-muted ml-2">{parseFloat(t.balance || "0").toFixed(4)}</span>
                          </div>
                          {selectedToken?.address === t.address && <CheckIcon size={14} className="text-brand-400" />}
                        </button>
                      ))}

                      {/* Hidden (spam / worthless / thin-liquidity) — collapsed */}
                      {hiddenNonEvmTokens.length > 0 && (
                        <>
                          <button
                            onClick={() => setShowHiddenTokens(!showHiddenTokens)}
                            className="w-full flex items-center justify-between px-3.5 py-2 text-[11px] text-muted hover:bg-surface-2 transition-colors border-t border-border"
                          >
                            <span>
                              {showHiddenTokens ? "Hide" : "Show"} {hiddenNonEvmTokens.length} hidden token{hiddenNonEvmTokens.length > 1 ? "s" : ""}
                            </span>
                            <ChevronDownIcon size={12} className={`transition-transform ${showHiddenTokens ? "rotate-180" : ""}`} />
                          </button>
                          {showHiddenTokens && hiddenNonEvmTokens.map((t) => (
                            <button
                              key={t.address}
                              onClick={() => { setSelectedToken(t); setShowTokenPicker(false); setAmount(""); }}
                              className={`w-full flex items-center gap-2.5 px-3.5 py-2.5 text-[13px] hover:bg-surface-2 transition-colors opacity-60 ${selectedToken?.address === t.address ? "text-brand-400" : "text-text-primary"}`}
                            >
                              <AssetIcon symbol={t.symbol} logo={t.logo} chainId={selectedChainId} address={t.address} size={22} />
                              <div className="flex-1 text-left">
                                <span className="font-medium">{t.symbol}</span>
                                <span className="text-[11px] text-muted ml-2">{parseFloat(t.balance || "0").toFixed(4)}</span>
                              </div>
                              {selectedToken?.address === t.address && <CheckIcon size={14} className="text-brand-400" />}
                            </button>
                          ))}
                        </>
                      )}
                    </div>
                  )}
                </>
              )}

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

      {txFx && (
        <TxResultOverlay
          status={txFx}
          kind="send"
          amountLabel={`${amount} ${sendSymbol}`}
          explorerUrl={explorerUrl}
          txHash={txHash}
          errorMessage={error}
          onClose={() => setTxFx(null)}
        />
      )}
    </Layout>
  );
}
