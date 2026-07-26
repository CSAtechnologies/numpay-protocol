// Re-authentication gate for revealing a secret out of an ALREADY-UNLOCKED
// vault. The extension gates the same reveal behind a password re-entry
// (Settings.tsx RevealPrompt → decryptVault, then a 30 s auto-hide); mobile's
// credential is the 6-digit PIN, so this is the PinPad plus the biometric key
// where it is enrolled.
//
// Why an unlocked vault still asks: unlocking proves who opened the app,
// possibly 15 minutes ago. Handing over the recovery phrase — the one secret
// that IS the wallet, on every device forever — is worth its own proof. An
// unlocked phone on a desk must not be enough.
//
// The gate never sees the secret. It reports success and the caller fetches.
import { useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  VaultError, getStatus, verifyBiometrics, verifyPin,
} from "../vault/mobileVault";
import { colors, spacing, type as ts } from "./theme";
import { AlertCard, ScreenHeader } from "./components";
import { PinPad } from "./PinPad";

export function RevealGate({ title, body, onPass, onCancel }: {
  /** What is about to be revealed, e.g. "Reveal recovery phrase". */
  title: string;
  /** One line on why this is sensitive. */
  body: string;
  onPass: () => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState("");
  const [shake, setShake] = useState(0);
  const [busy, setBusy] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(false);
  const [lockUntil, setLockUntil] = useState(0);
  const [now, setNow] = useState(Date.now());
  // The gate can outlive its own verification (a slow argon2 stretch, then the
  // user backs out); resolving after unmount must not call onPass.
  const live = useRef(true);
  useEffect(() => () => { live.current = false; }, []);

  useEffect(() => {
    getStatus()
      .then((s) => {
        if (!live.current) return;
        setBioEnabled(s.biometricsEnabled);
        setLockUntil(s.lockUntil);
      })
      .catch(() => {});
  }, []);

  // Drives the lockout countdown, same as the cold lock screen's.
  useEffect(() => {
    if (lockUntil <= Date.now()) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [lockUntil]);

  const lockedFor = Math.max(0, Math.ceil((lockUntil - now) / 1000));

  const submitPin = async (pin: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await verifyPin(pin);
      if (!live.current) return;
      if (ok) { onPass(); return; }
      // verifyPin feeds the shared backoff counter, so re-read it to show the
      // same lockout the lock screen would.
      const s = await getStatus();
      if (!live.current) return;
      setLockUntil(s.lockUntil);
      setError(s.lockUntil > Date.now() ? "Too many attempts." : "Wrong PIN.");
      setShake((n) => n + 1);
    } catch (e) {
      if (!live.current) return;
      if (e instanceof VaultError && e.code === "locked") {
        setLockUntil(e.lockUntil ?? 0);
        setError("Too many attempts.");
      } else {
        setError(String((e as Error)?.message ?? e));
      }
      setShake((n) => n + 1);
    } finally {
      if (live.current) setBusy(false);
    }
  };

  const submitBio = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const ok = await verifyBiometrics("Reveal recovery phrase");
      if (!live.current) return;
      if (ok) onPass();
      else setError("Biometric check failed or was cancelled.");
    } finally {
      if (live.current) setBusy(false);
    }
  };

  return (
    <View style={st.overlay}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader title={title} onBack={onCancel} />
        <AlertCard tone="amber" title="Confirm it's you" body={body} style={{ marginBottom: 14 }} />
        {lockedFor > 0 ? (
          <AlertCard
            tone="danger"
            title="Locked out"
            body={`Too many attempts. Try again in ${
              lockedFor >= 60 ? `${Math.ceil(lockedFor / 60)} min` : `${lockedFor} s`
            }.`}
          />
        ) : (
          <PinPad
            onComplete={(pin) => { void submitPin(pin); }}
            onChangeLength={() => setError("")}
            shakeToken={shake}
            disabled={busy}
            showBiometrics={bioEnabled}
            onBiometrics={() => { void submitBio(); }}
          />
        )}
        {!!error && <Text style={st.err}>{error}</Text>}
        <Pressable onPress={onCancel} hitSlop={8} style={st.cancel}>
          <Text style={st.cancelText}>Cancel</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  overlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    paddingTop: 56,
    paddingHorizontal: spacing.screen,
    zIndex: 20,
  },
  err: { color: colors.danger, fontSize: ts.body, marginTop: 10, textAlign: "center" },
  cancel: { alignSelf: "center", paddingVertical: 18 },
  cancelText: { color: colors.muted, fontSize: ts.body, fontWeight: "500" },
});
