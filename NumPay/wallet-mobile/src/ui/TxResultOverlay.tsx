// RN port of the extension's TxResultOverlay: a full-screen overlay with one
// shared shell for pending / success / error, same titles and copy. Platform
// difference: without react-native-svg there is no gradient draw-in ring, so
// the mark is an accent ring + glyph with the same pop-in spring; the scrim,
// card treatment, colours and dismissal rules match the popup.
import { useEffect, useRef } from "react";
import {
  ActivityIndicator, Animated, Linking, Pressable, StyleSheet, Text, View,
} from "react-native";
import { colors } from "./theme";
import { Btn } from "./components";

export type TxFxStatus = "pending" | "success" | "error";
export type TxFxKind = "send" | "swap" | "bridge";

const TITLES: Record<TxFxKind, Record<TxFxStatus, string>> = {
  send:   { pending: "Sending…",   success: "Sent",             error: "Send failed" },
  swap:   { pending: "Swapping…",  success: "Swap submitted",   error: "Swap failed" },
  bridge: { pending: "Bridging…",  success: "Bridge submitted", error: "Bridge failed" },
};

const PENDING_SUB: Record<TxFxKind, string> = {
  send:   "Broadcasting to the network…",
  swap:   "Confirming your swap on-chain…",
  bridge: "Submitting your bridge transfer…",
};

export function TxResultOverlay({
  status, kind, amountLabel, explorerUrl, txHash, errorTitle, errorMessage, onClose,
}: {
  status: TxFxStatus;
  kind: TxFxKind;
  amountLabel?: string;
  explorerUrl?: string;
  txHash?: string;
  errorTitle?: string;
  errorMessage?: string;
  onClose: () => void;
}) {
  const isError = status === "error";
  const isPending = status === "pending";
  const accent = isError ? colors.danger : colors.success;
  const title = isError ? errorTitle || TITLES[kind].error : TITLES[kind][status];

  const pop = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    pop.setValue(0.9);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 6, tension: 120 }).start();
  }, [status, pop]);

  return (
    <View style={st.scrim}>
      <Animated.View style={[st.card, { transform: [{ scale: pop }] }]}>
        <View style={st.markArea}>
          {isPending ? (
            <ActivityIndicator size="large" color={colors.brand} />
          ) : (
            <View style={[st.ring, { borderColor: accent }]}>
              <Text style={{ color: accent, fontSize: 40, fontWeight: "700", marginTop: -4 }}>
                {isError ? "✕" : "✓"}
              </Text>
            </View>
          )}
        </View>

        <Text style={st.title}>{title}</Text>
        {!!amountLabel && !isError && <Text style={st.amount}>{amountLabel}</Text>}
        {isError && !!errorMessage && <Text style={st.errBody}>{errorMessage}</Text>}
        {isPending && <Text style={st.pendingSub}>{PENDING_SUB[kind]}</Text>}

        {status === "success" && !!explorerUrl && !!txHash && (
          <Pressable onPress={() => Linking.openURL(explorerUrl).catch(() => {})}>
            <Text style={st.hashLink}>
              {txHash.slice(0, 14)}…{txHash.slice(-8)} ↗
            </Text>
          </Pressable>
        )}

        {!isPending && (
          <Btn label={isError ? "Try again" : "Done"} onPress={onClose} style={{ marginTop: 20 }} />
        )}
      </Animated.View>
    </View>
  );
}

const st = StyleSheet.create({
  scrim: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: "rgba(0,0,0,0.6)",
    alignItems: "center",
    justifyContent: "center",
    padding: 20,
    zIndex: 50,
  },
  card: {
    width: "100%",
    maxWidth: 310,
    alignItems: "center",
    paddingHorizontal: 28,
    paddingVertical: 32,
    borderRadius: 28,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.borderLight,
    // Soft brand lighting stand-in for the popup's glow shadows.
    shadowColor: colors.brand,
    shadowOpacity: 0.5,
    shadowRadius: 30,
    elevation: 16,
  },
  markArea: {
    width: 112, height: 112,
    alignItems: "center", justifyContent: "center",
  },
  ring: {
    width: 88, height: 88, borderRadius: 44, borderWidth: 4,
    alignItems: "center", justifyContent: "center",
  },
  title: { marginTop: 16, fontSize: 19, fontWeight: "700", color: colors.textPrimary },
  amount: { marginTop: 4, fontSize: 13, color: colors.textSecondary, textAlign: "center" },
  errBody: { marginTop: 8, fontSize: 12, color: colors.textSecondary, lineHeight: 17, textAlign: "center" },
  pendingSub: { marginTop: 6, fontSize: 12, color: colors.muted },
  hashLink: { marginTop: 12, fontSize: 11, color: colors.brand2 },
});
