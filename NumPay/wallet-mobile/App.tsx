// NumPay mobile shell: create/import wallet → 6-digit PIN (+ optional
// biometrics) → Keystore-backed dual-wrapped vault → unlock with backoff →
// dashboard / receive / send. Visuals come from src/ui (the extension's design
// tokens + shared components); the vault/auth machinery is unchanged from
// Phase 0. FLAG_SECURE on secret screens is a follow-up (needs
// expo-screen-capture or a config plugin).
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useRef, useState } from "react";

// Hold the branded native splash (dark bg + NumPay mark, app.json) until the
// first real screen is ready; hideAsync then reveals the lock/onboard screen,
// which animates the logo in itself. No separate JS splash (no double reveal).
SplashScreen.preventAutoHideAsync().catch(() => {});
import { LinearGradient } from "expo-linear-gradient";
import { BackHandler, Pressable, RefreshControl, ScrollView, StyleSheet, Switch, Text, View } from "react-native";

import { createWallet, importFromMnemonic } from "@numpay/core/wallet";
import { formatBPAN } from "@numpay/core/bpan";
import { chainNameOf } from "@numpay/core/txLog";
import {
  createVault, getLastArgonMs, getStatus, getUnlockedMnemonic, lock,
  autoLockCheck, touchActivity, unlockWithBiometrics, unlockWithPin,
  getActiveWalletId, switchWallet, addWallet,
  VaultError, wipeVault, type VaultStatus,
} from "./src/vault/mobileVault";
import { runSpike, type SpikeResult } from "./spike/runSpike";
import { runDevnetTx } from "./spike/devnetTx";
import { useMobileWallet, type AssetRow, type MobileWalletState } from "./src/wallet/useMobileWallet";
import { colors, radius, type as ts, spacing } from "./src/ui/theme";
import {
  AlertCard, AmbientBackground, AnimatedLogo, Btn, Card, Field,
  GradientNumber, LogoMark, ScreenHeader, SectionLabel,
} from "./src/ui/components";
import { BottomNav, BOTTOM_NAV_CLEARANCE, type NavTab } from "./src/ui/BottomNav";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import {
  LayersIcon, LinkIcon, LockIcon, ReceiveIcon, SendIcon, SwapIcon,
} from "./src/ui/icons";
import { AssetIcon, ChainBadge, ChainIcon } from "./src/ui/coins";
import { ReceiveScreen, type ReceiveAddrs } from "./src/screens/ReceiveScreen";
import { SendScreen, type SendTokenPick } from "./src/screens/SendScreen";
import { TokenDetailScreen } from "./src/screens/TokenDetailScreen";
import { SwapScreen } from "./src/screens/SwapScreen";
import { BridgeScreen } from "./src/screens/BridgeScreen";
import { ActivityScreen } from "./src/screens/ActivityScreen";
import { BPANScreen } from "./src/screens/BPANScreen";
import { WalletConnectScreen } from "./src/screens/WalletConnectScreen";
import { WcApprovalHost } from "./src/walletconnect/WcApprovalHost";
// Side-effect import: defines the background receive-watch task at bundle
// load so headless launches can find it (see notify/backgroundTask.ts).
import { ensureReceiveWatch } from "./src/notify/backgroundTask";
import { clearReceiveWatch } from "./src/notify/receiveWatch";
import { PinPad } from "./src/ui/PinPad";

type Mode =
  | "loading" | "onboard" | "import" | "reveal" | "pin" | "locked" | "home"
  | "spike" | "devnet" | "receive" | "send" | "swap" | "bridge" | "activity" | "bpan" | "dapps" | "dev" | "settings" | "token";

export default function App() {
  const [mode, setMode] = useState<Mode>("loading");
  const [receiveAddrs, setReceiveAddrs] = useState<ReceiveAddrs | null>(null);
  // Token-detail target and the Send screen's preselection (TokenDetail entry).
  const [tokenDetail, setTokenDetail] = useState<AssetRow | null>(null);
  const [sendInit, setSendInit] = useState<{ chainId: string; token: SendTokenPick | null } | null>(null);
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
  // Active wallet id (multi-wallet): drives the useMobileWallet reload on switch.
  const [activeWalletId, setActiveWalletId] = useState<string | null>(null);
  const [addWalletOpen, setAddWalletOpen] = useState(false);

  const unlocked =
    mode === "home" || mode === "receive" || mode === "send" || mode === "swap" || mode === "bridge" || mode === "activity" || mode === "bpan" || mode === "dapps" || mode === "dev" || mode === "settings" || mode === "token";
  // The floating nav shows on its six tabs; focused flows (swap, bridge,
  // dApps, dev) keep the full screen.
  const navVisible =
    mode === "home" || mode === "send" || mode === "receive" || mode === "bpan" || mode === "activity" || mode === "settings";
  const w = useMobileWallet(unlocked, activeWalletId);
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;

  const refresh = useCallback(async () => {
    const s = await getStatus();
    setStatus(s);
    const mn = await getUnlockedMnemonic();
    setActiveWalletId(await getActiveWalletId());
    if (mn) setMode("home");
    else setMode(s.exists ? "locked" : "onboard");
  }, []);

  // Switch the active wallet (Settings accounts). The hook re-derives on the id
  // change; we land on the dashboard so the switch is visible immediately.
  const onSwitchWallet = useCallback(async (id: string) => {
    await switchWallet(id);
    await touchActivity();
    setActiveWalletId(id);
    setMode("home");
  }, []);

  const showRelock = useCallback(async () => {
    setStatus(await getStatus());
    setRelocked(true);
  }, []);

  // Hold the branded native splash until the first real screen is resolved
  // (lock / onboard / home), so it hands straight to content with no black
  // flash — the lock/onboard screens animate the logo in themselves.
  useEffect(() => {
    if (mode !== "loading") SplashScreen.hideAsync().catch(() => {});
  }, [mode]);

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

  // Arm the closed-app receive watcher once per unlock: asks notification
  // permission on first use, then registers the OS background task. Failure
  // (denied / restricted) is silent by design — the wallet works without it.
  useEffect(() => {
    if (unlocked) void ensureReceiveWatch();
  }, [unlocked]);

  // Hardware back: sub-screens return home and onboarding steps step back,
  // instead of the whole app exiting (the long-standing "back kills NumPay"
  // gotcha). Auth screens consume nothing: backing out of home/locked/onboard
  // exits normally, and the re-lock overlay cannot be dismissed with back.
  const modeRef = useRef(mode);
  modeRef.current = mode;
  const relockedRef = useRef(relocked);
  relockedRef.current = relocked;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (relockedRef.current) return true; // re-auth is mandatory, not dismissible
      const m = modeRef.current;
      if (m === "spike" || m === "devnet") {
        setMode("dev");
        return true;
      }
      if (m === "receive" || m === "send" || m === "swap" || m === "bridge" ||
          m === "activity" || m === "bpan" || m === "dapps" || m === "dev" ||
          m === "settings" || m === "token") {
        setMode("home");
        return true;
      }
      if (m === "import" || m === "reveal" || m === "pin") {
        setMode("onboard");
        return true;
      }
      return false; // home / locked / onboard: let Android close the app
    });
    return () => sub.remove();
  }, []);

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

  const goReceive = () => {
    setReceiveAddrs({ evm: w.evmAddress, nonEvm: w.nonEvmAddresses });
    setMode("receive");
  };
  const navTo = (tab: NavTab) => {
    if (tab === "receive") goReceive();
    else setMode(tab);
  };

  return (
    <View style={[st.container, navVisible && { paddingBottom: BOTTOM_NAV_CLEARANCE }]}>
      <AmbientBackground />
      <StatusBar style="light" />
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
          onSend={() => setMode("send")}
          onSwap={() => setMode("swap")}
          onBridge={() => setMode("bridge")}
          onActivity={() => setMode("activity")}
          onReceive={goReceive}
          onLock={async () => { await lock(); setError(""); await refresh(); }}
          onBPAN={() => setMode("bpan")}
          onDapps={() => setMode("dapps")}
          onOpenAsset={(row) => { setTokenDetail(row); setMode("token"); }}
        />
      )}
      {mode === "settings" && (
        <SettingsScreen
          activeWalletId={activeWalletId}
          onSwitchWallet={onSwitchWallet}
          onAddWallet={() => { setError(""); setAddWalletOpen(true); }}
          onLock={async () => { await lock(); setError(""); await refresh(); }}
          onDapps={() => setMode("dapps")}
          onDev={() => setMode("dev")}
          onWipe={async () => { await wipeVault(); await clearReceiveWatch(); setError(""); await refresh(); }}
        />
      )}
      {mode === "dev" && (
        <DevScreen
          w={w}
          argonMs={getLastArgonMs()}
          onBack={() => setMode("home")}
          onSpike={() => setMode("spike")}
          onDevnet={() => setMode("devnet")}
          onWipe={async () => { await wipeVault(); await clearReceiveWatch(); setError(""); await refresh(); }}
        />
      )}
      {mode === "receive" && receiveAddrs && (
        <ReceiveScreen addrs={receiveAddrs} onBack={() => setMode("home")} />
      )}
      {mode === "send" && (
        <SendScreen
          key={sendInit ? `${sendInit.chainId}:${sendInit.token?.address ?? "native"}` : "default"}
          w={w}
          initialChainId={sendInit?.chainId}
          initialToken={sendInit?.token}
          onBack={() => { setSendInit(null); setMode("home"); }}
          onSessionExpired={() => { void showRelock(); }}
        />
      )}
      {mode === "token" && tokenDetail && (
        <TokenDetailScreen
          w={w}
          row={tokenDetail}
          onBack={() => setMode("home")}
          onSend={() => {
            setSendInit({
              chainId: tokenDetail.chainId,
              token: tokenDetail.isNative ? null : {
                chainId: tokenDetail.chainId,
                address: tokenDetail.key.split(":")[1],
                symbol: tokenDetail.symbol,
                decimals: w.tokensByChain[tokenDetail.chainId]
                  ?.find((t) => t.address.toLowerCase() === tokenDetail.key.split(":")[1])?.decimals ?? 18,
                logo: tokenDetail.logo,
                balanceNum: tokenDetail.balanceNum,
                priceUsd: tokenDetail.balanceNum > 0 ? tokenDetail.usdValue / tokenDetail.balanceNum : 0,
              },
            });
            setMode("send");
          }}
          onReceive={goReceive}
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
      {mode === "spike" && <Spike onBack={() => setMode("dev")} />}
      {mode === "devnet" && <DevnetTx onBack={() => setMode("dev")} />}

      {/* Floating pill nav (extension Layout parity) on the six main tabs. */}
      {navVisible && !relocked && (
        <BottomNav active={mode as NavTab} onNavigate={navTo} />
      )}

      {/* WalletConnect approval sheets (session proposals + signing requests)
          render over whatever screen is open; the re-lock overlay below still
          wins (higher zIndex), so an expired vault always re-auths first. */}
      {unlocked && (
        <WcApprovalHost
          accounts={{ evm: w.evmAddress, solana: w.nonEvmAddresses?.solana }}
          onSessionExpired={() => { void showRelock(); }}
        />
      )}

      {/* Add-wallet overlay (Settings → accounts). Adds to the unlocked vault
          and switches to it without a re-PIN. */}
      {addWalletOpen && (
        <AddWalletOverlay
          onClose={() => setAddWalletOpen(false)}
          onAdded={async (id) => {
            setAddWalletOpen(false);
            setActiveWalletId(id);
            setMode("home");
          }}
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

// Brand header for the auth screens: the real NumPay logo with the extension
// Welcome page's breathing-glow treatment, centered for the phone canvas.
function AuthHeader() {
  return (
    <View style={st.authHeader}>
      <AnimatedLogo size={72} />
      <Text style={st.authWordmark}>NumPay</Text>
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

// Two-step PIN setup with the dots keypad: enter, then confirm. A mismatch
// bumps the shake token and restarts at step 1.
function PinSetup(p: {
  bioAvailable: boolean;
  error: string;
  onSubmit: (pin: string, enableBio: boolean) => void;
}) {
  const [first, setFirst] = useState<string | null>(null);
  const [bio, setBio] = useState(p.bioAvailable);
  const [localErr, setLocalErr] = useState("");
  const [shake, setShake] = useState(0);

  const onComplete = (pin: string) => {
    if (first === null) {
      setFirst(pin);
      setLocalErr("");
      setShake((s) => s + 1); // clear dots for the confirm step
      return;
    }
    if (pin !== first) {
      setFirst(null);
      setLocalErr("PINs didn't match. Start again.");
      setShake((s) => s + 1);
      return;
    }
    setLocalErr("");
    p.onSubmit(pin, bio);
  };

  return (
    <View>
      <Text style={st.h2}>{first === null ? "Choose a 6-digit PIN" : "Confirm your PIN"}</Text>
      <PinPad onComplete={onComplete} shakeToken={shake} onChangeLength={() => setLocalErr("")} />
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
      {!!(localErr || p.error) && <Text style={[st.err, { textAlign: "center" }]}>{localErr || p.error}</Text>}
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
  const [shake, setShake] = useState(0);
  const errRef = useRef(p.error);
  // A new error (wrong PIN) arrived: shake + clear the dots.
  useEffect(() => {
    if (p.error && p.error !== errRef.current) setShake((s) => s + 1);
    errRef.current = p.error;
  }, [p.error]);
  const lockedFor = Math.max(0, Math.ceil((p.status.lockUntil - p.now) / 1000));
  return (
    <View>
      <Text style={[st.h2, { textAlign: "center" }]}>Welcome back</Text>
      {lockedFor > 0 ? (
        <AlertCard
          tone="amber"
          title="Locked out"
          body={`Too many attempts. Try again in ${lockedFor >= 60 ? `${Math.ceil(lockedFor / 60)} min` : `${lockedFor} s`}.`}
          style={{ marginTop: 10 }}
        />
      ) : (
        <PinPad
          onComplete={(pin) => p.onPin(pin)}
          shakeToken={shake}
          showBiometrics={p.status.biometricsEnabled}
          onBiometrics={p.onBio}
        />
      )}
      {!!p.error && <Text style={[st.err, { textAlign: "center" }]}>{p.error}</Text>}
    </View>
  );
}

// Add-wallet overlay: create a fresh wallet (reveal its phrase first) or import
// one, name it, add it to the unlocked vault, and switch to it. No re-PIN — the
// vault is already open.
function AddWalletOverlay(p: { onClose: () => void; onAdded: (id: string) => void }) {
  const [tab, setTab] = useState<"create" | "import">("create");
  const [name, setName] = useState("");
  const [phrase, setPhrase] = useState("");
  // Create flow reveals the new phrase before it is added.
  const [generated, setGenerated] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const add = async (mnemonic: string) => {
    setBusy(true);
    setError("");
    try {
      const id = await addWallet(mnemonic, name);
      p.onAdded(id);
    } catch (e) {
      setError(String((e as Error)?.message ?? e));
      setBusy(false);
    }
  };

  return (
    <View style={st.lockOverlay}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false}>
        <ScreenHeader title="Add wallet" onBack={p.onClose} />

        {generated ? (
          <View>
            <AlertCard
              tone="amber"
              title="Save this recovery phrase"
              body="These words ARE the new wallet. Write them down in order and keep them offline before continuing."
              style={{ marginBottom: 10 }}
            />
            <Card style={{ padding: 14 }}>
              <Text style={st.mnemonic}>{generated}</Text>
            </Card>
            {!!error && <Text style={st.err}>{error}</Text>}
            <Btn label={busy ? "Adding…" : "I saved it, add wallet"} onPress={() => { void add(generated); }} disabled={busy} />
          </View>
        ) : (
          <View>
            <View style={st.segRow}>
              <Pressable style={[st.seg, tab === "create" && st.segOn]} onPress={() => { setTab("create"); setError(""); }}>
                <Text style={[st.segText, tab === "create" && st.segTextOn]}>Create new</Text>
              </Pressable>
              <Pressable style={[st.seg, tab === "import" && st.segOn]} onPress={() => { setTab("import"); setError(""); }}>
                <Text style={[st.segText, tab === "import" && st.segTextOn]}>Import</Text>
              </Pressable>
            </View>

            <Field placeholder="Wallet name (optional)" value={name} onChangeText={setName} />

            {tab === "import" && (
              <Field
                style={{ height: 90, textAlignVertical: "top" }}
                multiline autoCapitalize="none" autoCorrect={false}
                placeholder="Recovery phrase (12 or 24 words)"
                value={phrase}
                onChangeText={setPhrase}
              />
            )}

            {!!error && <Text style={st.err}>{error}</Text>}

            <Btn
              label={tab === "create" ? "Create" : (busy ? "Importing…" : "Import")}
              disabled={busy}
              onPress={() => {
                if (tab === "create") {
                  setGenerated(createWallet().mnemonic);
                  setError("");
                } else {
                  try {
                    const wa = importFromMnemonic(phrase.trim());
                    void add(wa.mnemonic);
                  } catch {
                    setError("That doesn't look like a valid recovery phrase.");
                  }
                }
              }}
            />
          </View>
        )}
      </ScrollView>
    </View>
  );
}

// ── Dashboard ─────────────────────────────────────────────────────────────────
function Dashboard(p: {
  w: MobileWalletState;
  onSend: () => void;
  onSwap: () => void;
  onBridge: () => void;
  onActivity: () => void;
  onReceive: () => void;
  onBPAN: () => void;
  onDapps: () => void;
  onLock: () => void;
  onOpenAsset: (row: AssetRow) => void;
}) {
  const { w } = p;
  const [filter, setFilter] = useState<string | null>(null);
  const [showNetworks, setShowNetworks] = useState(false);
  const rows = filter ? w.rows.filter((r) => r.chainId === filter) : w.rows;
  const filterName = filter ? (chainNameOf(filter) ?? filter) : "All Assets";
  return (
    <View style={{ flex: 1 }}>
      {/* Header: account pill left, dApps + lock right (ext Dashboard header) */}
      <View style={st.homeHeader}>
        <View style={st.acctPill}>
          <LogoMark size={18} />
          <Text style={st.acctName}>NumPay</Text>
        </View>
        <View style={{ flex: 1 }} />
        <Pressable onPress={p.onDapps} style={st.iconBtn} hitSlop={8}>
          <LinkIcon size={15} color={colors.muted} />
        </Pressable>
        <Pressable onPress={p.onLock} style={st.iconBtn} hitSlop={8}>
          <LockIcon size={15} color={colors.muted} />
        </Pressable>
      </View>

      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={w.loading}
            onRefresh={w.refresh}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.card}
          />
        }
      >
        {/* Hero: the ext's centered gradient portfolio number, no card. */}
        <View style={{ alignItems: "center", marginTop: 14 }}>
          <GradientNumber text={`$${w.portfolioUsd.toFixed(2)}`} size={42} />
          <Text style={st.heroSub}>
            Total Portfolio{w.loading ? "  · syncing…" : ""}
          </Text>
        </View>

        {/* Pills: chain filter + the wallet's BPAN (identity rule) */}
        <View style={st.pillRow}>
          <Pressable style={st.filterPill} onPress={() => setShowNetworks((v) => !v)}>
            {filter && <ChainIcon chainId={filter} size={15} />}
            <Text style={st.filterPillText}>{filterName}</Text>
            <Text style={st.pillChevron}>{showNetworks ? "▴" : "▾"}</Text>
          </Pressable>
          <Pressable style={st.bpanPill} onPress={p.onBPAN}>
            <Text style={st.bpanHash}>#</Text>
            <Text style={st.bpanPillText}>
              {w.bpan ? formatBPAN(w.bpan) : "Set up BPAN ›"}
            </Text>
          </Pressable>
        </View>

        {/* Network filter dropdown (ext parity) */}
        {showNetworks && (
          <Card style={{ marginBottom: 12, maxHeight: 250 }}>
            <ScrollView nestedScrollEnabled>
              <Pressable
                style={st.netRow}
                onPress={() => { setFilter(null); setShowNetworks(false); }}
              >
                <Text style={[st.netName, filter === null && { color: colors.brand2 }]}>All Assets</Text>
              </Pressable>
              {w.chainIds.map((id) => (
                <Pressable
                  key={id}
                  style={st.netRow}
                  onPress={() => { setFilter(id); setShowNetworks(false); }}
                >
                  <ChainIcon chainId={id} size={16} />
                  <Text style={[st.netName, filter === id && { color: colors.brand2 }]}>
                    {chainNameOf(id) ?? id}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </Card>
        )}

        {/* Primary Send CTA (ext: gradient bar, "Pay anyone, any chain") */}
        <Pressable onPress={p.onSend} style={({ pressed }) => [pressed && { transform: [{ scale: 0.99 }] }]}>
          <LinearGradient
            colors={["#b5a8ff", "#7c6df0", "#5b4cdb"]}
            locations={[0, 0.5, 1]}
            start={{ x: 0, y: 0 }}
            end={{ x: 1, y: 1 }}
            style={st.sendCta}
          >
            <View style={st.sendCtaChip}>
              <SendIcon size={15} color="#fff" />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.sendCtaTitle}>Send</Text>
              <Text style={st.sendCtaSub}>Pay anyone, any chain</Text>
            </View>
            <Text style={st.sendCtaChevron}>{"›"}</Text>
          </LinearGradient>
        </Pressable>

        {/* Secondary row: Receive / Swap / Bridge (ext has DeFi in slot 3) */}
        <View style={st.actionCards}>
          {([
            { label: "Receive", Icon: ReceiveIcon, onPress: p.onReceive },
            { label: "Swap", Icon: SwapIcon, onPress: p.onSwap },
            { label: "Bridge", Icon: LayersIcon, onPress: p.onBridge },
          ] as const).map(({ label, Icon, onPress }) => (
            <Pressable
              key={label}
              onPress={onPress}
              style={({ pressed }) => [st.actionCard, pressed && { borderColor: colors.brand }]}
            >
              <Icon size={15} color={colors.muted} />
              <Text style={st.actionCardLabel}>{label}</Text>
            </Pressable>
          ))}
        </View>

        {!!w.error && (
          <AlertCard tone="danger" title="Refresh failed" body={w.error} style={{ marginBottom: 8 }} />
        )}

        <SectionLabel text="Assets" style={{ marginTop: 18, marginBottom: 2 } as object} />
        {rows.map((r) => (
          <AssetRowView key={r.key} row={r} onPress={() => p.onOpenAsset(r)} />
        ))}
        {rows.length === 0 && !w.loading && (
          <View style={st.emptyState}>
            <Text style={st.emptyTitle}>No assets yet</Text>
            <Text style={st.dim}>Receive funds to get started.</Text>
          </View>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

// ── Dev screen (hidden: 5 taps on the dashboard version footer) ──────────────
function DevScreen(p: {
  w: MobileWalletState;
  argonMs: number | null;
  onBack: () => void;
  onSpike: () => void;
  onDevnet: () => void;
  onWipe: () => void;
}) {
  const [confirmWipe, setConfirmWipe] = useState(false);
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Developer tools" onBack={p.onBack} />
      <SectionLabel
        text={`Diagnostics${p.argonMs !== null ? ` · argon2 ${p.argonMs} ms` : ""}`}
        style={{ marginTop: 6 } as object}
      />
      <Btn label="Refresh balances" onPress={p.w.refresh} variant="secondary" />
      <Btn label="Run core spike" onPress={p.onSpike} variant="secondary" />
      <Btn label="Devnet tx (Phase 0 gate)" onPress={p.onDevnet} variant="secondary" />
      <View style={{ flex: 1 }} />
      <Btn
        label={confirmWipe ? "Tap again to WIPE vault (seed is the only recovery)" : "Wipe vault"}
        onPress={() => (confirmWipe ? p.onWipe() : setConfirmWipe(true))}
        variant="danger"
        style={{ marginBottom: 24 }}
      />
    </View>
  );
}

// Token/holdings row (.token-row): flat row with hairline divider, house-framed
// asset icon + chain corner badge, name/chain left, balance/fiat right.
function AssetRowView(p: { row: AssetRow; onPress?: () => void }) {
  const r = p.row;
  return (
    <Pressable
      onPress={p.onPress}
      style={({ pressed }) => [st.tokenRow, pressed && { opacity: 0.7 }]}
    >
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
    </Pressable>
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

const st = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    paddingTop: 56,
    paddingHorizontal: spacing.screen,
  },

  authHeader: { alignItems: "center", marginTop: 72, marginBottom: 36 },
  authWordmark: { color: colors.textPrimary, fontSize: 22, fontWeight: "700", marginTop: 16 },
  homeHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  wordmark: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  iconBtn: {
    width: 32, height: 32, borderRadius: radius.iconBtn,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },

  acctPill: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingVertical: 5, paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  acctName: { color: colors.textPrimary, fontSize: 13, fontWeight: "600" },
  heroSub: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },

  pillRow: {
    flexDirection: "row", justifyContent: "center", alignItems: "center",
    gap: 8, marginTop: 14, marginBottom: 14,
  },
  filterPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 7, paddingHorizontal: 13,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  filterPillText: { color: colors.textPrimary, fontSize: 12.5, fontWeight: "500" },
  pillChevron: { color: colors.muted, fontSize: 9 },
  bpanPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 7, paddingHorizontal: 13,
    borderRadius: radius.pill,
    backgroundColor: colors.brandTint,
    borderWidth: 1, borderColor: "rgba(124, 109, 240, 0.32)",
  },
  bpanHash: { color: colors.brand2, fontSize: 12, fontWeight: "700" },
  bpanPillText: {
    color: colors.brand2, fontSize: 12.5, fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  netRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(42, 36, 80, 0.7)",
  },
  netName: { color: colors.textPrimary, fontSize: 13, fontWeight: "500" },

  sendCta: {
    flexDirection: "row", alignItems: "center", gap: 12,
    paddingVertical: 13, paddingHorizontal: 14,
    borderRadius: 14,
    shadowColor: colors.brand,
    shadowOpacity: 0.85, shadowRadius: 12, shadowOffset: { width: 0, height: 10 },
    elevation: 10,
  },
  sendCtaChip: {
    width: 32, height: 32, borderRadius: 9,
    backgroundColor: "rgba(255,255,255,0.16)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.18)",
    alignItems: "center", justifyContent: "center",
  },
  sendCtaTitle: { color: "#fff", fontSize: 15, fontWeight: "600", letterSpacing: -0.3 },
  sendCtaSub: { color: "rgba(255,255,255,0.75)", fontSize: 11, marginTop: 1 },
  sendCtaChevron: { color: "rgba(255,255,255,0.7)", fontSize: 18, marginTop: -2 },

  actionCards: { flexDirection: "row", gap: 7, marginTop: 8 },
  actionCard: {
    flex: 1, alignItems: "center", gap: 5,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  actionCardLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: "500" },

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
  emptyState: { alignItems: "center", paddingVertical: 48 },
  emptyTitle: { color: colors.textSecondary, fontSize: ts.body, fontWeight: "600" },
  version: {
    color: colors.muted2, fontSize: ts.label, textAlign: "center",
    paddingVertical: 28, letterSpacing: 0.4,
  },
  mono: { color: colors.textPrimary, fontFamily: "monospace", fontSize: ts.row, marginTop: 2 },
  ok: { color: colors.success, fontSize: ts.row },
  err: { color: colors.danger, fontSize: ts.body, marginTop: 8 },
  mnemonic: { color: colors.textPrimary, fontSize: 16, lineHeight: 26, fontFamily: "monospace" },
  segRow: {
    flexDirection: "row", gap: 6,
    padding: 4,
    borderRadius: radius.button,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
    marginBottom: 4,
  },
  seg: {
    flex: 1, alignItems: "center", paddingVertical: 9, borderRadius: radius.tile,
  },
  segOn: { backgroundColor: colors.brand },
  segText: { color: colors.muted, fontSize: ts.small, fontWeight: "600" },
  segTextOn: { color: "#fff" },
  rowBetween: {
    flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 14,
  },
});
