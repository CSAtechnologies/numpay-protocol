// Mobile Send — EVM native + Solana native (Phase 1 slice; tokens and the
// remaining non-EVM chains follow). Ports the extension Send page's flow and
// safety rails: BPAN quorum resolution with the trust-on-first-use changed-
// mapping acknowledgement (H-03), chain-format validation of resolved
// addresses, the fee-reserve MAX rule, titled AlertCard failure states from
// core/sendErrors, and the TxResultOverlay. ENS/SNS name resolution is not in
// this slice.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Keyboard, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { ethers } from "ethers";
import {
  isBPANInput, isValidBPAN, resolveBPANChecked, acceptBPANChange,
  BPANConsensusError, BPANInsufficientConfirmationError, formatBPAN,
} from "@numpay/core/bpan";
import { NETWORKS } from "@numpay/core/networks";
import { isValidNonEvmAddress } from "@numpay/core/addressValidation";
import { friendlyTxError, parseSendError } from "@numpay/core/sendErrors";
import { getUsdPrice } from "@numpay/core/currency";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import {
  estimateEvmNativeFee, explorerTxUrl, sendEvmNative, sendNonEvmNative,
  nonEvmNativeReserve, NON_EVM_SENDABLE, type EvmFeeEstimate,
} from "../wallet/send";
import type { MobileWalletState } from "../wallet/useMobileWallet";
import { colors, radius, type as ts } from "../ui/theme";
import { AlertCard, Btn, Chip, Card, Field, ScreenHeader, SendErrorCard } from "../ui/components";
import { AssetIcon, ChainIcon } from "../ui/coins";
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

// Fiat tail for a fee line: "$0.00" says nothing, so sub-cent fees read
// "(<$0.01)" instead.
function feeUsdLabel(usd: number): string {
  if (!(usd > 0)) return "";
  return usd < 0.005 ? " (<$0.01)" : ` ($${usd.toFixed(2)})`;
}

function nonEvmFeeLine(chainId: string, price: number): string {
  const usd = price > 0 ? (NON_EVM_FEE_NATIVE[chainId] ?? 0) * price : 0;
  switch (chainId) {
    case "solana": return `Network fee ~0.000005 SOL${feeUsdLabel(usd)}`;
    case "tron":   return `Network fee up to ~1 TRX${feeUsdLabel(usd)} (new recipients cost ~1 TRX activation)`;
    case "sui":    return `Network fee ~0.003 SUI${feeUsdLabel(usd)}`;
    default:       return "";
  }
}

export function SendScreen({ w, onBack, onSessionExpired }: {
  w: MobileWalletState;
  onBack: () => void;
  onSessionExpired?: () => void;
}) {
  // Sendable chains: every EVM chain the wallet holds native coin on (plus
  // Ethereum so the screen is never empty), then the sendable non-EVM chains.
  const chains = useMemo(() => {
    const evm = w.rows
      .filter((r) => r.isNative && NETWORKS[r.chainId] && (r.balanceNum > 0 || r.chainId === "ethereum"))
      .map((r) => r.chainId);
    if (!evm.includes("ethereum")) evm.unshift("ethereum");
    return [...evm, ...Object.keys(NON_EVM_SENDABLE)];
  }, [w.rows]);

  const [chainId, setChainId] = useState("ethereum");
  const isEvm = !NON_EVM_SENDABLE[chainId];
  const net = NETWORKS[chainId];
  const symbol = isEvm ? (net?.symbol ?? "ETH") : NON_EVM_SENDABLE[chainId].symbol;
  const chainName = isEvm ? (net?.name ?? chainId) : NON_EVM_NAMES[chainId] ?? chainId;
  const balance = w.rows.find((r) => r.isNative && r.chainId === chainId)?.balanceNum ?? 0;
  const price = w.rates ? getUsdPrice(symbol, w.rates) : 0;

  const [to, setTo] = useState("");
  const [resolvedAddr, setResolvedAddr] = useState("");
  const [resolvedBPAN, setResolvedBPAN] = useState("");
  const [resolving, setResolving] = useState(false);
  const [bpanChange, setBpanChange] = useState<BpanChange | null>(null);
  const [bpanChangeAck, setBpanChangeAck] = useState(false);
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [sending, setSending] = useState(false);
  const [txFx, setTxFx] = useState<TxFxStatus | null>(null);
  const [txHash, setTxHash] = useState("");
  const [fee, setFee] = useState<EvmFeeEstimate | null>(null);
  const resolveSeq = useRef(0);

  // Fee estimate for the fee row + the MAX reserve.
  useEffect(() => {
    setFee(null);
    if (!isEvm) return;
    let live = true;
    estimateEvmNativeFee(chainId).then((f) => { if (live) setFee(f); });
    return () => { live = false; };
  }, [chainId, isEvm]);

  function switchChain(id: string) {
    setChainId(id);
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

  const destinationAddress =
    resolvedAddr ||
    (isEvm
      ? (ethers.isAddress(to.trim()) ? to.trim() : "")
      : (isValidNonEvmAddress(to.trim(), chainId) ? to.trim() : ""));

  function handleMax() {
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
      const hash = isEvm
        ? await sendEvmNative(mnemonic, chainId, destinationAddress, amount)
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
  const feeUsd = fee && price > 0 ? fee.feeNative * price : 0;
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
              label={NON_EVM_NAMES[id] ?? NETWORKS[id]?.name ?? id}
              active={chainId === id}
              onPress={() => switchChain(id)}
              icon={<ChainIcon chainId={id} size={16} />}
            />
          ))}
        </ScrollView>

        {/* Asset summary */}
        <Card style={st.assetCard}>
          <AssetIcon symbol={symbol} chainId={chainId} size={36} />
          <View style={{ flex: 1, marginLeft: 12 }}>
            <Text style={st.assetSym}>{symbol}</Text>
            <Text style={st.assetChain}>{chainName}</Text>
          </View>
          <View style={{ alignItems: "flex-end" }}>
            <Text style={st.assetBal}>
              {balance.toLocaleString(undefined, { maximumFractionDigits: 6 })} {symbol}
            </Text>
            {price > 0 && <Text style={st.assetChain}>${(balance * price).toFixed(2)}</Text>}
          </View>
        </Card>

        {/* Recipient */}
        <Field
          placeholder={`Address or 11-digit BPAN`}
          autoCapitalize="none"
          autoCorrect={false}
          value={to}
          onChangeText={(v) => { void handleToChange(v); }}
        />
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
          <Text style={st.subText}>{amountUsd > 0 ? `≈ $${amountUsd.toFixed(2)}` : " "}</Text>
          <Text style={st.subText}>
            {isEvm
              ? (fee ? `Network fee ~${fmtFeeNative(fee.feeNative)} ${symbol}${feeUsdLabel(feeUsd)}` : "Estimating fee…")
              : nonEvmFeeLine(chainId, price)}
          </Text>
        </View>

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
});
