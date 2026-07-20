import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Screen, GradientButton, GhostButton, TextField, ErrorText } from "../components/ui";
import { colors, radius, spacing } from "../theme";
import { createWallet, encryptAndSave, WalletData } from "../lib/vault";

interface Props {
  onDone: (wallet: WalletData, id: string) => void;
  onBack: () => void;
}

export function CreateWallet({ onDone, onBack }: Props) {
  const [step, setStep] = useState<"password" | "mnemonic">("password");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [wallet, setWallet] = useState<WalletData | null>(null);
  const [savedId, setSavedId] = useState("");

  async function handleCreate() {
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setBusy(true);
    try {
      const w = createWallet();
      const id = await encryptAndSave(w, password);
      setWallet(w);
      setSavedId(id);
      setStep("mnemonic");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  if (step === "mnemonic" && wallet) {
    const words = wallet.mnemonic.split(" ");
    return (
      <Screen scroll>
        <Text style={styles.h1}>Your recovery phrase</Text>
        <Text style={styles.sub}>
          These 12 words are the ONLY way to recover your wallet. Write them down
          on paper, in order, and keep them offline. Never share them. Anyone with
          these words controls your funds.
        </Text>
        <View style={styles.grid}>
          {words.map((w, i) => (
            <View key={i} style={styles.word}>
              <Text style={styles.wordIndex}>{i + 1}</Text>
              <Text style={styles.wordText}>{w}</Text>
            </View>
          ))}
        </View>
        <GradientButton title="I wrote it down" onPress={() => onDone(wallet, savedId)} />
      </Screen>
    );
  }

  return (
    <Screen>
      <Text style={styles.h1}>Set a password</Text>
      <Text style={styles.sub}>
        This password encrypts your wallet on this device. It cannot be reset:
        if you forget it, only your recovery phrase can restore access.
      </Text>
      <TextField placeholder="Password (min 8 characters)" value={password} onChangeText={setPassword} secureTextEntry />
      <TextField placeholder="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry />
      <ErrorText>{error}</ErrorText>
      <GradientButton title="Create wallet" onPress={handleCreate} loading={busy} />
      <GhostButton title="Back" onPress={onBack} />
      <View style={{ flex: 1 }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 26, fontWeight: "800", marginBottom: spacing.sm, marginTop: spacing.xl },
  sub: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: spacing.lg },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginBottom: spacing.lg },
  word: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.input, paddingHorizontal: 12, paddingVertical: 9, width: "31%",
  },
  wordIndex: { color: colors.textFaint, fontSize: 12, fontWeight: "700" },
  wordText: { color: colors.text, fontSize: 14, fontWeight: "600" },
});
