// The real NumPay mark, ported 1:1 from the extension's AnimatedLogo.tsx +
// index.css .npl-* keyframes. Pure vector (viewBox 100x100): a purple rounded
// tile, the white "N" as one polygon revealed by a snake centerline mask, and
// the foot dash. NOT the logo.png (that asset is the mark floating in a big
// white square — rendering it shows white). Geometry + colors are verbatim.
import { useEffect, useRef } from "react";
import { Animated, View } from "react-native";
import Svg, { Rect, Path, Mask, G } from "react-native-svg";
import { colors } from "./theme";
import { useReducedMotion } from "./useReducedMotion";

const NP_PURPLE = "#786EE9";
const N_BODY = "M23.22 22.93 L35.14 22.93 L66.37 53.79 L66.56 23.12 L76.4 23.12 L76.4 62.68 L60.88 62.68 L33.63 35.62 L33.44 62.3 L23.22 62.3 Z";
const N_FOOT = "M41.39 53.3 L56.72 67.98 L76.4 67.98 L76.4 77.07 L23.22 77.07 L23.22 67.98 L41.39 67.98 Z";
const SNAKE = "M28.33 62.3 L28.33 22.93 L71.48 62.68 L71.48 23.12";
// Measured length of the snake centerline (three segments); the reveal draws
// dashoffset from this down to 0.
const SNAKE_LEN = 140;

const AnimatedPath = Animated.createAnimatedComponent(Path);
const AnimatedG = Animated.createAnimatedComponent(G);

function Glow({ size, children }: { size: number; children: React.ReactNode }) {
  return (
    <View
      style={{
        width: size, height: size,
        shadowColor: colors.brand, shadowOpacity: 0.45,
        shadowRadius: size * 0.3, shadowOffset: { width: 0, height: size * 0.14 },
        elevation: 10,
      }}
    >
      {children}
    </View>
  );
}

/** Static final mark (header pills, account pill, dashboard). No animation. */
export function NumPayMark({ size = 28 }: { size?: number }) {
  return (
    <Glow size={size}>
      <Svg width={size} height={size} viewBox="0 0 100 100">
        <Rect x={6} y={6} width={88} height={88} rx={13.2} ry={13.2} fill={NP_PURPLE} />
        <Path d={N_BODY} fill="#fff" />
        <Path d={N_FOOT} fill="#fff" />
      </Svg>
    </Glow>
  );
}

/**
 * Animated mark that plays the extension's build-in once on mount: the tile
 * forms (scale 0.2→1.06→1, rotate −10→3→0), the N snake-draws (dashoffset
 * SNAKE_LEN→0), then the foot bounces up. Motion timings match the CSS
 * keyframes (npl-form 0.55s, npl-draw 1.05s @0.45s, npl-foot 0.62s @1.5s).
 */
export function NumPayAnimatedLogo({ size = 88 }: { size?: number }) {
  // Native-driver value for the outer tile form (View transform).
  const form = useRef(new Animated.Value(0)).current;
  // Non-native values for SVG-attr animations (draw + foot).
  const draw = useRef(new Animated.Value(0)).current;
  const foot = useRef(new Animated.Value(0)).current;
  const reduceMotion = useReducedMotion();

  useEffect(() => {
    if (reduceMotion) {
      form.setValue(1);
      draw.setValue(1);
      foot.setValue(1);
      return;
    }
    const animation = Animated.parallel([
      Animated.timing(form, {
        toValue: 1, duration: 550, useNativeDriver: true,
      }),
      Animated.sequence([
        Animated.delay(450),
        Animated.timing(draw, { toValue: 1, duration: 1050, useNativeDriver: false }),
      ]),
      Animated.sequence([
        Animated.delay(1500),
        Animated.timing(foot, { toValue: 1, duration: 620, useNativeDriver: false }),
      ]),
    ]);
    animation.start();
    return () => animation.stop();
  }, [draw, foot, form, reduceMotion]);

  const scale = form.interpolate({ inputRange: [0, 0.6, 1], outputRange: [0.2, 1.06, 1] });
  const rotate = form.interpolate({ inputRange: [0, 0.6, 1], outputRange: ["-10deg", "3deg", "0deg"] });
  const opacity = form.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] });

  const dashoffset = draw.interpolate({ inputRange: [0, 1], outputRange: [SNAKE_LEN, 0] });
  const footY = foot.interpolate({ inputRange: [0, 0.55, 0.78, 1], outputRange: [14, -1.6, 0.5, 0] });
  const footScaleY = foot.interpolate({ inputRange: [0, 0.55, 0.78, 1], outputRange: [0.72, 1.05, 0.98, 1] });
  const footOpacity = foot.interpolate({ inputRange: [0, 0.3, 1], outputRange: [0, 1, 1] });

  return (
    <Glow size={size}>
      <Animated.View style={{ opacity, transform: [{ scale }, { rotate }] }}>
        <Svg width={size} height={size} viewBox="0 0 100 100">
          <Mask id="npl-reveal">
            <AnimatedPath
              d={SNAKE}
              fill="none"
              stroke="#fff"
              strokeWidth={14}
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={SNAKE_LEN}
              strokeDashoffset={dashoffset}
            />
          </Mask>
          <Rect x={6} y={6} width={88} height={88} rx={13.2} ry={13.2} fill={NP_PURPLE} />
          <Path d={N_BODY} fill="#fff" mask="url(#npl-reveal)" />
          <AnimatedG y={footY} scaleY={footScaleY} originY={77} opacity={footOpacity}>
            <Path d={N_FOOT} fill="#fff" />
          </AnimatedG>
        </Svg>
      </Animated.View>
    </Glow>
  );
}
