// Connected dApps screen. Two ways in, one place to see and revoke them:
//   • WalletConnect sessions (paired by QR or a `wc:` link), and
//   • sites connected in the in-app browser, which grant a per-ORIGIN
//     permission rather than a session.
// They are different mechanisms, but from the user's side both are "a site can
// see my address and ask me to sign", so both belong on this screen. Somewhere
// you cannot revoke a connection is somewhere connections quietly accumulate.
//
// The approval sheets themselves live in WcApprovalHost (mounted app-wide) and
// BrowserScreen; this screen only starts pairings and lists the results.
import { useCallback, useEffect, useRef, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { listOrigins, revoke, type OriginPermission } from "@numpay/core/dapp";
import { colors, radius, type as ts } from "../ui/theme";
import { Notice, Btn, Card, Field, ScreenHeader, SectionLabel } from "../ui/components";
import { displayHost } from "../browser/session";
import { hasProjectId } from "../walletconnect/config";
import { disconnectSession, pair } from "../walletconnect/client";
import {
  emitSessionsChanged,
  listSessions,
  subscribeSessionsChanged,
  type SessionInfo,
} from "../walletconnect/sessions";

export function WalletConnectScreen({ onBack }: { onBack: () => void }) {
  const configured = hasProjectId();
  const [uri, setUri] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<SessionInfo[]>(listSessions);
  const [scanning, setScanning] = useState(false);
  const [scanHint, setScanHint] = useState("");
  const [camPermission, requestCamPermission] = useCameraPermissions();
  // The camera fires onBarcodeScanned many times a second for the same code;
  // only the first wc: hit may start a pairing.
  const scannedRef = useRef(false);
  // Sites connected through the in-app browser (per-origin grants).
  const [sites, setSites] = useState<Array<{ origin: string } & OriginPermission>>([]);

  useEffect(() => subscribeSessionsChanged(() => setSessions(listSessions())), []);

  const reloadSites = useCallback(() => { void listOrigins().then(setSites); }, []);
  useEffect(reloadSites, [reloadSites]);

  const connect = async (raw: string) => {
    const trimmed = raw.trim();
    if (!trimmed.startsWith("wc:")) {
      setError("That doesn't look like a WalletConnect link. It starts with wc:");
      return;
    }
    setBusy(true);
    setError("");
    try {
      // A successful pair fires session_proposal; the approval sheet takes over.
      await pair(trimmed);
      setUri("");
    } catch (e) {
      setError(`Could not connect: ${String((e as Error)?.message ?? e)}`);
    } finally {
      setBusy(false);
    }
  };

  const openScanner = async () => {
    setError("");
    let granted = camPermission?.granted ?? false;
    if (!granted) granted = (await requestCamPermission()).granted;
    if (!granted) {
      setError("Camera access is off. Allow it in system settings to scan QR codes.");
      return;
    }
    scannedRef.current = false;
    setScanHint("");
    setScanning(true);
  };

  const onScanned = (data: string) => {
    if (scannedRef.current) return;
    if (!data.trim().startsWith("wc:")) {
      setScanHint("Not a WalletConnect QR code. Look for one on the dApp's connect dialog.");
      return;
    }
    scannedRef.current = true;
    setScanning(false);
    void connect(data);
  };

  if (scanning) {
    return (
      <View style={{ flex: 1 }}>
        <ScreenHeader title="Scan WalletConnect QR" onBack={() => setScanning(false)} />
        <View style={st.scanBox}>
          <CameraView
            style={{ flex: 1 }}
            facing="back"
            barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
            onBarcodeScanned={({ data }) => onScanned(String(data ?? ""))}
          />
        </View>
        <Text style={st.hint}>
          {scanHint || "Point the camera at the QR code in the dApp's WalletConnect dialog."}
        </Text>
        <Btn label="Cancel" variant="secondary" onPress={() => setScanning(false)} />
      </View>
    );
  }

  const disconnect = async (topic: string) => {
    try {
      await disconnectSession(topic);
    } finally {
      emitSessionsChanged();
    }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Connected dApps" onBack={onBack} />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {!configured && (
          <Notice
            tone="caution"
            title="WalletConnect not configured"
            body="This build has no WALLETCONNECT_PROJECT_ID (polyfills.ts). Pairing is disabled until one is set."
            style={{ marginBottom: 12 }}
          />
        )}

        <Card style={{ padding: 14, marginBottom: 14 }}>
          <SectionLabel text="Connect to a dApp" />
          <Text style={st.hint}>
            On the dApp, choose WalletConnect, then scan its QR code. Or copy the
            connection link and paste it below.
          </Text>
          <Btn
            label="Scan QR code"
            onPress={() => { void openScanner(); }}
            disabled={busy || !configured}
          />
          <Field
            placeholder="wc:…"
            autoCapitalize="none"
            autoCorrect={false}
            value={uri}
            onChangeText={setUri}
          />
          {!!error && <Text style={st.err}>{error}</Text>}
          <Btn
            label={busy ? "Connecting…" : "Connect"}
            variant="secondary"
            onPress={() => { void connect(uri); }}
            disabled={busy || !configured || !uri.trim()}
          />
        </Card>

        <SectionLabel text="Active sessions" style={{ marginBottom: 4 } as object} />
        {sessions.length === 0 && (
          <Text style={st.dim}>No dApps connected yet.</Text>
        )}
        {sessions.map((s) => (
          <Card key={s.topic} style={{ padding: 14, marginTop: 8 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
              {s.iconUrl ? (
                <Image source={{ uri: s.iconUrl }} style={st.icon} />
              ) : (
                <View style={[st.icon, st.iconFallback]}>
                  <Text style={{ color: colors.brand2, fontWeight: "700" }}>
                    {s.name.slice(0, 1).toUpperCase()}
                  </Text>
                </View>
              )}
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.name} numberOfLines={1}>{s.name}</Text>
                {!!s.url && <Text style={st.sub} numberOfLines={1}>{s.url}</Text>}
              </View>
            </View>
            {s.chainNames.length > 0 && (
              <Text style={[st.sub, { marginTop: 8 }]} numberOfLines={2}>
                {s.chainNames.join(", ")}
              </Text>
            )}
            <Btn
              label="Disconnect"
              variant="danger"
              onPress={() => { void disconnect(s.topic); }}
            />
          </Card>
        ))}

        {/* Browser-connected sites. Revoking here takes effect immediately for
            any future request; a page already open sees it the next time it
            asks for accounts. */}
        <SectionLabel text="Sites in the NumPay browser" style={{ marginTop: 18, marginBottom: 4 } as object} />
        {sites.length === 0 && (
          <Text style={st.dim}>No sites connected in the browser yet.</Text>
        )}
        {sites.map((s) => (
          <Card key={s.origin} style={{ padding: 14, marginTop: 8 }}>
            <Text style={st.name} numberOfLines={1}>{displayHost(s.origin)}</Text>
            <Text style={st.sub} numberOfLines={1}>{s.origin}</Text>
            <Text style={[st.sub, { marginTop: 6 }]} numberOfLines={1}>
              {s.account.slice(0, 10)}…{s.account.slice(-6)}
            </Text>
            <Btn
              label="Disconnect"
              variant="danger"
              onPress={() => { void revoke(s.origin).then(reloadSites); }}
            />
          </Card>
        ))}
        <View style={{ height: 30 }} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  hint: { color: colors.muted, fontSize: ts.small, lineHeight: 17, marginTop: 6 },
  scanBox: {
    flex: 1,
    borderRadius: radius.card,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#000",
  },
  dim: { color: colors.muted, fontSize: ts.row, marginTop: 8 },
  err: { color: colors.danger, fontSize: ts.body, marginTop: 8 },
  icon: { width: 36, height: 36, borderRadius: radius.tile, backgroundColor: colors.surface2 },
  iconFallback: {
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border,
  },
  name: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600" },
  sub: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
});
