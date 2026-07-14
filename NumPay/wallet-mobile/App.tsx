// NumPay mobile shell: create/import wallet → 6-digit PIN (+ optional
// biometrics) → Keystore-backed dual-wrapped vault → unlock with backoff →
// dashboard / receive / send. Visuals come from src/ui (the extension's design
// tokens + shared components); the vault/auth machinery is unchanged from
// Phase 0. FLAG_SECURE on secret screens is a follow-up (needs
// expo-screen-capture or a config plugin).
import { StatusBar } from "expo-status-bar";
import { useCallback, useEffect, useRef, useState } from "react";
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { createWallet, importFromMnemonic } from "@numpay/core/wallet";
import { formatBPAN } from "@numpay/core/bpan";
import {
  createVault, getLastArgonMs, getStatus, getUnlockedMnemonic, lock,
  autoLockCheck, touchActivity, unlockWithBiometrics, unlockWithPin,
  VaultError, wipeVault, type VaultStatus,
} from "./src/vault/mobileVault";
import { runSpike, type SpikeResult } from "./spike/runSpike";
import { runDevnetTx } from "./spike/devnetTx";
import { useMobileWallet, type AssetRow, type MobileWalletState } from "./src/wallet/useMobileWallet";
import { colors, radius, type as ts, spacing } from "./src/ui/theme";
import { AlertCard, Btn, Chip, Card, Field, ScreenHeader, SectionLabel } from "./src/ui/components";
import { AssetIcon, ChainBadge, ChainIcon } from "./src/ui/coins";
import { ReceiveScreen, type ReceiveAddrs } from "./src/screens/ReceiveScreen";
import { SendScreen } from "./src/screens/SendScreen";
import { SwapScreen } from "./src/screens/SwapScreen";
import { BridgeScreen } from "./src/screens/BridgeScreen";
import { ActivityScreen } from "./src/screens/ActivityScreen";
import { BPANScreen } from "./src/screens/BPANScreen";
import { WalletConnectScreen } from "./src/screens/WalletConnectScreen";
import { WcApprovalHost } from "./src/walletconnect/WcApprovalHost";

type Mode =
  | "loading" | "onboard" | "import" | "reveal" | "pin" | "locked" | "home"
  | "spike" | "devnet" | "receive" | "send" | "swap" | "bridge" | "activity" | "bpan" | "dapps";

export default function App() {
  const [mode, setMode] = useState<Mode>("loading");
  const [receiveAddrs, setReceiveAddrs] = useState<ReceiveAddrs | null>(null);
  const [status, setStatus] = useState<VaultStatus | null>(null);
  const [pendingMnemonic, setPendingMnemonic] = useState("");
  const [error, setError] = useState("");
  const [now, setNow] = useState(Date.now()); // drives the lockout countdown
  // Session expired while a wallet screen was open. Rendered as an opaque
  // overlay ON TOP of the mounted tree instead of swapping mode: the mnemonic
  // is already wiped from RAM (only non-secret screen state survives), and
  // after re-auth the user resumes exactly where they were — a mid-send
  // expiry used to silently unmount the form and its error card.
  const [relocked, setRelocked] = useState(false);

  const unlocked =
    mode === "home" || mode === "receive" || mode === "send" || mode === "swap" || mode === "bridge" || mode === "activity" || mode === "bpan" || mode === "dapps";
  const w = useMobileWallet(unlocked);
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;

  const refresh = useCallback(async () => {
    const s = await getStatus();
    setStatus(s);
    const mn = await getUnlockedMnemonic();
    if (mn) setMode("home");
    else setMode(s.exists ? "locked" : "onboard");
  }, []);

  const showRelock = useCallback(async () => {
    setStatus(await getStatus());
    setRelocked(true);
  }, []);

  useEffect(() => {
    refresh().catch((e) => setError(String(e)));
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const auto = setInterval(() => {
      autoLockCheck().then((locked) => {
        if (!locked) return;
        if (unlockedRef.current) showRelock();
        else refresh();
      });
    }, 30_000);
    return () => { clearInterval(tick); clearInterval(auto); };
  }, [refresh, showRelock]);

  // Navigating counts as activity; without this the 15-min auto-lock is a
  // hard timer from unlock and fires mid-use (observed killing an in-progress
  // send).
  useEffect(() => {
    if (unlocked && !relocked) void touchActivity();
  }, [mode, unlocked, relocked]);

  const onUnlocked = async () => {
    setError("");
    await touchActivity();
    await refresh();
  };

  // Shared PIN/biometric handlers for the cold lock screen (mode "locked",
  // `after` = refresh) and the session-expiry overlay (`after` = dismiss).
  const pinUnlock = async (pin: string, after: () => void | Promise<void>) => {
    try {
      await unlockWithPin(pin);
      setError("");
      await touchActivity();
      await after();
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
  };
  const bioUnlock = async (after: () => void | Promise<void>) => {
    try {
      await unlockWithBiometrics();
      setError("");
      await touchActivity();
      await after();
    } catch (e) {
      setError(e instanceof VaultError ? e.message : String(e));
    }
  };

  return (
    <View style={st.container}>
      <StatusBar style="light" />
      {mode === "loading" && <Text style={st.dim}>loading…</Text>}
      {(mode === "onboard" || mode === "import" || mode === "reveal" || mode === "pin" || mode === "locked") && (
        <AuthHeader />
      )}
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
              const wa = importFromMnemonic(phrase);
              setPendingMnemonic(wa.mnemonic);
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
          onPin={(pin) => { void pinUnlock(pin, refresh); }}
          onBio={() => { void bioUnlock(refresh); }}
        />
      )}
      {mode === "home" && (
        <Dashboard
          w={w}
          argonMs={getLastArgonMs()}
          onSend={() => setMode("send")}
          onSwap={() => setMode("swap")}
          onBridge={() => setMode("bridge")}
          onActivity={() => setMode("activity")}
          onReceive={() => {
            setReceiveAddrs({ evm: w.evmAddress, nonEvm: w.nonEvmAddresses });
            setMode("receive");
          }}
          onLock={async () => { await lock(); setError(""); await refresh(); }}
          onBPAN={() => setMode("bpan")}
          onDapps={() => setMode("dapps")}
          onSpike={() => setMode("spike")}
          onDevnet={() => setMode("devnet")}
          onWipe={async () => { await wipeVault(); setError(""); await refresh(); }}
        />
      )}
      {mode === "receive" && receiveAddrs && (
        <ReceiveScreen addrs={receiveAddrs} onBack={() => setMode("home")} />
      )}
      {mode === "send" && (
        <SendScreen
          w={w}
          onBack={() => setMode("home")}
          onSessionExpired={() => { void showRelock(); }}
        />
      )}
      {mode === "swap" && (
        <SwapScreen
          w={w}
          onBack={() => setMode("home")}
          onSessionExpired={() => { void showRelock(); }}
        />
      )}
      {mode === "bridge" && (
        <BridgeScreen
          w={w}
          onBack={() => setMode("home")}
          onSessionExpired={() => { void showRelock(); }}
        />
      )}
      {mode === "activity" && (
        <ActivityScreen owner={w.evmAddress} onBack={() => setMode("home")} />
      )}
      {mode === "bpan" && (
        <BPANScreen
          w={w}
          onBack={() => setMode("home")}
          onSessionExpired={() => { void showRelock(); }}
        />
      )}
      {mode === "dapps" && (
        <WalletConnectScreen onBack={() => setMode("home")} />
      )}
      {mode === "spike" && <Spike onBack={() => setMode("home")} />}
      {mode === "devnet" && <DevnetTx onBack={() => setMode("home")} />}

      {/* WalletConnect approval sheets (session proposals + signing requests)
          render over whatever screen is open; the re-lock overlay below still
          wins (higher zIndex), so an expired vault always re-auths first. */}
      {unlocked && (
        <WcApprovalHost
          accounts={{ evm: w.evmAddress, solana: w.nonEvmAddresses?.solana }}
          onSessionExpired={() => { void showRelock(); }}
        />
      )}

      {/* Session-expiry re-auth overlay (see the `relocked` comment above). */}
      {relocked && status && (
        <View style={st.lockOverlay}>
          <AuthHeader />
          <AlertCard
            tone="amber"
            title="Session expired"
            body="NumPay locked itself after inactivity. Unlock to pick up where you left off."
            style={{ marginBottom: 12 }}
          />
          <Locked
            status={status}
            now={now}
            error={error}
            onPin={(pin) => { void pinUnlock(pin, () => setRelocked(false)); }}
            onBio={() => { void bioUnlock(() => setRelocked(false)); }}
          />
        </View>
      )}
    </View>
  );
}

// Brand header for the auth screens: the small gradient logo mark + wordmark
// (the popup's .logo-mark, solid brand fill in RN).
function AuthHeader() {
  return (
    <View style={st.authHeader}>
      <View style={st.logoMark}><Text style={st.logoMarkText}>N</Text></View>
      <Text style={st.wordmark}>NumPay</Text>
    </View>
  );
}

function Onboard(p: { onCreate: () => void; onImport: () => void }) {
  return (
    <View>
      <Text style={st.h2}>Set up your wallet</Text>
      <Btn label="Create new wallet" onPress={p.onCreate} />
      <Btn label="Import recovery phrase" onPress={p.onImport} variant="secondary" />
    </View>
  );
}

function Import(p: { error: string; onBack: () => void; onSubmit: (phrase: string) => void }) {
  const [phrase, setPhrase] = useState("");
  return (
    <View>
      <Text style={st.h2}>Import wallet</Text>
      <Field
        style={{ height: 90, textAlignVertical: "top" }}
        multiline
        autoCapitalize="none"
        autoCorrect={false}
        placeholder="Recovery phrase (12 or 24 words)"
        value={phrase}
        onChangeText={setPhrase}
      />
      {!!p.error && <Text style={st.err}>{p.error}</Text>}
      <Btn label="Continue" onPress={() => p.onSubmit(phrase.trim())} />
      <Btn label="Back" onPress={p.onBack} variant="secondary" />
    </View>
  );
}

function Reveal(p: { mnemonic: string; onNext: () => void }) {
  return (
    <View>
      <Text style={st.h2}>Your recovery phrase</Text>
      <AlertCard
        tone="amber"
        title="This phrase IS the wallet"
        body="Write these words down in order and keep them offline. Your PIN only unlocks this phone's copy."
        style={{ marginBottom: 10 }}
      />
      <Card style={{ padding: 14 }}>
        <Text style={st.mnemonic}>{p.mnemonic}</Text>
      </Card>
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
          <Switch
            value={bio}
            onValueChange={setBio}
            trackColor={{ true: colors.brand, false: colors.surface4 }}
          />
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
        <AlertCard
          tone="amber"
          title="Locked out"
          body={`Too many attempts. Try again in ${lockedFor >= 60 ? `${Math.ceil(lockedFor / 60)} min` : `${lockedFor} s`}.`}
          style={{ marginTop: 10 }}
        />
      ) : (
        <Btn label="Unlock" onPress={() => { p.onPin(pin); setPin(""); }} />
      )}
      {p.status.biometricsEnabled && <Btn label="Use biometrics" onPress={p.onBio} variant="secondary" />}
    </View>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard(p: {
  w: MobileWalletState;
  argonMs: number | null;
  onSend: () => void;
  onSwap: () => void;
  onBridge: () => void;
  onActivity: () => void;
  onReceive: () => void;
  onBPAN: () => void;
  onDapps: () => void;
  onLock: () => void;
  onSpike: () => void;
  onDevnet: () => void;
  onWipe: () => void;
}) {
  const { w } = p;
  const [confirmWipe, setConfirmWipe] = useState(false);
  const [filter, setFilter] = useState<string | null>(null);
  const rows = filter ? w.rows.filter((r) => r.chainId === filter) : w.rows;
  return (
    <View style={{ flex: 1 }}>
      {/* Header: logo mark + wordmark + lock */}
      <View style={st.homeHeader}>
        <View style={st.logoMark}><Text style={st.logoMarkText}>N</Text></View>
        <Text style={st.wordmark}>NumPay</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={p.onDapps} style={st.iconBtn} hitSlop={8}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>{"🔗"}</Text>
        </Pressable>
        <Pressable onPress={p.onLock} style={st.iconBtn} hitSlop={8}>
          <Text style={{ color: colors.muted, fontSize: 13 }}>{"🔒"}</Text>
        </Pressable>
      </View>

      {/* Portfolio hero. Auto-displays the wallet's BPAN once known (the
          product's identity rule); the raw address stays as the fallback.
          Tapping opens BPAN management (register / map / look up). */}
      <Pressable onPress={p.onBPAN} style={({ pressed }) => [st.hero, pressed && { opacity: 0.85 }]}>
        <View style={st.heroLabelRow}>
          <View style={st.greenDot} />
          <SectionLabel
            text={w.bpan ? "Your number · Active" : "Portfolio"}
            style={{ color: colors.brand2 } as object}
          />
          <View style={{ flex: 1 }} />
          <Text style={st.heroManage}>{w.bpan ? "Manage ›" : "Set up BPAN ›"}</Text>
        </View>
        {!!w.bpan && <Text style={st.heroBpan}>{formatBPAN(w.bpan)}</Text>}
        <Text style={[st.portfolio, !!w.bpan && { fontSize: 22, marginTop: 4 }]}>
          ${w.portfolioUsd.toFixed(2)}
          {w.loading ? "  …" : ""}
        </Text>
        <Text style={st.heroAddr} numberOfLines={1}>{w.evmAddress}</Text>
      </Pressable>

      {/* Action circles (Send / Receive / Activity) */}
      <View style={st.actions}>
        <ActionCircle label="Send" color={colors.brand} glyph="↑" onPress={p.onSend} />
        <ActionCircle label="Receive" color="#22c55e" glyph="↓" onPress={p.onReceive} />
        <ActionCircle label="Swap" color="#f59e0b" glyph="⇄" onPress={p.onSwap} />
        <ActionCircle label="Bridge" color="#8b5cf6" glyph="⇉" onPress={p.onBridge} />
        <ActionCircle label="Activity" color="#0ea5e9" glyph="≋" onPress={p.onActivity} />
      </View>

      {!!w.error && (
        <AlertCard tone="danger" title="Refresh failed" body={w.error} style={{ marginBottom: 8 }} />
      )}

      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0, marginBottom: 6 }}>
        <Chip label="All" active={filter === null} onPress={() => setFilter(null)} />
        {w.chainIds.map((id) => (
          <Chip
            key={id}
            label={id}
            active={filter === id}
            onPress={() => setFilter(id)}
            icon={<ChainIcon chainId={id} size={16} />}
          />
        ))}
      </ScrollView>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <SectionLabel text="Assets" style={{ marginTop: 8, marginBottom: 2 } as object} />
        {rows.map((r) => (
          <AssetRowView key={r.key} row={r} />
        ))}
        {rows.length === 0 && !w.loading && (
          <Text style={st.dim}>No assets yet. Receive funds to get started.</Text>
        )}
        <View style={st.devBox}>
          <SectionLabel text={`Dev${p.argonMs !== null ? ` · argon2 ${p.argonMs} ms` : ""}`} />
          <Btn label="Refresh" onPress={w.refresh} variant="secondary" />
          <Btn label="Run core spike" onPress={p.onSpike} variant="secondary" />
          <Btn label="Devnet tx (Phase 0 gate)" onPress={p.onDevnet} variant="secondary" />
          <Btn
            label={confirmWipe ? "Tap again to WIPE vault (seed is the only recovery)" : "Wipe vault (dev)"}
            onPress={() => (confirmWipe ? p.onWipe() : setConfirmWipe(true))}
            variant="danger"
          />
        </View>
      </ScrollView>
    </View>
  );
}

function ActionCircle(p: { label: string; color: string; glyph: string; onPress: () => void }) {
  return (
    <Pressable onPress={p.onPress} style={({ pressed }) => [st.actionCircle, pressed && { transform: [{ scale: 0.93 }] }]}>
      <View style={[st.actionIcon, { backgroundColor: p.color }]}>
        <Text style={{ color: "#fff", fontSize: 20, fontWeight: "700" }}>{p.glyph}</Text>
      </View>
      <Text style={st.actionLabel}>{p.label}</Text>
    </Pressable>
  );
}

// Token/holdings row (.token-row): flat row with hairline divider, house-framed
// asset icon + chain corner badge, name/chain left, balance/fiat right.
function AssetRowView(p: { row: AssetRow }) {
  const r = p.row;
  return (
    <View style={st.tokenRow}>
      <View style={{ width: 32, height: 32 }}>
        <AssetIcon
          symbol={r.symbol}
          logo={r.logo}
          chainId={r.chainId}
          address={r.isNative ? undefined : r.key.split(":")[1]}
          size={32}
        />
        {!r.isNative && <ChainBadge chainId={r.chainId} size={13} />}
      </View>
      <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
        <Text style={st.tokenName} numberOfLines={1}>{r.name}</Text>
        <Text style={st.tokenSub}>{r.chainName}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={st.tokenBal}>
          {r.balanceNum.toLocaleString(undefined, { maximumFractionDigits: 6 })} {r.symbol}
        </Text>
        <Text style={st.tokenSub}>${r.usdValue.toFixed(2)}</Text>
      </View>
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
      <ScreenHeader title="Core spike" onBack={p.onBack} />
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
    </View>
  );
}

function DevnetTx(p: { onBack: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [outcome, setOutcome] = useState<"running" | "pass" | "fail">("running");
  useEffect(() => {
    const log = (s: string) => setLines((prev) => [...prev, s]);
    (async () => {
      const mn = await getUnlockedMnemonic();
      if (!mn) throw new Error("Vault is locked.");
      await runDevnetTx(mn, log);
    })().then(
      () => setOutcome("pass"),
      (e) => { setLines((prev) => [...prev, String(e)]); setOutcome("fail"); }
    );
  }, []);
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Devnet transaction" onBack={p.onBack} />
      <Text style={outcome === "fail" ? st.err : outcome === "pass" ? st.ok : st.dim}>
        {outcome === "running" ? "running…" : outcome === "pass" ? "CONFIRMED ON-CHAIN" : "FAILED"}
      </Text>
      <ScrollView style={{ marginTop: 8, flex: 1 }}>
        {lines.map((l, i) => (
          <Text key={i} style={st.mono} selectable>{l}</Text>
        ))}
      </ScrollView>
    </View>
  );
}

function PinInput(p: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <Field
      keyboardType="number-pad"
      secureTextEntry
      maxLength={6}
      placeholder={p.placeholder}
      value={p.value}
      onChangeText={(v) => p.onChange(v.replace(/\D/g, ""))}
    />
  );
}

const st = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 56,
    paddingHorizontal: spacing.screen,
  },

  authHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 20 },
  homeHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  logoMark: {
    width: 28, height: 28, borderRadius: 9,
    backgroundColor: colors.brand,
    alignItems: "center", justifyContent: "center",
  },
  logoMarkText: { color: "#fff", fontWeight: "700", fontSize: 13 },
  wordmark: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  iconBtn: {
    width: 32, height: 32, borderRadius: radius.iconBtn,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },

  hero: {
    backgroundColor: colors.surface2,
    borderWidth: 1,
    borderColor: colors.borderLight,
    borderRadius: radius.hero,
    padding: spacing.cardPad,
    marginTop: 6,
  },
  heroLabelRow: { flexDirection: "row", alignItems: "center", gap: 7 },
  heroManage: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
  greenDot: {
    width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success,
  },
  portfolio: {
    color: colors.textPrimary, fontSize: 32, fontWeight: "700",
    marginTop: 8, fontVariant: ["tabular-nums"],
  },
  heroAddr: { color: colors.muted, fontSize: ts.sub, marginTop: 8, fontFamily: "monospace" },
  // .m-number: the big monospace BPAN headline (solid brand-tinted fill in RN
  // for the popup's gradient text).
  heroBpan: {
    color: "#d9d2ff", fontSize: ts.hero, fontWeight: "700",
    fontFamily: "monospace", marginTop: 8, fontVariant: ["tabular-nums"],
  },

  actions: {
    flexDirection: "row", justifyContent: "space-between",
    marginTop: 14, marginBottom: 12,
    paddingHorizontal: 4,
  },
  actionCircle: { alignItems: "center", gap: 7, padding: 2 },
  actionIcon: {
    width: 46, height: 46, borderRadius: 23,
    alignItems: "center", justifyContent: "center",
  },
  actionLabel: { color: colors.textSecondary, fontSize: ts.small, fontWeight: "500" },

  tokenRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(42, 36, 80, 0.7)",
  },
  tokenName: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "500" },
  tokenSub: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
  tokenBal: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "500", fontVariant: ["tabular-nums"] },

  lockOverlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    paddingTop: 56,
    paddingHorizontal: spacing.screen,
    zIndex: 10,
  },
  h2: { color: colors.textPrimary, fontSize: ts.h2, fontWeight: "600", marginBottom: 12 },
  body: { color: colors.textPrimary, fontSize: 15 },
  dim: { color: colors.muted, fontSize: ts.row, marginTop: 8 },
  devBox: { marginTop: 24, marginBottom: 30 },
  mono: { color: colors.textPrimary, fontFamily: "monospace", fontSize: ts.row, marginTop: 2 },
  ok: { color: colors.success, fontSize: ts.row },
  err: { color: colors.danger, fontSize: ts.body, marginTop: 8 },
  mnemonic: { color: colors.textPrimary, fontSize: 16, lineHeight: 26, fontFamily: "monospace" },
  rowBetween: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14,
  },
});
