// RN port of the extension's TxResultOverlay: a full-screen overlay with one
// shared shell for pending / success / error, same titles and copy, used by
// send, swap and bridge alike.
//
// The animation is now a real port rather than a stand-in. The popup draws its
// mark with SVG strokes (pathLength=1 + stroke-dashoffset keyframes); this file
// does the same with react-native-svg, which the app has depended on since the
// UI parity pass. Timings are lifted straight from popup/index.css so both
// products feel identical:
//   card pop      tx-pop      0.32s spring-ish overshoot
//   ring draw     tx-ring     0.55s ease-out
//   mark draw     tx-mark     0.40s ease-out, 0.42s delay (cross arm 2: 0.58s)
//   pulse ring    tx-pulse    1.30s ease-out, 0.50s delay, scale 0.82 -> 2.4
//   orbs          tx-orb      1.50s ease-out, rise 54px, staggered
//   glow          tx-glow     1.90s ease-in-out, infinite 0.3 <-> 0.65
//
// SVG stroke props and layout-driving opacity cannot run on the native driver,
// so those Animated values are JS-driven; the card pop and the orb transforms
// stay native.
import { useEffect, useRef } from "react";
import {
  ActivityIndicator, Animated, Easing, Linking, Modal, Pressable, StyleSheet, Text, View,
} from "react-native";
import Svg, { Circle, Defs, LinearGradient, Path, Stop } from "react-native-svg";
import { colors, themedStyles } from "./theme";
import { Btn } from "./components";

const AnimatedCircle = Animated.createAnimatedComponent(Circle);
const AnimatedPath = Animated.createAnimatedComponent(Path);

export type TxFxStatus = "pending" | "success" | "error";
export type TxFxKind = "send" | "swap" | "bridge" | "bpan-register" | "bpan-map";

const TITLES: Record<TxFxKind, Record<TxFxStatus, string>> = {
  send:   { pending: "Sending…",   success: "Sent",             error: "Send failed" },
  swap:   { pending: "Swapping…",  success: "Swap submitted",   error: "Swap failed" },
  bridge: { pending: "Bridging…",  success: "Bridge submitted", error: "Bridge failed" },
  "bpan-register": { pending: "Registering BPAN…", success: "BPAN registered", error: "Registration failed" },
  "bpan-map":      { pending: "Saving mappings…", success: "Mappings saved",   error: "Mapping failed" },
};

const PENDING_SUB: Record<TxFxKind, string> = {
  send:   "Broadcasting to the network…",
  swap:   "Confirming your swap on-chain…",
  bridge: "Submitting your bridge transfer…",
  "bpan-register": "Confirming your payment identity on Base…",
  "bpan-map":      "Confirming your wallet mappings on Base…",
};

// The popup animates stroke-dashoffset from 1 to 0 against pathLength=1. RN's
// SVG has no pathLength, so each stroke declares its own length in user units
// and the dash offset counts down from it. Circle r=40 -> 2πr.
const RING_LEN = 2 * Math.PI * 40;
const CHECK_LEN = 52;  // M30 49 L43 62 L67 35
const ARM_LEN = 34;    // one diagonal of the cross

/** Four rising brand orbs, mirroring the popup's success flourish. */
function Orbs() {
  // Each orb: [left, bottom, size, colour, delay ms]
  const spec: Array<[number, number, number, string, number]> = [
    [28, 28, 8,  colors.brand2, 150],
    [76, 24, 6,  colors.brand2, 350],
    [52, 32, 10, colors.success, 50],
    [66, 28, 6,  colors.brand,  500],
  ];
  return (
    <>
      {spec.map(([left, bottom, size, color, delay], i) => (
        <Orb key={i} left={left} bottom={bottom} size={size} color={color} delay={delay} />
      ))}
    </>
  );
}

function Orb({ left, bottom, size, color, delay }: {
  left: number; bottom: number; size: number; color: string; delay: number;
}) {
  const t = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    Animated.timing(t, {
      toValue: 1, duration: 1500, delay, easing: Easing.out(Easing.ease), useNativeDriver: true,
    }).start();
  }, [t, delay]);
  return (
    <Animated.View
      pointerEvents="none"
      style={{
        position: "absolute",
        left, bottom,
        width: size, height: size, borderRadius: size / 2,
        backgroundColor: color,
        opacity: t.interpolate({ inputRange: [0, 0.25, 1], outputRange: [0, 0.85, 0] }),
        transform: [
          { translateY: t.interpolate({ inputRange: [0, 1], outputRange: [10, -54] }) },
          { scale: t.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
        ],
      }}
    />
  );
}

export function TxResultOverlay({
  status, kind, amountLabel, detail, explorerUrl, txHash, errorTitle, errorMessage, onClose,
}: {
  status: TxFxStatus;
  kind: TxFxKind;
  amountLabel?: string;
  /** Step progress while pending (e.g. "Approving USDC (1 of 2)…"). */
  detail?: string;
  explorerUrl?: string;
  txHash?: string;
  errorTitle?: string;
  errorMessage?: string;
  onClose: () => void;
}) {
  const isError = status === "error";
  const isPending = status === "pending";
  const isSuccess = status === "success";
  const accent = isError ? colors.danger : colors.success;
  const title = isError ? errorTitle || TITLES[kind].error : TITLES[kind][status];

  // Card pop-in (tx-pop). Replays whenever the status changes, so pending →
  // success re-lands the card rather than swapping its contents in place.
  const pop = useRef(new Animated.Value(0.9)).current;
  useEffect(() => {
    pop.setValue(0.9);
    Animated.spring(pop, { toValue: 1, useNativeDriver: true, friction: 6, tension: 120 }).start();
  }, [status, pop]);

  // Stroke draw-in: one 0→1 progress per stroke, offsets derived from it.
  const ringT = useRef(new Animated.Value(0)).current;
  const markT = useRef(new Animated.Value(0)).current;
  const armT = useRef(new Animated.Value(0)).current;
  // Pulse ring and the breathing glow.
  const pulseT = useRef(new Animated.Value(0)).current;
  const glowT = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isPending) return; // the spinner owns the pending state
    ringT.setValue(0); markT.setValue(0); armT.setValue(0); pulseT.setValue(0);
    const draw = (v: Animated.Value, duration: number, delay: number) =>
      Animated.timing(v, {
        toValue: 1, duration, delay, easing: Easing.out(Easing.ease), useNativeDriver: false,
      });
    const anims = [draw(ringT, 550, 0), draw(markT, 400, 420)];
    if (isError) anims.push(draw(armT, 400, 580));
    if (isSuccess) {
      anims.push(Animated.timing(pulseT, {
        toValue: 1, duration: 1300, delay: 500, easing: Easing.out(Easing.ease), useNativeDriver: true,
      }));
    }
    Animated.parallel(anims).start();
  }, [status, isPending, isError, isSuccess, ringT, markT, armT, pulseT]);

  useEffect(() => {
    if (isPending) return;
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(glowT, { toValue: 1, duration: 950, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(glowT, { toValue: 0, duration: 950, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [isPending, glowT]);

  const offset = (v: Animated.Value, len: number) =>
    v.interpolate({ inputRange: [0, 1], outputRange: [len, 0] });

  return (
    <Modal
      visible
      transparent
      statusBarTranslucent
      navigationBarTranslucent
      presentationStyle="overFullScreen"
      animationType="none"
      onRequestClose={isPending ? () => {} : onClose}
    >
    <View accessibilityViewIsModal style={st.scrim}>
      <Animated.View style={[st.card, { transform: [{ scale: pop }] }]}>
        <View style={st.markArea}>
          {isSuccess && <Orbs />}

          {/* Soft glow behind the mark (tx-glow). */}
          {!isPending && (
            <Animated.View
              pointerEvents="none"
              style={[
                st.glow,
                {
                  backgroundColor: isError ? colors.dangerTint : colors.successTint,
                  opacity: glowT.interpolate({ inputRange: [0, 1], outputRange: [0.3, 0.65] }),
                },
              ]}
            />
          )}

          {/* Expanding pulse ring (success only). */}
          {isSuccess && (
            <Animated.View
              pointerEvents="none"
              style={[
                st.pulse,
                {
                  borderColor: colors.success,
                  opacity: pulseT.interpolate({ inputRange: [0, 1], outputRange: [0.65, 0] }),
                  transform: [{ scale: pulseT.interpolate({ inputRange: [0, 1], outputRange: [0.82, 2.4] }) }],
                },
              ]}
            />
          )}

          {isPending ? (
            <ActivityIndicator size="large" color={colors.brand} />
          ) : (
            <Svg width={88} height={88} viewBox="0 0 96 96">
              <Defs>
                <LinearGradient id="txfx" x1="0" y1="0" x2="1" y2="1">
                  <Stop offset="0%" stopColor={colors.brand} />
                  <Stop offset="100%" stopColor={accent} />
                </LinearGradient>
              </Defs>
              {/* Faint track the drawn ring lands on. */}
              <Circle cx="48" cy="48" r="40" fill="none" stroke={colors.border} strokeWidth="4" opacity={0.5} />
              <AnimatedCircle
                cx="48" cy="48" r="40" fill="none"
                stroke="url(#txfx)" strokeWidth="4" strokeLinecap="round"
                strokeDasharray={RING_LEN}
                strokeDashoffset={offset(ringT, RING_LEN) as unknown as number}
                // Start the sweep at 12 o'clock, as the popup does.
                transform="rotate(-90 48 48)"
              />
              {isSuccess ? (
                <AnimatedPath
                  d="M30 49 L43 62 L67 35" fill="none"
                  stroke="url(#txfx)" strokeWidth="5.5" strokeLinecap="round" strokeLinejoin="round"
                  strokeDasharray={CHECK_LEN}
                  strokeDashoffset={offset(markT, CHECK_LEN) as unknown as number}
                />
              ) : (
                <>
                  <AnimatedPath
                    d="M36 36 L60 60" fill="none"
                    stroke="url(#txfx)" strokeWidth="5.5" strokeLinecap="round"
                    strokeDasharray={ARM_LEN}
                    strokeDashoffset={offset(markT, ARM_LEN) as unknown as number}
                  />
                  <AnimatedPath
                    d="M60 36 L36 60" fill="none"
                    stroke="url(#txfx)" strokeWidth="5.5" strokeLinecap="round"
                    strokeDasharray={ARM_LEN}
                    strokeDashoffset={offset(armT, ARM_LEN) as unknown as number}
                  />
                </>
              )}
            </Svg>
          )}
        </View>

        <Text style={st.title}>{title}</Text>
        {!!amountLabel && !isError && <Text style={st.amount}>{amountLabel}</Text>}
        {isError && !!errorMessage && <Text style={st.errBody}>{errorMessage}</Text>}
        {isPending && <Text style={st.pendingSub}>{detail || PENDING_SUB[kind]}</Text>}

        {isSuccess && !!explorerUrl && !!txHash && (
          <Pressable onPress={() => Linking.openURL(explorerUrl).catch(() => {})}>
            <Text style={st.hashLink}>
              {txHash.slice(0, 14)}…{txHash.slice(-8)} ↗
            </Text>
          </Pressable>
        )}

        {!isPending && (
          <Btn label={isError ? "Try again" : "Done"} onPress={onClose} style={st.action} />
        )}
      </Animated.View>
    </View>
    </Modal>
  );
}

const st = themedStyles((colors) => ({
  scrim: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.scrim,
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
  glow: {
    position: "absolute",
    left: 16, right: 16, top: 16, bottom: 16,
    borderRadius: 40,
  },
  pulse: {
    position: "absolute",
    left: 12, right: 12, top: 12, bottom: 12,
    borderRadius: 44,
    borderWidth: 2,
  },
  title: { marginTop: 16, fontSize: 19, fontWeight: "700", color: colors.textPrimary },
  amount: { marginTop: 4, fontSize: 13, color: colors.textSecondary, textAlign: "center" },
  errBody: { marginTop: 8, fontSize: 12, color: colors.textSecondary, lineHeight: 17, textAlign: "center" },
  pendingSub: { marginTop: 6, fontSize: 12, color: colors.muted },
  hashLink: { marginTop: 12, fontSize: 11, color: colors.brand2 },
  action: { alignSelf: "stretch", marginTop: 20 },
}));
