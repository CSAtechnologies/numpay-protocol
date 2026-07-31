/**
 * The recovery phrase, as numbered word chips.
 *
 * All three places that show a phrase (onboarding reveal, add-wallet reveal,
 * Settings reveal) used to render it as one wrapped paragraph of text. That is
 * the single most transcription-error-prone way to present it: the words run
 * together, nothing marks their ORDER, and order is the whole point — a phrase
 * copied down out of sequence is a wallet that is gone.
 *
 * Numbered chips fix that, and are also what every wallet worth copying does.
 *
 * `covered` starts the grid masked behind a tap-to-reveal scrim. It exists for
 * the shoulder-surfing case: opening the page should not be the same act as
 * putting the phrase on screen. RN has no blur without a native dependency, so
 * the mask is an opaque panel rather than a frosted one.
 *
 * FLAG_SECURE (plan §3.2) is applied HERE rather than on the three screens that
 * show a phrase. The guard belongs with the secret: every current caller gets it
 * without having to remember, and so does the next one. While this component is
 * mounted, Android blocks screenshots, screen recording, and the recents
 * thumbnail for the whole window.
 */
import { useId, useState, type ReactNode } from "react";
import { Pressable, StyleSheet, Text, View, type StyleProp, type ViewStyle } from "react-native";
import { usePreventScreenCapture } from "expo-screen-capture";
import { colors, radius, type as ts, themedStyles } from "./theme";
import { EyeOffIcon } from "./icons";

export function SeedPhraseGrid({
  phrase, covered = false, footer, style,
}: {
  phrase: string;
  /** Start masked, revealing on tap. */
  covered?: boolean;
  /** Slot under the grid (copy button, auto-hide countdown). */
  footer?: ReactNode;
  style?: StyleProp<ViewStyle>;
}) {
  // Held while a phrase is on screen, released on unmount. The key must be
  // per-INSTANCE: expo-screen-capture keeps a set of keys and re-allows capture
  // when it empties, so two grids sharing one key would have the first to
  // unmount drop the flag while the second is still showing words.
  usePreventScreenCapture(`numpay-seed-${useId()}`);

  const [hidden, setHidden] = useState(covered);
  const words = phrase.trim().split(/\s+/).filter(Boolean);

  return (
    <View style={[st.wrap, style]}>
      <View style={st.grid}>
        {words.map((w, i) => (
          <View key={`${i}-${w}`} style={st.chip}>
            <Text style={st.index}>{i + 1}</Text>
            {/* selectable so a user who insists can still copy one word out;
                the whole-phrase copy stays an explicit, warned action. */}
            <Text style={st.word} selectable={!hidden} numberOfLines={1}>{w}</Text>
          </View>
        ))}
      </View>

      {hidden && (
        <Pressable
          style={st.mask}
          onPress={() => setHidden(false)}
          accessibilityRole="button"
          accessibilityLabel="Reveal recovery phrase"
        >
          <View style={st.maskIcon}>
            <EyeOffIcon size={18} color={colors.muted} />
          </View>
          <Text style={st.maskTitle}>Tap to reveal</Text>
          <Text style={st.maskHint}>Make sure nobody is watching your screen.</Text>
        </Pressable>
      )}

      {footer && <View style={st.footer}>{footer}</View>}
    </View>
  );
}

const st = themedStyles((colors) => ({
  wrap: {
    position: "relative",
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 12,
    overflow: "hidden",
  },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  chip: {
    // Two per row at any phone width, with the gap accounted for.
    width: "47.6%",
    flexGrow: 1,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 10,
    borderRadius: radius.tile,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  index: {
    color: colors.muted2,
    fontSize: 10.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    minWidth: 14,
    textAlign: "right",
  },
  word: {
    color: colors.textPrimary,
    fontSize: 13.5,
    fontWeight: "600",
    letterSpacing: -0.1,
    flexShrink: 1,
  },
  mask: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.card,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  maskIcon: {
    width: 40, height: 40, borderRadius: 14,
    backgroundColor: colors.surface1,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
    marginBottom: 10,
  },
  maskTitle: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "700" },
  maskHint: {
    color: colors.muted, fontSize: ts.small, marginTop: 3,
    textAlign: "center", lineHeight: 16,
  },
  footer: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
}));
