import { Text, View } from "react-native";
import { colors, spacing, themedStyles } from "./theme";
import { Tappable } from "./components";
import { WalletAvatar } from "./WalletAvatar";
import {
  ArrowUpRightIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon,
  GlobeIcon, HashIcon, ReceiveIcon, ScanIcon, SwapIcon, TrendingUpIcon,
} from "./icons";

/** Shared by the native wallet and the browser UI workbench. All wallet work
 * stays in the caller; this component only renders values and user actions. */
export function WalletOverview(p: {
  walletName: string;
  walletAvatar?: string;
  balance: string;
  loading: boolean;
  bpan?: string | null;
  copied?: boolean;
  onAccounts: () => void;
  onScan: () => void;
  onBrowser: () => void;
  onSend: () => void;
  onReceive: () => void;
  onSwap: () => void;
  onDeFi: () => void;
  onBPAN: () => void;
  onCopyBPAN: () => void;
}) {
  return (
    <View style={st.root}>
      <View style={st.header}>
        <Tappable style={st.account} feedback="ghost" borderRadius={12}
          onPress={p.onAccounts} accessibilityLabel={`Switch wallet, ${p.walletName}`}>
          <WalletAvatar avatar={p.walletAvatar} name={p.walletName} size={32} />
          <Text numberOfLines={1} style={st.walletName}>{p.walletName}</Text>
          <ChevronDownIcon size={14} color={colors.muted} />
        </Tappable>
        <Tappable style={st.headerAction} feedback="ghost" borderRadius={12}
          onPress={p.onScan} accessibilityLabel="Scan a QR code">
          <ScanIcon size={21} color={colors.textSecondary} />
        </Tappable>
        <Tappable style={st.headerAction} feedback="ghost" borderRadius={12}
          onPress={p.onBrowser} accessibilityLabel="Open the dApp browser">
          <GlobeIcon size={21} color={colors.textSecondary} />
        </Tappable>
      </View>

      <View style={st.balanceBlock}>
        <View style={st.balanceLabelRow}>
          <Text style={st.balanceLabel}>Total balance</Text>
          {p.loading && <Text style={st.sync} accessibilityLiveRegion="polite">Updating…</Text>}
        </View>
        <Text style={st.balance} numberOfLines={1} adjustsFontSizeToFit
          minimumFontScale={0.6} accessibilityLabel={`Total balance ${p.balance}`}>
          {p.balance}
        </Text>
      </View>

      <View style={st.actions}>
        {[
          { label: "Send", Icon: ArrowUpRightIcon, onPress: p.onSend },
          { label: "Receive", Icon: ReceiveIcon, onPress: p.onReceive },
          { label: "Swap", Icon: SwapIcon, onPress: p.onSwap },
        ].map(({ label, Icon, onPress }, i) => (
          <Tappable key={label} style={[st.action, i === 0 && st.primaryAction]} feedback="tile" borderRadius={14}
            onPress={onPress} accessibilityLabel={label}>
            <Icon size={19} color={i === 0 ? colors.onBrand : colors.textPrimary} />
            <Text style={[st.actionLabel, i === 0 && st.primaryActionLabel]}>{label}</Text>
          </Tappable>
        ))}
      </View>

      <View style={st.supportingActions}>
        <Tappable style={st.supportingAction} feedback="ghost" borderRadius={10}
          onPress={p.bpan ? p.onCopyBPAN : p.onBPAN}
          accessibilityLabel={p.bpan ? (p.copied ? "BPAN copied" : `Copy BPAN ${p.bpan}`) : "Create a BPAN payment number"}>
          {p.copied ? <CheckIcon size={16} color={colors.successText} /> : <HashIcon size={16} color={colors.brand2} />}
          <Text numberOfLines={1} style={[st.supportingLabel, p.copied && { color: colors.successText }]}>
            {p.copied ? "BPAN copied" : p.bpan ? p.bpan : "Create BPAN"}
          </Text>
        </Tappable>
        <Tappable style={st.supportingAction} feedback="ghost" borderRadius={10}
          onPress={p.onDeFi} accessibilityLabel="Explore DeFi">
          <TrendingUpIcon size={16} color={colors.muted} />
          <Text style={st.supportingLabel}>Explore DeFi</Text>
          <ChevronRightIcon size={14} color={colors.muted} />
        </Tappable>
      </View>
    </View>
  );
}

const st = themedStyles((colors) => ({
  root: { paddingHorizontal: spacing.screen, paddingTop: 52, paddingBottom: 12 },
  header: { flexDirection: "row", alignItems: "center", gap: 2 },
  account: { flex: 1, minWidth: 0, minHeight: 44, flexDirection: "row", alignItems: "center", gap: 9, paddingRight: 6 },
  walletName: { flexShrink: 1, fontSize: 16, fontWeight: "600", color: colors.textPrimary },
  headerAction: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
  balanceBlock: { marginTop: 24, marginBottom: 20 },
  balanceLabelRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", minHeight: 22 },
  balanceLabel: { fontSize: 14, color: colors.muted },
  sync: { fontSize: 12, color: colors.muted },
  balance: { fontSize: 40, lineHeight: 52, letterSpacing: -1.4, fontWeight: "700", color: colors.textPrimary, fontVariant: ["tabular-nums"] },
  actions: { flexDirection: "row", gap: 8 },
  action: {
    flex: 1, minWidth: 0, minHeight: 68, alignItems: "flex-start",
    justifyContent: "space-between", paddingHorizontal: 11, paddingVertical: 10,
    borderRadius: 14, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  primaryAction: { backgroundColor: colors.action, borderColor: colors.action },
  actionLabel: { fontSize: 12, fontWeight: "600", color: colors.textPrimary },
  primaryActionLabel: { color: colors.onBrand },
  supportingActions: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginTop: 10, gap: 8,
  },
  supportingAction: {
    minHeight: 44, flex: 1, minWidth: 0, flexDirection: "row", alignItems: "center",
    gap: 7, paddingHorizontal: 8,
  },
  supportingLabel: {
    flexShrink: 1, color: colors.textSecondary, fontSize: 12,
    fontWeight: "600", fontVariant: ["tabular-nums"],
  },
}));
