import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Screen, GradientButton, GhostButton } from "../components/ui";
import { Logo } from "../components/Logo";
import { colors, spacing } from "../theme";

export function Welcome({ onCreate, onImport }: { onCreate: () => void; onImport: () => void }) {
  return (
    <Screen>
      <View style={styles.hero}>
        <Logo size={130} animate />
        <Text style={styles.title}>NumPay</Text>
        <Text style={styles.tagline}>Your number is your wallet.</Text>
        <Text style={styles.sub}>
          Send and receive crypto with a short 11-digit NumPay ID, not a long address.
          Your keys never leave this device.
        </Text>
      </View>
      <View style={styles.actions}>
        <GradientButton title="Create a new wallet" onPress={onCreate} />
        <GhostButton title="I already have a wallet" onPress={onImport} />
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  hero: { flex: 1, alignItems: "center", justifyContent: "center", gap: spacing.sm },
  title: { color: colors.text, fontSize: 34, fontWeight: "800", marginTop: spacing.lg },
  tagline: { color: colors.purpleLight, fontSize: 18, fontWeight: "700" },
  sub: {
    color: colors.textSecondary, fontSize: 14, textAlign: "center",
    lineHeight: 21, marginTop: spacing.sm, paddingHorizontal: spacing.lg,
  },
  actions: { gap: spacing.xs, paddingBottom: spacing.lg },
});
