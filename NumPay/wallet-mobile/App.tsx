// Phase 0 skeleton: create/import wallet → 6-digit PIN (+ optional biometrics)
// → Keystore-backed dual-wrapped vault → unlock with backoff → home.
// Deliberately minimal UI; the point is the vault/auth machinery and the
// on-device core spike, not product design. FLAG_SECURE on secret screens is
// a follow-up (needs expo-screen-capture or a config plugin).
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useState } from "react";
import {
  Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View,
} from "react-native";

import { createWallet, importFromMnemonic } from "@numpay/core/wallet";
import {
  createVault, getLastArgonMs, getStatus, getUnlockedMnemonic, lock,
  autoLockCheck, touchActivity, unlockWithBiometrics, unlockWithPin,
  VaultError, wipeVault, type VaultStatus,
} from "./src/vault/mobileVault";
import { runSpike, type SpikeResult } from "./spike/runSpike";

type Mode = "loading" | "onboard" | "import" | "reveal" | "pin" | "locked" | "home" | "spike";

export default function App() {
  const [mode, setMode] = useState<Mode>("loading");
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [pendingMnemonic, setPendingMnemonic] = useState("");
  const [evmAddress, setEvmAddress] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now()); // drives the lockout countdown

  const refresh = useCallback(async () => {
    const s = await getStatus();
    setStatus(s);
    const mn = await getUnlockedMnemonic();
    if (mn) {
      setEvmAddress(importFromMnemonic(mn).address);
      setMode("home");
    } else {
      setMode(s.exists ? "locked" : "onboard");
    }
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const auto = setInterval(() => {
      autoLockCheck().then((locked) => { if (locked) refresh(); });
    }, 30_000);
    return () => { clearInterval(tick); clearInterval(auto); };
  }, [refresh]);

  const onUnlocked = async () => {
    setError("");
    await touchActivity();
    await refresh();
  };

  return (
    <View style={st.container}>
      <StatusBar style="light" />
      <Text style={st.title}>NumPay</Text>
      {mode === "loading" && <Text style={st.dim}>loading…</Text>}
      {mode === "onboard" && (
        <Onboard
          onCreate={() => { setPendingMnemonic(createWallet().mnemonic); setMode("reveal"); }}
          onImport={() => { setError(""); setMode("import"); }}
        />
      )}
      {mode === "import" && (
        <Import
          error={error}
          onBack={() => setMode("onboard")}
          onSubmit={(phrase) => {
            try {
              const w = importFromMnemonic(phrase);
              setPendingMnemonic(w.mnemonic);
              setError("");
              setMode("pin");
            } catch {
              setError("That doesn't look like a valid recovery phrase.");
            }
          }}
        />
      )}
      {mode === "reveal" && (
        <Reveal mnemonic={pendingMnemonic} onNext={() => setMode("pin")} />
      )}
      {mode === "pin" && (
        <PinSetup
          bioAvailable={status?.biometricsAvailable ?? false}
          error={error}
          onSubmit={async (pin, enableBio) => {
            try {
              await createVault(pendingMnemonic, pin, enableBio);
              setPendingMnemonic("");
              await onUnlocked();
            } catch (e) {
              setError(String(e));
            }
          }}
        />
      )}
      {mode === "locked" && status && (
        <Locked
          status={status}
          now={now}
          error={error}
          onPin={async (pin) => {
            try {
              await unlockWithPin(pin);
              await onUnlocked();
            } catch (e) {
              if (e instanceof VaultError) {
                setError(
                  e.code === "locked" || (e.code === "wrong-pin" && e.lockUntil)
                    ? "Too many attempts."
                    : `Wrong PIN (${e.failedAttempts} failed).`
                );
              } else setError(String(e));
              setStatus(await getStatus());
            }
          }}
          onBio={async () => {
            try {
              await unlockWithBiometrics();
              await onUnlocked();
            } catch (e) {
              setError(e instanceof VaultError ? e.message : String(e));
            }
          }}
        />
      )}
      {mode === "home" && (
        <Home
          evmAddress={evmAddress}
          argonMs={getLastArgonMs()}
          onLock={async () => { await lock(); setError(""); await refresh(); }}
          onSpike={() => setMode("spike")}
          onWipe={async () => { await wipeVault(); setError(""); await refresh(); }}
        />
      )}
      {mode === "spike" && <Spike onBack={() => setMode("home")} />}
    </View>
  );
}

function Onboard(p: { onCreate: () => void; onImport: () => void }) {
  return (
    <View>
      <Text style={st.h2}>Set up your wallet</Text>
      <Btn label="Create new wallet" onPress={p.onCreate} />
      <Btn label="Import recovery phrase" onPress={p.onImport} secondary />
    </View>
  );
}

function Import(p: { error: string; onBack: () => void; onSubmit: (phrase: string) => void }) {
  const [phrase, setPhrase] = useState("");
  return (
    <View>
      <Text style={st.h2}>Import wallet</Text>
      <TextInput
        style={[st.input, { height: 90 }]}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Recovery phrase (12 or 24 words)"
        placeholderTextColor="#666"
        value={phrase}
        onChangeText={setPhrase}
      />
      {!!p.error && <Text style={st.err}>{p.error}</Text>}
      <Btn label="Continue" onPress={() => p.onSubmit(phrase.trim())} />
      <Btn label="Back" onPress={p.onBack} secondary />
    </View>
  );
}

function Reveal(p: { mnemonic: string; onNext: () => void }) {
  return (
    <View>
      <Text style={st.h2}>Your recovery phrase</Text>
      <Text style={st.warn}>
        Write these words down in order and keep them offline. Your PIN only
        unlocks this phone's copy. This phrase IS the wallet.
      </Text>
      <View style={st.mnemonicBox}>
        <Text style={st.mnemonic}>{p.mnemonic}</Text>
      </View>
      <Btn label="I saved it, continue" onPress={p.onNext} />
    </View>
  );
}

function PinSetup(p: {
  bioAvailable: boolean;
  error: string;
  onSubmit: (pin: string, enableBio: boolean) => void;
}) {
  const [pin, setPin] = useState("");
  const [pin2, setPin2] = useState("");
  const [bio, setBio] = useState(p.bioAvailable);
  const [localErr, setLocalErr] = useState("");
  return (
    <View>
      <Text style={st.h2}>Choose a 6-digit PIN</Text>
      <PinInput value={pin} onChange={setPin} placeholder="PIN" />
      <PinInput value={pin2} onChange={setPin2} placeholder="Repeat PIN" />
      {p.bioAvailable && (
        <View style={st.rowBetween}>
          <Text style={st.body}>Biometric unlock</Text>
          <Switch value={bio} onValueChange={setBio} />
        </View>
      )}
      {!!(localErr || p.error) && <Text style={st.err}>{localErr || p.error}</Text>}
      <Btn
        label="Create vault"
        onPress={() => {
          if (!/^\d{6}$/.test(pin)) return setLocalErr("PIN must be exactly 6 digits.");
          if (pin !== pin2) return setLocalErr("PINs don't match.");
          setLocalErr("");
          p.onSubmit(pin, bio);
        }}
      />
    </View>
  );
}

function Locked(p: {
  status: { biometricsEnabled: boolean; lockUntil: number; failedAttempts: number };
  now: number;
  error: string;
  onPin: (pin: string) => void;
  onBio: () => void;
}) {
  const [pin, setPin] = useState("");
  const lockedFor = Math.max(0, Math.ceil((p.status.lockUntil - p.now) / 1000));
  return (
    <View>
      <Text style={st.h2}>Welcome back</Text>
      <PinInput value={pin} onChange={setPin} placeholder="6-digit PIN" />
      {!!p.error && <Text style={st.err}>{p.error}</Text>}
      {lockedFor > 0 ? (
        <Text style={st.warn}>
          Locked out. Try again in {lockedFor >= 60 ? `${Math.ceil(lockedFor / 60)} min` : `${lockedFor} s`}.
        </Text>
      ) : (
        <Btn label="Unlock" onPress={() => { p.onPin(pin); setPin(""); }} />
      )}
      {p.status.biometricsEnabled && <Btn label="Use biometrics" onPress={p.onBio} secondary />}
    </View>
  );
}

function Home(p: {
  evmAddress: string;
  argonMs: number | null;
  onLock: () => void;
  onSpike: () => void;
  onWipe: () => void;
}) {
  const [confirmWipe, setConfirmWipe] = useState(false);
  return (
    <View>
      <Text style={st.h2}>Unlocked</Text>
      <Text style={st.dim}>EVM address</Text>
      <Text style={st.mono}>{p.evmAddress}</Text>
      {p.argonMs !== null && (
        <Text style={st.dim}>argon2id PIN stretch: {p.argonMs} ms on this device</Text>
      )}
      <Btn label="Lock" onPress={p.onLock} />
      <Btn label="Run core spike" onPress={p.onSpike} secondary />
      <Btn
        label={confirmWipe ? "Tap again to WIPE vault (seed is the only recovery)" : "Wipe vault (dev)"}
        onPress={() => (confirmWipe ? p.onWipe() : setConfirmWipe(true))}
        danger
      />
    </View>
  );
}

function Spike(p: { onBack: () => void }) {
  const [results, setResults] = useState<SpikeResult[] | null>(null);
  useEffect(() => {
    runSpike().then(setResults).catch((e) => {
      setResults([{ name: "spike crashed", pass: false, detail: String(e) }]);
    });
  }, []);
  const failed = results?.filter((r) => !r.pass).length ?? 0;
  return (
    <View style={{ flex: 1 }}>
      <Text style={st.h2}>Core spike</Text>
      {!results ? (
        <Text style={st.dim}>running…</Text>
      ) : (
        <Text style={failed === 0 ? st.ok : st.err}>
          {failed === 0 ? `ALL ${results.length} CHECKS PASSED` : `${failed}/${results.length} FAILED`}
        </Text>
      )}
      <ScrollView style={{ marginTop: 8, flex: 1 }}>
        {results?.map((r) => (
          <Text key={r.name} style={r.pass ? st.ok : st.err}>
            {r.pass ? "PASS" : "FAIL"} {r.name}
          </Text>
        ))}
      </ScrollView>
      <Btn label="Back" onPress={p.onBack} secondary />
    </View>
  );
}

function PinInput(p: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <TextInput
      style={st.input}
      keyboardType="number-pad"
      secureTextEntry
      maxLength={6}
      placeholder={p.placeholder}
      placeholderTextColor="#666"
      value={p.value}
      onChangeText={(v) => p.onChange(v.replace(/\D/g, ""))}
    />
  );
}

function Btn(p: { label: string; onPress: () => void; secondary?: boolean; danger?: boolean }) {
  return (
    <Pressable
      style={[st.btn, p.secondary && st.btnSecondary, p.danger && st.btnDanger]}
      onPress={p.onPress}
    >
      <Text style={st.btnText}>{p.label}</Text>
    </Pressable>
  );
}

const st = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#12101c", paddingTop: 60, paddingHorizontal: 20 },
  title: { color: "#c9beff", fontSize: 22, fontWeight: "700", marginBottom: 16 },
  h2: { color: "#e5e1ff", fontSize: 18, fontWeight: "600", marginBottom: 12 },
  body: { color: "#e5e1ff", fontSize: 15 },
  dim: { color: "#8b87a0", fontSize: 13, marginTop: 8 },
  mono: { color: "#e5e1ff", fontFamily: "monospace", fontSize: 13, marginTop: 2 },
  ok: { color: "#4ade80", fontSize: 13 },
  err: { color: "#f87171", fontSize: 14, marginTop: 8 },
  warn: { color: "#fbbf24", fontSize: 14, marginVertical: 8, lineHeight: 20 },
  mnemonicBox: { backgroundColor: "#1e1a30", borderRadius: 12, padding: 14, marginVertical: 10 },
  mnemonic: { color: "#e5e1ff", fontSize: 16, lineHeight: 26, fontFamily: "monospace" },
  input: {
    backgroundColor: "#1e1a30", color: "#e5e1ff", borderRadius: 10,
    paddingHorizontal: 14, paddingVertical: 12, fontSize: 16, marginTop: 10,
  },
  rowBetween: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14,
  },
  btn: {
    backgroundColor: "#7c6cf1", borderRadius: 12, paddingVertical: 14,
    alignItems: "center", marginTop: 14,
  },
  btnSecondary: { backgroundColor: "#2a2542" },
  btnDanger: { backgroundColor: "#5b1f2b" },
  btnText: { color: "#fff", fontSize: 16, fontWeight: "600" },
});
