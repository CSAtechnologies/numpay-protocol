// Animated NumPay logo, built from the real logo artwork split into three
// layers (tile, N, dash). Build-on sequence: tile pops in, the N arrives,
// the dash bounces up into place, then the whole mark idles with a float.
import React, { useEffect, useRef } from "react";
import { Animated, Easing, View } from "react-native";

const TILE = require("../../assets/logo/purple_square.png");
const N = require("../../assets/logo/n_layer.png");
const DASH = require("../../assets/logo/dash_layer.png");

export function Logo({ size = 120, animate = true }: { size?: number; animate?: boolean }) {
  const tile = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const n = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const dash = useRef(new Animated.Value(animate ? 0 : 1)).current;
  const float = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!animate) return;
    Animated.sequence([
      Animated.spring(tile, { toValue: 1, useNativeDriver: true, damping: 12, stiffness: 180 }),
      Animated.timing(n, {
        toValue: 1, duration: 420, easing: Easing.out(Easing.cubic), useNativeDriver: true,
      }),
      Animated.spring(dash, { toValue: 1, useNativeDriver: true, damping: 9, stiffness: 200 }),
    ]).start(() => {
      Animated.loop(
        Animated.sequence([
          Animated.timing(float, { toValue: 1, duration: 1900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
          Animated.timing(float, { toValue: 0, duration: 1900, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        ])
      ).start();
    });
  }, [animate, tile, n, dash, float]);

  const floatY = float.interpolate({ inputRange: [0, 1], outputRange: [0, -7] });
  const layer = { position: "absolute" as const, width: size, height: size };

  return (
    <Animated.View style={{ width: size, height: size, transform: [{ translateY: floatY }] }}>
      <Animated.Image
        source={TILE}
        style={[layer, {
          opacity: tile,
          transform: [
            { scale: tile.interpolate({ inputRange: [0, 1], outputRange: [0.3, 1] }) },
            { rotate: tile.interpolate({ inputRange: [0, 1], outputRange: ["-12deg", "0deg"] }) },
          ],
        }]}
        resizeMode="contain"
      />
      <Animated.Image
        source={N}
        style={[layer, {
          opacity: n,
          transform: [
            { translateX: n.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.18, 0] }) },
            { translateY: n.interpolate({ inputRange: [0, 1], outputRange: [-size * 0.12, 0] }) },
          ],
        }]}
        resizeMode="contain"
      />
      <Animated.Image
        source={DASH}
        style={[layer, {
          opacity: dash,
          transform: [
            { translateY: dash.interpolate({ inputRange: [0, 1], outputRange: [size * 0.25, 0] }) },
          ],
        }]}
        resizeMode="contain"
      />
      <View />
    </Animated.View>
  );
}
