// Opening animation on cold start: the logo springs in with an expanding glow
// ring and the wordmark rises, holds a beat, then the whole overlay fades out.
// Shown over everything while the app boots so the first thing the user sees is
// branded motion, not a static PNG or a "loading…" line. Calls onFinish when
// the fade-out completes; the caller unmounts it then.
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { colors } from "./theme";
import { LogoMark } from "./components";

export function Splash({ onFinish }: { onFinish: () => void }) {
  const logoScale = useRef(new Animated.Value(0.6)).current;
  const logoOpacity = useRef(new Animated.Value(0)).current;
  const ring = useRef(new Animated.Value(0)).current;
  const word = useRef(new Animated.Value(0)).current;
  const overlay = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.parallel([
        Animated.spring(logoScale, { toValue: 1, friction: 5, tension: 80, useNativeDriver: true }),
        Animated.timing(logoOpacity, { toValue: 1, duration: 320, useNativeDriver: true }),
        Animated.timing(ring, { toValue: 1, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      ]),
      Animated.timing(word, { toValue: 1, duration: 300, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.delay(520),
      Animated.timing(overlay, { toValue: 0, duration: 340, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onFinish(); });
  }, []);

  return (
    <Animated.View style={[st.overlay, { opacity: overlay }]} pointerEvents="none">
      <View style={{ alignItems: "center" }}>
        <View style={st.logoWrap}>
          <Animated.View
            style={[
              st.ring,
              {
                opacity: ring.interpolate({ inputRange: [0, 0.5, 1], outputRange: [0.6, 0.35, 0] }),
                transform: [{ scale: ring.interpolate({ inputRange: [0, 1], outputRange: [0.7, 2.1] }) }],
              },
            ]}
          />
          <Animated.View style={{ opacity: logoOpacity, transform: [{ scale: logoScale }] }}>
            <LogoMark size={84} />
          </Animated.View>
        </View>
        <Animated.Text
          style={[
            st.word,
            {
              opacity: word,
              transform: [{ translateY: word.interpolate({ inputRange: [0, 1], outputRange: [10, 0] }) }],
            },
          ]}
        >
          NumPay
        </Animated.Text>
      </View>
    </Animated.View>
  );
}

const st = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    alignItems: "center",
    justifyContent: "center",
    zIndex: 100,
  },
  logoWrap: { width: 200, height: 200, alignItems: "center", justifyContent: "center" },
  ring: {
    position: "absolute",
    width: 120, height: 120, borderRadius: 60,
    backgroundColor: colors.brandTint,
  },
  word: {
    color: colors.textPrimary,
    fontSize: 26, fontWeight: "700",
    marginTop: -8,
    letterSpacing: 0.3,
  },
});
