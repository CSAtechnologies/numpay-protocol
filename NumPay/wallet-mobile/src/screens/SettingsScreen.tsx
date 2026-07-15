// Settings — the nav's sixth tab, mirroring the extension Settings page's
// role at mobile scope: lock, the entry points that used to hide in the
// header, and the danger zone. The version row doubles as the hidden
// developer-tools entry (5 taps), the same convention real wallets use.
import { useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, type as ts } from "../ui/theme";
import { Btn, Card, ScreenHeader, SectionLabel } from "../ui/components";

function Row({ label, hint, onPress, danger }: {
  label: string;
  hint?: string;
  onPress: () => void;
  danger?: boolean;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [st.row, pressed && { opacity: 0.7 }]}>
      <View style={{ flex: 1 }}>
        <Text style={[st.rowLabel, danger && { color: colors.danger }]}>{label}</Text>
        {!!hint && <Text style={st.rowHint}>{hint}</Text>}
      </View>
      <Text style={st.rowChevron}>{"›"}</Text>
    </Pressable>
  );
}

export function SettingsScreen({ onLock, onDapps, onDev, onWipe }: {
  onLock: () => void;
  onDapps: () => void;
  onDev: () => void;
  onWipe: () => void;
}) {
  const [confirmWipe, setConfirmWipe] = useState(false);
  const devTaps = useRef(0);
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Settings" />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <SectionLabel text="Security" style={{ marginTop: 6, marginBottom: 6 } as object} />
        <Card>
          <Row label="Lock wallet" hint="Requires your PIN or biometrics to reopen" onPress={onLock} />
        </Card>

        <SectionLabel text="Connections" style={{ marginTop: 18, marginBottom: 6 } as object} />
        <Card>
          <Row label="Connected dApps" hint="WalletConnect sessions and pairing" onPress={onDapps} />
        </Card>

        <SectionLabel text="Danger zone" style={{ marginTop: 18, marginBottom: 6 } as object} />
        <Card style={{ padding: 14 }}>
          <Text style={st.rowHint}>
            Removing the wallet deletes its keys from this phone. The recovery
            phrase is the ONLY way back in.
          </Text>
          <Btn
            label={confirmWipe ? "Tap again to remove wallet" : "Remove wallet from this device"}
            variant="danger"
            onPress={() => (confirmWipe ? onWipe() : setConfirmWipe(true))}
          />
        </Card>

        <Pressable
          onPress={() => {
            devTaps.current += 1;
            if (devTaps.current >= 5) { devTaps.current = 0; onDev(); }
          }}
        >
          <Text style={st.version}>NumPay · v0.1.0</Text>
        </Pressable>
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
  rowChevron: { color: colors.muted2, fontSize: 18, marginLeft: 10 },
  version: {
    color: colors.muted2, fontSize: ts.label, textAlign: "center",
    paddingVertical: 26, letterSpacing: 0.4,
  },
});
