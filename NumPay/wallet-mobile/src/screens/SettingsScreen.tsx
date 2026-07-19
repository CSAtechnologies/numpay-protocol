// Settings — the nav's sixth tab, mirroring the extension Settings page at
// mobile scope: Accounts (the multi-wallet switcher: list, switch, rename,
// remove, add), Security (lock, reveal recovery phrase), Connections (dApps),
// and the danger zone. The version row is the hidden developer-tools entry.
import { useCallback, useEffect, useState } from "react";
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  listWallets, renameWallet, removeWallet, getActiveMnemonic, setWalletAvatar,
  type WalletMeta,
} from "../vault/mobileVault";
import { CURRENCIES } from "@numpay/core/currency";
import { colors, radius, type as ts } from "../ui/theme";
import { AlertCard, Btn, Card, Field, ScreenHeader, SectionLabel } from "../ui/components";
import { WalletAvatar, EmojiPicker } from "../ui/WalletAvatar";
import { useCurrencyPref } from "../ui/currency";

function shortAddr(a?: string): string {
  return a && a.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a ?? "");
}

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
  const [emojiTargetId, setEmojiTargetId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  const [confirmWipe, setConfirmWipe] = useState(false);
  const cur = useCurrencyPref();
  const [showCurrency, setShowCurrency] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");
  const filteredCurrencies = CURRENCIES.filter((c) => {
    const q = currencySearch.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.code.includes(q) || c.symbol.toLowerCase().includes(q);
  });

  const reload = useCallback(() => { listWallets().then(setWallets).catch(() => {}); }, []);
  useEffect(() => { reload(); }, [reload, activeWalletId]);

  const emojiTarget = wallets.find((w) => w.id === emojiTargetId) ?? null;

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
                  {/* Avatar — tap to pick an emoji (extension parity) */}
                  <Pressable hitSlop={6} onPress={() => setEmojiTargetId(m.id)} style={{ marginRight: 10 }}>
                    <WalletAvatar avatar={m.avatar} name={m.name} size={34} active={m.active} />
                  </Pressable>
                  <Pressable style={st.walletMain} onPress={() => onSwitchWallet(m.id)}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.rowLabel}>{m.name}</Text>
                      <Text style={st.rowHint} numberOfLines={1}>{shortAddr(m.evmAddress)}</Text>
                    </View>
                  </Pressable>
                  <View style={{ alignItems: "flex-end" }}>
                    {m.active ? (
                      <Text style={[st.walletActionText, { color: colors.muted }]}>Active</Text>
                    ) : (
                      <Pressable hitSlop={8} onPress={() => onSwitchWallet(m.id)}>
                        <Text style={st.walletActionText}>Switch</Text>
                      </Pressable>
                    )}
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                      <Pressable hitSlop={6} onPress={() => { setRenaming(m.id); setRenameVal(m.name); }}>
                        <Text style={st.walletSubAction}>Rename</Text>
                      </Pressable>
                      {wallets.length > 1 && (
                        <Pressable hitSlop={6} onPress={() => doRemove(m)}>
                          <Text style={[st.walletSubAction, { color: colors.danger }]}>Remove</Text>
                        </Pressable>
                      )}
                    </View>
                  </View>
                </>
              )}
            </View>
          ))}
        </Card>
        {emojiTarget && (
          <EmojiPicker
            walletName={emojiTarget.name}
            current={emojiTarget.avatar}
            onPick={async (emoji) => { await setWalletAvatar(emojiTarget.id, emoji); setEmojiTargetId(null); reload(); }}
            onClose={() => setEmojiTargetId(null)}
          />
        )}
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

        {/* ── Preferences ── */}
        <SectionLabel text="Preferences" style={{ marginTop: 18, marginBottom: 6 } as object} />
        <Card>
          <Row
            label="Display currency"
            hint="Prices and balances show in this currency"
            right={`${cur.currency?.flag ? cur.currency.flag + " " : ""}${cur.currency?.symbol ?? cur.code.toUpperCase()}`}
            onPress={() => { setShowCurrency((v) => !v); setCurrencySearch(""); }}
          />
          <View style={st.hairline} />
          <Row label="Theme" hint="Light theme coming soon" right="Dark" />
        </Card>
        {showCurrency && (
          <Card style={{ marginTop: 8, maxHeight: 320 }}>
            <View style={{ padding: 10 }}>
              <Field placeholder="Search currencies…" value={currencySearch} onChangeText={setCurrencySearch} />
            </View>
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {filteredCurrencies.map((c) => (
                <Pressable
                  key={c.code}
                  style={st.curRow}
                  onPress={() => { cur.setCode(c.code); setShowCurrency(false); }}
                >
                  <Text style={st.curFlag}>{c.flag ?? "🪙"}</Text>
                  <View style={{ flex: 1 }}>
                    <Text style={st.rowLabel}>{c.name}</Text>
                    <Text style={st.rowHint}>{c.code.toUpperCase()}</Text>
                  </View>
                  <Text style={[st.curSym, cur.code === c.code && { color: colors.brand2 }]}>{c.symbol}</Text>
                </Pressable>
              ))}
              {filteredCurrencies.length === 0 && (
                <Text style={[st.rowHint, { textAlign: "center", padding: 16 }]}>No currencies found</Text>
              )}
            </ScrollView>
          </Card>
        )}

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
    backgroundColor: colors.divider,
    marginHorizontal: 14,
  },

  walletRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
  walletDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
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
  walletSubAction: { color: colors.muted, fontSize: ts.small, fontWeight: "500" },

  curRow: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingHorizontal: 14, paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider,
  },
  curFlag: { fontSize: 22 },
  curSym: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "600" },
  mnemonic: { color: colors.textPrimary, fontSize: 15, lineHeight: 24, fontFamily: "monospace" },
  version: {
    color: colors.muted2, fontSize: ts.label, textAlign: "center",
    paddingVertical: 24, letterSpacing: 0.4,
  },
});
