// NumPay mobile shell: create/import wallet → 6-digit PIN (+ optional
// biometrics) → Keystore-backed dual-wrapped vault → unlock with backoff →
// dashboard / receive / send. Visuals come from src/ui (the extension's design
// tokens + shared components); the vault/auth machinery is unchanged from
// Phase 0. FLAG_SECURE on secret screens is a follow-up (needs
// expo-screen-capture or a config plugin).
import { StatusBar } from "expo-status-bar";
import * as SplashScreen from "expo-splash-screen";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";

// Hold the branded native splash (dark bg + NumPay mark, app.json) until the
// first real screen is ready; hideAsync then reveals the lock/onboard screen,
// which animates the logo in itself. No separate JS splash (no double reveal).
SplashScreen.preventAutoHideAsync().catch(() => {});
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import {
  Animated, BackHandler, PanResponder, Pressable, RefreshControl, ScrollView,
  StyleSheet, Switch, Text, View,
} from "react-native";

import { createWallet, importFromMnemonic } from "@numpay/core/wallet";
import { formatBPAN } from "@numpay/core/bpan";
import { chainNameOf } from "@numpay/core/txLog";
import {
  createVault, getLastArgonMs, getStatus, getUnlockedMnemonic, lock,
  autoLockCheck, touchActivity, unlockWithBiometrics, unlockWithPin,
  getActiveWalletId, switchWallet, addWallet, listWallets,
  VaultError, wipeVault, type VaultStatus, type WalletMeta,
} from "./src/vault/mobileVault";
import { runSpike, type SpikeResult } from "./spike/runSpike";
import { runDevnetTx } from "./spike/devnetTx";
import { useMobileWallet, type AssetRow, type MobileWalletState } from "./src/wallet/useMobileWallet";
import { activeTheme, colors, radius, type as ts, spacing } from "./src/ui/theme";
import {
  Notice, AmbientBackground, AnimatedLogo, Btn, Card, EmptyState, Field,
  GradientNumber, HeroSection, ScreenHeader, SectionLabel, SkeletonRow,
} from "./src/ui/components";
import { SeedPhraseGrid } from "./src/ui/SeedPhrase";
import { ToastHost, toast } from "./src/ui/Toast";
import { TxResultOverlay, type TxFxKind, type TxFxStatus } from "./src/ui/TxResultOverlay";
import { QrScanner } from "./src/ui/QrScanner";
import { parseScannedPayload } from "@numpay/core/qrPayload";
import { pair } from "./src/walletconnect/client";
import { BottomNav, BOTTOM_NAV_CLEARANCE, type NavTab } from "./src/ui/BottomNav";
import { WalletAvatar } from "./src/ui/WalletAvatar";
import { CurrencyProvider, useCurrencyPref, formatFiat } from "./src/ui/currency";
import { SettingsScreen } from "./src/screens/SettingsScreen";
import {
  ArrowUpRightIcon, CheckIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon,
  CopyIcon, EyeOffIcon, HashIcon, LinkIcon, LockIcon, PlusIcon, ReceiveIcon,
  RefreshIcon, ScanIcon, SwapIcon, TrendingUpIcon, WalletIcon,
} from "./src/ui/icons";
import { AssetIcon, ChainBadge, ChainIcon } from "./src/ui/coins";
import { ReceiveScreen, type ReceiveAddrs } from "./src/screens/ReceiveScreen";
import { SendScreen, type SendTokenPick } from "./src/screens/SendScreen";
import { TokenDetailScreen } from "./src/screens/TokenDetailScreen";
import { SwapScreen } from "./src/screens/SwapScreen";
import { DeFiScreen } from "./src/screens/DeFiScreen";
import { ActivityScreen } from "./src/screens/ActivityScreen";
import { BPANScreen } from "./src/screens/BPANScreen";
import { WalletConnectScreen } from "./src/screens/WalletConnectScreen";
import { BrowserScreen } from "./src/screens/BrowserScreen";
import { ManageAssetsScreen } from "./src/screens/ManageAssetsScreen";
import { WcApprovalHost } from "./src/walletconnect/WcApprovalHost";
// Side-effect import: defines the background receive-watch task at bundle
// load so headless launches can find it (see notify/backgroundTask.ts).
import { ensureReceiveWatch } from "./src/notify/backgroundTask";
import { clearReceiveWatch } from "./src/notify/receiveWatch";
import { PinPad } from "./src/ui/PinPad";

type Mode =
  | "loading" | "onboard" | "import" | "reveal" | "pin" | "locked" | "home"
  // No "bridge" mode: bridging is a cross-chain PAIR inside Swap (extension
  // parity), and slot 3 of the dashboard is DeFi.
  | "spike" | "devnet" | "receive" | "send" | "swap" | "defi" | "activity" | "bpan" | "dapps" | "dev" | "settings" | "token" | "assets"
  // In-app dApp browser. A phone browser cannot host an extension, so this is
  // the only way to reach dApps that never implemented WalletConnect.
  | "browser"
  // Universal scanner reached from the dashboard header. Whatever it reads is
  // routed by core/qrPayload: an address or BPAN opens Send prefilled, a wc:
  // code pairs. (Send has its own scanner for the address field alone.)
  | "scan";

export default function App() {
  return (
    <CurrencyProvider>
      <AppInner />
    </CurrencyProvider>
  );
}

function AppInner() {
  const [mode, setMode] = useState<Mode>("loading");
  const [receiveAddrs, setReceiveAddrs] = useState<ReceiveAddrs | null>(null);
  // Token-detail target and the Send screen's preselection (TokenDetail entry).
  const [tokenDetail, setTokenDetail] = useState<AssetRow | null>(null);
  const [sendInit, setSendInit] = useState<{ chainId: string; token: SendTokenPick | null } | null>(null);
  // Send prefill produced by the dashboard scanner (address/BPAN, optional
  // chain and amount).
  const [scanPrefill, setScanPrefill] =
    useState<{ to: string; chainId?: string; amount?: string } | null>(null);
  // Swap preselection (TokenDetail "Swap" button): chain + sell-side token.
  const [swapInit, setSwapInit] = useState<{ chainId: string; fromAddr?: string } | null>(null);
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
  const [activeWallet, setActiveWallet] = useState<WalletMeta | null>(null);
  const [addWalletOpen, setAddWalletOpen] = useState(false);
  // Manage assets is reachable from BOTH the dashboard (network dropdown, the
  // Assets "+" button) and Settings, so back has to return where it came from
  // rather than always dropping the user into Settings.
  const [assetsReturn, setAssetsReturn] = useState<Mode>("settings");

  const unlocked =
    mode === "home" || mode === "receive" || mode === "send" || mode === "swap" || mode === "defi" || mode === "activity" || mode === "bpan" || mode === "dapps" || mode === "dev" || mode === "settings" || mode === "token" || mode === "assets" || mode === "scan" || mode === "browser";
  // The floating nav shows on its six tabs; focused flows (swap, DeFi,
  // dApps, browser, dev) keep the full screen.
  const navVisible =
    mode === "home" || mode === "send" || mode === "receive" || mode === "bpan" || mode === "activity" || mode === "settings";
  const w = useMobileWallet(unlocked, activeWalletId);
  const unlockedRef = useRef(unlocked);
  unlockedRef.current = unlocked;

  // Load the active wallet's meta (name + avatar) for the dashboard pill.
  const loadActiveWallet = useCallback(async () => {
    const list = await listWallets();
    setActiveWallet(list.find((w) => w.active) ?? null);
  }, []);

  const refresh = useCallback(async () => {
    const s = await getStatus();
    setStatus(s);
    const mn = await getUnlockedMnemonic();
    setActiveWalletId(await getActiveWalletId());
    if (mn) { setMode("home"); void loadActiveWallet(); }
    else setMode(s.exists ? "locked" : "onboard");
  }, [loadActiveWallet]);

  // Switch the active wallet (Settings accounts). The hook re-derives on the id
  // change; we land on the dashboard so the switch is visible immediately.
  const onSwitchWallet = useCallback(async (id: string) => {
    await switchWallet(id);
    await touchActivity();
    setActiveWalletId(id);
    void loadActiveWallet();
    setMode("home");
  }, [loadActiveWallet]);

  /**
   * The dashboard scanner's router. Returns a message to REJECT the code and
   * keep scanning, nothing to accept.
   *
   * A `wc:` code pairs straight from here (WcApprovalHost is mounted app-wide
   * and shows the proposal sheet), so the user never has to know a scan was a
   * dApp connection rather than a payment. Anything address-shaped opens Send.
   */
  const routeScan = useCallback((raw: string): string | void => {
    const p = parseScannedPayload(raw);
    switch (p.kind) {
      case "walletconnect":
        setMode("home");
        void pair(p.uri).catch((e) => setError(`Could not connect: ${String((e as Error)?.message ?? e)}`));
        return;
      case "bpan":
        setScanPrefill({ to: p.bpan });
        setMode("send");
        return;
      case "address":
        setScanPrefill({ to: p.address, chainId: p.chainId, amount: p.amount });
        setMode("send");
        return;
      default:
        return "That QR code isn't an address, a payment link, a BPAN or a WalletConnect code.";
    }
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

  // Returning to the dashboard: refresh the account pill's name/avatar in case
  // they were changed in Settings (rename / emoji).
  useEffect(() => {
    if (mode === "home") void loadActiveWallet();
  }, [mode, loadActiveWallet]);

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
  // The back handler is registered once, so it reads the current callback
  // through a ref rather than closing over a stale one.
  const reloadCustomRef = useRef(w.reloadCustom);
  reloadCustomRef.current = w.reloadCustom;
  const assetsReturnRef = useRef(assetsReturn);
  assetsReturnRef.current = assetsReturn;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (relockedRef.current) return true; // re-auth is mandatory, not dismissible
      const m = modeRef.current;
      if (m === "spike" || m === "devnet") {
        setMode("dev");
        return true;
      }
      if (m === "assets") {
        // Same reload as the header back button. Without it a token added in
        // Manage assets and dismissed with the hardware back never reached the
        // dashboard or the Send/Swap pickers, which read like "add token is
        // broken" — the token was saved, nothing had re-read it.
        setMode(assetsReturnRef.current);
        void reloadCustomRef.current?.();
        return true;
      }
      if (m === "scan") {
        setMode("home");
        return true;
      }
      // NOT "browser": it registers its own back handler, which walks the page
      // history first and only leaves the screen at the top of it. Handlers run
      // most-recently-registered first, so its own returns true before this
      // ever sees the press.
      if (m === "receive" || m === "send" || m === "swap" || m === "defi" ||
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
    <View
      style={[
        st.container,
        // The dashboard's hero has to reach the screen edges (and up behind the
        // status bar), which negative margins cannot do inside a ScrollView —
        // Android clips them. So home drops the shell's padding and each
        // dashboard section pads itself instead.
        mode === "home" && st.containerFlush,
        navVisible && { paddingBottom: BOTTOM_NAV_CLEARANCE },
      ]}
    >
      <AmbientBackground />
      {/* Status bar glyphs are the INVERSE of the background: dark icons on
          the light theme's near-white bg, light icons on the dark one. */}
      <StatusBar style={activeTheme === "light" ? "dark" : "light"} />
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
          onDeFi={() => setMode("defi")}
          onActivity={() => setMode("activity")}
          onReceive={goReceive}
          onLock={async () => { await lock(); setError(""); await refresh(); }}
          onBPAN={() => setMode("bpan")}
          onDapps={() => setMode("dapps")}
          onScan={() => setMode("scan")}
          onAccounts={() => setMode("settings")}
          onManageAssets={() => { setAssetsReturn("home"); setMode("assets"); }}
          walletName={activeWallet?.name ?? "NumPay"}
          walletAvatar={activeWallet?.avatar}
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
          onManageAssets={() => { setAssetsReturn("settings"); setMode("assets"); }}
          onDev={() => setMode("dev")}
          onWipe={async () => { await wipeVault(); await clearReceiveWatch(); setError(""); await refresh(); }}
        />
      )}
      {mode === "assets" && (
        <ManageAssetsScreen
          onBack={() => { setMode(assetsReturn); void w.reloadCustom(); }}
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
          key={
            scanPrefill
              ? `scan:${scanPrefill.to}`
              : sendInit ? `${sendInit.chainId}:${sendInit.token?.address ?? "native"}` : "default"
          }
          w={w}
          initialChainId={scanPrefill?.chainId ?? sendInit?.chainId}
          initialToken={sendInit?.token}
          initialTo={scanPrefill?.to}
          initialAmount={scanPrefill?.amount}
          onBack={() => { setSendInit(null); setScanPrefill(null); setMode("home"); }}
          onSessionExpired={() => { void showRelock(); }}
        />
      )}
      {mode === "scan" && (
        <View style={{ flex: 1 }}>
          <ScreenHeader title="Scan" onBack={() => setMode("home")} />
          <QrScanner
            title="Scan"
            hint="Point the camera at a wallet address, payment QR, BPAN or WalletConnect code."
            onScan={routeScan}
            onCancel={() => setMode("home")}
          />
        </View>
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
          onSwap={() => {
            setSwapInit({
              chainId: tokenDetail.chainId,
              fromAddr: tokenDetail.isNative ? undefined : tokenDetail.key.split(":")[1],
            });
            setMode("swap");
          }}
          onReceive={goReceive}
          onSessionExpired={() => { void showRelock(); }}
        />
      )}
      {mode === "swap" && (
        <SwapScreen
          key={swapInit ? `${swapInit.chainId}:${swapInit.fromAddr ?? "native"}` : "default"}
          w={w}
          initialChainId={swapInit?.chainId}
          initialFromAddr={swapInit?.fromAddr}
          onBack={() => { setSwapInit(null); setMode("home"); }}
          onSessionExpired={() => { void showRelock(); }}
        />
      )}
      {mode === "defi" && <DeFiScreen onBack={() => setMode("home")} />}
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

      {/* Toasts sit above the screens but BELOW the lock overlays that follow:
          a note about a failed refresh must never float over a PIN prompt. */}
      <ToastHost />

      {/* Session-expiry re-auth overlay (see the `relocked` comment above). */}
      {relocked && status && (
        <View style={st.lockOverlay}>
          <AuthHeader />
          {/* Info, not caution: the wallet did exactly what it promised, and
              dressing a working security feature in warning colours teaches
              people to ignore the colour that matters. */}
          <Notice
            tone="info"
            title="Session expired"
            body="NumPay locked itself after inactivity. Unlock to pick up where you left off."
            icon={<LockIcon size={15} color={colors.brand2} />}
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
      <Notice
        tone="caution"
        title="This phrase IS the wallet"
        body="Write these words down in order and keep them offline. Your PIN only unlocks this phone's copy."
        style={{ marginBottom: 10 }}
      />
      {/* Not `covered` here: the user just asked to create a wallet and this
          is the one screen whose entire job is showing them the words. */}
      <SeedPhraseGrid phrase={p.mnemonic} />
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
        // Danger, not caution: this one really is blocking the user.
        <Notice
          tone="danger"
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
      {/* Reserved slot: a wrong PIN must not grow the screen under the thumb
          that is mid-retry. Kept inline rather than toasted because this is
          field-level feedback and belongs next to the keypad, not at the top
          of the screen where the eye is not looking. */}
      <View style={st.errSlot}>
        {!!p.error && <Text style={[st.err, st.errCentered]}>{p.error}</Text>}
      </View>
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
            <Notice
              tone="caution"
              title="Save this recovery phrase"
              body="These words ARE the new wallet. Write them down in order and keep them offline before continuing."
              style={{ marginBottom: 10 }}
            />
            <SeedPhraseGrid phrase={generated} />
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
  onDeFi: () => void;
  onActivity: () => void;
  onReceive: () => void;
  onBPAN: () => void;
  onDapps: () => void;
  onScan: () => void;
  onLock: () => void;
  onAccounts: () => void;
  onManageAssets: () => void;
  walletName: string;
  walletAvatar?: string;
  onOpenAsset: (row: AssetRow) => void;
}) {
  const { w } = p;
  const cur = useCurrencyPref();
  const [filter, setFilter] = useState<string | null>(null);
  const [showNetworks, setShowNetworks] = useState(false);
  const [showDust, setShowDust] = useState(false);
  const [bpanCopied, setBpanCopied] = useState(false);
  const rows = filter ? w.rows.filter((r) => r.chainId === filter) : w.rows;
  const dust = filter ? w.dustRows.filter((r) => r.chainId === filter) : w.dustRows;
  const filterName = filter ? (chainNameOf(filter) ?? filter) : "All Assets";

  // A failed sweep is transient and needs no decision, so it toasts instead of
  // wedging a card between the hero and the asset list — which pushed the whole
  // dashboard down every time a flaky network hiccuped, and then popped it back
  // up on the next successful refresh.
  const lastError = useRef("");
  useEffect(() => {
    if (w.error && w.error !== lastError.current) {
      toast.error("Couldn't refresh balances", "Your funds are safe. Pull down to try again.");
    }
    lastError.current = w.error;
  }, [w.error]);

  // The BPAN pill copies on tap, like the extension's. Tapping the "get one"
  // state instead opens the BPAN screen, since there is nothing to copy yet.
  const copyBpan = async () => {
    if (!w.bpan) return;
    try {
      await Clipboard.setStringAsync(w.bpan);
      setBpanCopied(true);
      setTimeout(() => setBpanCopied(false), 2000);
    } catch { /* clipboard unavailable; the BPAN screen still shows the number */ }
  };

  return (
    <View style={{ flex: 1 }}>
      <ScrollView
        style={{ flex: 1 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={w.loading}
            // Forced: pulling to refresh is the user asking for the truth, and
            // an unforced sweep inside the 3-minute freshness window just
            // re-paints the cache, which reads as "refresh does nothing".
            onRefresh={() => w.refresh(true)}
            tintColor={colors.brand}
            colors={[colors.brand]}
            progressBackgroundColor={colors.card}
            // The dashboard scrolls flush to the top edge, so without this the
            // spinner drops in behind the status bar.
            progressViewOffset={56}
          />
        }
      >
        {/* ── Hero gradient section (.hero-section): header, balance, pills and
            the action row all sit on the extension's gradient block. ── */}
        <HeroSection>
          <View style={st.heroInner}>
            {/* Header: account pill (avatar + wallet name -> Settings/accounts)
                left, scan + dApps + lock right. Scan is mobile-only (camera). */}
            <View style={st.homeHeader}>
              <Pressable style={st.acctPill} onPress={p.onAccounts}>
                <WalletAvatar avatar={p.walletAvatar} name={p.walletName} size={20} />
                <Text style={st.acctName} numberOfLines={1}>{p.walletName}</Text>
                <ChevronDownIcon size={11} color={colors.muted} />
              </Pressable>
              <View style={{ flex: 1 }} />
              <Pressable onPress={p.onScan} style={st.iconBtn} hitSlop={8} accessibilityLabel="Scan a QR code">
                <ScanIcon size={15} color={colors.muted} />
              </Pressable>
              <Pressable onPress={p.onDapps} style={st.iconBtn} hitSlop={8} accessibilityLabel="Connected dApps">
                <LinkIcon size={15} color={colors.muted} />
              </Pressable>
              <Pressable onPress={p.onLock} style={st.iconBtn} hitSlop={8} accessibilityLabel="Lock wallet">
                <LockIcon size={15} color={colors.muted} />
              </Pressable>
            </View>

            {/* Balance: the ext's centered gradient portfolio number, no card. */}
            <View style={{ alignItems: "center", marginTop: 10 }}>
              <GradientNumber text={formatFiat(w.portfolioUsd, cur.code, cur.currency, w.rates)} size={42} />
              <Text style={st.heroSub}>
                Total Portfolio{w.loading ? "  · syncing…" : ""}
              </Text>
            </View>

            {/* Pills: chain filter + the wallet's BPAN (identity rule) */}
            <View style={st.pillRow}>
              <Pressable style={st.filterPill} onPress={() => setShowNetworks((v) => !v)}>
                {filter
                  ? <ChainIcon chainId={filter} size={15} />
                  : <View style={st.allDisc}><Text style={st.allDiscText}>All</Text></View>}
                <Text style={st.filterPillText}>{filterName}</Text>
                {showNetworks
                  ? <ChevronUpIcon size={10} color={colors.muted} />
                  : <ChevronDownIcon size={10} color={colors.muted} />}
              </Pressable>
              {w.bpan ? (
                <Pressable style={st.bpanPill} onPress={() => { void copyBpan(); }}>
                  <HashIcon size={9} color={colors.brand2} />
                  <Text style={st.bpanPillText}>{formatBPAN(w.bpan)}</Text>
                  {bpanCopied
                    ? <CheckIcon size={10} color={colors.success} />
                    : <CopyIcon size={10} color={colors.brand2} />}
                </Pressable>
              ) : (
                <Pressable style={st.getBpanPill} onPress={p.onBPAN}>
                  <HashIcon size={9} color={colors.textSecondary} />
                  <Text style={st.getBpanText}>Get BPAN</Text>
                </Pressable>
              )}
            </View>

            {/* Network / filter dropdown, grouped the way the extension groups
                it. Mobile lists only the chains that actually have something to
                show (w.chainIds) rather than every network. */}
            {showNetworks && (
              <Card style={{ marginBottom: 14, maxHeight: 250 }}>
                <ScrollView nestedScrollEnabled>
                  <Pressable
                    style={st.netRow}
                    onPress={() => { setFilter(null); setShowNetworks(false); }}
                  >
                    <View style={st.allDiscLg}><Text style={st.allDiscText}>All</Text></View>
                    <Text style={[st.netName, filter === null && { color: colors.brand2 }]}>All Assets</Text>
                    {filter === null && <CheckIcon size={14} color={colors.brand2} />}
                  </Pressable>
                  {w.chainIds.map((id) => (
                    <Pressable
                      key={id}
                      style={st.netRow}
                      onPress={() => { setFilter(id); setShowNetworks(false); }}
                    >
                      <ChainIcon chainId={id} size={18} />
                      <Text style={[st.netName, filter === id && { color: colors.brand2 }]}>
                        {chainNameOf(id) ?? id}
                      </Text>
                      {filter === id && <CheckIcon size={14} color={colors.brand2} />}
                    </Pressable>
                  ))}
                  <Pressable
                    style={[st.netRow, { borderBottomWidth: 0 }]}
                    onPress={() => { setShowNetworks(false); p.onManageAssets(); }}
                  >
                    <View style={st.dashedDisc}><PlusIcon size={11} color={colors.brand2} /></View>
                    <Text style={[st.netName, { color: colors.brand2 }]}>Manage Tokens &amp; Networks</Text>
                  </Pressable>
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
                {/* Specular gloss: a soft highlight from the top-right corner,
                    the same overlay the extension paints over the CTA. */}
                <LinearGradient
                  colors={["rgba(255,255,255,0.18)", "rgba(255,255,255,0)"]}
                  start={{ x: 1, y: 0 }}
                  end={{ x: 0.15, y: 1 }}
                  style={StyleSheet.absoluteFill}
                  pointerEvents="none"
                />
                <View style={st.sendCtaChip}>
                  <ArrowUpRightIcon size={15} color="#fff" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={st.sendCtaTitle}>Send</Text>
                  <Text style={st.sendCtaSub}>Pay anyone, any chain</Text>
                </View>
                <ChevronRightIcon size={16} color="rgba(255,255,255,0.7)" />
              </LinearGradient>
            </Pressable>

            {/* Secondary row: Receive / Swap / DeFi — same three as the extension.
                Bridging is not a slot here: it is a cross-chain pair inside Swap. */}
            <View style={st.actionCards}>
              {([
                { label: "Receive", Icon: ReceiveIcon, onPress: p.onReceive },
                { label: "Swap", Icon: SwapIcon, onPress: p.onSwap },
                { label: "DeFi", Icon: TrendingUpIcon, onPress: p.onDeFi },
              ] as const).map(({ label, Icon, onPress }) => (
                <Pressable
                  key={label}
                  onPress={onPress}
                  style={({ pressed }) => [st.actionCard, pressed && { borderColor: colors.brand }]}
                >
                  <Icon size={14} color={colors.muted} />
                  <Text style={st.actionCardLabel}>{label}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        </HeroSection>

        {/* ── Assets section ── */}
        <View style={st.assetsSection}>

          <View style={st.assetsHead}>
            <SectionLabel text="Assets" />
            <View style={{ flexDirection: "row", gap: 2 }}>
              <Pressable hitSlop={8} onPress={p.onManageAssets} style={st.headBtn} accessibilityLabel="Manage tokens and networks">
                <PlusIcon size={14} color={colors.muted} />
              </Pressable>
              <Pressable hitSlop={8} onPress={() => w.refresh(true)} style={st.headBtn} accessibilityLabel="Refresh balances">
                <RefreshIcon size={14} color={colors.muted} />
              </Pressable>
            </View>
          </View>

          {rows.map((r) => (
            <AssetRowView
              key={r.key}
              row={r}
              fiat={formatFiat(r.usdValue, cur.code, cur.currency, w.rates)}
              onPress={() => p.onOpenAsset(r)}
              // Every row can leave the home list now, natives included: the
              // default-five rule is what keeps the majors present, so the old
              // native exemption would only have blocked a deliberate tidy-up.
              onHide={() => { void w.setRowHidden(r, true); }}
            />
          ))}

          {/* First paint of a scope: placeholder rows rather than a blank page. */}
          {rows.length === 0 && w.loading && (
            <>
              <SkeletonRow /><SkeletonRow /><SkeletonRow />
            </>
          )}

          {rows.length === 0 && !w.loading && (
            <EmptyState
              icon={<WalletIcon size={20} color={colors.muted} />}
              title="No assets found"
              hint="Receive funds to get started."
            />
          )}

          {/* Dust + hidden tokens, behind a disclosure (ext parity). */}
          {dust.length > 0 && (
            <View style={{ marginTop: 16 }}>
              <Pressable style={st.dustToggle} onPress={() => setShowDust((v) => !v)}>
                {showDust
                  ? <ChevronUpIcon size={12} color={colors.muted} />
                  : <ChevronDownIcon size={12} color={colors.muted} />}
                <Text style={st.dustToggleText}>Hidden ({dust.length})</Text>
              </Pressable>
              {showDust && dust.map((r) => (
                <View key={`dust-${r.key}`} style={{ opacity: 0.55 }}>
                  <AssetRowView
                    row={r}
                    fiat={formatFiat(r.usdValue, cur.code, cur.currency, w.rates)}
                    onPress={() => p.onOpenAsset(r)}
                    // Anything in here can go back on the home list, however it
                    // got here. Gating this on manualHidden left dust and spam
                    // rows with no way out, so a real token the classifier
                    // guessed wrong about was stuck for good.
                    onUnhide={() => { void w.setRowHidden(r, false); }}
                    compact
                  />
                </View>
              ))}
            </View>
          )}

          <View style={{ height: 24 }} />
        </View>
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
  // Drives a preview of the tx result overlay. The real thing only appears
  // after a signed transaction, so without this the send/swap/bridge animation
  // could not be checked without spending funds. Mobile counterpart of the
  // extension's run-txfx-visual harness.
  const [fx, setFx] = useState<{ status: TxFxStatus; kind: TxFxKind } | null>(null);
  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Developer tools" onBack={p.onBack} />
      <SectionLabel
        text={`Diagnostics${p.argonMs !== null ? ` · argon2 ${p.argonMs} ms` : ""}`}
        style={{ marginTop: 6 } as object}
      />
      <Btn label="Refresh balances" onPress={() => p.w.refresh(true)} variant="secondary" />
      <Btn label="Run core spike" onPress={p.onSpike} variant="secondary" />
      <Btn label="Devnet tx (Phase 0 gate)" onPress={p.onDevnet} variant="secondary" />

      <SectionLabel text="Tx overlay preview" style={{ marginTop: 14 } as object} />
      <View style={{ flexDirection: "row", gap: 8 }}>
        <View style={{ flex: 1 }}>
          <Btn label="Pending" variant="secondary" onPress={() => setFx({ status: "pending", kind: "send" })} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn label="Success" variant="secondary" onPress={() => setFx({ status: "success", kind: "swap" })} />
        </View>
        <View style={{ flex: 1 }}>
          <Btn label="Error" variant="secondary" onPress={() => setFx({ status: "error", kind: "bridge" })} />
        </View>
      </View>

      <View style={{ flex: 1 }} />
      <Btn
        label={confirmWipe ? "Tap again to WIPE vault (seed is the only recovery)" : "Wipe vault"}
        onPress={() => (confirmWipe ? p.onWipe() : setConfirmWipe(true))}
        variant="danger"
        style={{ marginBottom: 24 }}
      />

      {fx && (
        <TxResultOverlay
          status={fx.status}
          kind={fx.kind}
          amountLabel="0.05 ETH → 1.229394 SOL"
          detail={fx.status === "pending" ? "Approving USDC (1 of 2)…" : undefined}
          txHash="0x8eee4ba6c0f1d2e3a4b5c6d7e8f90112233445566778899aabbccddeeff947d7"
          explorerUrl="https://basescan.org"
          errorTitle="Bridge failed"
          errorMessage="Preview only. No transaction was signed."
          onClose={() => setFx(null)}
        />
      )}
      {/* Pending has no Done button by design, so give the preview a way out. */}
      {fx?.status === "pending" && (
        <Pressable
          onPress={() => setFx(null)}
          style={{ position: "absolute", top: 8, right: 8, padding: 12, zIndex: 60 }}
        >
          <Text style={{ color: colors.textPrimary, fontWeight: "700" }}>Close</Text>
        </Pressable>
      )}
    </View>
  );
}

// Token/holdings row (.token-row): flat row with hairline divider, house-framed
/** Width of the "Hide" action revealed by the swipe. Same 76 as the popup. */
const HIDE_ACTION_W = 76;

/**
 * A row you drag right-to-left to reveal a red "Hide" action, ported from the
 * extension's SwipeRow (Dashboard.tsx). This is the manual backstop for spam
 * that gets past the classifier, so it has to be a deliberate, discoverable
 * gesture — it replaced a long-press, which was both invisible and easy to fire
 * by accident while scrolling.
 *
 * The PanResponder claims the gesture ONLY once the drag is clearly horizontal
 * (|dx| > |dy| and past a few px). Without that test it swallows vertical drags
 * and the dashboard stops scrolling.
 */
function SwipeToHideRow({ onHide, onPress, children }: {
  onHide: () => void;
  onPress?: () => void;
  children: ReactNode;
}) {
  const dx = useRef(new Animated.Value(0)).current;
  // Read in the responder callbacks, which close over their creation render, so
  // this has to be a ref rather than state.
  const openRef = useRef(false);
  const movedRef = useRef(false);

  const settle = (open: boolean) => {
    openRef.current = open;
    Animated.timing(dx, {
      toValue: open ? -HIDE_ACTION_W : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  };

  const pan = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_e, g) =>
        Math.abs(g.dx) > 5 && Math.abs(g.dx) > Math.abs(g.dy),
      onPanResponderGrant: () => { movedRef.current = false; },
      onPanResponderMove: (_e, g) => {
        movedRef.current = true;
        const base = openRef.current ? -HIDE_ACTION_W : 0;
        // Clamped: the row never travels past the action, and never right of
        // its resting position.
        dx.setValue(Math.max(-HIDE_ACTION_W, Math.min(0, base + g.dx)));
      },
      // Past the halfway point stays open, otherwise snap shut (popup parity).
      onPanResponderRelease: (_e, g) => {
        const base = openRef.current ? -HIDE_ACTION_W : 0;
        settle(base + g.dx <= -HIDE_ACTION_W / 2);
      },
      onPanResponderTerminate: () => settle(openRef.current),
    }),
  ).current;

  return (
    <View style={{ position: "relative", overflow: "hidden" }}>
      {/* Action sits beneath the row's right edge, revealed as the row slides. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Hide token"
        onPress={() => { settle(false); onHide(); }}
        style={st.hideAction}
      >
        <EyeOffIcon size={15} color="#fff" />
        <Text style={st.hideActionText}>Hide</Text>
      </Pressable>
      {/* Opaque background is load-bearing: it is what keeps the action out of
          sight until the row is actually dragged off it. */}
      <Animated.View
        {...pan.panHandlers}
        style={{ transform: [{ translateX: dx }], backgroundColor: colors.bg }}
      >
        <Pressable
          onPress={() => {
            if (movedRef.current) return;             // a swipe, not a tap
            if (openRef.current) { settle(false); return; } // tap closes it
            onPress?.();
          }}
          style={({ pressed }) => [st.tokenRow, pressed && { opacity: 0.7 }]}
        >
          {children}
        </Pressable>
      </Animated.View>
    </View>
  );
}

// asset icon + chain corner badge, SYMBOL over chain name left, balance/fiat
// right — the extension's hierarchy. Home rows swipe right-to-left to reveal
// Hide; hidden rows get an Unhide button instead.
function AssetRowView(p: {
  row: AssetRow;
  fiat: string;
  onPress?: () => void;
  onHide?: () => void;
  onUnhide?: () => void;
  /** Hidden-section rows: smaller disc and denser type, as in the popup. */
  compact?: boolean;
}) {
  const r = p.row;
  const disc = p.compact ? 28 : 36;
  const body = (
    <>
      <View style={{ width: disc, height: disc }}>
        <AssetIcon
          symbol={r.symbol}
          logo={r.logo}
          chainId={r.chainId}
          address={r.isNative ? undefined : r.key.split(":")[1]}
          size={disc}
        />
        {!r.isNative && <ChainBadge chainId={r.chainId} size={p.compact ? 11 : 13} />}
      </View>
      <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
        <Text style={[st.tokenName, p.compact && { fontSize: 12 }]} numberOfLines={1}>{r.symbol}</Text>
        <Text style={[st.tokenSub, p.compact && { fontSize: 10 }]} numberOfLines={1}>{r.chainName}</Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={[st.tokenBal, p.compact && { fontSize: 12 }]}>
          {r.balanceNum > 0
            ? r.balanceNum.toLocaleString(undefined, { maximumFractionDigits: p.compact ? 6 : 4 })
            : "0"}
        </Text>
        {r.usdValue > 0 && <Text style={st.tokenSub}>{p.fiat}</Text>}
      </View>
      {p.onUnhide && (
        <Pressable hitSlop={8} onPress={p.onUnhide} style={st.unhideBtn}>
          <Text style={st.unhideText}>Unhide</Text>
        </Pressable>
      )}
    </>
  );

  if (p.onHide) {
    return <SwipeToHideRow onHide={p.onHide} onPress={p.onPress}>{body}</SwipeToHideRow>;
  }
  return (
    <Pressable
      onPress={p.onPress}
      style={({ pressed }) => [st.tokenRow, pressed && { opacity: 0.7 }]}
    >
      {body}
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
  containerFlush: { paddingTop: 0, paddingHorizontal: 0 },

  authHeader: { alignItems: "center", marginTop: 72, marginBottom: 36 },
  authWordmark: { color: colors.textPrimary, fontSize: 22, fontWeight: "700", marginTop: 16 },
  homeHeader: { flexDirection: "row", alignItems: "center", gap: 10, marginBottom: 8 },
  wordmark: { color: colors.textPrimary, fontSize: 16, fontWeight: "700" },
  iconBtn: {
    width: 32, height: 32, borderRadius: radius.iconBtn,
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },

  // Home runs flush (see containerFlush), so the hero reaches the edges and
  // the status bar on its own and pads its contents back in.
  heroInner: {
    paddingHorizontal: spacing.screen,
    paddingTop: 56,
    paddingBottom: 14,
  },
  // Everything below the hero re-applies the shell's horizontal padding.
  assetsSection: { paddingHorizontal: spacing.screen, paddingTop: 16 },

  acctPill: {
    flexDirection: "row", alignItems: "center", gap: 7,
    paddingVertical: 5, paddingHorizontal: 10,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  acctName: { color: colors.textPrimary, fontSize: 13, fontWeight: "600", maxWidth: 140 },
  heroSub: { color: colors.textSecondary, fontSize: 12, marginTop: 4 },

  pillRow: {
    flexDirection: "row", justifyContent: "center", alignItems: "center",
    gap: 8, marginTop: 14, marginBottom: 14,
  },
  // "All" disc: the neutral stand-in the extension shows when no chain filter
  // is set, in place of a chain logo.
  allDisc: {
    width: 15, height: 15, borderRadius: 8,
    backgroundColor: colors.surface3,
    alignItems: "center", justifyContent: "center",
  },
  allDiscLg: {
    width: 18, height: 18, borderRadius: 9,
    backgroundColor: colors.surface3,
    alignItems: "center", justifyContent: "center",
  },
  allDiscText: { color: colors.muted, fontSize: 7, fontWeight: "700" },
  dashedDisc: {
    width: 18, height: 18, borderRadius: 9,
    borderWidth: 1, borderStyle: "dashed", borderColor: "rgba(124, 109, 240, 0.5)",
    alignItems: "center", justifyContent: "center",
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
  bpanPillText: {
    color: colors.brand2, fontSize: 12.5, fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  // No BPAN yet: the extension marks the empty state with a dashed pill.
  getBpanPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    paddingVertical: 7, paddingHorizontal: 13,
    borderRadius: radius.pill,
    backgroundColor: colors.card,
    borderWidth: 1, borderStyle: "dashed", borderColor: colors.border,
  },
  getBpanText: { color: colors.textSecondary, fontSize: 12.5, fontWeight: "500" },
  netRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  netName: { color: colors.textPrimary, fontSize: 13, fontWeight: "500", flex: 1 },

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

  actionCards: { flexDirection: "row", gap: 7, marginTop: 8 },
  actionCard: {
    flex: 1, alignItems: "center", gap: 5,
    paddingVertical: 9,
    borderRadius: 11,
    backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border,
  },
  actionCardLabel: { color: colors.textPrimary, fontSize: 11, fontWeight: "500" },

  assetsHead: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    marginBottom: 4,
  },
  headBtn: { padding: 6, borderRadius: radius.iconBtn },

  tokenRow: {
    flexDirection: "row", alignItems: "center",
    paddingVertical: 10,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  // Swipe-to-hide action, pinned to the right edge under the sliding row.
  // dangerBtn (not the danger text colour): light theme needs the full red
  // here, since the dark theme's maroon reads as mud on white.
  hideAction: {
    position: "absolute", top: 0, right: 0, bottom: 0,
    width: HIDE_ACTION_W,
    alignItems: "center", justifyContent: "center", gap: 3,
    backgroundColor: colors.dangerBtn,
  },
  hideActionText: { color: "#fff", fontSize: 10, fontWeight: "600" },
  // Symbol leads the row, as in the popup; the chain name is the subtitle.
  tokenName: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600" },
  tokenSub: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
  tokenBal: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600", fontVariant: ["tabular-nums"] },
  unhideBtn: {
    marginLeft: 10, paddingHorizontal: 8, paddingVertical: 3,
    borderRadius: 6, backgroundColor: colors.surface2,
  },
  unhideText: { color: colors.textSecondary, fontSize: 10, fontWeight: "600" },

  dustToggle: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
  dustToggleText: { color: colors.muted, fontSize: ts.small, fontWeight: "500" },

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
  version: {
    color: colors.muted2, fontSize: ts.label, textAlign: "center",
    paddingVertical: 28, letterSpacing: 0.4,
  },
  mono: { color: colors.textPrimary, fontFamily: "monospace", fontSize: ts.row, marginTop: 2 },
  ok: { color: colors.success, fontSize: ts.row },
  err: { color: colors.dangerText, fontSize: ts.body, marginTop: 8, fontWeight: "600" },
  errCentered: { textAlign: "center", marginTop: 0 },
  // Height held whether or not there is an error, so the layout never jumps.
  errSlot: { minHeight: 30, justifyContent: "center", marginTop: 8 },
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
