// PIN entry as six dots + an on-screen numeric keypad, replacing the raw text
// field. The dots fill as digits are entered; the pad calls onComplete when the
// sixth digit lands. A `shake` bump (bump the prop) clears the dots and plays an
// error shudder after a wrong PIN. Purely presentational — the caller owns the
// PIN string lifecycle and never sees it persisted.
import { useEffect, useRef, useState } from "react";
import { Animated, Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";

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
          <Key label="⌐" glyph onPress={() => onBiometrics?.()} disabled={disabled} />
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
