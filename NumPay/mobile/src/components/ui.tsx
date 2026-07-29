import React from "react";
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, ActivityIndicator,
  KeyboardAvoidingView, Platform, ScrollView,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import { colors, gradient, radius, spacing } from "../theme";

export function Screen({ children, scroll = false }: { children: React.ReactNode; scroll?: boolean }) {
  const inner = scroll ? (
    <ScrollView contentContainerStyle={styles.scrollInner} keyboardShouldPersistTaps="handled">
      {children}
    </ScrollView>
  ) : (
    <View style={styles.inner}>{children}</View>
  );
  return (
    <KeyboardAvoidingView
      style={styles.screen}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      {inner}
    </KeyboardAvoidingView>
  );
}

export function GradientButton({
  title, onPress, disabled = false, loading = false,
}: { title: string; onPress: () => void; disabled?: boolean; loading?: boolean }) {
  return (
    <TouchableOpacity onPress={onPress} disabled={disabled || loading} activeOpacity={0.85}>
      <LinearGradient
        colors={[...gradient.button]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={[styles.button, (disabled || loading) && { opacity: 0.55 }]}
      >
        {loading ? (
          <ActivityIndicator color={colors.white} />
        ) : (
          <Text style={styles.buttonText}>{title}</Text>
        )}
      </LinearGradient>
    </TouchableOpacity>
  );
}

export function GhostButton({ title, onPress }: { title: string; onPress: () => void }) {
  return (
    <TouchableOpacity onPress={onPress} style={styles.ghost} activeOpacity={0.7}>
      <Text style={styles.ghostText}>{title}</Text>
    </TouchableOpacity>
  );
}

export function TextField(props: React.ComponentProps<typeof TextInput>) {
  return (
    <TextInput
      placeholderTextColor={colors.textFaint}
      autoCapitalize="none"
      autoCorrect={false}
      {...props}
      style={[styles.input, props.style]}
    />
  );
}

export function ErrorText({ children }: { children: React.ReactNode }) {
  if (!children) return null;
  return <Text style={styles.error}>{children}</Text>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  inner: { flex: 1, padding: spacing.lg },
  scrollInner: { flexGrow: 1, padding: spacing.lg },
  button: {
    borderRadius: radius.button,
    paddingVertical: 16,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 54,
  },
  buttonText: { color: colors.white, fontSize: 17, fontWeight: "700" },
  ghost: { paddingVertical: 14, alignItems: "center" },
  ghostText: { color: colors.purpleLight, fontSize: 16, fontWeight: "600" },
  input: {
    backgroundColor: colors.bgInput,
    borderRadius: radius.input,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.text,
    paddingHorizontal: 16,
    paddingVertical: 14,
    fontSize: 16,
    marginBottom: spacing.sm,
  },
  error: { color: colors.danger, fontSize: 13, marginBottom: spacing.sm },
});
