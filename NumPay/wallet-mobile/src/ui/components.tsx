// Shared RN components, ported from the extension popup's design system
// (index.css component classes + AlertCard.tsx). Every mobile screen builds
// from these so the phone app keeps the extension's visual language; only
// touch sizing differs where noted.
import { useEffect, useRef, type ReactNode } from "react";
import {
  Animated, Easing, Pressable, StyleSheet, Text, TextInput, View,
  type StyleProp, type TextInputProps, type ViewStyle,
} from "react-native";
import { NumPayMark, NumPayAnimatedLogo } from "./NumPayLogo";
import { LinearGradient } from "expo-linear-gradient";
import Svg, {
  Defs, RadialGradient as SvgRadialGradient, LinearGradient as SvgLinearGradient,
  Stop, Ellipse, Text as SvgText,
} from "react-native-svg";
import type { SendErrorView } from "@numpay/core/sendErrors";
import { colors, gradients, radius, type as ts } from "./theme";
import { ChevronLeftIcon } from "./icons";

// ── Buttons (.btn-primary-premium / .btn-secondary + danger tone) ────────────
export function Btn({
  label, onPress, variant = "primary", disabled, style,
}: {
  label: string;
  onPress: () => void;
  variant?: "primary" | "secondary" | "danger";
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  if (variant === "primary") {
    // .btn-primary-premium: vertical brand gradient, hairline top light,
    // brand glow. Gradient lives inside the pressable so radius clips it.
    return (
      <Pressable
        onPress={onPress}
        disabled={disabled}
        style={({ pressed }) => [
          st.btnPremiumShell,
          disabled && { opacity: 0.4 },
          pressed && !disabled && { transform: [{ scale: 0.98 }] },
          style,
        ]}
      >
        <LinearGradient
          colors={gradients.brand}
          locations={gradients.brandLocations}
          start={{ x: 0.5, y: 0 }}
          end={{ x: 0.5, y: 1 }}
          style={st.btnPremiumFill}
        >
          <Text style={st.btnText}>{label}</Text>
        </LinearGradient>
      </Pressable>
    );
  }
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        st.btn,
        variant === "secondary" && st.btnSecondary,
        variant === "danger" && st.btnDanger,
        disabled && { opacity: 0.35 },
        pressed && !disabled && { transform: [{ scale: 0.98 }] },
        style,
      ]}
    >
      <Text style={[st.btnText, variant === "secondary" && { color: colors.textPrimary }]}>
        {label}
      </Text>
    </Pressable>
  );
}

// ── Logo mark: the real NumPay vector mark (see NumPayLogo). LogoMark is the
//    static tile used in header pills / account pill; AnimatedLogo wraps the
//    self-drawing mark in the Welcome page's breathing pulse rings. ───────────
export function LogoMark({ size = 28 }: { size?: number }) {
  return <NumPayMark size={size} />;
}

/**
 * Auth/splash logo: the extension Welcome page's treatment — three staggered
 * pulse rings behind the mark that draws itself in on mount (NumPayAnimatedLogo).
 */
export function AnimatedLogo({ size = 88 }: { size?: number }) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, {
          toValue: 1, duration: 2600,
          easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
        Animated.timing(pulse, {
          toValue: 0, duration: 2600,
          easing: Easing.inOut(Easing.ease), useNativeDriver: true,
        }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);

  const ring = size * 1.6;
  return (
    <View style={{ width: ring, height: ring, alignItems: "center", justifyContent: "center" }}>
      <Animated.View
        style={{
          position: "absolute",
          width: ring, height: ring, borderRadius: ring / 2,
          backgroundColor: colors.brandTint,
          opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.5, 0.05] }),
          transform: [{ scale: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.72, 1.05] }) }],
        }}
      />
      <View
        style={{
          position: "absolute",
          width: size * 1.28, height: size * 1.28, borderRadius: (size * 1.28) / 2,
          borderWidth: 1, borderColor: "rgba(124, 109, 240, 0.3)",
        }}
      />
      <NumPayAnimatedLogo size={size} />
    </View>
  );
}

// ── Ambient wash (body::before): two soft radial blobs behind everything ─────
export function AmbientBackground() {
  return (
    <Svg
      pointerEvents="none"
      style={StyleSheet.absoluteFill}
      width="100%"
      height="100%"
    >
      <Defs>
        {/* stopOpacity ramps, not "transparent" color stops: react-native-svg
            renders the latter with a visible hard edge (seen on-device). */}
        <SvgRadialGradient id="ambA" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#7c6df0" stopOpacity={0.14} />
          <Stop offset="60%" stopColor="#7c6df0" stopOpacity={0.05} />
          <Stop offset="100%" stopColor="#7c6df0" stopOpacity={0} />
        </SvgRadialGradient>
        <SvgRadialGradient id="ambB" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor="#a394ff" stopOpacity={0.08} />
          <Stop offset="100%" stopColor="#a394ff" stopOpacity={0} />
        </SvgRadialGradient>
      </Defs>
      <Ellipse cx="12%" cy="-2%" rx="300" ry="170" fill="url(#ambA)" />
      <Ellipse cx="100%" cy="16%" rx="230" ry="150" fill="url(#ambB)" />
    </Svg>
  );
}

// ── Gradient numerals (.m-number): white->lilac vertical text gradient ───────
export function GradientNumber({
  text, size = 26,
}: { text: string; size?: number }) {
  // Monospace digits: ~0.62em advance is enough width for the svg canvas.
  const width = Math.ceil(text.length * size * 0.62) + 4;
  const height = Math.ceil(size * 1.25);
  return (
    <Svg width={width} height={height}>
      <Defs>
        <SvgLinearGradient id="numGrad" x1="0" y1="0" x2="0" y2="1">
          <Stop offset="0%" stopColor={gradients.number[0]} />
          <Stop offset="100%" stopColor={gradients.number[1]} />
        </SvgLinearGradient>
      </Defs>
      <SvgText
        x={0}
        y={size}
        fill="url(#numGrad)"
        fontSize={size}
        fontWeight="700"
        fontFamily="monospace"
      >
        {text}
      </SvgText>
    </Svg>
  );
}

// ── Input (.input-field) ──────────────────────────────────────────────────────
export function Field(props: TextInputProps) {
  return (
    <TextInput
      placeholderTextColor={colors.muted}
      {...props}
      style={[st.input, props.style]}
    />
  );
}

// ── Pill chip (.pill / .pill-brand) — chain filters, selectors ───────────────
export function Chip({
  label, active, onPress, icon,
}: { label: string; active?: boolean; onPress: () => void; icon?: ReactNode }) {
  return (
    <Pressable onPress={onPress} style={[st.pill, active && st.pillBrand]}>
      {icon}
      <Text style={[st.pillText, active && st.pillTextBrand]}>{label}</Text>
    </Pressable>
  );
}

// ── Card (.premium-card) ─────────────────────────────────────────────────────
export function Card({
  children, style,
}: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[st.card, style]}>{children}</View>;
}

// ── Section label (.section-label) ───────────────────────────────────────────
export function SectionLabel({ text, style }: { text: string; style?: StyleProp<ViewStyle> }) {
  return <Text style={[st.sectionLabel, style as object]}>{text.toUpperCase()}</Text>;
}

// ── Screen header: back chevron + title (Layout.tsx pattern, phone-sized) ────
export function ScreenHeader({ title, onBack }: { title: string; onBack?: () => void }) {
  return (
    <View style={st.header}>
      {onBack && (
        <Pressable onPress={onBack} style={st.iconBtn} hitSlop={8}>
          <ChevronLeftIcon size={17} color={colors.muted} />
        </Pressable>
      )}
      <Text style={st.headerTitle}>{title}</Text>
    </View>
  );
}

// ── AlertCard — RN port of components/AlertCard.tsx ──────────────────────────
// Titled hairline + icon tile, plain-language body, optional hint row,
// optional Required/Available figure tiles, optional "funds are safe" line.
export interface AlertCardProps {
  title: string;
  body: string;
  hint?: string;
  tone?: "danger" | "amber";
  figures?: { required: string; available: string; unit: string };
  safe?: boolean;
  style?: StyleProp<ViewStyle>;
}

export function AlertCard({
  title, body, hint, tone = "danger", figures, safe, style,
}: AlertCardProps) {
  const color = tone === "danger" ? colors.danger : colors.amber;
  const iconBg = tone === "danger" ? colors.dangerTint : colors.amberTint;
  return (
    <Card style={[{ overflow: "hidden" }, style]}>
      <View style={{ height: 2, backgroundColor: color, opacity: 0.55 }} />
      <View style={{ padding: 14 }}>
        <View style={{ flexDirection: "row", gap: 12 }}>
          <View style={[st.alertIconTile, { backgroundColor: iconBg }]}>
            <Text style={{ color, fontSize: 15, fontWeight: "700" }}>!</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={{ color, fontSize: 13, fontWeight: "700", marginBottom: 2 }}>{title}</Text>
            <Text style={{ color: colors.textSecondary, fontSize: 11, lineHeight: 16 }}>{body}</Text>
          </View>
        </View>
        {figures && (
          <View style={{ flexDirection: "row", gap: 8, marginTop: 12 }}>
            <View style={st.figureTile}>
              <Text style={st.figureLabel}>REQUIRED</Text>
              <Text style={st.figureValue}>
                ~{figures.required} <Text style={st.figureUnit}>{figures.unit}</Text>
              </Text>
            </View>
            <View style={st.figureTile}>
              <Text style={st.figureLabel}>AVAILABLE</Text>
              <Text style={[st.figureValue, { color }]}>
                {figures.available} <Text style={st.figureUnit}>{figures.unit}</Text>
              </Text>
            </View>
          </View>
        )}
        {hint && (
          <View style={st.hintBox}>
            <Text style={{ color: colors.muted, fontSize: 10.5, lineHeight: 15 }}>{hint}</Text>
          </View>
        )}
        {safe && (
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 }}>
            <Text style={{ color: colors.success, fontSize: 11 }}>{"✓"}</Text>
            <Text style={{ color: colors.success, fontSize: 10, fontWeight: "500" }}>
              Nothing was sent. Your funds are safe.
            </Text>
          </View>
        )}
      </View>
    </Card>
  );
}

// Render a parsed SendErrorView (from @numpay/core/sendErrors).
export function SendErrorCard({ view, style }: { view: SendErrorView; style?: StyleProp<ViewStyle> }) {
  return (
    <AlertCard
      title={view.title} body={view.body} hint={view.hint}
      tone={view.tone} safe={view.safe} style={style}
    />
  );
}

const st = StyleSheet.create({
  btnPremiumShell: {
    width: "100%",
    borderRadius: radius.button,
    marginTop: 12,
    borderWidth: 1,
    borderColor: "rgba(255, 255, 255, 0.13)",
    overflow: "hidden",
    shadowColor: colors.brand,
    shadowOpacity: 0.5,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 6 },
    elevation: 8,
  },
  btnPremiumFill: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 24,
  },
  btn: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    paddingVertical: 13,
    paddingHorizontal: 24,
    borderRadius: radius.button,
    backgroundColor: colors.brand,
    marginTop: 12,
  },
  btnSecondary: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnDanger: { backgroundColor: "#5b1f2b" },
  btnText: { color: "#fff", fontWeight: "600", fontSize: ts.body },

  input: {
    width: "100%",
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: radius.input,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    color: colors.textPrimary,
    fontSize: ts.body,
    marginTop: 10,
  },

  pill: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    marginRight: 8,
  },
  pillBrand: {
    backgroundColor: "rgba(124, 109, 240, 0.14)",
    borderColor: "rgba(124, 109, 240, 0.32)",
  },
  pillText: { color: colors.textSecondary, fontSize: 12 },
  pillTextBrand: { color: colors.brand2, fontWeight: "600" },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
  },

  sectionLabel: {
    fontSize: ts.label,
    fontWeight: "600",
    letterSpacing: 1.2,
    color: colors.muted2,
  },

  header: {
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    marginBottom: 12,
  },
  headerTitle: { color: colors.textPrimary, fontSize: ts.h2, fontWeight: "600" },
  iconBtn: {
    width: 32, height: 32,
    borderRadius: radius.iconBtn,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },

  alertIconTile: {
    width: 36, height: 36, borderRadius: radius.tile,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
  },
  figureTile: {
    flex: 1, borderRadius: radius.tile,
    backgroundColor: colors.surface3, paddingHorizontal: 12, paddingVertical: 8,
  },
  hintBox: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.tile,
    backgroundColor: colors.surface1,
    borderWidth: 1,
    borderColor: colors.border,
  },
  figureLabel: { fontSize: 9, letterSpacing: 1, color: colors.muted, marginBottom: 2 },
  figureValue: { fontSize: 13, fontWeight: "700", color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  figureUnit: { fontSize: 10, color: colors.muted, fontWeight: "600" },
});
