// PIN entry as six dots + an on-screen numeric keypad, replacing the raw text
// field. The dots fill as digits are entered; the pad calls onComplete when the
// sixth digit lands. A `shake` bump (bump the prop) clears the dots and plays an
// error shudder after a wrong PIN. Purely presentational — the caller owns the
// PIN string lifecycle and never sees it persisted.
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { colors } from "./theme";

// Fingerprint glyph for the biometrics key (lucide "fingerprint", trimmed).
function FingerprintIcon({ size = 24, color = colors.muted }: { size?: number; color?: string }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
      <Path d="M2 12C2 6.5 6.5 2 12 2a10 10 0 0 1 8 4" />
      <Path d="M5 19.5C5.5 18 6 15 6 12c0-.7.12-1.37.34-2" />
      <Path d="M17.29 21.02c.12-.6.43-2.3.5-3.02" />
      <Path d="M12 10a2 2 0 0 0-2 2c0 1.02-.1 2.51-.26 4" />
      <Path d="M8.65 22c.21-.66.45-1.32.57-2" />
      <Path d="M14 13.12c0 2.38 0 6.38-1 8.88" />
      <Path d="M2 16h.01" />
      <Path d="M21.8 16c.2-2 .131-5.354 0-6" />
      <Path d="M9 6.8a6 6 0 0 1 9 5.2v2" />
    </Svg>
  );
}

const PIN_LENGTH = 6;

export function PinPad({
  onComplete,
  onChangeLength,
  disabled,
  shakeToken = 0,
  showBiometrics,
  onBiometrics,
}: {
  /** Called with the full PIN once six digits are entered. */
  onComplete: (pin: string) => void;
  /** Optional: notified of the current digit count (to clear errors on edit). */
  onChangeLength?: (len: number) => void;
  disabled?: boolean;
  /** Increment to clear the dots and shake (after a rejected PIN). */
  shakeToken?: number;
  showBiometrics?: boolean;
  onBiometrics?: () => void;
}) {
  const [pin, setPin] = useState("");
  const shakeX = useRef(new Animated.Value(0)).current;

  // Clear + shudder whenever the caller bumps shakeToken.
  useEffect(() => {
    if (shakeToken === 0) return;
    setPin("");
    onChangeLength?.(0);
    Animated.sequence([
      Animated.timing(shakeX, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: -1, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 1, duration: 60, useNativeDriver: true }),
      Animated.timing(shakeX, { toValue: 0, duration: 60, useNativeDriver: true }),
    ]).start();
  }, [shakeToken]);

  function press(digit: string) {
    if (disabled || pin.length >= PIN_LENGTH) return;
    const next = pin + digit;
    setPin(next);
    onChangeLength?.(next.length);
    if (next.length === PIN_LENGTH) {
      // Let the last dot paint before the (blocking) unlock work begins.
      setTimeout(() => onComplete(next), 40);
    }
  }
  function backspace() {
    if (disabled || pin.length === 0) return;
    const next = pin.slice(0, -1);
    setPin(next);
    onChangeLength?.(next.length);
  }

  const translateX = shakeX.interpolate({ inputRange: [-1, 1], outputRange: [-9, 9] });

  return (
    <View>
      <Animated.View style={[st.dots, { transform: [{ translateX }] }]}>
        {Array.from({ length: PIN_LENGTH }).map((_, i) => (
          <View key={i} style={[st.dot, i < pin.length && st.dotFilled]} />
        ))}
      </Animated.View>

      <View style={st.pad}>
        {["1", "2", "3", "4", "5", "6", "7", "8", "9"].map((d) => (
          <Key key={d} label={d} onPress={() => press(d)} disabled={disabled} />
        ))}
        {/* Bottom row: biometrics (optional) · 0 · backspace */}
        {showBiometrics ? (
          <Pressable
            onPress={() => onBiometrics?.()}
            disabled={disabled}
            style={({ pressed }) => [st.key, pressed && !disabled && st.keyPressed]}
          >
            <FingerprintIcon size={26} />
          </Pressable>
        ) : (
          <View style={st.key} />
        )}
        <Key label="0" onPress={() => press("0")} disabled={disabled} />
        <Key label="⌫" glyph onPress={backspace} disabled={disabled} />
      </View>
    </View>
  );
}

function Key({ label, onPress, disabled, glyph }: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  glyph?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [st.key, pressed && !disabled && st.keyPressed]}
    >
      <Text style={[st.keyText, glyph && st.keyGlyph]}>{label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  dots: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 16,
    marginVertical: 26,
  },
  dot: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 1.5,
    borderColor: colors.borderLight,
    backgroundColor: "transparent",
  },
  dotFilled: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  pad: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    rowGap: 12,
  },
  key: {
    width: "31%",
    aspectRatio: 1.7,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: 16,
  },
  keyPressed: { backgroundColor: colors.card },
  keyText: { color: colors.textPrimary, fontSize: 26, fontWeight: "500" },
  keyGlyph: { fontSize: 22, color: colors.muted },
});
