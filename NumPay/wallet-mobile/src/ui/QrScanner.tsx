// One camera surface, shared by every scan entry point (dashboard, Send,
// WalletConnect). Owns the permission prompt, the viewfinder chrome and the
// duplicate-frame guard; it does NOT decide what a code means — the caller
// passes onScan and routes the payload (see core/qrPayload).
import { useEffect, useRef, useState } from "react";
import { Animated, Easing, StyleSheet, Text, View } from "react-native";
import { CameraView, useCameraPermissions } from "expo-camera";
import { colors, radius, type as ts } from "./theme";
import { Btn } from "./components";

export function QrScanner({ title, hint, onScan, onCancel }: {
  title: string;
  /** Line under the viewfinder telling the user what to point at. */
  hint: string;
  /** Return a message to REJECT the code and keep scanning; void/"" accepts. */
  onScan: (data: string) => string | void;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const [rejected, setRejected] = useState("");
  // The camera fires onBarcodeScanned many times a second for the same code;
  // only the first accepted hit may act.
  const doneRef = useRef(false);
  // Re-prompting the same rejected code every frame would strobe the message,
  // so a given payload is only reported once.
  const lastRejectedRef = useRef("");

  useEffect(() => {
    if (!permission) return;
    if (!permission.granted && permission.canAskAgain) void requestPermission();
  }, [permission, requestPermission]);

  // Sweeping scan line, purely to show the camera is live.
  const sweep = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(sweep, { toValue: 1, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
      Animated.timing(sweep, { toValue: 0, duration: 1800, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
    ]));
    loop.start();
    return () => loop.stop();
  }, [sweep]);

  const granted = permission?.granted ?? false;

  return (
    <View style={{ flex: 1 }}>
      <View style={st.box}>
        {granted ? (
          <>
            <CameraView
              style={StyleSheet.absoluteFill}
              facing="back"
              barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
              onBarcodeScanned={({ data }) => {
                if (doneRef.current) return;
                const value = String(data ?? "").trim();
                if (!value) return;
                const reject = onScan(value);
                if (reject) {
                  if (lastRejectedRef.current !== value) {
                    lastRejectedRef.current = value;
                    setRejected(reject);
                  }
                  return;
                }
                doneRef.current = true;
              }}
            />
            <View style={st.reticle} pointerEvents="none" />
            <Animated.View
              pointerEvents="none"
              style={[st.sweep, {
                transform: [{ translateY: sweep.interpolate({ inputRange: [0, 1], outputRange: [-90, 90] }) }],
              }]}
            />
          </>
        ) : (
          <View style={st.denied}>
            <Text style={st.deniedText}>
              {permission && !permission.canAskAgain
                ? "Camera access is off. Turn it on for NumPay in system settings to scan QR codes."
                : "Waiting for camera permission…"}
            </Text>
          </View>
        )}
      </View>

      <Text style={st.hint}>{rejected || hint}</Text>
      <Btn label="Cancel" variant="secondary" onPress={onCancel} />
      <View style={{ height: 12 }} />
      {/* title is rendered by the caller's ScreenHeader; kept in props so every
          scan surface names itself consistently. */}
      <Text style={st.srOnly} accessibilityLabel={title} />
    </View>
  );
}

const st = StyleSheet.create({
  box: {
    flex: 1,
    borderRadius: radius.card,
    overflow: "hidden",
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: "#000",
    alignItems: "center",
    justifyContent: "center",
  },
  reticle: {
    width: 210, height: 210,
    borderRadius: radius.card,
    borderWidth: 2,
    borderColor: colors.brand2,
    opacity: 0.9,
  },
  sweep: {
    position: "absolute",
    width: 190, height: 2,
    borderRadius: 1,
    backgroundColor: colors.brand2,
    opacity: 0.75,
  },
  denied: { padding: 24 },
  deniedText: { color: "#fff", fontSize: ts.row, textAlign: "center", lineHeight: 20 },
  hint: { color: colors.muted, fontSize: ts.small, lineHeight: 17, marginTop: 10, marginBottom: 4 },
  srOnly: { height: 0 },
});
