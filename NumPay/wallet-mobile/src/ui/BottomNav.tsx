// The extension's floating pill nav (.floating-nav + Layout NAV_ITEMS), ported
// 1:1: six tabs, active tab gets the brand-tinted pill and the icon's fill
// layer. Absolute-positioned over the screen; App pads the content area so
// the last rows clear it.
//
// The port was faithful but inert. This is the most-tapped surface in the app
// and every tab was a bare Pressable with no pressed style at all, so a tap
// produced nothing until the whole screen cut to the next one. Two things fix
// that: the active pill SLIDES between tabs instead of teleporting, and each
// tab answers the finger while it is still down.
import { useEffect, useMemo, useRef, useState } from "react";
import {
  Animated, Easing, Pressable, Text,
} from "react-native";
import { colors, motion, press, themedStyles } from "./theme";
import { useReducedMotion } from "./useReducedMotion";
import {
  NavActivityIcon, NavBpanIcon, NavSendIcon,
  NavSettingsIcon, NavWalletIcon,
} from "./icons";

export type NavTab = "home" | "send" | "bpan" | "activity" | "settings";

const ITEMS: Array<{
  tab: NavTab;
  label: string;
  Icon: typeof NavWalletIcon;
}> = [
  { tab: "home", label: "Wallet", Icon: NavWalletIcon },
  { tab: "send", label: "Pay", Icon: NavSendIcon },
  { tab: "bpan", label: "BPAN", Icon: NavBpanIcon },
  { tab: "activity", label: "Activity", Icon: NavActivityIcon },
  { tab: "settings", label: "Settings", Icon: NavSettingsIcon },
];

export const BOTTOM_NAV_CLEARANCE = 72;

/** One tab. Owns its own press value so pressing one tab does not re-render
 *  the other five. */
function NavItem({
  label, Icon, isActive, onPress,
}: {
  label: string;
  Icon: typeof NavWalletIcon;
  isActive: boolean;
  onPress: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const a = useRef(new Animated.Value(0)).current;
  const drive = (to: number) => {
    if (reduceMotion) return;
    Animated.timing(a, {
      toValue: to, duration: motion.press,
      easing: Easing.out(Easing.quad), useNativeDriver: true,
    }).start();
  };
  return (
    <Pressable
      style={st.item}
      onPress={onPress}
      onPressIn={() => drive(1)}
      onPressOut={() => drive(0)}
      accessibilityRole="tab"
      accessibilityState={{ selected: isActive }}
      accessibilityLabel={label}
    >
      {/* Icon and caption scale as ONE unit. Scaling them separately makes the
          glyph drift against its label, which reads as a rendering fault. */}
      <Animated.View
        style={{
          alignItems: "center",
          gap: 3,
          transform: [{
            scale: a.interpolate({ inputRange: [0, 1], outputRange: [1, press.scale] }),
          }],
        }}
      >
        <Icon size={17} color={isActive ? colors.brand2 : colors.muted} active={isActive} />
        <Text style={[st.label, isActive && { color: colors.brand2 }]}>{label}</Text>
      </Animated.View>
    </Pressable>
  );
}

export function BottomNav({ active, onNavigate, visible = true }: {
  active: NavTab;
  onNavigate: (tab: NavTab) => void;
  visible?: boolean;
}) {
  // -1 (the nav is visible on a screen that is not itself a tab) would throw
  // the pill off the left edge, so it falls back to the first slot.
  const found = ITEMS.findIndex((i) => i.tab === active);
  const index = found === -1 ? 0 : found;

  // The pill's position animates as a tab index. Once the bar is measured the
  // index is multiplied by one slot width and applied as a native transform;
  // this survives rotation without putting every animation frame on JS.
  const slide = useRef(new Animated.Value(index)).current;
  const reveal = useRef(new Animated.Value(visible ? 1 : 0)).current;
  const reduceMotion = useReducedMotion();
  const [barWidth, setBarWidth] = useState(0);

  useEffect(() => {
    if (reduceMotion) {
      slide.setValue(index);
      return;
    }
    // Spring rather than timing: the pill should arrive and settle. Same curve
    // as the Sheet, so the app's physical motion agrees with itself.
    Animated.spring(slide, {
      toValue: index,
      ...motion.spring,
      // A pill that shoots past a tab and comes back reads as sloppy over this
      // short a travel, where a full-height sheet has the distance to carry it.
      overshootClamping: true,
      useNativeDriver: true,
    }).start();
  }, [index, reduceMotion, slide]);

  useEffect(() => {
    if (reduceMotion) {
      reveal.setValue(visible ? 1 : 0);
      return;
    }
    Animated.timing(reveal, {
      toValue: visible ? 1 : 0,
      duration: visible ? motion.screen : motion.exit,
      easing: visible ? Easing.out(Easing.cubic) : Easing.in(Easing.quad),
      useNativeDriver: true,
    }).start();
  }, [reduceMotion, reveal, visible]);

  const slotWidth = barWidth / ITEMS.length;
  const indicatorWidth = 28;
  // Animated.add/multiply create native graph nodes. Rebuilding that graph on
  // every parent render can detach an input while Android is still processing
  // a frame, which React Native reports as an illegal animated node ID. The
  // graph only depends on the measured bar width and the stable slide value.
  const indicatorTranslateX = useMemo(() => (
    barWidth > 0
      ? Animated.add(
          Animated.multiply(slide, slotWidth),
          Math.max(0, (slotWidth - indicatorWidth) / 2),
        )
      : null
  ), [barWidth, slide, slotWidth]);

  return (
    <Animated.View
      style={[
        st.bar,
        {
          opacity: reveal,
          transform: [{
            translateY: reveal.interpolate({ inputRange: [0, 1], outputRange: [18, 0] }),
          }],
        },
      ]}
      pointerEvents={visible ? "auto" : "none"}
      accessibilityElementsHidden={!visible}
      importantForAccessibility={visible ? "auto" : "no-hide-descendants"}
      accessibilityRole="tablist"
      onLayout={(e) => setBarWidth(e.nativeEvent.layout.width)}
    >
      {indicatorTranslateX && (
        <Animated.View
          pointerEvents="none"
          style={[
            st.activePill,
            {
              width: indicatorWidth,
              transform: [{
                translateX: indicatorTranslateX,
              }],
            },
          ]}
        />
      )}
      {ITEMS.map(({ tab, label, Icon }) => (
        <NavItem
          key={tab}
          label={label}
          Icon={Icon}
          isActive={tab === active}
          onPress={() => onNavigate(tab)}
        />
      ))}
    </Animated.View>
  );
}

const st = themedStyles((colors) => ({
  bar: {
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    height: 68,
    paddingBottom: 8,
    backgroundColor: colors.navBg,
    borderTopWidth: 1,
    borderColor: colors.navBorder,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    zIndex: 8,
  },
  item: {
    flex: 1,
    height: "100%",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  activePill: {
    position: "absolute",
    left: 0,
    top: 0, height: 3,
    borderBottomLeftRadius: 3,
    borderBottomRightRadius: 3,
    backgroundColor: colors.brand,
  },
  label: {
    // 8.5 was the popup's caption size: legible at desk distance on a 360px
    // panel, not on a phone at arm's length.
    fontSize: 10,
    fontWeight: "600",
    letterSpacing: 0,
    color: colors.muted,
  },
}));
