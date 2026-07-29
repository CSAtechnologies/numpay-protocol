import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Screen, GradientButton, GhostButton, TextField, ErrorText } from "../components/ui";
import { colors, spacing } from "../theme";
import { importFromMnemonic, importFromPrivateKey, encryptAndSave, WalletData } from "../lib/vault";

interface Props {
  onDone: (wallet: WalletData, id: string) => void;
  onBack: () => void;
}

export function ImportWallet({ onDone, onBack }: Props) {
  const [secret, setSecret] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleImport() {
    setError("");
    if (password.length < 8) { setError("Password must be at least 8 characters"); return; }
    if (password !== confirm) { setError("Passwords do not match"); return; }
    setBusy(true);
    try {
      const trimmed = secret.trim();
      const wallet = trimmed.split(/\s+/).length >= 12
        ? importFromMnemonic(trimmed)
        : importFromPrivateKey(trimmed);
      const id = await encryptAndSave(wallet, password);
      onDone(wallet, id);
    } catch {
      setError("Invalid recovery phrase or private key");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen scroll>
      <Text style={styles.h1}>Import a wallet</Text>
      <Text style={styles.sub}>
        Paste your 12 or 24 word recovery phrase, or a private key. It is
        encrypted with your password and never leaves this device.
      </Text>
      <TextField
        placeholder="Recovery phrase or private key"
        value={secret}
        onChangeText={setSecret}
        multiline
        style={{ minHeight: 96, textAlignVertical: "top" }}
      />
      <TextField placeholder="New password (min 8 characters)" value={password} onChangeText={setPassword} secureTextEntry />
      <TextField placeholder="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry />
      <ErrorText>{error}</ErrorText>
      <GradientButton title="Import wallet" onPress={handleImport} loading={busy} />
      <GhostButton title="Back" onPress={onBack} />
      <View style={{ height: spacing.lg }} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  h1: { color: colors.text, fontSize: 26, fontWeight: "800", marginBottom: spacing.sm, marginTop: spacing.xl },
  sub: { color: colors.textSecondary, fontSize: 14, lineHeight: 21, marginBottom: spacing.lg },
});
