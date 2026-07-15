// The extension's floating pill nav (.floating-nav + Layout NAV_ITEMS), ported
// 1:1: six tabs, active tab gets the brand-tinted pill and the icon's fill
// layer. Absolute-positioned over the screen; App pads the content area so
// the last rows clear it.
import { Pressable, StyleSheet, Text, View } from "react-native";
import { colors } from "./theme";
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

export function BottomNav({ active, onNavigate }: {
  active: NavTab;
  onNavigate: (tab: NavTab) => void;
}) {
  return (
    <View style={st.bar}>
      {ITEMS.map(({ tab, label, Icon }) => {
        const isActive = tab === active;
        return (
          <Pressable key={tab} style={st.item} onPress={() => onNavigate(tab)}>
            {isActive && <View style={st.activePill} />}
            <Icon size={17} color={isActive ? colors.brand2 : colors.muted} active={isActive} />
            <Text style={[st.label, isActive && { color: colors.brand2 }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const st = StyleSheet.create({
  bar: {
    position: "absolute",
    bottom: 12, left: 12, right: 12,
    height: 56,
    borderRadius: 20,
    backgroundColor: "rgba(17, 15, 30, 0.96)",
    borderWidth: 1,
    borderColor: colors.border,
    flexDirection: "row",
    alignItems: "center",
    overflow: "hidden",
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
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
    left: 5, right: 5, top: 6, bottom: 6,
    borderRadius: 16,
    backgroundColor: "rgba(139, 92, 246, 0.12)",
    borderWidth: 1,
    borderColor: "rgba(139, 92, 246, 0.1)",
  },
  label: {
    fontSize: 8.5,
    fontWeight: "600",
    letterSpacing: 0.8,
    color: colors.muted,
  },
});
