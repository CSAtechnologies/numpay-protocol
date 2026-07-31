// Per-wallet emoji avatar + picker, ported from the extension Dashboard
// WalletAvatar + PRESET_EMOJIS. A wallet with an avatar shows the emoji; without
// one it falls back to a brand-tinted tile with the name's initial. The picker
// is the same 30-emoji pack the extension offers.
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, type as ts, themedStyles } from "./theme";

export const PRESET_EMOJIS = [
  "💎", "🦊", "🐉", "🦁", "🌙", "⚡",
  "🔥", "🌊", "🎯", "🦄", "🐺", "🦅",
  "🤖", "👾", "🎭", "🌺", "🔮", "💜",
  "🏆", "💰", "🪙", "🌟", "✨", "🎮",
  "🎲", "🐸", "🐝", "🦋", "🐯", "👑",
];

export function WalletAvatar({
  avatar, name, size = 30, active = true,
}: {
  avatar?: string;
  name: string;
  size?: number;
  active?: boolean;
}) {
  if (avatar) {
    return (
      <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ fontSize: size * 0.62 }}>{avatar}</Text>
      </View>
    );
  }
  // Initial fallback: brand tile when active, muted when not.
  //
  // The initial used to be white on BOTH tiles. That works on the brand fill,
  // but the inactive tile is `surface4`, which is a pale lilac in light theme
  // (#d2c9ff) — white on it measures 1.55:1, so every non-active wallet in the
  // account switcher showed an initial that was very nearly invisible. Another
  // value that was safe while the product was dark-only (dark surface4 is
  // #2a2450) and broke when light became the default. The label now follows its
  // own tile: white on brand, body text on the muted one.
  return (
    <View
      style={{
        width: size, height: size, borderRadius: size * 0.32,
        alignItems: "center", justifyContent: "center",
        backgroundColor: active ? colors.brand : colors.surface4,
      }}
    >
      <Text
        style={{
          color: active ? colors.onBrand : colors.textSecondary,
          fontWeight: "700",
          fontSize: size * 0.42,
        }}
      >
        {(name || "?").charAt(0).toUpperCase()}
      </Text>
    </View>
  );
}

/** Grid picker of the preset pack. `onPick("")` clears back to the initial. */
export function EmojiPicker({
  walletName, current, onPick, onClose,
}: {
  walletName: string;
  current?: string;
  onPick: (emoji: string) => void;
  onClose: () => void;
}) {
  return (
    <View style={st.sheet}>
      <View style={st.header}>
        <Text style={st.title}>Choose avatar</Text>
        <Text style={st.sub}>{walletName}</Text>
      </View>
      <ScrollView contentContainerStyle={st.grid} showsVerticalScrollIndicator={false}>
        {/* Clear back to initial */}
        <Pressable style={[st.cell, !current && st.cellOn]} onPress={() => onPick("")}>
          <Text style={{ color: colors.muted, fontSize: 12, fontWeight: "700" }}>
            {(walletName || "?").charAt(0).toUpperCase()}
          </Text>
        </Pressable>
        {PRESET_EMOJIS.map((e) => (
          <Pressable
            key={e}
            style={[st.cell, current === e && st.cellOn]}
            onPress={() => onPick(e)}
          >
            <Text style={{ fontSize: 22 }}>{e}</Text>
          </Pressable>
        ))}
      </ScrollView>
      <Pressable style={st.close} onPress={onClose}>
        <Text style={st.closeText}>Close</Text>
      </Pressable>
    </View>
  );
}

const st = themedStyles((colors) => ({
  sheet: {
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.card,
    padding: 14,
    marginTop: 8,
  },
  header: { marginBottom: 10 },
  title: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "600" },
  sub: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  cell: {
    width: 46, height: 46, borderRadius: radius.tile,
    alignItems: "center", justifyContent: "center",
    backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: "transparent",
  },
  cellOn: { borderColor: colors.brand, backgroundColor: colors.brandTint },
  close: {
    marginTop: 12, alignItems: "center", paddingVertical: 10,
    borderRadius: radius.button, backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border,
  },
  closeText: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "500" },
}));
