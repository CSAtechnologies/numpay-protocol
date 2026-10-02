import { useState } from "react";
import { ScrollView, Text, View, useWindowDimensions } from "react-native";
import { colors, setThemePref, themedStyles, useThemeState } from "../ui/theme";
import { WalletOverview } from "../ui/WalletOverview";
import { BottomNav, BOTTOM_NAV_CLEARANCE, type NavTab } from "../ui/BottomNav";
import { Btn, EmptyState, Field, Notice, ScreenHeader, SkeletonRow, Tappable } from "../ui/components";
import { ReceiveScreen } from "../screens/ReceiveScreen";
import { PinPad } from "../ui/PinPad";
import { NumPayMark } from "../ui/NumPayLogo";
import { WalletIcon } from "../ui/icons";

type Screen = "Wallet" | "Receive" | "Unlock" | "Controls";
type Scenario = "Ready" | "Empty" | "Loading" | "Offline";

/** No vault, seed, signing, or RPC initialization is imported here. The browser
 * renders the same production UI components with explicit sample inputs. */
export default function PreviewWorkbench() {
  const { theme } = useThemeState();
  const { width } = useWindowDimensions();
  const [screen, setScreen] = useState<Screen>("Wallet");
  const [scenario, setScenario] = useState<Scenario>("Ready");
  const [phoneWidth, setPhoneWidth] = useState(390);
  const [copied, setCopied] = useState(false);
  const [message, setMessage] = useState("");
  const [shake, setShake] = useState(0);
  const [tab, setTab] = useState<NavTab>("home");
  const narrow = width < 760;
  const note = (label: string) => () => setMessage(`${label} tapped. This workbench uses sample data; use the native app for the complete flow.`);
  const navigate = (next: NavTab) => {
    setTab(next);
    if (next === "home") setScreen("Wallet");
    else if (next === "send") setScreen("Receive");
    else note(next === "bpan" ? "BPAN" : next === "activity" ? "Activity" : "Settings")();
  };
  return (
    <ScrollView style={st.page} contentContainerStyle={[st.layout, narrow && { flexDirection: "column" }]}>
      <View style={[st.sidebar, narrow && { width: "100%" }]}>
        <Text style={st.eyebrow}>NUMPAY / UI WORKBENCH</Text>
        <Text style={st.title}>Mobile preview</Text>
        <Text style={st.description}>Live React Native components. Save a UI file to refresh this preview.</Text>
        <Text style={st.label}>Screen</Text>
        <View style={st.options}>{(["Wallet", "Receive", "Unlock", "Controls"] as Screen[]).map((name) => (
          <Tappable key={name} style={[st.option, screen === name && st.selected]} onPress={() => { setScreen(name); setMessage(""); setTab(name === "Receive" ? "send" : "home"); }} accessibilityState={{ selected: screen === name }}>
            <Text style={st.optionText}>{name}</Text>
          </Tappable>
        ))}</View>
        <Text style={st.label}>Appearance</Text>
        <View style={st.options}>{(["light", "dark"] as const).map((name) => (
          <Tappable key={name} style={[st.option, theme === name && st.selected]} onPress={() => { void setThemePref(name); }} accessibilityState={{ selected: theme === name }}>
            <Text style={st.optionText}>{name === "light" ? "Light" : "Dark"}</Text>
          </Tappable>
        ))}</View>
        <Text style={st.label}>Wallet state</Text>
        <View style={st.options}>{(["Ready", "Empty", "Loading", "Offline"] as Scenario[]).map((name) => (
          <Tappable key={name} style={[st.option, scenario === name && st.selected]} onPress={() => setScenario(name)} accessibilityState={{ selected: scenario === name }}>
            <Text style={st.optionText}>{name}</Text>
          </Tappable>
        ))}</View>
        <Text style={st.label}>Width</Text>
        <View style={st.options}>{[360, 390, 430].map((size) => (
          <Tappable key={size} style={[st.option, phoneWidth === size && st.selected]} onPress={() => setPhoneWidth(size)} accessibilityLabel={`${size} pixel phone`}>
            <Text style={st.optionText}>{size}</Text>
          </Tappable>
        ))}</View>
        <Text style={st.description}>Sample balances and addresses only. Native storage, biometrics, camera, signing, Android keyboard and performance need a device check.</Text>
        {!!message && <Text style={st.message} accessibilityLiveRegion="polite">{message}</Text>}
      </View>

      <View style={[st.phone, { width: Math.min(phoneWidth, width - (narrow ? 32 : 380)) }]}>
        <View pointerEvents="none" style={st.status}><Text style={st.clock}>9:41</Text><Text style={st.clock}>UI preview</Text></View>
        <View style={{ flex: 1, paddingBottom: screen === "Unlock" ? 0 : BOTTOM_NAV_CLEARANCE }}>
          {screen === "Wallet" && <ScrollView showsVerticalScrollIndicator={false}>
            <WalletOverview walletName="Personal wallet" balance={scenario === "Empty" || scenario === "Loading" ? "$0.00" : "$12,480.50"}
              loading={scenario === "Loading"} bpan={scenario === "Ready" || scenario === "Offline" ? "1234 5678 90" : null} copied={copied}
              onAccounts={note("Wallet switcher")} onScan={note("Scanner")} onBrowser={note("Browser")}
              onSend={note("Send")} onReceive={() => { setScreen("Receive"); setTab("send"); }}
              onSwap={note("Swap")} onDeFi={note("DeFi")} onBPAN={note("BPAN")}
              onCopyBPAN={() => { setCopied(true); setMessage("Sample BPAN copy feedback. No clipboard write."); }} />
            <View style={st.screenBody}>
              {scenario === "Offline" && <Notice tone="caution" title="Couldn't refresh balances" body="Showing the last available balances. Try again when you're connected." />}
              <Text style={st.section}>Assets</Text>
              {scenario === "Loading" ? <><SkeletonRow /><SkeletonRow /><SkeletonRow /></> :
                scenario === "Empty" ? <EmptyState icon={<WalletIcon size={24} color={colors.muted} />} title="No assets yet" hint="Receive funds to get started." /> :
                <Text style={st.description}>Asset list omitted from this component preview. Portfolio, actions and payment number above are the production WalletOverview.</Text>}
            </View>
          </ScrollView>}
          {screen === "Receive" && <View style={st.focused}>
            <ReceiveScreen addrs={{ evm: "0x0000000000000000000000000000000000000000", nonEvm: null }} onBack={() => { setScreen("Wallet"); setTab("home"); }} onSend={note("Send")} />
          </View>}
          {screen === "Unlock" && <ScrollView contentContainerStyle={st.unlock}>
            <NumPayMark size={44} />
            <Text style={st.unlockTitle}>Welcome back</Text>
            <Text style={st.description}>Enter any six digits to exercise the keypad.</Text>
            <PinPad shakeToken={shake} onComplete={() => { setShake((v) => v + 1); setMessage("Six digits received. Preview reset; no wallet was unlocked."); }} />
            <Btn label="Back to wallet preview" variant="secondary" onPress={() => setScreen("Wallet")} />
          </ScrollView>}
          {screen === "Controls" && <ScrollView style={st.focused}>
            <ScreenHeader title="Shared controls" />
            <Field placeholder="Payment number or address" accessibilityLabel="Payment number or address" />
            <Btn label="Review payment" onPress={note("Review payment")} />
            <Btn label="Not enough funds" disabled onPress={() => {}} />
            <Btn label="Cancel" variant="secondary" onPress={note("Cancel")} />
            <Notice tone="danger" title="Payment wasn't sent" body="Check your connection and try again." />
            <Notice tone="success" title="Payment sent" body="Your payment is on its way." />
            <SkeletonRow />
          </ScrollView>}
        </View>
        {screen !== "Unlock" && <BottomNav active={tab} onNavigate={navigate} />}
      </View>
    </ScrollView>
  );
}

const st = themedStyles((colors) => ({
  page: { flex: 1, backgroundColor: colors.bg2 },
  layout: { flexDirection: "row", justifyContent: "center", alignItems: "flex-start", gap: 40, padding: 24 },
  sidebar: { width: 280, paddingTop: 12 },
  eyebrow: { color: colors.brand2, fontSize: 11, fontWeight: "700", letterSpacing: 1.2 },
  title: { fontSize: 28, fontWeight: "700", color: colors.textPrimary, marginTop: 12, marginBottom: 10 },
  description: { fontSize: 13, lineHeight: 21, color: colors.muted, marginBottom: 12 },
  label: { fontSize: 12, fontWeight: "600", color: colors.textSecondary, marginTop: 20, marginBottom: 8 },
  options: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
  option: { minHeight: 44, paddingHorizontal: 14, justifyContent: "center", borderRadius: 10, backgroundColor: colors.card },
  selected: { backgroundColor: colors.brandTint, borderWidth: 1, borderColor: colors.brand },
  optionText: { color: colors.textPrimary, fontSize: 13 },
  message: { color: colors.brand2, fontSize: 13, lineHeight: 20, marginTop: 12 },
  phone: { height: 844, backgroundColor: colors.bg, borderRadius: 28, overflow: "hidden", borderWidth: 1, borderColor: colors.border },
  status: { position: "absolute", top: 0, left: 0, right: 0, paddingHorizontal: 24, height: 40, flexDirection: "row", alignItems: "center", justifyContent: "space-between", zIndex: 20 },
  clock: { color: colors.textPrimary, fontSize: 11, fontWeight: "600" },
  screenBody: { paddingHorizontal: 20 },
  section: { color: colors.textPrimary, fontSize: 19, fontWeight: "600", marginVertical: 18 },
  focused: { flex: 1, paddingTop: 48, paddingHorizontal: 20 },
  unlock: { paddingTop: 100, paddingHorizontal: 20, alignItems: "center", gap: 12 },
  unlockTitle: { fontSize: 24, fontWeight: "700", color: colors.textPrimary },
}));
