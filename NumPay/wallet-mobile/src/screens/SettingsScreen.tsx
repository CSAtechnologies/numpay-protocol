// Settings — the nav's sixth tab, mirroring the extension Settings page at
// mobile scope: Accounts (the multi-wallet switcher: list, switch, rename,
// remove, add), Security (lock, reveal recovery phrase), Connections (dApps),
// and the danger zone. The version row is the hidden developer-tools entry.
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  listWallets, renameWallet, removeWallet, getActiveMnemonic,
  type WalletMeta,
} from "../vault/mobileVault";
import { colors, radius, type as ts } from "../ui/theme";
import { AlertCard, Btn, Card, Field, ScreenHeader, SectionLabel } from "../ui/components";

function Row({ label, hint, onPress, danger, right }: {
  label: string;
  hint?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [st.row, pressed && onPress && { opacity: 0.7 }]}
    >
      <View style={{ flex: 1 }}>
        <Text style={[st.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {!!hint && <Text style={st.rowHint}>{hint}</Text>}
      </View>
      {!!right && <Text style={st.rowRight}>{right}</Text>}
      {onPress && <Text style={st.rowChevron}>{"›"}</Text>}
    </Pressable>
  );
}

export function SettingsScreen({
  activeWalletId, onSwitchWallet, onAddWallet, onLock, onDapps, onDev, onWipe,
}: {
  activeWalletId: string | null;
  onSwitchWallet: (id: string) => void;
  onAddWallet: () => void;
  onLock: () => void;
  onDapps: () => void;
  onDev: () => void;
  onWipe: () => void;
}) {
  const [wallets, setWallets] = useState<WalletMeta[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);

  const reload = useCallback(() => { listWallets().then(setWallets).catch(() => {}); }, []);
  useEffect(() => { reload(); }, [reload, activeWalletId]);

  const doRename = async (id: string) => {
    await renameWallet(id, renameVal);
    setRenaming(null); setRenameVal("");
    reload();
  };
  const doRemove = (m: WalletMeta) => {
    Alert.alert(
      `Remove ${m.name}?`,
      "This deletes the wallet's keys from this phone. You can only restore it from its recovery phrase.",
      [
        { text: "Cancel", style: "cancel" },
        { text: "Remove", style: "destructive", onPress: async () => { await removeWallet(m.id); reload(); } },
      ],
    );
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Settings" />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* ── Accounts (multi-wallet) ── */}
        <SectionLabel text="Accounts" style={{ marginTop: 6, marginBottom: 6 } as object} />
        <Card>
          {wallets.map((m, i) => (
            <View key={m.id} style={[st.walletRow, i > 0 && st.walletDivider]}>
              {renaming === m.id ? (
                <View style={{ flex: 1 }}>
                  <Field
                    autoFocus
                    placeholder="Wallet name"
                    value={renameVal}
                    onChangeText={setRenameVal}
                    onSubmitEditing={() => { void doRename(m.id); }}
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Btn label="Save" onPress={() => { void doRename(m.id); }} style={{ flex: 1 }} />
                    <Btn label="Cancel" variant="secondary" onPress={() => setRenaming(null)} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : (
                <>
                  <Pressable style={st.walletMain} onPress={() => onSwitchWallet(m.id)}>
                    <View style={[st.radio, m.active && st.radioOn]}>
                      {m.active && <View style={st.radioDot} />}
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={st.rowLabel}>{m.name}</Text>
                      <Text style={st.rowHint}>{m.active ? "Active" : "Tap to switch"}</Text>
                    </View>
                  </Pressable>
                  <Pressable
                    hitSlop={8}
                    onPress={() => { setRenaming(m.id); setRenameVal(m.name); }}
                    style={st.walletAction}
                  >
                    <Text style={st.walletActionText}>Rename</Text>
                  </Pressable>
                  {wallets.length > 1 && (
                    <Pressable hitSlop={8} onPress={() => doRemove(m)} style={st.walletAction}>
                      <Text style={[st.walletActionText, { color: colors.danger }]}>Remove</Text>
                    </Pressable>
                  )}
                </>
              )}
            </View>
          ))}
        </Card>
        <Btn label="Add wallet" variant="secondary" onPress={onAddWallet} />

        {/* ── Security ── */}
        <SectionLabel text="Security" style={{ marginTop: 18, marginBottom: 6 } as object} />
        <Card>
          <Row label="Lock wallet" hint="Requires your PIN or biometrics to reopen" onPress={onLock} />
          <View style={st.hairline} />
          <Row
            label="Reveal recovery phrase"
            hint="Show the active wallet's 12/24 words. Never share them."
            onPress={async () => {
              const mn = await getActiveMnemonic();
              if (mn) setRevealed(mn);
            }}
          />
        </Card>
        {!!revealed && (
          <View style={{ marginTop: 10 }}>
            <AlertCard
              tone="amber"
              title="Active wallet recovery phrase"
              body="Anyone with these words controls this wallet. Keep them offline."
              style={{ marginBottom: 8 }}
            />
            <Card style={{ padding: 14 }}>
              <Text style={st.mnemonic} selectable>{revealed}</Text>
            </Card>
            <Btn label="Hide" variant="secondary" onPress={() => setRevealed(null)} />
          </View>
        )}

        {/* ── Connections ── */}
        <SectionLabel text="Connections" style={{ marginTop: 18, marginBottom: 6 } as object} />
        <Card>
          <Row label="Connected dApps" hint="WalletConnect sessions and pairing" onPress={onDapps} />
        </Card>

        {/* ── Preferences (display currency / theme land here next) ── */}
        <SectionLabel text="Preferences" style={{ marginTop: 18, marginBottom: 6 } as object} />
        <Card>
          <Row label="Display currency" hint="More currencies coming soon" right="USD" />
          <View style={st.hairline} />
          <Row label="Theme" hint="Light theme coming soon" right="Dark" />
        </Card>

        {/* ── Danger zone ── */}
        <SectionLabel text="Danger zone" style={{ marginTop: 18, marginBottom: 6 } as object} />
        <Card style={{ padding: 14 }}>
          <Text style={st.rowHint}>
            Removing the wallet deletes every key from this phone. The recovery
            phrase is the ONLY way back in.
          </Text>
          <Btn
            label={confirmWipe ? "Tap again to remove everything" : "Remove all wallets from this device"}
            variant="danger"
            onPress={() => (confirmWipe ? onWipe() : setConfirmWipe(true))}
          />
        </Card>

        <Pressable
          onPress={() => {
            // 5 taps on the version footer opens the hidden developer screen.
            (SettingsScreen as unknown as { _t?: number })._t =
              ((SettingsScreen as unknown as { _t?: number })._t ?? 0) + 1;
            if (((SettingsScreen as unknown as { _t?: number })._t ?? 0) >= 5) {
              (SettingsScreen as unknown as { _t?: number })._t = 0;
              onDev();
            }
          }}
        >
          <Text style={st.version}>NumPay · v0.1.0</Text>
        </Pressable>
        <View style={{ height: 20 }} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  rowLabel: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "500" },
  rowHint: { color: colors.muted, fontSize: ts.small, marginTop: 2, lineHeight: 15 },
  rowRight: { color: colors.brand2, fontSize: ts.body, fontWeight: "600", marginRight: 8 },
  rowChevron: { color: colors.muted2, fontSize: 18, marginLeft: 2 },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: "rgba(42, 36, 80, 0.7)",
    marginHorizontal: 14,
  },

  walletRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
  walletDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "rgba(42, 36, 80, 0.7)",
  },
  walletMain: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  radioOn: { borderColor: colors.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  walletAction: { paddingHorizontal: 8, paddingVertical: 4 },
  walletActionText: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },

  mnemonic: { color: colors.textPrimary, fontSize: 15, lineHeight: 24, fontFamily: "monospace" },
  version: {
    color: colors.muted2, fontSize: ts.label, textAlign: "center",
    paddingVertical: 24, letterSpacing: 0.4,
  },
});
