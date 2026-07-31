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
import { useEffect, useRef } from "react";
import {
  AccessibilityInfo, Animated, Easing, Pressable, Text, View,
} from "react-native";
import { colors, elevation, motion, press, themedStyles } from "./theme";
import {
  NavActivityIcon, NavBpanIcon, NavReceiveIcon, NavSendIcon,
  NavSettingsIcon, NavWalletIcon,
} from "./icons";

export type NavTab = "home" | "send" | "receive" | "bpan" | "activity" | "settings";

const ITEMS: Array<{
  tab: NavTab;
  label: string;
  Icon: typeof NavWalletIcon;
}> = [
  { tab: "home", label: "WALLET", Icon: NavWalletIcon },
  { tab: "send", label: "SEND", Icon: NavSendIcon },
  { tab: "receive", label: "RECEIVE", Icon: NavReceiveIcon },
  { tab: "bpan", label: "BPAN", Icon: NavBpanIcon },
  { tab: "activity", label: "ACTIVITY", Icon: NavActivityIcon },
  { tab: "settings", label: "SETTINGS", Icon: NavSettingsIcon },
];

export const BOTTOM_NAV_CLEARANCE = 80; // nav height + gap the content must clear

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
  const a = useRef(new Animated.Value(0)).current;
  const drive = (to: number) => {
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

export function BottomNav({ active, onNavigate }: {
  active: NavTab;
  onNavigate: (tab: NavTab) => void;
}) {
  // -1 (the nav is visible on a screen that is not itself a tab) would throw
  // the pill off the left edge, so it falls back to the first slot.
  const found = ITEMS.findIndex((i) => i.tab === active);
  const index = found === -1 ? 0 : found;

  // The pill's position animates as a tab INDEX and interpolates to a
  // percentage, not to a pixel offset. The bar is a flex row spanning the
  // display minus 12dp a side, so it has no width this file can know; a
  // percentage survives rotation and any display size.
  const slide = useRef(new Animated.Value(index)).current;
  const reduceMotion = useRef(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then((on) => { reduceMotion.current = on; })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (reduceMotion.current) {
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
      // Percentage strings cannot go through the native driver.
      useNativeDriver: false,
    }).start();
  }, [index, slide]);

  return (
    <View style={st.bar} accessibilityRole="tablist">
      <Animated.View
        pointerEvents="none"
        style={[
          st.activePill,
          {
            left: slide.interpolate({
              inputRange: ITEMS.map((_, i) => i),
              outputRange: ITEMS.map((_, i) => `${(i * 100) / ITEMS.length}%`),
            }),
          },
        ]}
      />
      {ITEMS.map(({ tab, label, Icon }) => (
        <NavItem
          key={tab}
          label={label}
          Icon={Icon}
          isActive={tab === active}
          onPress={() => onNavigate(tab)}
        />
      ))}
    </View>
  );
}

const st = themedStyles((colors) => ({
  bar: {
    position: "absolute",
    bottom: 12, left: 12, right: 12,
    height: 56,
    borderRadius: 20,
    backgroundColor: colors.navBg,
    borderWidth: 1,
    borderColor: colors.navBorder,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    // Was a hand-written shadow whose own comment noted that 0.6 reads as a
    // smudge on a light background. That reasoning now lives in the elevation
    // tokens, which apply it to every floating surface rather than just here.
    ...elevation.floating,
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
    // One slot wide, inset 5dp a side so consecutive pills never touch.
    // `left` is ANIMATED in the component and deliberately not set here.
    width: `${100 / ITEMS.length}%`,
    top: 6, bottom: 6,
    marginLeft: 5,
    marginRight: 5,
    borderRadius: 16,
    backgroundColor: colors.brandTint,
    borderWidth: 1,
    borderColor: colors.navBorder,
  },
  label: {
    // 8.5 was the popup's caption size: legible at desk distance on a 360px
    // panel, not on a phone at arm's length.
    fontSize: 9.5,
    fontWeight: "600",
    letterSpacing: 0.7,
    color: colors.muted,
  },
}));
