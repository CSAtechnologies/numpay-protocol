// PIN entry as six dots + an on-screen numeric keypad, replacing the raw text
// field. The dots fill as digits are entered; the pad calls onComplete when the
// sixth digit lands. A `shake` bump (bump the prop) clears the dots and plays an
// error shudder after a wrong PIN. Purely presentational — the caller owns the
// PIN string lifecycle and never sees it persisted.
import { useEffect, useRef, useState } from "react";
import { Animated, Text, View } from "react-native";
import Svg, { Path } from "react-native-svg";
import { Tappable } from "./components";
import { colors, themedStyles } from "./theme";

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

/** Shared by the key's own fill and by the Tappable that clips its ripple, so
 *  the two cannot drift apart and leave the ripple square. */
const KEY_RADIUS = 16;

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
  // Press events can arrive faster than React commits a render (especially
  // while the JS thread is deriving wallet state). A ref is the authoritative
  // sequence so two quick taps never append to the same stale `pin` value.
  const pinRef = useRef("");
  const shakeX = useRef(new Animated.Value(0)).current;

  // Clear + shudder whenever the caller bumps shakeToken.
  useEffect(() => {
    if (shakeToken === 0) return;
    pinRef.current = "";
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
    if (disabled || pinRef.current.length >= PIN_LENGTH) return;
    const next = pinRef.current + digit;
    pinRef.current = next;
    setPin(next);
    onChangeLength?.(next.length);
    if (next.length === PIN_LENGTH) {
      // Let the last dot paint before the (blocking) unlock work begins.
      setTimeout(() => onComplete(next), 40);
    }
  }
  function backspace() {
    if (disabled || pinRef.current.length === 0) return;
    const next = pinRef.current.slice(0, -1);
    pinRef.current = next;
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
          <Tappable
            onPress={() => onBiometrics?.()}
            disabled={disabled}
            feedback="tile"
            borderRadius={KEY_RADIUS}
            accessibilityLabel="Unlock with biometrics"
            style={st.key}
          >
            <FingerprintIcon size={26} />
          </Tappable>
        ) : (
          <View style={st.key} />
        )}
        <Key label="0" onPress={() => press("0")} disabled={disabled} />
        <Key label="⌫" a11yLabel="Delete" glyph onPress={backspace} disabled={disabled} />
      </View>
    </View>
  );
}

function Key({ label, a11yLabel, onPress, disabled, glyph }: {
  label: string;
  /** Spoken name, where the visible label is a glyph a screen reader cannot
   *  pronounce ("⌫"). Digits read correctly as themselves. */
  a11yLabel?: string;
  onPress: () => void;
  disabled?: boolean;
  glyph?: boolean;
}) {
  return (
    // Was a bare Pressable with its own `pressed` style, which is how it escaped
    // the press-feedback pass: `backgroundColor: colors.card` measured 1.05:1
    // against the light page and 1.12:1 against the dark one, so tapping a key
    // produced nothing visible in EITHER theme. On the one screen the user
    // touches every single time they open the wallet. Going through Tappable
    // gives it the same tint, ripple and press-scale as the rest of the app, and
    // the scale reads even where a tint on a fill-less key cannot.
    <Tappable
      onPress={onPress}
      disabled={disabled}
      feedback="tile"
      borderRadius={KEY_RADIUS}
      accessibilityLabel={a11yLabel ?? label}
      style={st.key}
    >
      <Text style={[st.keyText, glyph && st.keyGlyph]}>{label}</Text>
    </Tappable>
  );
}

const st = themedStyles((colors) => ({
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
    // `width` hoists to Tappable's animated wrapper (it is a box prop);
    // `aspectRatio` deliberately does NOT, so the Pressable itself is the
    // aspect-sized box and the touch target fills the whole key rather than
    // shrinking to the height of the digit.
    width: "31%",
    aspectRatio: 1.7,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: KEY_RADIUS,
  },
  keyText: { color: colors.textPrimary, fontSize: 26, fontWeight: "500" },
  keyGlyph: { fontSize: 22, color: colors.muted },
}));
