import React, { useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { Screen, GradientButton, TextField, ErrorText } from "../components/ui";
import { Logo } from "../components/Logo";
import { colors, spacing } from "../theme";
import { decryptAllVaults, getActiveId, cacheSession } from "../lib/vault";

export function Unlock({ onUnlock }: { onUnlock: () => void }) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function handleUnlock() {
    if (!password) return;
    setBusy(true);
    setError("");
    try {
      const all = await decryptAllVaults(password);
      const savedId = await getActiveId();
      const activeId = all.find((w) => w.id === savedId)?.id ?? all[0].id;
      cacheSession(all, activeId);
      onUnlock();
    } catch {
      setError("Incorrect password, try again");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Screen>
      <View style={styles.hero}>
        <Logo size={110} animate />
        <Text style={styles.title}>Welcome back</Text>
        <Text style={styles.sub}>Enter your password to unlock</Text>
      </View>
      <View style={styles.form}>
        <TextField
          placeholder="Password"
          value={password}
          onChangeText={setPassword}
          secureTextEntry
          onSubmitEditing={handleUnlock}
          returnKeyType="go"
          autoFocus
        />
        <ErrorText>{error}</ErrorText>
        <GradientButton title={busy ? "Unlocking" : "Unlock wallet"} onPress={handleUnlock} loading={busy} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.xs },
  title: { color: colors.text, fontSize: 26, fontWeight: "800", marginTop: spacing.lg },
  sub: { color: colors.textSecondary, fontSize: 14 },
  form: { paddingBottom: spacing.xl },
});
