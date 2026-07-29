import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, TouchableOpacity, Linking, ScrollView } from "react-native";
import { Screen, GradientButton, GhostButton, TextField, ErrorText } from "../components/ui";
import { colors, radius, spacing } from "../theme";
import { getSessionWallets, touchActivity } from "../lib/vault";
import { fetchEthBalance, fetchSolBalance } from "../lib/chains";
import { isValidBPAN, formatBPAN, resolveBPAN } from "../lib/bpan";
import {
  validateEthAddress, validateSolAddress,
  deriveSolSecretKey, sendSolTransfer, sendEthTransfer, estimateEthFee,
} from "../lib/tx";

type Chain = "ethereum" | "solana";
type Step = "form" | "review" | "done";

interface Resolved {
  address: string;
  viaBpan: string | null; // the NumPay ID it was resolved from, if any
}

export function Send({ onClose }: { onClose: () => void }) {
  const session = getSessionWallets();
  const active = session?.wallets.find((w) => w.id === session.activeId) ?? session?.wallets[0];

  const [chain, setChain] = useState<Chain>("ethereum");
  const [recipient, setRecipient] = useState("");
  const [amount, setAmount] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [step, setStep] = useState<Step>("form");
  const [resolved, setResolved] = useState<Resolved | null>(null);
  const [balance, setBalance] = useState<string | null>(null);
  const [ethFee, setEthFee] = useState<string | null>(null);
  const [txId, setTxId] = useState("");

  const canSol = !!active?.wallet.mnemonic;
  const symbol = chain === "ethereum" ? "ETH" : "SOL";

  useEffect(() => {
    setBalance(null);
    if (!active) return;
    (async () => {
      try {
        if (chain === "ethereum") {
          setBalance(await fetchEthBalance(active.wallet.address));
        } else {
          const { deriveSolAccount } = await import("../lib/chains");
          setBalance(await fetchSolBalance(deriveSolAccount(active.wallet.mnemonic).address));
        }
      } catch { setBalance(null); }
    })();
  }, [chain, active?.id]);

  async function handleReview() {
    if (!active) return;
    setError("");
    touchActivity();

    const input = recipient.trim().replace(/[\s-]/g, "");
    const amt = Number(amount);
    if (!amount || !isFinite(amt) || amt <= 0) { setError("Enter a valid amount"); return; }
    if (balance !== null && amt > Number(balance)) { setError(`Amount exceeds your ${symbol} balance`); return; }

    setBusy(true);
    try {
      let target: Resolved | null = null;

      if (/^\d+$/.test(input)) {
        // Numeric input = NumPay ID. Checksum-validate BEFORE any lookup.
        if (!isValidBPAN(input)) {
          setError("That NumPay ID is not valid (11 digits required). Check for a typo.");
          return;
        }
        const addr = await resolveBPAN(input, chain);
        if (!addr) {
          setError(`This NumPay ID has no ${chain} address registered.`);
          return;
        }
        const checked = chain === "ethereum" ? validateEthAddress(addr) : validateSolAddress(addr);
        if (!checked) {
          setError("The registry returned an invalid address. Send cancelled for safety.");
          return;
        }
        target = { address: checked, viaBpan: input };
      } else {
        const checked = chain === "ethereum" ? validateEthAddress(input) : validateSolAddress(input);
        if (!checked) {
          setError(chain === "ethereum"
            ? "Invalid Ethereum address (check the characters and try again)"
            : "Invalid Solana address");
          return;
        }
        target = { address: checked, viaBpan: null };
      }

      if (chain === "ethereum") {
        try { setEthFee(await estimateEthFee()); } catch { setEthFee(null); }
      }
      setResolved(target);
      setStep("review");
    } finally {
      setBusy(false);
    }
  }

  async function handleSend() {
    if (!active || !resolved) return;
    setBusy(true);
    setError("");
    touchActivity();
    try {
      if (chain === "ethereum") {
        setTxId(await sendEthTransfer(active.wallet.privateKey, resolved.address, amount));
      } else {
        const lamports = BigInt(Math.round(Number(amount) * 1e9));
        const secretKey = deriveSolSecretKey(active.wallet.mnemonic);
        setTxId(await sendSolTransfer(secretKey, resolved.address, lamports));
      }
      setStep("done");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Transaction failed");
    } finally {
      setBusy(false);
    }
  }

  if (!active) {
    return (
      <Screen>
        <Text style={styles.sub}>Session expired. Unlock again to send.</Text>
        <GhostButton title="Close" onPress={onClose} />
      </Screen>
    );
  }

  if (step === "done") {
    const explorer = chain === "ethereum"
      ? `https://etherscan.io/tx/${txId}`
      : `https://solscan.io/tx/${txId}`;
    return (
      <Screen>
        <View style={styles.center}>
          <Text style={styles.doneMark}>Sent</Text>
          <Text style={styles.sub}>
            {amount} {symbol} to {resolved?.viaBpan ? `# ${formatBPAN(resolved.viaBpan)}` : short(resolved?.address ?? "")}
          </Text>
          <Text style={styles.hash}>{short(txId)}</Text>
          <GhostButton title="View on explorer" onPress={() => Linking.openURL(explorer)} />
        </View>
        <GradientButton title="Done" onPress={onClose} />
        <View style={{ height: spacing.lg }} />
      </Screen>
    );
  }

  if (step === "review" && resolved) {
    return (
      <Screen>
        <Text style={styles.h1}>Review</Text>
        <View style={styles.reviewBox}>
          <ReviewRow label="Amount" value={`${amount} ${symbol}`} />
          {resolved.viaBpan && <ReviewRow label="NumPay ID" value={`# ${formatBPAN(resolved.viaBpan)}`} />}
          <ReviewRow label="To address" value={resolved.address} mono />
          <ReviewRow label="Network" value={chain === "ethereum" ? "Ethereum" : "Solana"} />
          <ReviewRow
            label="Estimated fee"
            value={chain === "ethereum" ? (ethFee ? `~${Number(ethFee).toFixed(6)} ETH` : "unavailable") : "~0.000005 SOL"}
          />
        </View>
        <Text style={styles.warn}>
          Transactions are final and cannot be reversed. Check the address before sending.
        </Text>
        <ErrorText>{error}</ErrorText>
        <GradientButton title={`Send ${amount} ${symbol}`} onPress={handleSend} loading={busy} />
        <GhostButton title="Back" onPress={() => { setStep("form"); setError(""); }} />
        <View style={{ flex: 1 }} />
      </Screen>
    );
  }

  return (
    <Screen>
      <ScrollView keyboardShouldPersistTaps="handled">
        <Text style={styles.h1}>Send</Text>

        <View style={styles.chainRow}>
          <ChainChip label="ETH" active={chain === "ethereum"} onPress={() => setChain("ethereum")} />
          <ChainChip label="SOL" active={chain === "solana"} disabled={!canSol} onPress={() => canSol && setChain("solana")} />
        </View>
        {!canSol && <Text style={styles.note}>SOL requires a wallet imported with a recovery phrase.</Text>}

        <TextField
          placeholder="NumPay ID or address"
          value={recipient}
          onChangeText={setRecipient}
          keyboardType={/^[\d\s-]*$/.test(recipient) && recipient !== "" ? "number-pad" : "default"}
        />
        <TextField placeholder={`Amount (${symbol})`} value={amount} onChangeText={setAmount} keyboardType="decimal-pad" />
        <Text style={styles.note}>
          {balance === null ? "Balance loading..." : `Balance: ${balance} ${symbol}`}
        </Text>
        <ErrorText>{error}</ErrorText>
        <GradientButton title="Review" onPress={handleReview} loading={busy} />
        <GhostButton title="Cancel" onPress={onClose} />
      </ScrollView>
    </Screen>
  );
}

function ReviewRow({ label, value, mono = false }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={styles.rrow}>
      <Text style={styles.rlabel}>{label}</Text>
      <Text style={[styles.rvalue, mono && { fontSize: 12 }]} numberOfLines={2}>{value}</Text>
    </View>
  );
}

function ChainChip({ label, active, onPress, disabled = false }: {
  label: string; active: boolean; onPress: () => void; disabled?: boolean;
}) {
  return (
    <TouchableOpacity
      onPress={onPress}
      style={[styles.chip, active && styles.chipActive, disabled && { opacity: 0.4 }]}
    >
      <Text style={[styles.chipText, active && { color: colors.white }]}>{label}</Text>
    </TouchableOpacity>
  );
}

function short(v: string): string {
  return v.length > 18 ? `${v.slice(0, 9)}...${v.slice(-7)}` : v;
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 26, fontWeight: "800", marginBottom: spacing.lg, marginTop: spacing.xl },
  sub: { color: colors.textSecondary, fontSize: 15, textAlign: "center" },
  center: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  doneMark: { color: colors.success, fontSize: 34, fontWeight: "800" },
  hash: { color: colors.textFaint, fontSize: 13 },
  chainRow: { flexDirection: "row", gap: spacing.sm, marginBottom: spacing.md },
  chip: {
    borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: 22, paddingVertical: 10, backgroundColor: colors.bgCard,
  },
  chipActive: { backgroundColor: colors.purpleDeep, borderColor: colors.purpleDeep },
  chipText: { color: colors.textSecondary, fontWeight: "800", fontSize: 14 },
  note: { color: colors.textFaint, fontSize: 13, marginBottom: spacing.sm },
  reviewBox: {
    backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.card, padding: spacing.md, gap: spacing.sm, marginBottom: spacing.md,
  },
  rrow: { gap: 2 },
  rlabel: { color: colors.textFaint, fontSize: 12, fontWeight: "700", letterSpacing: 1 },
  rvalue: { color: colors.text, fontSize: 15, fontWeight: "600" },
  warn: { color: "#f0b429", fontSize: 13, lineHeight: 19, marginBottom: spacing.sm },
});
