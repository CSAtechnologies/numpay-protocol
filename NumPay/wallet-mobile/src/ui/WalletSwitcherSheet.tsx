import { StyleSheet, Text, View } from "react-native";
import type { Rates } from "@numpay/core/currency";
import type { WalletMeta } from "../vault/mobileVault";
import { Sheet } from "./Sheet";
import { Btn, Tappable } from "./components";
import { WalletAvatar } from "./WalletAvatar";
import { CheckIcon, ChevronRightIcon } from "./icons";
import { colors, radius, themedStyles } from "./theme";
import { formatFiat, useCurrencyPref } from "./currency";

const shortAddress = (address?: string) =>
  address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "Address loading";

/**
 * Dashboard account switcher. Balances are last-known PUBLIC summaries; this
 * component never decrypts another wallet or changes the active account merely
 * to preview it.
 */
export function WalletSwitcherSheet({
  open, wallets, activeWalletId, balances, liveBalanceUsd, rates, loading,
  onClose, onSwitch, onManage,
}: {
  open: boolean;
  wallets: WalletMeta[];
  activeWalletId: string | null;
  balances: Record<string, number | null>;
  liveBalanceUsd: number;
  rates: Rates | null;
  loading: boolean;
  onClose: () => void;
  onSwitch: (id: string) => void;
  onManage: () => void;
}) {
  const cur = useCurrencyPref();

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Switch wallet"
      body="Balances are the latest saved values. Select a wallet to open it."
      maxHeightRatio={0.72}
    >
      <View style={st.list}>
        {wallets.map((wallet, index) => {
          const active = wallet.id === activeWalletId;
          const usd = active ? liveBalanceUsd : balances[wallet.id];
          const balance = typeof usd === "number"
            ? formatFiat(usd, cur.code, cur.currency, rates)
            : loading ? "Loading…" : "Not synced yet";
          return (
            <Tappable
              key={wallet.id}
              feedback="row"
              borderRadius={radius.tile}
              onPress={() => onSwitch(wallet.id)}
              accessibilityRole="button"
              accessibilityLabel={`${wallet.name}, ${balance}${active ? ", active wallet" : ""}`}
              accessibilityState={{ selected: active }}
              style={[st.row, index > 0 && st.divider]}
            >
              <WalletAvatar avatar={wallet.avatar} name={wallet.name} size={40} active={active} />
              <View style={st.identity}>
                <View style={st.nameLine}>
                  <Text numberOfLines={1} style={st.name}>{wallet.name}</Text>
                  {active && <Text style={st.activeLabel}>Active</Text>}
                </View>
                <Text numberOfLines={1} style={st.address}>{shortAddress(wallet.evmAddress)}</Text>
              </View>
              <View style={st.trailing}>
                <Text numberOfLines={1} adjustsFontSizeToFit minimumFontScale={0.75} style={st.balance}>
                  {balance}
                </Text>
                {active
                  ? <CheckIcon size={15} color={colors.successText} />
                  : <ChevronRightIcon size={14} color={colors.muted2} />}
              </View>
            </Tappable>
          );
        })}
        {!loading && wallets.length === 0 && (
          <Text style={st.empty}>No wallets are available.</Text>
        )}
      </View>
      <Btn label="Manage wallets" variant="secondary" onPress={onManage} style={st.manage} />
    </Sheet>
  );
}

const st = themedStyles((colors) => ({
  list: {
    marginTop: 16,
    borderRadius: radius.tile,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surface1,
    overflow: "hidden",
  },
  row: {
    minHeight: 70,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  divider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border },
  identity: { flex: 1, minWidth: 0 },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 7 },
  name: { flexShrink: 1, color: colors.textPrimary, fontSize: 15, fontWeight: "600" },
  activeLabel: { color: colors.successText, fontSize: 10.5, fontWeight: "700" },
  address: { marginTop: 3, color: colors.muted, fontSize: 11.5, fontFamily: "monospace" },
  trailing: { maxWidth: "38%", alignItems: "flex-end", gap: 6 },
  balance: {
    color: colors.textPrimary,
    fontSize: 13.5,
    fontWeight: "700",
    fontVariant: ["tabular-nums"],
    textAlign: "right",
  },
  empty: { color: colors.muted, fontSize: 13, textAlign: "center", padding: 20 },
  manage: { marginTop: 12 },
}));
