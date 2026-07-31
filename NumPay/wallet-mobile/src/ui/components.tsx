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
import { colors, elevation, getTheme, gradients, motion, press, radius, type as ts, themedStyles } from "./theme";
import { noticeTone, type NoticeToneInput } from "./notice";
import { AlertIcon, ArrowLeftIcon, CheckIcon } from "./icons";

// ── Tappable: the app's ONE press-feedback contract ──────────────────────────
/**
 * Before this existed, 61 of the app's 83 Pressables had no pressed style at
 * all. Tapping a token row, a nav tab or a chip produced nothing at all until
 * the screen changed, so every interaction read as a dead surface followed by
 * an abrupt cut. That gap, not the palette, is what made the app feel rigid.
 *
 * `feedback` picks how a surface answers a touch, because they should not all
 * answer the same way:
 *   row   a list row tints under the finger and ripples on Android. It must not
 *         scale: a full-width row shrinking looks like the list is collapsing.
 *   tile  a button, action tile or card presses IN. Scale is animated (native
 *         driver) rather than snapped, so the release springs back instead of
 *         popping, which is the difference between "pressed" and "glitched".
 *   ghost chrome with no fill of its own (header buttons). Tints only, no
 *         ripple, so it does not draw a box that is not there at rest.
 *
 * Everything routes through `motion.press`, so the whole app answers a finger
 * at one speed.
 */
export type PressFeedback = "row" | "tile" | "ghost" | "none";

/**
 * Style props that size or place the box, as opposed to painting it.
 *
 * `tile` has to wrap its Pressable in an Animated.View to carry the scale, and
 * THAT wrapper, not the Pressable, becomes the flex child of whatever laid the
 * tile out. So these have to move up to the wrapper. Leaving them inside
 * collapsed every tile row in the app to its content width: the dashboard's
 * Receive/Swap/DeFi row and the add-wallet segmented control both bunched up
 * against the left edge, because their `flex: 1` was landing on a child of a
 * wrapper that had no width of its own to divide.
 */
const TILE_OUTER_KEYS = [
  "flex", "flexBasis", "flexGrow", "flexShrink", "alignSelf",
  "width", "height", "minWidth", "minHeight", "maxWidth", "maxHeight",
  "margin", "marginTop", "marginBottom", "marginLeft", "marginRight",
  "marginHorizontal", "marginVertical", "marginStart", "marginEnd",
  "position", "top", "bottom", "left", "right", "zIndex",
] as const;

// NOTE, unverified on device: shadows are deliberately NOT in the list above.
// A `tile` that passes `borderRadius` gets `overflow: "hidden"` on the wrapper
// to keep the Android ripple inside the tile's corners, and that clip is
// believed to also eat a shadow cast by a CHILD, since an elevation shadow
// draws outside the child's own bounds. The dashboard Send CTA is the one call
// site this would affect (its brand glow sits on the LinearGradient inside).
// Hoisting the shadow to the wrapper is NOT the fix: the wrapper has no
// background, so Android has no outline to cast from and iOS drops the shadow
// outright once masksToBounds is set. Needs an emulator check before anything
// here changes.

/** [outer, inner]: the box props above go to the wrapper, everything that
 *  paints the tile (padding, fill, border, alignment) stays on the Pressable,
 *  so the ripple still clips to the tile's own edge. */
function splitTileStyle(
  style: StyleProp<ViewStyle>,
): [ViewStyle, ViewStyle] {
  const flat = StyleSheet.flatten(style);
  if (!flat) return [{}, {}];
  const outer: ViewStyle = {};
  const inner: ViewStyle = { ...flat };
  for (const k of TILE_OUTER_KEYS) {
    if (flat[k] === undefined) continue;
    (outer[k] as unknown) = flat[k];
    delete inner[k];
  }
  return [outer, inner];
}

export function Tappable({
  children, onPress, onLongPress, disabled, feedback = "row", style,
  hitSlop, borderRadius, accessibilityLabel, accessibilityRole = "button",
}: {
  children: ReactNode;
  onPress?: () => void;
  onLongPress?: () => void;
  disabled?: boolean;
  feedback?: PressFeedback;
  style?: StyleProp<ViewStyle>;
  hitSlop?: number;
  /** Rounds the press tint and clips the Android ripple. Deliberately has NO
   *  default: a full-width list row carries a divider hairline, and giving it a
   *  radius curls the ends of that line. Pass the surface's own radius for
   *  anything that actually is rounded (a pill, a tile, a card). */
  borderRadius?: number;
  accessibilityLabel?: string;
  accessibilityRole?: "button" | "link" | "none";
}) {
  const a = useRef(new Animated.Value(0)).current;
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1, press.scale] });

  const drive = (to: number) => {
    Animated.timing(a, {
      toValue: to, duration: motion.press,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  };

  const tint =
    feedback === "row" || feedback === "ghost" ? press.rowTint : undefined;

  // Only `tile` grows a wrapper, so only `tile` needs the split.
  const [outerStyle, innerStyle] =
    feedback === "tile" ? splitTileStyle(style) : [undefined, style];

  const body = (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      hitSlop={hitSlop}
      accessibilityRole={accessibilityRole}
      accessibilityLabel={accessibilityLabel}
      onPressIn={feedback === "tile" ? () => drive(1) : undefined}
      onPressOut={feedback === "tile" ? () => drive(0) : undefined}
      // Ripple is Android's own press language and costs nothing on iOS, where
      // the `pressed` tint below carries the same job.
      android_ripple={
        feedback === "row" || feedback === "tile"
          ? { color: press.ripple, borderless: false, radius: undefined }
          : undefined
      }
      style={({ pressed }) => [
        feedback !== "tile" && borderRadius != null && { borderRadius },
        innerStyle,
        disabled && { opacity: 0.4 },
        pressed && !disabled && tint ? { backgroundColor: tint } : null,
      ]}
    >
      {children}
    </Pressable>
  );

  if (feedback !== "tile") return body;
  return (
    <Animated.View
      style={[
        outerStyle,
        { transform: [{ scale }] },
        // Overflow clip keeps the ripple inside the tile's own corners.
        borderRadius != null && { borderRadius, overflow: "hidden" },
      ]}
    >
      {body}
    </Animated.View>
  );
}

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
  // Press is ANIMATED rather than a snapped `pressed &&` transform. The snap
  // version jumps to 0.98 and back in one frame each way, which registers as a
  // flicker; easing it over motion.press makes the button feel depressed and
  // then released. Native driver, so it holds 60fps while JS is busy signing.
  const a = useRef(new Animated.Value(0)).current;
  const scale = a.interpolate({ inputRange: [0, 1], outputRange: [1, press.scale] });
  const drive = (to: number) => {
    Animated.timing(a, {
      toValue: to, duration: motion.press,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  };
  const pressProps = {
    onPress,
    disabled,
    onPressIn: () => drive(1),
    onPressOut: () => drive(0),
    accessibilityRole: "button" as const,
    accessibilityLabel: label,
  };

  if (variant === "primary") {
    // .btn-primary-premium: vertical brand gradient, hairline top light,
    // brand glow. Gradient lives inside the pressable so radius clips it.
    return (
      // The default top margin lives on this wrapper, NOT on the inner fill, so
      // a caller passing `marginTop` overrides it instead of stacking on top of
      // it. (It used to sit on the same node as the caller's style, where the
      // caller's value simply won.)
      <Animated.View style={[{ marginTop: 12, transform: [{ scale }] }, style]}>
        <Pressable
          {...pressProps}
          style={[st.btnPremiumShell, disabled && { opacity: 0.4 }]}
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
      </Animated.View>
    );
  }
  return (
    // The default top margin lives on this wrapper, NOT on the inner fill, so
    // a caller passing `marginTop` overrides it instead of stacking on top of
    // it. (It used to sit on the same node as the caller's style, where the
    // caller's value simply won.)
    <Animated.View style={[{ marginTop: 12, transform: [{ scale }] }, style]}>
      <Pressable
        {...pressProps}
        style={[
          st.btn,
          variant === "secondary" && st.btnSecondary,
          variant === "danger" && st.btnDanger,
          disabled && { opacity: 0.35 },
        ]}
      >
        <Text style={[st.btnText, variant === "secondary" && { color: colors.textPrimary }]}>
          {label}
        </Text>
      </Pressable>
    </Animated.View>
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
          <Stop offset="0%" stopColor={gradients.ambientA.color} stopOpacity={gradients.ambientA.opacity} />
          <Stop offset="60%" stopColor={gradients.ambientA.color} stopOpacity={gradients.ambientA.opacity * 0.36} />
          <Stop offset="100%" stopColor={gradients.ambientA.color} stopOpacity={0} />
        </SvgRadialGradient>
        <SvgRadialGradient id="ambB" cx="50%" cy="50%" r="50%">
          <Stop offset="0%" stopColor={gradients.ambientB.color} stopOpacity={gradients.ambientB.opacity} />
          <Stop offset="100%" stopColor={gradients.ambientB.color} stopOpacity={0} />
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
  // Chips are the app's densest tap target (chain filters, presets), so they
  // press as a tile: at this size a tint is easy to miss under a fingertip,
  // where a scale is felt even when the finger covers the chip.
  return (
    <Tappable
      feedback="tile"
      onPress={onPress}
      borderRadius={radius.pill}
      accessibilityLabel={label}
      style={[st.pill, active && st.pillBrand]}
    >
      {icon}
      <Text style={[st.pillText, active && st.pillTextBrand]}>{label}</Text>
    </Tappable>
  );
}

// ── Toggle ───────────────────────────────────────────────────────────────────
/**
 * A binary setting. Hand-built rather than RN's `<Switch>` because that renders
 * the stock Material control, which is the one widget on these screens that
 * would announce itself as not-this-product: platform blue-green, platform
 * proportions, ignores the palette. The extension has no switch to port, so this
 * is the mobile original, built from the same tokens as everything else.
 *
 * The knob animates on the native driver and the track cross-fades, so the
 * change is legible without the user having to look for a colour they only see
 * one of at a time.
 */
export function Toggle({
  value, onValueChange, disabled, label,
}: {
  value: boolean;
  onValueChange: (next: boolean) => void;
  disabled?: boolean;
  /** Accessibility name. The visible label lives in the row that owns this. */
  label: string;
}) {
  const t = useRef(new Animated.Value(value ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(t, {
      toValue: value ? 1 : 0,
      duration: motion.press * 2,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [value, t]);

  return (
    <Pressable
      onPress={() => { if (!disabled) onValueChange(!value); }}
      disabled={disabled}
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      // Generous, because the control itself is deliberately small.
      hitSlop={10}
      style={[st.toggleTrack, value && st.toggleTrackOn, disabled && { opacity: 0.4 }]}
    >
      <Animated.View
        style={[
          st.toggleKnob,
          { transform: [{ translateX: t.interpolate({ inputRange: [0, 1], outputRange: [0, 18] }) }] },
        ]}
      />
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

// ── Screen header — Layout.tsx's header bar, 1:1 ─────────────────────────────
// A GHOST back button (no card fill or border) with ArrowLeftIcon, a 15px
// tracking-tight title, and the brand gradient hairline that fades out at both
// ends. `right` takes the trailing action the extension puts on some pages
// (explorer link, refresh).
// `subtitle` is the small line the extension puts under a page title when the
// page needs to name who is doing the work (Swap: "Powered by LI.FI"). It
// stacks inside the same 50px bar rather than adding a second row.
export function ScreenHeader({ title, subtitle, onBack, right }: {
  title: string;
  subtitle?: string;
  onBack?: () => void;
  right?: ReactNode;
}) {
  return (
    <View style={st.header}>
      {onBack && (
        <Tappable
          onPress={onBack}
          feedback="ghost"
          hitSlop={10}
          borderRadius={radius.iconBtn}
          accessibilityLabel="Go back"
          style={st.ghostBtn}
        >
          <ArrowLeftIcon size={16} color={colors.muted} />
        </Tappable>
      )}
      {subtitle ? (
        <View style={{ flexShrink: 1 }}>
          <Text style={st.headerTitle} numberOfLines={1}>{title}</Text>
          <Text style={st.headerSubtitle} numberOfLines={1}>{subtitle}</Text>
        </View>
      ) : (
        <Text style={st.headerTitle} numberOfLines={1}>{title}</Text>
      )}
      {right != null && <View style={{ marginLeft: "auto" }}>{right}</View>}
      <View style={st.headerRule} pointerEvents="none">
        <LinearGradient
          colors={["rgba(139,92,246,0)", "rgba(139,92,246,0.2)", "rgba(139,92,246,0)"]}
          start={{ x: 0, y: 0.5 }}
          end={{ x: 1, y: 0.5 }}
          style={{ flex: 1 }}
        />
      </View>
    </View>
  );
}

/** Square bordered icon button (.icon-btn): header bell/avatar/explorer slots. */
export function IconBtn({ children, onPress, label }: {
  children: ReactNode;
  onPress?: () => void;
  label?: string;
}) {
  return (
    <Tappable
      onPress={onPress}
      feedback="ghost"
      hitSlop={8}
      borderRadius={radius.iconBtn}
      accessibilityLabel={label}
      style={st.iconBtn}
    >
      {children}
    </Tappable>
  );
}

// ── Hero section (.hero-section) ─────────────────────────────────────────────
// The dashboard's gradient header block: a wide brand wash from the top centre,
// a second cooler wash from the upper left, over a vertical ramp that settles
// into the page background. Radials are SVG (RN gradients are linear only), and
// the ramp is a LinearGradient underneath them.
export function HeroSection({ children, style }: {
  children: ReactNode;
  /** Callers bleed this past the screen's horizontal padding with negative
   *  margins, so the wash reaches the edges the way the popup's does. */
  style?: StyleProp<ViewStyle>;
}) {
  const light = getTheme() === "light";
  return (
    <View style={[{ position: "relative" }, style]}>
      <View style={StyleSheet.absoluteFill} pointerEvents="none">
        <LinearGradient
          colors={light
            ? ["#ede9ff", "#f4f2ff", colors.bg]
            : ["#13102a", "#0d0b1e", colors.bg]}
          locations={[0, 0.55, 1]}
          style={StyleSheet.absoluteFill}
        />
        <Svg style={StyleSheet.absoluteFill} width="100%" height="100%">
          <Defs>
            <SvgRadialGradient id="heroA" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#7c6df0" stopOpacity={light ? 0.16 : 0.32} />
              <Stop offset="55%" stopColor="#7c6df0" stopOpacity={0} />
            </SvgRadialGradient>
            <SvgRadialGradient id="heroB" cx="50%" cy="50%" r="50%">
              <Stop offset="0%" stopColor="#5b4cdb" stopOpacity={light ? 0.08 : 0.2} />
              <Stop offset="50%" stopColor="#5b4cdb" stopOpacity={0} />
            </SvgRadialGradient>
          </Defs>
          <Ellipse cx="50%" cy="-5%" rx="260" ry="180" fill="url(#heroA)" />
          <Ellipse cx="5%" cy="15%" rx="140" ry="110" fill="url(#heroB)" />
        </Svg>
      </View>
      {children}
    </View>
  );
}

// ── Skeletons (the extension's animate-pulse placeholder blocks) ─────────────

/** A single pulsing placeholder block. */
export function SkeletonBlock({ width, height, radius: r = 4, style }: {
  width: number | `${number}%`;
  height: number;
  radius?: number;
  style?: StyleProp<ViewStyle>;
}) {
  const pulse = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [pulse]);
  return (
    <Animated.View
      style={[
        { width, height, borderRadius: r, backgroundColor: colors.surface3 },
        { opacity: pulse.interpolate({ inputRange: [0, 1], outputRange: [0.85, 0.35] }) },
        style,
      ]}
    />
  );
}

/** Placeholder token/tx row: disc + two text bars left, two right. */
export function SkeletonRow({ discSize = 36 }: { discSize?: number }) {
  return (
    <View style={st.skeletonRow}>
      <SkeletonBlock width={discSize} height={discSize} radius={discSize / 2} />
      <View style={{ flex: 1, marginLeft: 12, gap: 6 }}>
        <SkeletonBlock width={56} height={12} />
        <SkeletonBlock width={80} height={10} />
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        <SkeletonBlock width={56} height={12} />
        <SkeletonBlock width={40} height={10} />
      </View>
    </View>
  );
}

// ── Empty state (ext: circular premium-card icon tile + title + hint) ────────
export function EmptyState({ icon, title, hint, style }: {
  icon?: ReactNode;
  title: string;
  hint?: string;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <View style={[st.emptyState, style]}>
      {icon && <View style={st.emptyIcon}>{icon}</View>}
      <Text style={st.emptyTitle}>{title}</Text>
      {!!hint && <Text style={st.emptyHint}>{hint}</Text>}
    </View>
  );
}

// ── Notice — the inline message panel ────────────────────────────────────────
//
// Replaces the old AlertCard, which was a white card with a saturated 2px
// colour bar welded across the top and a full-strength amber title. Two things
// were wrong with it. The bar is a decoration that carries no information the
// icon does not already carry, and it dominated the card. And #f59e0b title
// text on white measured ~2.2:1, so the most urgent copy in the app was also
// the hardest to read.
//
// Now it is one tinted panel: the tone fills the surface softly and colours the
// icon and title, and the border is the same hue at low alpha so the panel has
// an edge without a hard rule. Body copy stays neutral — colouring the whole
// message is what made these read as browser warning bars.
//
// A Notice is for something the user may need to ACT on, and it stays until it
// is resolved. Transient failures belong in a toast (see Toast.tsx); anything
// needing an answer belongs in a Sheet.
export interface NoticeProps {
  title: string;
  body: string;
  hint?: string;
  tone?: NoticeToneInput;
  /** Optional Required/Available tiles (e.g. a fee shortfall). */
  figures?: { required: string; available: string; unit: string };
  /** Show the "nothing was sent" reassurance line. */
  safe?: boolean;
  /** Leading glyph. Defaults to the alert triangle. */
  icon?: ReactNode;
  /** Compact variant: no icon tile, tighter padding. For dense screens. */
  dense?: boolean;
  /** Actions belonging to the notice, rendered under everything else. Use it
   *  only for what resolves THIS notice: a notice that grows unrelated controls
   *  stops reading as one thing the user can dispose of. */
  children?: ReactNode;
  style?: StyleProp<ViewStyle>;
}

export function Notice({
  title, body, hint, tone = "danger", figures, safe, icon, dense, children, style,
}: NoticeProps) {
  const t = noticeTone(tone);
  return (
    <View
      style={[
        st.notice,
        { backgroundColor: t.tint, borderColor: t.line },
        dense && { padding: 11 },
        style,
      ]}
    >
      <View style={{ flexDirection: "row", gap: 11 }}>
        {!dense && (
          <View style={[st.noticeIcon, { borderColor: t.line }]}>
            {icon ?? <AlertIcon size={15} color={t.fg} />}
          </View>
        )}
        <View style={{ flex: 1 }}>
          <Text style={[st.noticeTitle, { color: t.fg }]}>{title}</Text>
          <Text style={st.noticeBody}>{body}</Text>
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
            <Text style={[st.figureValue, { color: t.fg }]}>
              {figures.available} <Text style={st.figureUnit}>{figures.unit}</Text>
            </Text>
          </View>
        </View>
      )}
      {hint && (
        <View style={[st.hintBox, { borderColor: t.line }]}>
          <Text style={{ color: colors.muted, fontSize: 10.5, lineHeight: 15 }}>{hint}</Text>
        </View>
      )}
      {safe && (
        <View style={st.safeRow}>
          <CheckIcon size={12} color={colors.successText} />
          <Text style={st.safeText}>Nothing was sent. Your funds are safe.</Text>
        </View>
      )}
      {children}
    </View>
  );
}

// Render a parsed SendErrorView (from @numpay/core/sendErrors). Core still
// spells the caution tone "amber" because that type is shared with the
// extension; noticeTone() accepts both spellings so this needs no translation.
export function SendErrorCard({ view, style }: { view: SendErrorView; style?: StyleProp<ViewStyle> }) {
  return (
    <Notice
      title={view.title} body={view.body} hint={view.hint}
      tone={view.tone} safe={view.safe} style={style}
    />
  );
}

const st = themedStyles((colors) => ({
  btnPremiumShell: {
    width: "100%",
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.overlayBorder,
    overflow: "hidden",
    ...elevation.brand,
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
  },
  btnSecondary: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
  },
  btnDanger: { backgroundColor: colors.dangerBtn },
  // Buttons carry a brand-gradient or solid-colour fill in both themes, so
  // the label stays white rather than following textPrimary.
  btnText: { color: colors.onBrand, fontWeight: "600", fontSize: ts.body },

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

  // 42x24 track, 20px knob, 2px inset: the knob travels 18 (see the
  // interpolation in Toggle, which must match this arithmetic).
  toggleTrack: {
    width: 42,
    height: 24,
    borderRadius: radius.pill,
    backgroundColor: colors.surface3,
    borderWidth: 1,
    borderColor: colors.border,
    padding: 1,
    justifyContent: "center",
  },
  toggleTrackOn: {
    backgroundColor: colors.brand,
    borderColor: colors.brandDark,
  },
  toggleKnob: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: colors.onBrand,
    // Lifted off the track so the OFF state reads as a control and not as a
    // flat pill: on a light theme the white knob on a pale track needs it.
    shadowColor: "#000",
    shadowOpacity: 0.18,
    shadowRadius: 2,
    shadowOffset: { width: 0, height: 1 },
    elevation: 2,
  },

  card: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.card,
    // The popup gave cards a hairline and nothing else, because inside a
    // browser panel there is no depth to express: the panel IS the top layer.
    // On a phone that left every card reading as a rectangle drawn onto the
    // page. A soft resting shadow is what makes it read as a surface instead.
    ...elevation.card,
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
    height: 50,
    marginBottom: 6,
    position: "relative",
  },
  headerTitle: {
    color: colors.textPrimary,
    fontSize: 15,
    fontWeight: "600",
    letterSpacing: -0.2,
    flexShrink: 1,
  },
  headerSubtitle: {
    color: colors.muted,
    fontSize: 10,
    marginTop: 1,
  },
  // The gradient separator under Layout's header bar.
  headerRule: { position: "absolute", left: 0, right: 0, bottom: 0, height: 1 },
  // Ghost back button: no fill or border until pressed (Layout's hover state).
  ghostBtn: {
    width: 32, height: 32,
    borderRadius: radius.button,
    alignItems: "center", justifyContent: "center",
  },
  iconBtn: {
    width: 32, height: 32,
    borderRadius: radius.iconBtn,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },

  skeletonRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },

  emptyState: { alignItems: "center", paddingVertical: 44 },
  emptyIcon: {
    width: 48, height: 48, borderRadius: 24,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
    marginBottom: 12,
  },
  emptyTitle: { color: colors.textSecondary, fontSize: ts.row },
  emptyHint: {
    color: colors.muted2, fontSize: ts.small, marginTop: 4,
    textAlign: "center", paddingHorizontal: 24, lineHeight: 16,
  },

  notice: {
    borderRadius: radius.card,
    borderWidth: 1,
    padding: 14,
  },
  // The tile reads against the panel's own tint, so it carries only a hairline
  // rather than a second, heavier fill of the same hue.
  noticeIcon: {
    width: 32, height: 32, borderRadius: 11,
    borderWidth: 1,
    alignItems: "center", justifyContent: "center", flexShrink: 0,
    backgroundColor: colors.card,
  },
  noticeTitle: { fontSize: 13, fontWeight: "700", marginBottom: 3, letterSpacing: -0.1 },
  noticeBody: { color: colors.textSecondary, fontSize: 11.5, lineHeight: 17 },

  figureTile: {
    flex: 1, borderRadius: radius.tile,
    backgroundColor: colors.card, paddingHorizontal: 12, paddingVertical: 8,
  },
  hintBox: {
    marginTop: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.tile,
    backgroundColor: colors.card,
    borderWidth: 1,
  },
  safeRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 12 },
  safeText: { color: colors.successText, fontSize: 10.5, fontWeight: "600" },
  figureLabel: { fontSize: 9, letterSpacing: 1, color: colors.muted, marginBottom: 2 },
  figureValue: { fontSize: 13, fontWeight: "700", color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  figureUnit: { fontSize: 10, color: colors.muted, fontWeight: "600" },
}));
