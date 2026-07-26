// Mobile Send — EVM native + Solana native (Phase 1 slice; tokens and the
// remaining non-EVM chains follow). Ports the extension Send page's flow and
// safety rails: BPAN quorum resolution with the trust-on-first-use changed-
// mapping acknowledgement (H-03), chain-format validation of resolved
// addresses, the fee-reserve MAX rule, titled AlertCard failure states from
// core/sendErrors, and the TxResultOverlay. ENS/SNS name resolution is not in
// this slice.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BackHandler, Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ethers } from "ethers";
import {
  isBPANInput, isValidBPAN, resolveBPANChecked, acceptBPANChange,
  BPANConsensusError, BPANInsufficientConfirmationError, formatBPAN,
} from "@numpay/core/bpan";
import { NETWORKS } from "@numpay/core/networks";
import { isValidNonEvmAddress } from "@numpay/core/addressValidation";
import { parseScannedPayload } from "@numpay/core/qrPayload";
import { chainNameOf } from "@numpay/core/txLog";
import { friendlyTxError, parseSendError } from "@numpay/core/sendErrors";
import { tierOverrides, tierGwei, fetchFeeInfo, type GasTier, type FeeInfo } from "@numpay/core/gas";
import { getUsdPrice } from "@numpay/core/currency";
import { upsertCustomToken } from "@numpay/core/customTokens";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import {
  detectToken, detectErrorMessage, isTokenAddressFor, looksLikeTokenAddress,
} from "../wallet/tokenDetect";
import {
  estimateEvmNativeFee, explorerTxUrl, sendEvmNative, sendNonEvmNative,
  sendTokenTransfer, nonEvmNativeReserve, NON_EVM_SENDABLE,
  type EvmFeeEstimate, type TokenSendAsset,
} from "../wallet/send";
import type { MobileWalletState } from "../wallet/useMobileWallet";
import { colors, radius, type as ts } from "../ui/theme";
import { AlertCard, Btn, Chip, Card, Field, ScreenHeader, SendErrorCard } from "../ui/components";
import { useCurrencyPref, formatFiatLine, formatFeeTail } from "../ui/currency";
import { AssetIcon, ChainIcon } from "../ui/coins";
import { ScanIcon, SearchIcon, XIcon } from "../ui/icons";
import { ImportTokenCard } from "../ui/ImportTokenCard";
import { QrScanner } from "../ui/QrScanner";
import { TxResultOverlay, type TxFxStatus } from "../ui/TxResultOverlay";

interface BpanChange { number: string; chain: string; oldAddr: string; newAddr: string }

const NON_EVM_NAMES: Record<string, string> = { solana: "Solana", tron: "Tron", sui: "Sui" };
// Typical fee for chains without a live estimate (matches the reserve
// comments in send.ts: Tron ~1 TRX recipient activation, Sui a few
// thousandths).
const NON_EVM_FEE_NATIVE: Record<string, number> = { solana: 0.000005, tron: 1, sui: 0.003 };

// Fixed-notation amount for fee lines. toPrecision(2) rendered tiny rollup
// fees as scientific notation ("~2.3e-7 ETH", observed on Base).
function fmtFeeNative(n: number): string {
  if (!(n > 0)) return "0";
  if (n >= 1) return n.toFixed(4).replace(/\.?0+$/, "");
  const decimals = Math.min(12, Math.ceil(-Math.log10(n)) + 1); // 2 significant digits
  return n.toFixed(decimals).replace(/\.?0+$/, "");
}

// `tail` renders the parenthesised fiat cost in the user's display currency
// (formatFeeTail, bound by the caller) so these stay pure string builders.
function nonEvmFeeLine(chainId: string, price: number, tail: (usd: number) => string): string {
  const usd = price > 0 ? (NON_EVM_FEE_NATIVE[chainId] ?? 0) * price : 0;
  switch (chainId) {
    case "solana": return `Network fee ~0.000005 SOL${tail(usd)}`;
    case "tron":   return `Network fee up to ~1 TRX${tail(usd)} (new recipients cost ~1 TRX activation)`;
    case "sui":    return `Network fee ~0.003 SUI${tail(usd)}`;
    default:       return "";
  }
}

/** A pickable token: the asset fields the send needs plus display balance. */
export interface SendTokenPick extends TokenSendAsset {
  balanceNum: number;
  priceUsd: number;
}

export function SendScreen({
  w, onBack, onSessionExpired, initialChainId, initialToken, initialTo, initialAmount,
}: {
  w: MobileWalletState;
  onBack: () => void;
  onSessionExpired?: () => void;
  /** Preselect (TokenDetail entry): chain and, for token rows, the token. */
  initialChainId?: string;
  initialToken?: SendTokenPick | null;
  /** Prefill the recipient (dashboard scanner): an address or a BPAN. */
  initialTo?: string;
  /** Prefill the amount, when the scanned payload carried one. */
  initialAmount?: string;
}) {
  // A chain a scan selected that the chip row would not otherwise list (it
  // only lists funded chains). Without this the chips could not show which
  // chain a scanned payload put the send on — exactly the thing that has to
  // stay visible when a QR code changes the network.
  const [extraChain, setExtraChain] = useState<string | null>(null);

  // Sendable chains: every EVM chain the wallet holds native coin on (plus
  // Ethereum so the screen is never empty), then the sendable non-EVM chains.
  // Custom networks (Manage assets) count as EVM chains here.
  const chains = useMemo(() => {
    const evm = w.rows
      .filter((r) => r.isNative && (NETWORKS[r.chainId] || w.customNets[r.chainId]) && (r.balanceNum > 0 || r.chainId === "ethereum"))
      .map((r) => r.chainId);
    if (!evm.includes("ethereum")) evm.unshift("ethereum");
    const all = [...evm, ...Object.keys(NON_EVM_SENDABLE)];
    if (extraChain && !all.includes(extraChain)) all.unshift(extraChain);
    return all;
  }, [w.rows, w.customNets, extraChain]);

  const cur = useCurrencyPref();
  const feeTail = useCallback(
    (usd: number) => formatFeeTail(usd, cur.code, cur.currency, w.rates),
    [cur.code, cur.currency, w.rates],
  );
  const [chainId, setChainId] = useState(initialChainId ?? "ethereum");
  // null = the chain's native coin; otherwise the picked token.
  const [token, setToken] = useState<SendTokenPick | null>(initialToken ?? null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const isEvm = !NON_EVM_SENDABLE[chainId];
  const net = NETWORKS[chainId] ?? w.customNets[chainId];
  const nativeSymbol = isEvm ? (net?.symbol ?? "ETH") : NON_EVM_SENDABLE[chainId].symbol;
  const symbol = token?.symbol ?? nativeSymbol;
  const decimalsMax = token?.decimals ?? (isEvm ? (net?.decimals ?? 18) : NON_EVM_SENDABLE[chainId].decimals);
  const chainName = isEvm ? (net?.name ?? chainId) : NON_EVM_NAMES[chainId] ?? chainId;
  const nativeBalance = w.rows.find((r) => r.isNative && r.chainId === chainId)?.balanceNum ?? 0;
  const balance = token ? token.balanceNum : nativeBalance;
  const price = token
    ? token.priceUsd
    : (w.rates ? getUsdPrice(nativeSymbol, w.rates) : 0);

  // Tokens pickable on the selected chain (discovered holdings, largest first).
  const chainTokens = useMemo<SendTokenPick[]>(() => {
    const list = w.tokensByChain[chainId] ?? [];
    return list
      .map((t) => {
        const bal = parseFloat(t.balance) || 0;
        const p = t.priceUsd ?? (w.rates ? getUsdPrice(t.symbol, w.rates) : 0);
        return {
          chainId, address: t.address, symbol: t.symbol, decimals: t.decimals,
          logo: t.logo, balanceNum: bal, priceUsd: p,
        };
      })
      .filter((t) => t.balanceNum > 0)
      .sort((a, b) => b.balanceNum * b.priceUsd - a.balanceNum * a.priceUsd);
  }, [w.tokensByChain, chainId, w.rates]);

  // Picker search. Doubles as import-by-address, which matters more here than
  // anywhere else in the app: discovery misses tokens outright on the chains
  // with no indexer coverage, and until now a held token it missed could not
  // be sent at all without a detour through Manage assets.
  const [search, setSearch] = useState("");
  const [importState, setImportState] = useState<"idle" | "loading" | "preview">("idle");
  // The pick is what Send needs; the name is only for the preview card and the
  // stored custom token, so it rides alongside rather than widening SendTokenPick.
  const [importToken, setImportToken] = useState<{ pick: SendTokenPick; name: string } | null>(null);
  const [importError, setImportError] = useState("");

  const searchQ = search.trim().toLowerCase();
  const visibleTokens = useMemo(
    () => chainTokens.filter((t) =>
      !searchQ || t.symbol.toLowerCase().includes(searchQ) || t.address.toLowerCase() === searchQ),
    [chainTokens, searchQ],
  );
  // Only EVM chains and Solana can be looked up by address (Tron and Sui have
  // no detection path yet), so the import affordance is not offered elsewhere.
  const canImport = isEvm || chainId === "solana";
  const showImport = canImport && looksLikeTokenAddress(search.trim()) && visibleTokens.length === 0;

  function resetSearch() {
    setSearch(""); setImportState("idle"); setImportToken(null); setImportError("");
  }

  async function handleImport() {
    const raw = search.trim();
    setImportState("loading"); setImportError("");
    try {
      const found = await detectToken(chainId, raw, {
        evmAddress: w.evmAddress,
        solanaAddress: w.nonEvmAddresses?.solana,
        customNets: w.customNets,
      });
      setImportToken({
        name: found.name,
        pick: {
          chainId,
          address: chainId === "solana" ? raw : raw.toLowerCase(),
          symbol: found.symbol, decimals: found.decimals, logo: found.logo,
          balanceNum: parseFloat(found.balance ?? "0") || 0,
          priceUsd: w.rates ? getUsdPrice(found.symbol, w.rates) : 0,
        },
      });
      setImportState("preview");
    } catch (e: any) {
      setImportError(detectErrorMessage(e));
      setImportState("idle");
    }
  }

  async function confirmImport() {
    if (!importToken) return;
    const { pick, name } = importToken;
    await upsertCustomToken({
      chainId: pick.chainId, address: pick.address, symbol: pick.symbol,
      name, decimals: pick.decimals, logo: pick.logo,
    });
    void w.reloadCustom();
    // Select it straight away with the balance the lookup returned: the
    // discovery sweep is what missed this token in the first place, so waiting
    // for it to appear in the list would strand the send.
    setToken(pick); setPickerOpen(false); setAmount(""); setError("");
    resetSearch();
  }

  const [to, setTo] = useState(initialTo ?? "");
  const [resolvedAddr, setResolvedAddr] = useState("");
  const [resolvedBPAN, setResolvedBPAN] = useState("");
  const [resolving, setResolving] = useState(false);
  const [bpanChange, setBpanChange] = useState<BpanChange | null>(null);
  const [bpanChangeAck, setBpanChangeAck] = useState(false);
  const [amount, setAmount] = useState(initialAmount ?? "");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [txFx, setTxFx] = useState<TxFxStatus | null>(null);
  const [txHash, setTxHash] = useState("");
  const [fee, setFee] = useState<EvmFeeEstimate | null>(null);
  // Gas tier (EVM). Fee data drives the selector labels and the send overrides;
  // same slow/normal/fast logic as the extension Send page (@numpay/core/gas).
  const [gasTier, setGasTier] = useState<GasTier>("normal");
  const [feeInfo, setFeeInfo] = useState<FeeInfo | null>(null);
  const resolveSeq = useRef(0);
  const [scanning, setScanning] = useState(false);
  const [scanErr, setScanErr] = useState("");

  // Fee estimate for the fee row + the MAX reserve.
  useEffect(() => {
    setFee(null);
    if (!isEvm) return;
    let live = true;
    estimateEvmNativeFee(chainId).then((f) => { if (live) setFee(f); });
    return () => { live = false; };
  }, [chainId, isEvm]);

  // Fee data for the gas-tier selector (EVM only).
  useEffect(() => {
    setGasTier("normal"); setFeeInfo(null);
    if (!isEvm || !net) return;
    let live = true;
    fetchFeeInfo(net.rpcUrl, net.chainId).then((f) => { if (live) setFeeInfo(f); });
    return () => { live = false; };
  }, [chainId, isEvm, net]);

  function switchChain(id: string) {
    setChainId(id);
    setToken(null); setPickerOpen(false); resetSearch();
    setTo(""); setResolvedAddr(""); setResolvedBPAN("");
    setBpanChange(null); setBpanChangeAck(false);
    setError(""); setAmount(""); setTxHash("");
  }

  // Recipient input: raw address, or an 11-digit BPAN resolved with the quorum
  // + TOFU-pin checks (same messages as the extension so parseSendError maps
  // them to the same titled cards).
  const handleToChange = useCallback(async (value: string) => {
    setTo(value);
    setResolvedAddr(""); setResolvedBPAN("");
    setBpanChange(null); setBpanChangeAck(false);
    setError("");
    if (!value.trim()) return;

    const clean = value.trim().replace(/\D/g, "");
    if (!(isBPANInput(value) && isValidBPAN(clean))) return;

    const seq = ++resolveSeq.current;
    setResolving(true);
    try {
      const res = await resolveBPANChecked(clean, chainId);
      if (seq !== resolveSeq.current) return;
      const addr = res.address;
      if (addr) {
        // Registry mappings are free-form strings set by the BPAN owner.
        // Validate against the selected chain's format so a wrong-chain or
        // malformed mapping can never become a send target.
        const looksValid = isEvm
          ? ethers.isAddress(addr.trim())
          : isValidNonEvmAddress(addr.trim(), chainId);
        if (!looksValid) {
          setError(
            `BPAN ${formatBPAN(clean)} has a "${chainId}" mapping, but it is not a valid ` +
            `${chainName} address. Ask the owner to fix their mapping.`
          );
          return;
        }
        setResolvedAddr(addr.trim());
        setResolvedBPAN(clean);
        if (res.changed) {
          setBpanChange({
            number: clean, chain: chainId,
            oldAddr: (res.pinnedBefore ?? "").trim(), newAddr: addr.trim(),
          });
          setBpanChangeAck(false);
        }
      } else if (res.pendingFinality) {
        setError(
          `The ${chainName} mapping for BPAN ${formatBPAN(clean)} was added recently and is ` +
          `waiting for network confirmation. This takes about 15 minutes. Try again shortly.`
        );
      } else {
        setError(
          `No ${chainName} address mapped to BPAN ${formatBPAN(clean)}. ` +
          (isEvm
            ? `The owner needs to add an "All EVM chains" mapping (or a "${chainId}" one) in their profile.`
            : `The owner needs to add a "${chainId}" mapping in their profile.`)
        );
      }
    } catch (e) {
      if (seq !== resolveSeq.current) return;
      if (e instanceof BPANConsensusError) {
        setError(
          `Could not safely verify BPAN ${formatBPAN(clean)}: network providers returned ` +
          `conflicting addresses. Do not send. Try again later or contact the recipient.`
        );
      } else if (e instanceof BPANInsufficientConfirmationError) {
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
  }, [chainId, chainName, isEvm]);

  // A scanned BPAN arrives as a prefilled string, which is not enough: it still
  // has to go through the quorum + TOFU resolution before it can be sent to.
  // A raw address needs nothing — destinationAddress validates it directly.
  // MUST stay above the `if (scanning)` early return below: a hook after it
  // would be skipped whenever the camera is open ("rendered fewer hooks").
  const scannedBpanRef = useRef(initialTo);
  useEffect(() => {
    const seed = scannedBpanRef.current;
    scannedBpanRef.current = undefined;
    if (seed && isBPANInput(seed)) void handleToChange(seed);
  }, [handleToChange]);

  // The token picker is an inline dropdown, not a route, so App.tsx's global
  // back handler can't see it: a hardware back while it's open (now that it
  // holds typed search + a half-finished import) would fall through to the
  // "send" case and exit the whole screen. Register a picker-scoped handler
  // while it's open — RN fires the newest listener first, so returning true
  // consumes the press before App's runs. Skip while the scanner is up (its
  // own early return owns the screen then), and keep this ABOVE the
  // `if (scanning)` return so the hook count never changes. A back inside an
  // open import preview backs out to the list first.
  useEffect(() => {
    if (!pickerOpen || scanning) return;
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (importState !== "idle") {
        setImportState("idle"); setImportToken(null); setImportError("");
        return true;
      }
      setPickerOpen(false);
      resetSearch();
      return true;
    });
    return () => sub.remove();
  }, [pickerOpen, scanning, importState]);

  /**
   * A scanned code, applied to this form. Returns a message to REJECT and keep
   * the camera open; returns nothing to accept and close.
   *
   * The rule that matters: a payload that names no chain only fills the
   * address, leaving the user's selected chain alone (core/qrPayload never
   * guesses a chain for a bare EVM address). A payload that DOES name a chain
   * switches to it, and the chip row is made to show it.
   */
  function applyScan(raw: string): string | void {
    const p = parseScannedPayload(raw);
    if (p.kind === "walletconnect") {
      return "That's a WalletConnect code. Use Settings › Connected dApps to pair.";
    }
    if (p.kind === "bpan") {
      setScanning(false); setScanErr("");
      void handleToChange(p.bpan);
      return;
    }
    if (p.kind !== "address") {
      return "That QR code isn't an address, a payment link or a BPAN.";
    }
    if (p.chainId && p.chainId !== chainId) {
      const sendable = !!NETWORKS[p.chainId] || !!w.customNets[p.chainId] || !!NON_EVM_SENDABLE[p.chainId];
      if (!sendable) {
        return `This code is for ${chainNameOf(p.chainId) ?? p.chainId}, which NumPay can't send on yet.`;
      }
      // Chain first: switchChain deliberately clears the form, so the scanned
      // address has to be applied after it.
      switchChain(p.chainId);
      setExtraChain(p.chainId);
    }
    setScanning(false); setScanErr("");
    setTo(p.address);
    setResolvedAddr(""); setResolvedBPAN("");
    setBpanChange(null); setBpanChangeAck(false);
    setError("");
    // EIP-681 `value` is in the NATIVE coin, so it only applies when no token
    // is selected. Token-transfer amounts are dropped by the parser (their
    // units need the token's decimals), so nothing wrong can land here.
    if (p.amount && !token) setAmount(p.amount);
  }

  if (scanning) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Scan address" onBack={() => setScanning(false)} />
        <QrScanner
          title="Scan address"
          hint="Point the camera at a wallet address, payment QR or BPAN code."
          onScan={applyScan}
          onCancel={() => setScanning(false)}
        />
      </View>
    );
  }

  const destinationAddress =
    resolvedAddr ||
    (isEvm
      ? (ethers.isAddress(to.trim()) ? to.trim() : "")
      : (isValidNonEvmAddress(to.trim(), chainId) ? to.trim() : ""));

  function handleMax() {
    // Tokens don't pay their own fee (gas is native), so MAX is the full
    // balance; natives keep the fee reserve.
    if (token) {
      setAmount(token.balanceNum > 0 ? String(token.balanceNum) : "0");
      return;
    }
    const reserve = isEvm
      ? (fee?.reserveNative ?? 0.0012)
      : nonEvmNativeReserve(chainId);
    const max = Math.max(0, balance - reserve);
    setAmount(max > 0 ? String(Number(max.toFixed(8))) : "0");
  }

  async function handleSend() {
    if (bpanChange && !bpanChangeAck) {
      setError("This BPAN's address changed. Confirm you have verified the new address before sending.");
      return;
    }
    if (!destinationAddress) { setError("Enter a valid address or 11-digit BPAN"); return; }
    const amt = parseFloat(amount);
    if (!amount || !(amt > 0)) { setError("Enter an amount greater than zero"); return; }
    if (amt > balance) { setError("Insufficient balance"); return; }
    const mnemonic = await getUnlockedMnemonic();
    if (!mnemonic) {
      // Session expired under us — surface the re-auth overlay immediately
      // instead of waiting for the 30 s auto-lock poll to swap the screen.
      setError("Wallet is locked. Unlock NumPay and try again.");
      onSessionExpired?.();
      return;
    }

    // Deliberate acceptance of a changed mapping advances the trust pin (H-03).
    if (bpanChange) await acceptBPANChange(bpanChange.number, bpanChange.chain, bpanChange.newAddr);

    Keyboard.dismiss();
    setSending(true); setError(""); setTxHash(""); setTxFx("pending");
    try {
      const hash = token
        ? await sendTokenTransfer(
            mnemonic, token, destinationAddress, amount,
            isEvm ? tierOverrides(gasTier, feeInfo) : undefined,
          )
        : isEvm
          ? await sendEvmNative(mnemonic, chainId, destinationAddress, amount, tierOverrides(gasTier, feeInfo))
          : await sendNonEvmNative(mnemonic, chainId, destinationAddress, amount);
      setTxHash(hash);
      setTxFx("success");
      w.refresh();
    } catch (e: any) {
      setError(friendlyTxError(e?.reason || e?.message || "Transaction failed"));
      setTxFx("error");
    } finally {
      setSending(false);
    }
  }

  const amountUsd = parseFloat(amount) > 0 && price > 0 ? parseFloat(amount) * price : 0;
  // Fees are always paid in the chain's native coin, whatever asset is sent.
  const nativePrice = w.rates ? getUsdPrice(nativeSymbol, w.rates) : 0;
  const feeUsd = fee && nativePrice > 0 ? fee.feeNative * nativePrice : 0;
  const errView = error ? parseSendError(error) : null;

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Send" onBack={onBack} />
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        {/* Chain selector */}
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 4 }}>
          {chains.map((id) => (
            <Chip
              key={id}
              label={NON_EVM_NAMES[id] ?? NETWORKS[id]?.name ?? w.customNets[id]?.name ?? id}
              active={chainId === id}
              onPress={() => switchChain(id)}
              icon={<ChainIcon chainId={id} size={16} />}
            />
          ))}
        </ScrollView>

        {/* Asset picker: the chain's native coin or any discovered token */}
        <Pressable onPress={() => { setPickerOpen((v) => !v); resetSearch(); }}>
          <Card style={st.assetCard}>
            <AssetIcon
              symbol={symbol} logo={token?.logo} chainId={chainId}
              address={token?.address} size={36}
            />
            <View style={{ flex: 1, marginLeft: 12 }}>
              <Text style={st.assetSym}>{symbol}</Text>
              <Text style={st.assetChain}>
                {chainName}{chainTokens.length > 0 ? "  ·  tap to change asset" : ""}
              </Text>
            </View>
            <View style={{ alignItems: "flex-end" }}>
              <Text style={st.assetBal}>
                {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {symbol}
              </Text>
              {price > 0 && <Text style={st.assetChain}>${(balance * price).toFixed(2)}</Text>}
            </View>
          </Card>
        </Pressable>

        {/* Token list (native first, holdings by value) */}
        {pickerOpen && (
          <Card style={{ marginTop: 6 }}>
            {/* Search doubles as import-by-address; the native coin row stays
                visible only while the field is empty, since it can never be
                what a typed query is looking for. */}
            {(chainTokens.length > 2 || canImport) && (
              <View style={st.searchRow}>
                <SearchIcon size={15} color={colors.muted} />
                <Field
                  placeholder={canImport ? "Search or paste a token address" : "Search tokens"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  value={search}
                  onChangeText={(v) => {
                    setSearch(v);
                    setImportState("idle"); setImportToken(null); setImportError("");
                  }}
                  style={st.searchField}
                />
                {search.length > 0 && (
                  <Pressable onPress={resetSearch} hitSlop={8} accessibilityLabel="Clear search">
                    <XIcon size={12} color={colors.muted} />
                  </Pressable>
                )}
              </View>
            )}
            {showImport && (
              <ImportTokenCard
                address={search.trim()}
                chainId={chainId}
                chainName={chainName}
                rightShape={isTokenAddressFor(chainId, search.trim())}
                state={importState}
                token={importToken
                  ? {
                      symbol: importToken.pick.symbol, name: importToken.name,
                      logo: importToken.pick.logo, decimals: importToken.pick.decimals,
                      balance: String(importToken.pick.balanceNum),
                      address: importToken.pick.address, chainId: importToken.pick.chainId,
                    }
                  : null}
                error={importError}
                onFetch={() => { void handleImport(); }}
                onCancel={() => { setImportState("idle"); setImportToken(null); }}
                onAdd={() => { void confirmImport(); }}
              />
            )}
            {!searchQ && (
            <Pressable
              style={st.pickRow}
              onPress={() => { setToken(null); setPickerOpen(false); setAmount(""); setError(""); }}
            >
              <AssetIcon symbol={nativeSymbol} chainId={chainId} size={30} />
              <View style={{ flex: 1, marginLeft: 10 }}>
                <Text style={st.assetSym}>{nativeSymbol}</Text>
                <Text style={st.assetChain}>Native coin</Text>
              </View>
              <Text style={st.assetBal}>
                {nativeBalance.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </Text>
            </Pressable>
            )}
            {visibleTokens.map((t) => (
              <Pressable
                key={t.address}
                style={st.pickRow}
                onPress={() => { setToken(t); setPickerOpen(false); setAmount(""); setError(""); }}
              >
                <AssetIcon symbol={t.symbol} logo={t.logo} chainId={chainId} address={t.address} size={30} />
                <View style={{ flex: 1, marginLeft: 10 }}>
                  <Text style={st.assetSym}>{t.symbol}</Text>
                  <Text style={st.assetChain} numberOfLines={1}>
                    {t.address.slice(0, 8)}…{t.address.slice(-4)}
                  </Text>
                </View>
                <Text style={st.assetBal}>
                  {t.balanceNum.toLocaleString(undefined, { maximumFractionDigits: 6 })}
                </Text>
              </Pressable>
            ))}
            {visibleTokens.length === 0 && !showImport && (
              <Text style={[st.assetChain, { padding: 12 }]}>
                {searchQ
                  ? (canImport
                      ? `No token matches “${search.trim()}” on ${chainName}. Paste its contract address to import it.`
                      : `No token matches “${search.trim()}” on ${chainName}.`)
                  : `No tokens discovered on ${chainName} yet.`}
              </Text>
            )}
          </Card>
        )}

        {/* Recipient. The scan button sits in the row rather than inside the
            input: Field is a plain TextInput, and overlaying a control on it
            would fight the text as an address fills the width. */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Field
            placeholder={`Address or 11-digit BPAN`}
            autoCapitalize="none"
            autoCorrect={false}
            value={to}
            onChangeText={(v) => { void handleToChange(v); }}
            style={{ flex: 1 }}
          />
          <Pressable
            onPress={() => { setScanErr(""); setScanning(true); }}
            style={st.scanBtn}
            hitSlop={6}
            accessibilityLabel="Scan a QR code"
          >
            <ScanIcon size={17} color={colors.brand2} />
          </Pressable>
        </View>
        {!!scanErr && <Text style={st.scanErr}>{scanErr}</Text>}
        {resolving && <Text style={st.resolving}>Verifying BPAN across independent providers…</Text>}
        {!!resolvedBPAN && !!resolvedAddr && !bpanChange && (
          <Text style={st.resolved}>
            BPAN {formatBPAN(resolvedBPAN)} → {resolvedAddr.slice(0, 10)}…{resolvedAddr.slice(-6)}
          </Text>
        )}

        {/* Changed-mapping acknowledgement (H-03) */}
        {bpanChange && (
          <View style={{ marginTop: 10 }}>
            <AlertCard
              tone="amber"
              title="Address Changed"
              body={
                `This BPAN's ${chainName} address changed since you last used it.\n\n` +
                `Old: ${bpanChange.oldAddr}\nNew: ${bpanChange.newAddr}\n\n` +
                `Verify the new address with the recipient through another channel before sending.`
              }
            />
            <Btn
              label={bpanChangeAck ? "✓ Verified with the recipient" : "I verified the new address"}
              variant={bpanChangeAck ? "primary" : "secondary"}
              onPress={() => setBpanChangeAck((v) => !v)}
            />
          </View>
        )}

        {/* Amount */}
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
          <Field
            placeholder="0.0"
            keyboardType="decimal-pad"
            value={amount}
            onChangeText={(v) => { setAmount(v.replace(/[^0-9.]/g, "")); setError(""); }}
            style={{ flex: 1 }}
          />
          <Pressable onPress={handleMax} style={st.maxBtn}>
            <Text style={st.maxText}>MAX</Text>
          </Pressable>
        </View>
        <View style={st.subRow}>
          <Text style={st.subText}>{amountUsd > 0 ? `≈ ${formatFiatLine(amountUsd, cur.code, cur.currency, w.rates)}` : " "}</Text>
          <Text style={st.subText}>
            {isEvm
              ? (fee ? `Network fee ~${fmtFeeNative(fee.feeNative)} ${nativeSymbol}${feeTail(feeUsd)}` : "Estimating fee…")
              : nonEvmFeeLine(chainId, nativePrice, feeTail)}
          </Text>
        </View>

        {/* Gas tier (EVM) */}
        {isEvm && feeInfo && (
          <View style={{ marginTop: 14 }}>
            <View style={st.gasHead}>
              <Text style={st.gasLabel}>Network fee</Text>
              <Text style={st.gasUnit}>gwei</Text>
            </View>
            <View style={st.gasRow}>
              {(["slow", "normal", "fast"] as GasTier[]).map((t) => {
                const on = gasTier === t;
                return (
                  <Pressable
                    key={t}
                    onPress={() => setGasTier(t)}
                    style={[st.gasBtn, on && st.gasBtnOn]}
                  >
                    <Text style={[st.gasTier, on && st.gasTierOn]}>{t}</Text>
                    <Text style={st.gasGwei}>{tierGwei(t, feeInfo)}</Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
        )}

        {errView && <SendErrorCard view={errView} style={{ marginTop: 12 }} />}

        <Btn
          label={sending ? "Sending…" : `Send ${symbol}`}
          onPress={() => { void handleSend(); }}
          disabled={sending || resolving || !destinationAddress || !(parseFloat(amount) > 0)}
          style={{ marginTop: 16, marginBottom: 24 }}
        />
      </ScrollView>

      {txFx && (
        <TxResultOverlay
          status={txFx}
          kind="send"
          amountLabel={`${amount} ${symbol}`}
          txHash={txHash || undefined}
          explorerUrl={txHash ? explorerTxUrl(chainId, txHash) : undefined}
          errorTitle={errView?.title}
          errorMessage={errView?.body}
          onClose={() => { if (txFx === "success") onBack(); setTxFx(null); }}
        />
      )}
    </View>
  );
}

const st = StyleSheet.create({
  assetCard: {
    flexDirection: "row",
    alignItems: "center",
    padding: 14,
    marginTop: 12,
  },
  assetSym: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "600" },
  assetChain: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
  assetBal: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "500", fontVariant: ["tabular-nums"] },
  // Search sits inside the picker card, so it carries only a bottom hairline
  // rather than its own border and background.
  searchRow: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  searchField: {
    flex: 1, marginTop: 0,
    backgroundColor: "transparent", borderWidth: 0,
    paddingHorizontal: 0, paddingVertical: 11,
  },
  pickRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  scanBtn: {
    marginTop: 10,
    width: 46,
    paddingVertical: 12,
    borderRadius: radius.button,
    backgroundColor: "rgba(124, 109, 240, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(124, 109, 240, 0.32)",
    alignItems: "center",
    justifyContent: "center",
  },
  scanErr: { color: colors.danger, fontSize: ts.small, marginTop: 6 },
  resolving: { color: colors.muted, fontSize: ts.small, marginTop: 6 },
  resolved: { color: colors.success, fontSize: ts.small, marginTop: 6 },
  maxBtn: {
    marginTop: 10,
    paddingVertical: 13,
    paddingHorizontal: 14,
    borderRadius: radius.button,
    backgroundColor: "rgba(124, 109, 240, 0.14)",
    borderWidth: 1,
    borderColor: "rgba(124, 109, 240, 0.32)",
  },
  maxText: { color: colors.brand2, fontSize: 12, fontWeight: "600" },
  subRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 6,
    gap: 10,
  },
  subText: { color: colors.muted2, fontSize: 10.5 },
  gasHead: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 6,
  },
  gasLabel: { color: colors.textSecondary, fontSize: ts.small, fontWeight: "500" },
  gasUnit: { color: colors.muted2, fontSize: ts.label },
  gasRow: { flexDirection: "row", gap: 8 },
  gasBtn: {
    flex: 1,
    paddingVertical: 8,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
  },
  gasBtnOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  gasTier: {
    fontSize: 11,
    fontWeight: "600",
    textTransform: "capitalize",
    color: colors.textPrimary,
  },
  gasTierOn: { color: colors.brand2 },
  gasGwei: { color: colors.muted2, fontSize: ts.label, fontVariant: ["tabular-nums"], marginTop: 1 },
});
