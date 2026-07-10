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
import { logTx, updateTx } from "@/lib/txLog";
import { type Contact, loadContacts, saveContact, deleteContact, isSaved } from "@/lib/addressBook";
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
//
// Sized to roughly cover a native transfer (~21k gas) at a normal-ish fee, biased
// low so a small-portfolio user is not over-reserved. A ~21k-gas transfer is only
// a few US cents on nearly every chain now, so most buffers target ~$0.02-0.05;
// the exceptions are Ethereum L1 (fees genuinely reach dollars), Tron (recipient
// activation costs ~1 TRX) and Solana (the account must stay rent-exempt). If a
// buffer is ever short, MAX just fails at broadcast and the user lowers a hair,
// and the pre-broadcast simulation is the real safety net regardless.
const NATIVE_FEE_RESERVE: Record<string, number> = {
  ethereum: 0.0012,
  polygon: 0.05, avalanche: 0.003, bsc: 0.0003, fantom: 0.1, cronos: 0.3,
  celo: 0.03, gnosis: 0.02, moonbeam: 0.05, klaytn: 0.1, sei: 0.05,
  mantle: 0.1, metis: 0.002,
  // Solana: base fee is ~0.000005 SOL, but the account must retain the
  // rent-exempt minimum (~0.00089 SOL) or it can be purged. 0.0015 keeps that
  // plus priority-fee margin. Sui transfer gas is a few thousandths; 0.005 is
  // ample. Tron keeps ~2 TRX because sending to a fresh recipient costs ~1 TRX
  // account-activation plus bandwidth.
  solana: 0.0015, tron: 2, sui: 0.005,
};
// ETH L2s (arbitrum, optimism, base, zksync, scroll, linea, blast, ...) and any
// custom/unknown chain: gas is cheap, so a tiny buffer is enough. 0.0001 ETH is
// ~$0.30 and comfortably covers an L2 transfer incl. its L1 data fee (was 0.0005
// ≈ $1.50, which badly over-reserved small L2 balances). A too-small default only
// means MAX still fails and the user lowers the amount, as today.
const DEFAULT_FEE_RESERVE = 0.0001;

function nativeFeeReserve(chainId: string): number {
  return NATIVE_FEE_RESERVE[chainId] ?? DEFAULT_FEE_RESERVE;
}

// Rollups whose posted L2 gas price does NOT include the L1 data fee charged at
// execution (OP-stack, Arbitrum, the zk rollups). For these a reserve computed
// purely from 21k * L2-gas-price would under-reserve, so we never go below the
// flat cushion. Every other EVM chain is an L1 (or L1-like) where the fee is
// fully captured by gasPrice/maxFeePerGas, so the live estimate is exact.
const HIDDEN_L1_FEE_CHAINS = new Set([
  "arbitrum", "optimism", "base", "zksync", "scroll", "linea", "blast", "mantle", "polygonzkevm",
]);

// Gas units a plain native-coin transfer to an EOA costs. A contract recipient
// can cost more, but MAX-to-a-contract is rare and the pre-broadcast simulation
// is the backstop; the margin below also absorbs small overages.
const NATIVE_TRANSFER_GAS = 21_000n;

// ── Gas tiers (EVM) ───────────────────────────────────────────────────────────
type GasTier = "slow" | "normal" | "fast";
interface FeeInfo { maxFee?: bigint; prio?: bigint; gasPrice?: bigint; }

const scaleWei = (v: bigint, num: number, den: number) => (v * BigInt(num)) / BigInt(den);

// Ethers overrides for a chosen speed. "normal" returns {} so ethers uses the
// node's own suggestion. Slow lowers the tip (keeps the fee cap so it still
// confirms, just with less priority); fast raises the tip and lifts the cap to
// make room for it. Legacy chains scale gasPrice.
function tierOverrides(tier: GasTier, f: FeeInfo | null): ethers.Overrides {
  if (!f || tier === "normal") return {};
  if (f.maxFee != null && f.prio != null) {
    if (tier === "slow") return { maxFeePerGas: f.maxFee, maxPriorityFeePerGas: scaleWei(f.prio, 60, 100) };
    const prio = scaleWei(f.prio, 175, 100);
    return { maxFeePerGas: f.maxFee + (prio - f.prio), maxPriorityFeePerGas: prio };
  }
  if (f.gasPrice != null) {
    return { gasPrice: tier === "slow" ? scaleWei(f.gasPrice, 85, 100) : scaleWei(f.gasPrice, 130, 100) };
  }
  return {};
}

// The effective per-gas price for a tier, in gwei, for the selector labels.
function tierGwei(tier: GasTier, f: FeeInfo | null): string {
  if (!f) return "";
  const ov = tierOverrides(tier, f);
  const wei = (ov.maxFeePerGas ?? ov.gasPrice ?? f.maxFee ?? f.gasPrice) as bigint | undefined;
  if (wei == null) return "";
  const g = Number(wei) / 1e9;
  return g < 1 ? g.toFixed(3) : g.toFixed(1);
}

// An ENS name (foo.eth, sub.foo.eth). Resolved on-chain via Ethereum mainnet, so
// it is trustless (no third-party API); the resolved 0x address is valid on any
// EVM chain. (.sol / SNS needs on-chain resolution to meet the same safety bar as
// BPAN and is handled separately, not via an untrusted resolver API.)
function isEnsName(v: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.eth$/i.test(v.trim());
}

// A Solana Name Service domain (foo.sol, sub.foo.sol). Resolved on-chain via the
// lazy-loaded lib/sns module (heavy web3.js dep kept off the boot path).
function isSnsName(v: string): boolean {
  return /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*\.sol$/i.test(v.trim());
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
    wallet, network, balance, tokens, tokensByChain, chainBalances,
    activeChainId, nonEvmWallet, nonEvmChains, nonEvmLoading,
    switchChain, customChains,
  } = useWallet();

  const location = useLocation();
  const navState = location.state as
    { prefillChain?: string; prefillSymbol?: string; prefillAddress?: string } | null;
  const navChainId = navState?.prefillChain as BPANChainId | undefined;
  const prefillSymbol = navState?.prefillSymbol;
  const prefillAddress = navState?.prefillAddress;

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
  const [resolvedName, setResolvedName] = useState(""); // ENS name that produced resolvedAddr
  const [resolving, setResolving] = useState(false);

  // Address book
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [showContacts, setShowContacts] = useState(false);
  const [savingContact, setSavingContact] = useState(false);
  const [contactName, setContactName] = useState("");
  useEffect(() => { void loadContacts().then(setContacts); }, []);

  // Gas tier (EVM). Fee data is fetched per chain to label the selector and to
  // build the send overrides.
  const [gasTier, setGasTier] = useState<GasTier>("normal");
  const [feeInfo, setFeeInfo] = useState<FeeInfo | null>(null);
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

  // Fetch fee data for the active EVM chain to drive the gas-tier selector.
  useEffect(() => {
    if (!isEvmChain) { setFeeInfo(null); return; }
    let live = true;
    setGasTier("normal"); setFeeInfo(null);
    const provider = new ethers.JsonRpcProvider(sendNetwork.rpcUrl, sendNetwork.chainId, { staticNetwork: true });
    provider.getFeeData()
      .then((fd) => { if (live) setFeeInfo({ maxFee: fd.maxFeePerGas ?? undefined, prio: fd.maxPriorityFeePerGas ?? undefined, gasPrice: fd.gasPrice ?? undefined }); })
      .catch(() => { if (live) setFeeInfo(null); });
    return () => { live = false; };
  }, [isEvmChain, sendNetwork.rpcUrl, sendNetwork.chainId]);

  // Non-EVM metadata
  const nonEvmMeta      = NON_EVM_META[selectedChainId];
  const activeNonEvmChain = !isEvmChain ? nonEvmChains.find((c) => c.id === selectedChainId) : null;
  const nativeSymbol = isEvmChain ? sendNetwork.symbol : (nonEvmMeta?.symbol ?? selectedChainId.toUpperCase());

  // Held tokens for the selected non-EVM chain, split into visible vs. hidden
  // (spam / worthless / thin-liquidity) so the picker can collapse the junk.
  const nonEvmTokens = !isEvmChain ? (tokensByChain[selectedChainId] ?? []) : [];
  const visibleNonEvmTokens = nonEvmTokens.filter((t) => !classifyToken(t).hidden);
  const hiddenNonEvmTokens  = nonEvmTokens.filter((t) =>  classifyToken(t).hidden);

  // EVM token list + native balance follow the CHAIN picked here (selectedChainId),
  // not the global wallet network. The global `tokens`/`balance` lag behind until
  // switchChain + refresh finish, which showed the previous chain's tokens and
  // dropped auto-detected balances. tokensByChain carries the per-chain swept
  // tokens (incl. memecoins like BNKR); chainBalances carries the natives.
  const evmTokenList = useMemo<Token[]>(() => {
    if (!isEvmChain) return [];
    const swept = tokensByChain[selectedChainId];
    if (swept && swept.length) return swept;
    return selectedChainId === network.id ? tokens : [];
  }, [isEvmChain, tokensByChain, selectedChainId, network.id, tokens]);
  const evmNativeBalance = selectedChainId === network.id
    ? parseFloat(balance)
    : (chainBalances.find((c) => c.networkId === selectedChainId)?.balanceNum ?? 0);

  // Unified send values — respect a selected token on either EVM or non-EVM,
  // otherwise fall back to the chain's native coin.
  const sendSymbol = selectedToken
    ? selectedToken.symbol
    : nativeSymbol;
  const sendBalance = selectedToken
    ? parseFloat(selectedToken.balance || "0")
    : isEvmChain ? evmNativeBalance : (activeNonEvmChain?.balance ?? 0);
  const sendDecimals = selectedToken
    ? selectedToken.decimals
    : isEvmChain ? sendNetwork.decimals : (nonEvmMeta?.decimals ?? 9);

  const canSendNative = !isEvmChain && !!CAN_SEND_NATIVE[selectedChainId];

  // Preselect the token when arriving from a token's detail page (Send button):
  // TokenDetail passes prefillChain (already seeded into selectedChainId) plus the
  // token's address/symbol. Match it once the chain's token list has loaded; a
  // native coin has no address, so it stays as the default (selectedToken null).
  const tokenPrefillApplied = useRef(false);
  useEffect(() => {
    if (tokenPrefillApplied.current || selectedToken) return;
    if (!prefillAddress && !prefillSymbol) { tokenPrefillApplied.current = true; return; }
    const addrL = prefillAddress?.toLowerCase();
    if (!addrL && prefillSymbol === nativeSymbol) { tokenPrefillApplied.current = true; return; }
    const list = isEvmChain ? evmTokenList : (tokensByChain[selectedChainId] ?? []);
    if (!list.length) return; // wait for the chain's tokens to load, then match
    const match = list.find((t) =>
      addrL ? t.address?.toLowerCase() === addrL
            : (prefillSymbol ? t.symbol === prefillSymbol : false));
    if (match) { setSelectedToken(match); tokenPrefillApplied.current = true; }
  }, [prefillAddress, prefillSymbol, isEvmChain, evmTokenList, tokensByChain, selectedChainId, nativeSymbol, selectedToken]);

  function handleChainChange(id: BPANChainId) {
    setSelectedChainId(id);
    switchChain(id);
    setTo(""); setResolvedAddr(""); setResolvedBPAN(""); setResolvedName("");
    setShowContacts(false); setSavingContact(false); setContactName("");
    setBpanChange(null); setBpanChangeAck(false);
    setError(""); setAmount(""); setSelectedToken(null); setTxHash("");
    setShowTokenPicker(false); setShowHiddenTokens(false);
    chainSynced.current = true;
  }

  // Native-coin headroom to leave for the fee on a percentage/MAX send. For an
  // EVM chain with live fee data we reserve the ACTUAL estimated fee
  // (21k gas * the selected tier's per-gas price, +20% margin) instead of the
  // flat per-chain heuristic — so a small balance (e.g. $0.5 of BNB) sends
  // nearly all of it rather than losing a fixed ~$0.18 buffer. The tier's
  // maxFeePerGas is already a ceiling (actual fee ≤ 21k * maxFeePerGas), so this
  // reserve is a safe upper bound on an L1. On rollups the L2 gas price omits
  // the L1 data fee, so we never go below the flat cushion there.
  function nativeReserve(): number {
    const flat = nativeFeeReserve(selectedChainId);
    if (!isEvmChain || !feeInfo) return flat;
    const ov = tierOverrides(gasTier, feeInfo);
    const gp = (ov.maxFeePerGas ?? ov.gasPrice ?? feeInfo.maxFee ?? feeInfo.gasPrice) as bigint | undefined;
    if (gp == null || gp <= 0n) return flat;
    const feeWei = (NATIVE_TRANSFER_GAS * gp * 12n) / 10n; // +20% headroom
    const live = Number(ethers.formatUnits(feeWei, sendNetwork.decimals));
    if (!Number.isFinite(live) || live <= 0) return flat;
    // Rollups: keep at least the flat cushion for the unpriced L1 data fee.
    return HIDDEN_L1_FEE_CHAINS.has(selectedChainId) ? Math.max(live, flat) : live;
  }

  function setPercent(pct: number) {
    // Native-coin sends pay gas out of this same balance, so a MAX (100%) send with
    // no headroom always fails. Reserve the fee for native sends; tokens pay gas
    // from the native coin, so a token's own balance needs no reserve.
    const reserve = selectedToken ? 0 : nativeReserve();
    const cap = Math.max(0, sendBalance - reserve);
    const val = Math.min(sendBalance * pct, cap);
    setAmount(val > 0 ? val.toFixed(Math.min(sendDecimals, 8)) : "0");
  }

  // Guards against out-of-order async BPAN resolutions (fast typing): only the
  // latest lookup may write state.
  const resolveSeq = useRef(0);

  async function handleToChange(value: string) {
    setTo(value);
    setResolvedAddr(""); setResolvedBPAN(""); setResolvedName(""); setError("");
    setBpanChange(null); setBpanChangeAck(false);

    // SNS (.sol) name on Solana: resolve on-chain via the lazy-loaded resolver.
    if (selectedChainId === "solana" && isSnsName(value)) {
      const seq = ++resolveSeq.current;
      setResolving(true);
      try {
        const { resolveSns } = await import("@/lib/sns");
        const addr = await resolveSns(value.trim());
        if (seq !== resolveSeq.current) return; // superseded by a newer keystroke
        if (addr && isValidNonEvmAddress(addr, "solana")) {
          setResolvedAddr(addr);
          setResolvedName(value.trim().toLowerCase());
        } else {
          setError(`No address is set for ${value.trim()}. Double-check the name, or paste the address directly.`);
        }
      } catch {
        if (seq !== resolveSeq.current) return;
        setError("Name lookup failed. Check the name, or paste the address directly.");
      } finally {
        if (seq === resolveSeq.current) setResolving(false);
      }
      return;
    }

    // ENS name on an EVM chain: resolve on-chain via Ethereum mainnet (trustless).
    if (isEvmChain && isEnsName(value)) {
      const seq = ++resolveSeq.current;
      setResolving(true);
      try {
        const mainnet = new ethers.JsonRpcProvider(NETWORKS.ethereum.rpcUrl, 1, { staticNetwork: true });
        const addr = await mainnet.resolveName(value.trim().toLowerCase());
        if (seq !== resolveSeq.current) return; // superseded by a newer keystroke
        if (addr && ethers.isAddress(addr)) {
          setResolvedAddr(addr);
          setResolvedName(value.trim().toLowerCase());
        } else {
          setError(`No address is set for ${value.trim()}. Double-check the name, or paste the address directly.`);
        }
      } catch {
        if (seq !== resolveSeq.current) return;
        setError("Name lookup failed. Check your connection, or paste the address directly.");
      } finally {
        if (seq === resolveSeq.current) setResolving(false);
      }
      return;
    }

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
        } else if (res.pendingFinality) {
          // The mapping exists at the chain head but has not crossed Ethereum
          // finality yet (~15 min). Payment destinations only ever resolve
          // from finalized state, so name the real situation instead of
          // telling the user to add a mapping they just added.
          setError(
            `A ${chainInfo.name} mapping for BPAN ${formatBPAN(clean)} was added recently and is ` +
            `waiting for network confirmation. This takes about 15 minutes. Try again shortly.`
          );
        } else {
          setError(
            `No ${chainInfo.name} address mapped to BPAN ${formatBPAN(clean)}. ` +
            (isEvmChain
              ? `The owner needs to add an "All EVM chains" mapping (or a "${selectedChainId}" one) in their profile.`
              : `The owner needs to add a "${selectedChainId}" mapping in their profile.`)
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

  // Contacts valid for the active chain (EVM addresses on any EVM chain; a
  // non-EVM address only on its own chain).
  const chainContacts = useMemo(
    () => contacts.filter((c) =>
      isEvmChain ? ethers.isAddress(c.address) : isValidNonEvmAddress(c.address.trim(), selectedChainId)),
    [contacts, isEvmChain, selectedChainId],
  );
  const canSaveContact = !!destinationAddress && !isSaved(contacts, destinationAddress);

  function pickContact(c: Contact) {
    setShowContacts(false);
    void handleToChange(c.address);
  }
  async function handleSaveContact() {
    const name = contactName.trim();
    if (!name || !destinationAddress) return;
    setContacts(await saveContact({ name, address: destinationAddress, chainId: selectedChainId }));
    setSavingContact(false); setContactName("");
  }
  async function handleDeleteContact(id: string) {
    setContacts(await deleteContact(id));
  }

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

      const gasOv = tierOverrides(gasTier, feeInfo);
      let tx;
      if (selectedToken) {
        tx = await sendToken(selectedToken.address, destinationAddress, amount, selectedToken.decimals, signer, gasOv);
      } else {
        tx = await signer.sendTransaction({
          to: destinationAddress,
          value: ethers.parseUnits(amount, sendNetwork.decimals),
          ...gasOv,
        });
      }
      setTxHash(tx.hash);
      // Record in the local activity log so this send always shows in both the
      // Activity page and the token panel, regardless of indexer coverage. The
      // nonce/to/value/data/gas fields let the Activity page speed up or cancel
      // it while it is pending.
      void logTx({
        owner: wallet.address,
        hash: tx.hash, chainId: sendNetwork.id, kind: "send", timestamp: Date.now(),
        symbol: selectedToken?.symbol || sendNetwork.symbol, value: amount,
        assetAddr: selectedToken?.address?.toLowerCase(),
        logo: selectedToken?.logo || sendNetwork.logo,
        counterparty: destinationAddress,
        status: "pending",
        nonce: tx.nonce, from: tx.from ?? wallet.address,
        to: tx.to ?? undefined, valueWei: tx.value?.toString(), data: tx.data,
        maxFeeWei: tx.maxFeePerGas?.toString(), maxPrioWei: tx.maxPriorityFeePerGas?.toString(),
        gasPriceWei: tx.gasPrice?.toString(),
      });
      // Overlay the spend on the displayed balance immediately (gas settles on
      // reconciliation), and refresh the moment the receipt lands instead of
      // waiting out the fast-poll cadence.
      markBalancesDirty([{ chainId: sendNetwork.id, tokenAddress: selectedToken?.address, delta: -parseFloat(amount) }]);
      void tx.wait().then((rc) => {
        markBalancesDirty();
        void updateTx(sendNetwork.id, tx.hash, { status: rc && rc.status === 0 ? "failed" : "confirmed" });
      }).catch(() => { /* replaced/dropped — the Activity reconciler settles it */ });
      setTxFx("success");
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
    let outHash = "";
    try {
      if (selectedChainId === "solana") {
        if (selectedToken) {
          const amt = toBaseUnits(amount, selectedToken.decimals);
          const sig = await sendSolanaTokenTransfer(
            nonEvmWallet.solana.secretKey, selectedToken.address, destinationAddress, amt, selectedToken.decimals,
          );
          setTxHash(outHash = sig);
        } else {
          const lamports = toBaseUnits(amount, 9);
          const sig = await sendSolanaTransfer(nonEvmWallet.solana.secretKey, destinationAddress, lamports);
          setTxHash(outHash = sig);
        }
      } else if (selectedChainId === "tron") {
        if (selectedToken) {
          const amt = toBaseUnits(amount, selectedToken.decimals);
          const hash = await sendTronTokenTransfer(
            nonEvmWallet.tron.privateKey, nonEvmWallet.tron.address, selectedToken.address, destinationAddress, amt,
          );
          setTxHash(outHash = hash);
        } else {
          const sun = toBaseUnits(amount, 6);
          const hash = await sendTronTransfer(
            nonEvmWallet.tron.privateKey, nonEvmWallet.tron.address, destinationAddress, sun,
          );
          setTxHash(outHash = hash);
        }
      } else if (selectedChainId === "sui") {
        if (selectedToken) {
          const amt = toBaseUnits(amount, selectedToken.decimals);
          const digest = await sendSuiTokenTransfer(
            nonEvmWallet.sui.secretKey, nonEvmWallet.sui.address, selectedToken.address, destinationAddress, amt,
          );
          setTxHash(outHash = digest);
        } else {
          const mist = toBaseUnits(amount, 9);
          const digest = await sendSuiTransfer(
            nonEvmWallet.sui.secretKey, nonEvmWallet.sui.address, destinationAddress, mist,
          );
          setTxHash(outHash = digest);
        }
      } else {
        throw new Error(`Native ${selectedChainId} sending is not available yet`);
      }
      if (outHash) void logTx({
        owner: wallet?.address,
        hash: outHash, chainId: selectedChainId, kind: "send", timestamp: Date.now(),
        symbol: selectedToken?.symbol || nativeSymbol, value: amount,
        assetAddr: selectedToken?.address?.toLowerCase(),
        logo: selectedToken?.logo,
        counterparty: destinationAddress,
      });
      // Overlay the spend immediately; the 6s fast poll reconciles (non-EVM
      // chains confirm fast, so no receipt hook is needed here).
      markBalancesDirty([{ chainId: selectedChainId, tokenAddress: selectedToken?.address, delta: -parseFloat(amount) }]);
      setTxFx("success");
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
          <div className="flex items-center justify-between mb-1.5">
            <label className="text-xs text-text-secondary block font-medium">Recipient</label>
            {chainContacts.length > 0 && (
              <button
                type="button"
                onClick={() => setShowContacts((v) => !v)}
                className="flex items-center gap-1 text-[11px] text-brand-400 hover:text-brand-300 transition-colors"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" />
                </svg>
                Contacts
              </button>
            )}
          </div>
          <div className="relative mb-1">
            <input
              value={to}
              onChange={(e) => handleToChange(e.target.value)}
              placeholder={isEvmChain
                ? "0x / name.eth or 11-digit BPAN"
                : selectedChainId === "solana"
                  ? "Address / name.sol or 11-digit BPAN"
                  : `${sendSymbol} address or 11-digit BPAN`}
              className="input-field pr-10"
            />
            {isBPANInput(to) && (
              <div className="absolute right-3 top-1/2 -translate-y-1/2">
                <HashIcon size={16} className="text-brand-400" />
              </div>
            )}
          </div>

          {/* Contacts picker */}
          {showContacts && chainContacts.length > 0 && (
            <div className="mb-3 rounded-xl border border-surface-3/60 bg-surface-1 overflow-hidden animate-slide-up max-h-52 overflow-y-auto">
              {chainContacts.map((c) => (
                <div key={c.id} className="flex items-center gap-2 px-3 py-2 hover:bg-surface-2/50 transition-colors">
                  <button type="button" onClick={() => pickContact(c)} className="flex-1 min-w-0 text-left">
                    <p className="text-[12px] font-medium text-text-primary truncate">{c.name}</p>
                    <p className="text-[10px] text-muted font-mono truncate">{c.address}</p>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDeleteContact(c.id)}
                    title="Remove contact"
                    className="p-1 rounded-md text-muted hover:text-danger transition-colors flex-shrink-0"
                  >
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* BPAN resolution status */}
          {resolving && (
            <div className="flex items-center gap-2 mb-3 animate-fade-in">
              <div className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin flex-shrink-0" />
              <p className="text-brand-400 text-xs">
                {isEnsName(to) ? "Resolving ENS name…" : isSnsName(to) ? "Resolving .sol name…" : `Resolving ${chainInfo?.name} address from BPAN registry...`}
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

          {resolvedAddr && resolvedName && (
            <div className="mb-3 px-3 py-2.5 rounded-xl bg-brand-500/5 border border-brand-500/15 animate-slide-up">
              <div className="flex items-center gap-1.5 mb-1">
                <CheckIcon size={12} className="text-brand-400" />
                <p className="text-[11px] text-brand-400 font-medium">{resolvedName} resolved</p>
              </div>
              <p className="text-xs text-text-primary font-mono break-all">{resolvedAddr}</p>
            </div>
          )}

          {/* Save recipient to contacts */}
          {canSaveContact && !savingContact && (
            <button
              type="button"
              onClick={() => { setSavingContact(true); setContactName(resolvedName || (resolvedBPAN ? formatBPAN(resolvedBPAN) : "")); }}
              className="mb-3 flex items-center gap-1.5 text-[11px] text-brand-400 hover:text-brand-300 transition-colors"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><line x1="19" y1="8" x2="19" y2="14" /><line x1="22" y1="11" x2="16" y2="11" /></svg>
              Save to contacts
            </button>
          )}
          {canSaveContact && savingContact && (
            <div className="mb-3 flex items-center gap-2 animate-slide-up">
              <input
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                placeholder="Contact name"
                autoFocus
                className="input-field flex-1 py-2 text-[12px]"
              />
              <button
                type="button"
                onClick={() => void handleSaveContact()}
                disabled={!contactName.trim()}
                className="px-3 py-2 rounded-lg text-[12px] font-semibold bg-brand-500 text-white disabled:opacity-40 transition-opacity"
              >
                Save
              </button>
              <button
                type="button"
                onClick={() => { setSavingContact(false); setContactName(""); }}
                className="px-2 py-2 rounded-lg text-[12px] text-muted hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
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
                      <span className="text-[11px] text-muted ml-2">{evmNativeBalance.toFixed(4)}</span>
                    </div>
                    {!selectedToken && <CheckIcon size={14} className="text-brand-400" />}
                  </button>
                  {evmTokenList.map((t) => (
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

          {/* Gas tier (EVM) */}
          {isEvmChain && feeInfo && (
            <div className="mb-3">
              <div className="flex items-center justify-between mb-1.5">
                <label className="text-xs text-text-secondary font-medium">Network fee</label>
                <span className="text-[10px] text-muted">gwei</span>
              </div>
              <div className="flex gap-2">
                {(["slow", "normal", "fast"] as GasTier[]).map((t) => (
                  <button
                    key={t}
                    type="button"
                    onClick={() => setGasTier(t)}
                    className={`flex-1 py-2 rounded-xl border text-center transition-colors ${
                      gasTier === t ? "border-brand-500 bg-brand-500/10" : "border-border hover:border-brand-500/40"
                    }`}
                  >
                    <p className={`text-[11px] font-semibold capitalize ${gasTier === t ? "text-brand-400" : "text-text-primary"}`}>{t}</p>
                    <p className="text-[10px] text-muted tabular-nums">{tierGwei(t, feeInfo)}</p>
                  </button>
                ))}
              </div>
            </div>
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
