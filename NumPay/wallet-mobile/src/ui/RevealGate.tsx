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
// Presented as a Sheet rather than a full-screen takeover. It used to replace
// the whole Settings page and open with an amber warning card, which read as
// "something has gone wrong" when in fact nothing had: the user asked for this
// and is being asked to confirm. A sheet over the page they were on says that
// much more honestly, and keeps the context they came from visible behind it.
//
// The gate never sees the secret. It reports success and the caller fetches.
import { useEffect, useRef, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import {
  VaultError, getStatus, verifyBiometrics, verifyPin,
} from "../vault/mobileVault";
import { colors, type as ts } from "./theme";
import { Sheet } from "./Sheet";
import { Notice } from "./components";
import { ShieldIcon } from "./icons";
import { PinPad } from "./PinPad";

export function RevealGate({ open, title, body, onPass, onCancel }: {
  /** Kept MOUNTED and toggled, so the sheet can animate out on cancel rather
   *  than blinking away the instant the parent stops rendering it. */
  open: boolean;
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

  // Re-read on every OPEN, not once on mount: the gate now outlives a single
  // use, and a lockout earned on the previous attempt has to be reflected the
  // next time it opens.
  useEffect(() => {
    if (!open) { setError(""); return; }
    getStatus()
      .then((s) => {
        if (!live.current) return;
        setBioEnabled(s.biometricsEnabled);
        setLockUntil(s.lockUntil);
      })
      .catch(() => {});
  }, [open]);

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
    <Sheet
      open={open}
      onClose={onCancel}
      // "Confirm it's you" is the ASK, so it is the sheet's title rather than
      // the headline of a warning card sitting under a page header.
      title="Confirm it's you"
      body={body}
      tone="caution"
      icon={<ShieldIcon size={21} color={colors.caution} />}
    >
      <Text style={st.what}>{title}</Text>

      {lockedFor > 0 ? (
        <Notice
          tone="danger"
          title="Locked out"
          body={`Too many attempts. Try again in ${
            lockedFor >= 60 ? `${Math.ceil(lockedFor / 60)} min` : `${lockedFor} s`
          }.`}
          style={{ marginTop: 14 }}
        />
      ) : (
        <View style={{ marginTop: 6 }}>
          <PinPad
            onComplete={(pin) => { void submitPin(pin); }}
            onChangeLength={() => setError("")}
            shakeToken={shake}
            disabled={busy}
            showBiometrics={bioEnabled}
            onBiometrics={() => { void submitBio(); }}
          />
        </View>
      )}

      {/* Reserved height, so a wrong PIN colours a line already in the layout
          instead of growing the sheet under the user's thumb mid-retry. */}
      <View style={st.errSlot}>
        {!!error && <Text style={st.err}>{error}</Text>}
      </View>

      <Pressable onPress={onCancel} hitSlop={8} style={st.cancel} accessibilityRole="button">
        <Text style={st.cancelText}>Cancel</Text>
      </Pressable>
    </Sheet>
  );
}

const st = StyleSheet.create({
  what: {
    color: colors.muted,
    fontSize: ts.small,
    fontWeight: "600",
    letterSpacing: 0.3,
    marginTop: 14,
  },
  errSlot: { minHeight: 22, justifyContent: "center" },
  err: { color: colors.dangerText, fontSize: ts.body, textAlign: "center", fontWeight: "600" },
  cancel: { alignSelf: "center", paddingVertical: 10, paddingHorizontal: 24 },
  cancelText: { color: colors.muted, fontSize: ts.body, fontWeight: "600" },
});
