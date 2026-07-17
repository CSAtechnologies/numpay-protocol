// Opening animation on cold start: the logo springs in with an expanding glow
// ring and the wordmark rises, holds a beat, then the whole overlay fades out.
// Shown over everything while the app boots so the first thing the user sees is
// branded motion, not a static PNG or a "loading…" line. Calls onFinish when
// the fade-out completes; the caller unmounts it then.
import { useEffect, useRef } from "react";
import { Animated, Easing, StyleSheet, View } from "react-native";
import { colors } from "./theme";
import { NumPayAnimatedLogo } from "./NumPayLogo";

export function Splash({ onFinish }: { onFinish: () => void }) {
  // The mark plays its own build-in (tile forms, N draws, foot bounces) over
  // ~2.1s; the wordmark rises after the draw, then the whole overlay fades.
  const word = useRef(new Animated.Value(0)).current;
  const overlay = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.sequence([
      Animated.delay(1300), // let the N finish drawing before the wordmark
      Animated.timing(word, { toValue: 1, duration: 340, easing: Easing.out(Easing.ease), useNativeDriver: true }),
      Animated.delay(760),
      Animated.timing(overlay, { toValue: 0, duration: 360, easing: Easing.in(Easing.ease), useNativeDriver: true }),
    ]).start(({ finished }) => { if (finished) onFinish(); });
  }, []);

  return (
    <Animated.View style={[st.overlay, { opacity: overlay }]} pointerEvents="none">
      <View style={{ alignItems: "center" }}>
        <View style={st.logoWrap}>
          <NumPayAnimatedLogo size={96} />
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
  logoWrap: { width: 180, height: 180, alignItems: "center", justifyContent: "center" },
  word: {
    color: colors.textPrimary,
    fontSize: 26, fontWeight: "700",
    marginTop: -8,
    letterSpacing: 0.3,
  },
});
