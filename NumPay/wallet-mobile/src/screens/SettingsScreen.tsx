// Settings — the nav's sixth tab, mirroring the extension Settings page at
// mobile scope: Accounts (the multi-wallet switcher: list, switch, rename,
// remove, add), Security (lock, reveal recovery phrase), Connections (dApps),
// and the danger zone. The version row is the hidden developer-tools entry.
import { useCallback, useEffect, useState } from "react";
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import {
  listWallets, renameWallet, removeWallet, getActiveMnemonic, setWalletAvatar,
  isWipeOnFailEnabled, setWipeOnFail, WIPE_AFTER_ATTEMPTS,
  type WalletMeta,
} from "../vault/mobileVault";
import { CURRENCIES } from "@numpay/core/currency";
import {
  colors, type as ts, themedStyles, useThemeState, type ThemePref,
} from "../ui/theme";
import {
  clearIfUnchanged, copyEphemeral, SECRET_CLIPBOARD_TTL_MS, ttlSeconds,
} from "../platform/clipboard";
import {
  checkDeviceIntegrity, integrityWarning, shouldWarn, type DeviceIntegrity,
} from "../platform/deviceIntegrity";
import { Notice, Btn, Card, Field, ScreenHeader, SectionLabel, Tappable, Toggle } from "../ui/components";
import { ConfirmSheet } from "../ui/Sheet";
import { SeedPhraseGrid } from "../ui/SeedPhrase";
import { toast } from "../ui/Toast";
import {
  CheckIcon, ChevronDownIcon, ChevronRightIcon, ChevronUpIcon, CopyIcon, GlobeIcon,
  LayersIcon, LinkIcon, LockIcon, MoonIcon, SettingsIcon, ShieldIcon, SunIcon,
} from "../ui/icons";
import { WalletAvatar, EmojiPicker } from "../ui/WalletAvatar";
import { RevealGate } from "../ui/RevealGate";
import { useCurrencyPref } from "../ui/currency";

/** How long a revealed recovery phrase stays on screen (extension: 30 s). */
const REVEAL_AUTO_HIDE_MS = 30_000;

// ── Theme picker ─────────────────────────────────────────────────────────────
// "System" first: it is the default and the one most people want, and putting
// the two manual overrides under it reads as "or pin it".
const THEME_OPTIONS: ReadonlyArray<{
  pref: ThemePref;
  Icon: typeof SunIcon;
  tint: "amber" | "brand";
}> = [
  // No device glyph exists in the ported icon set and this file does not invent
  // art, so System borrows the gear: "whatever your phone settings say".
  { pref: "system", Icon: SettingsIcon, tint: "brand" },
  { pref: "light", Icon: SunIcon, tint: "amber" },
  { pref: "dark", Icon: MoonIcon, tint: "brand" },
];

const THEME_LABEL: Record<ThemePref, string> = {
  system: "System",
  light: "Light",
  dark: "Dark",
};

const THEME_HINT: Record<ThemePref, string> = {
  system: "Follows your phone's light or dark setting",
  light: "Always light, whatever the phone does",
  dark: "Always dark, whatever the phone does",
};

function shortAddr(a?: string): string {
  return a && a.length >= 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a ?? "");
}

/**
 * Turn a flag emoji (🇺🇸) into a flagcdn image URL via its ISO 3166-1 code.
 * Android's system font has no country-flag glyphs at all — the emoji renders
 * as bare regional-indicator letters or tofu — so the extension's flag images
 * are the only way to show the same thing here.
 */
function flagUrl(emoji: string): string | null {
  const code = [...emoji]
    .map((ch) => String.fromCharCode((ch.codePointAt(0) ?? 0) - 0x1F1A5))
    .join("")
    .toLowerCase();
  return /^[a-z]{2}$/.test(code) ? `https://flagcdn.com/40x30/${code}.png` : null;
}

/** Currency mark: real flag image where we can build one, symbol otherwise. */
function CurrencyMark({ flag, symbol, size = 20 }: {
  flag?: string; symbol?: string; size?: number;
}) {
  const url = flag ? flagUrl(flag) : null;
  if (url) {
    return (
      <Image
        source={{ uri: url }}
        style={{ width: size, height: size * 0.75, borderRadius: 2 }}
        resizeMode="cover"
      />
    );
  }
  return <Text style={[st.curSymMark, { width: size + 6 }]}>{symbol ?? "¤"}</Text>;
}

function Row({ label, hint, onPress, danger, right, icon, control }: {
  label: string;
  hint?: string;
  onPress?: () => void;
  danger?: boolean;
  right?: string;
  icon?: React.ReactNode;
  /** Trailing control (a Toggle). Replaces the chevron: a row that owns a
   *  switch is not a row that navigates anywhere. */
  control?: React.ReactNode;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={!onPress}
      style={({ pressed }) => [st.row, pressed && onPress && { opacity: 0.7 }]}
    >
      {icon && <View style={st.rowIcon}>{icon}</View>}
      <View style={{ flex: 1 }}>
        <Text style={[st.rowLabel, danger && { color: colors.dangerText }]}>{label}</Text>
        {!!hint && <Text style={st.rowHint}>{hint}</Text>}
      </View>
      {!!right && <Text style={st.rowRight}>{right}</Text>}
      {control}
      {onPress && !control && <ChevronRightIcon size={14} color={colors.muted2} />}
    </Pressable>
  );
}

export function SettingsScreen({
  activeWalletId, onSwitchWallet, onAddWallet, onLock, onDapps, onManageAssets, onDev, onWipe,
}: {
  activeWalletId: string | null;
  onSwitchWallet: (id: string) => void;
  onAddWallet: () => void;
  onLock: () => void;
  onDapps: () => void;
  onManageAssets: () => void;
  onDev: () => void;
  onWipe: () => void;
}) {
  const [wallets, setWallets] = useState<WalletMeta[]>([]);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [emojiTargetId, setEmojiTargetId] = useState<string | null>(null);
  const [revealed, setRevealed] = useState<string | null>(null);
  // Re-auth gate in front of the reveal (extension parity — see RevealGate).
  const [revealGate, setRevealGate] = useState(false);
  const [confirmWipe, setConfirmWipe] = useState(false);
  /** Wipe-after-N: the armed flag, and the confirm sheet shown before arming. */
  const [wipeOnFail, setWipeOnFailState] = useState(false);
  const [confirmArmWipe, setConfirmArmWipe] = useState(false);
  const [integrity, setIntegrity] = useState<DeviceIntegrity | null>(null);
  /** Wallet queued for removal, held while its confirm sheet is open. */
  const [confirmRemove, setConfirmRemove] = useState<WalletMeta | null>(null);
  /** Seconds left before a revealed phrase hides itself. */
  const [revealLeft, setRevealLeft] = useState(0);
  const cur = useCurrencyPref();
  const theme = useThemeState();
  const [showTheme, setShowTheme] = useState(false);
  const [showCurrency, setShowCurrency] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");
  const filteredCurrencies = CURRENCIES.filter((c) => {
    const q = currencySearch.trim().toLowerCase();
    return !q || c.name.toLowerCase().includes(q) || c.code.includes(q) || c.symbol.toLowerCase().includes(q);
  });

  const reload = useCallback(() => { listWallets().then(setWallets).catch(() => {}); }, []);
  useEffect(() => { reload(); }, [reload, activeWalletId]);

  useEffect(() => {
    void isWipeOnFailEnabled().then(setWipeOnFailState);
    void checkDeviceIntegrity().then(setIntegrity);
  }, []);

  // Arming is gated behind a confirm; DISARMING is not. Removing a way to lose
  // the wallet should never be the harder of the two directions.
  const applyWipeOnFail = async (on: boolean) => {
    if (on) { setConfirmArmWipe(true); return; }
    await setWipeOnFail(false);
    setWipeOnFailState(false);
    toast.info("Erase-on-failure off", "Wrong PINs will only trigger the lockout delays.");
  };

  // A revealed phrase auto-hides after 30 s, like the extension's. The words
  // stay in component state only for that window; nothing persists them.
  // The countdown is SHOWN, not just enforced. A phrase that vanishes without
  // warning while it is being copied down is its own small disaster.
  useEffect(() => {
    if (!revealed) { setRevealLeft(0); return; }
    const words = revealed;
    const until = Date.now() + REVEAL_AUTO_HIDE_MS;
    setRevealLeft(Math.ceil(REVEAL_AUTO_HIDE_MS / 1000));
    // Once a second, and derived from `until` rather than counted down, so a
    // dropped frame cannot make the phrase outstay its window. Faster ticking
    // would re-render this whole screen (wallet list included) 100+ times for
    // a number that only changes once a second.
    const tick = setInterval(() => {
      const left = Math.max(0, Math.ceil((until - Date.now()) / 1000));
      setRevealLeft(left);
      if (left === 0) setRevealed(null);
    }, 1000);
    return () => {
      clearInterval(tick);
      // Taking the words off the screen takes them off the clipboard too, so
      // "Hide now" and the auto-hide both mean the phrase is actually gone.
      // No-op unless the user copied, and never touches a later copy.
      void clearIfUnchanged(words);
    };
  }, [revealed]);

  // Switching the active wallet while a phrase is on screen would re-render the
  // panel with a DIFFERENT wallet's words behind the gate that authorised the
  // first one. Force-hide on any switch (the extension does the same on
  // wallet?.address change).
  useEffect(() => { setRevealed(null); setRevealGate(false); }, [activeWalletId]);

  // Hardware back closes whichever sheet is open rather than the whole Settings
  // screen. Sheet registers its own handler while it is mounted (and RN fires
  // the newest listener first), so the gate's back handling lives there now
  // instead of being duplicated per caller.

  const emojiTarget = wallets.find((w) => w.id === emojiTargetId) ?? null;

  const doRename = async (id: string) => {
    await renameWallet(id, renameVal);
    setRenaming(null); setRenameVal("");
    reload();
  };
  // Was a native Alert.alert, which is the one dialog in the app that cannot be
  // styled and looked like it belonged to a different product entirely.
  const doRemove = (m: WalletMeta) => setConfirmRemove(m);

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Settings" />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {/* ── Accounts (multi-wallet) ── */}
        <SectionLabel text="Accounts" style={{ marginTop: 6, marginBottom: 6 } as object} />
        <Card>
          {wallets.map((m, i) => (
            <View key={m.id} style={[st.walletRow, i > 0 && st.walletDivider]}>
              {renaming === m.id ? (
                <View style={{ flex: 1 }}>
                  <Field
                    autoFocus
                    placeholder="Wallet name"
                    value={renameVal}
                    onChangeText={setRenameVal}
                    onSubmitEditing={() => { void doRename(m.id); }}
                  />
                  <View style={{ flexDirection: "row", gap: 8 }}>
                    <Btn label="Save" onPress={() => { void doRename(m.id); }} style={{ flex: 1 }} />
                    <Btn label="Cancel" variant="secondary" onPress={() => setRenaming(null)} style={{ flex: 1 }} />
                  </View>
                </View>
              ) : (
                <>
                  {/* Avatar — tap to pick an emoji (extension parity) */}
                  <Tappable feedback="ghost" hitSlop={6} onPress={() => setEmojiTargetId(m.id)} style={{ marginRight: 10 }}>
                    <WalletAvatar avatar={m.avatar} name={m.name} size={34} active={m.active} />
                  </Tappable>
                  <Tappable feedback="row" style={st.walletMain} onPress={() => onSwitchWallet(m.id)}>
                    <View style={{ flex: 1 }}>
                      <Text style={st.rowLabel}>{m.name}</Text>
                      <Text style={st.rowHint} numberOfLines={1}>{shortAddr(m.evmAddress)}</Text>
                    </View>
                  </Tappable>
                  <View style={{ alignItems: "flex-end" }}>
                    {m.active ? (
                      <Text style={[st.walletActionText, { color: colors.muted }]}>Active</Text>
                    ) : (
                      <Tappable feedback="ghost" hitSlop={8} onPress={() => onSwitchWallet(m.id)}>
                        <Text style={st.walletActionText}>Switch</Text>
                      </Tappable>
                    )}
                    <View style={{ flexDirection: "row", gap: 10, marginTop: 4 }}>
                      <Tappable feedback="ghost" hitSlop={6} onPress={() => { setRenaming(m.id); setRenameVal(m.name); }}>
                        <Text style={st.walletSubAction}>Rename</Text>
                      </Tappable>
                      {wallets.length > 1 && (
                        <Tappable feedback="ghost" hitSlop={6} onPress={() => doRemove(m)}>
                          <Text style={[st.walletSubAction, { color: colors.dangerText }]}>Remove</Text>
                        </Tappable>
                      )}
                    </View>
                  </View>
                </>
              )}
            </View>
          ))}
        </Card>
        {emojiTarget && (
          <EmojiPicker
            walletName={emojiTarget.name}
            current={emojiTarget.avatar}
            onPick={async (emoji) => { await setWalletAvatar(emojiTarget.id, emoji); setEmojiTargetId(null); reload(); }}
            onClose={() => setEmojiTargetId(null)}
          />
        )}
        <Btn label="Add wallet" variant="secondary" onPress={onAddWallet} />

        {/* ── Security ── */}
        <SectionLabel text="Security" style={{ marginTop: 18, marginBottom: 6 } as object} />
        <Card>
          <Row
            label="Lock wallet"
            hint="Requires your PIN or biometrics to reopen"
            icon={<LockIcon size={15} color={colors.muted} />}
            onPress={onLock}
          />
          <View style={st.hairline} />
          <Row
            label={`Erase after ${WIPE_AFTER_ATTEMPTS} wrong PINs`}
            hint={
              wipeOnFail
                ? "On. This phone's copy is deleted when the count runs out."
                : "Off. Wrong PINs only trigger the lockout delays."
            }
            icon={<ShieldIcon size={15} color={wipeOnFail ? colors.dangerText : colors.muted} />}
            control={
              <Toggle
                value={wipeOnFail}
                onValueChange={(on) => { void applyWipeOnFail(on); }}
                label={`Erase the wallet after ${WIPE_AFTER_ATTEMPTS} wrong PIN attempts`}
              />
            }
          />
          <View style={st.hairline} />
          <Row
            label="Device integrity"
            hint={
              integrity === null
                ? "Checking…"
                : integrity.unknown
                  ? "Could not be checked on this device."
                  : integrity.rooted
                    ? integrity.isEmulator
                      ? "Root detected (emulator, where this is expected)."
                      : "Root detected. Your keys cannot be protected here."
                    : "No root detected by the standard checks."
            }
            icon={
              <ShieldIcon
                size={15}
                color={shouldWarn(integrity) ? colors.dangerText : colors.muted}
              />
            }
          />
          <View style={st.hairline} />
          <Row
            label="Reveal recovery phrase"
            hint="Show the active wallet's 12/24 words. Never share them."
            icon={<ShieldIcon size={15} color={colors.caution} />}
            right={revealed ? "Hide" : undefined}
            onPress={() => {
              // Already showing: hide without re-asking. Otherwise gate first —
              // the mnemonic is only fetched AFTER the gate passes, so a
              // dismissed prompt never puts it in state at all.
              if (revealed) { setRevealed(null); return; }
              setRevealGate(true);
            }}
          />
        </Card>
        {shouldWarn(integrity) && integrity && (
          <Notice
            tone="danger"
            title="Rooted device"
            body={integrityWarning(integrity)}
            icon={<ShieldIcon size={15} color={colors.dangerText} />}
            style={{ marginTop: 10 }}
          />
        )}
        {!!revealed && (
          <View style={{ marginTop: 10 }}>
            <Notice
              tone="caution"
              title="Anyone with these words owns this wallet"
              body="Write them down in order and keep them offline. Never type them into a website, an app, or a support chat."
              icon={<ShieldIcon size={15} color={colors.caution} />}
              style={{ marginBottom: 10 }}
            />
            <SeedPhraseGrid
              phrase={revealed}
              // Masked even though the PIN gate just passed: the gate proves WHO
              // is holding the phone, not who else can see it.
              covered
              footer={
                <View style={st.revealFoot}>
                  <View style={st.countdown}>
                    <View style={st.countdownDot} />
                    <Text style={st.countdownText}>Hides in {revealLeft}s</Text>
                  </View>
                  <Pressable
                    hitSlop={8}
                    style={({ pressed }) => [st.copyBtn, pressed && { opacity: 0.6 }]}
                    onPress={() => {
                      void copyEphemeral(revealed, SECRET_CLIPBOARD_TTL_MS);
                      toast.warn(
                        "Phrase copied",
                        `Your clipboard is readable by other apps. NumPay clears it in ${ttlSeconds(SECRET_CLIPBOARD_TTL_MS)}s, so paste it now.`,
                      );
                    }}
                  >
                    <CopyIcon size={13} color={colors.muted} />
                    <Text style={st.copyText}>Copy</Text>
                  </Pressable>
                </View>
              }
            />
            <Btn label="Hide now" variant="secondary" onPress={() => setRevealed(null)} />
          </View>
        )}

        {/* ── Connections ── */}
        <SectionLabel text="Connections" style={{ marginTop: 18, marginBottom: 6 } as object} />
        <Card>
          <Row
            label="Connected dApps"
            hint="WalletConnect sessions and pairing"
            icon={<LinkIcon size={15} color={colors.muted} />}
            onPress={onDapps}
          />
        </Card>

        {/* ── Preferences ── */}
        <SectionLabel text="Preferences" style={{ marginTop: 18, marginBottom: 6 } as object} />
        <Card>
          <Row
            label="Manage assets"
            hint="Add custom tokens and EVM networks"
            icon={<LayersIcon size={15} color={colors.muted} />}
            onPress={onManageAssets}
          />
          <View style={st.hairline} />
          {/* Display currency: the flag is an IMAGE, not an emoji (see flagUrl). */}
          <Pressable
            onPress={() => { setShowCurrency((v) => !v); setCurrencySearch(""); }}
            style={({ pressed }) => [st.row, pressed && { opacity: 0.7 }]}
          >
            <View style={st.rowIcon}>
              <GlobeIcon size={15} color={colors.muted} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.rowLabel}>Display currency</Text>
              <Text style={st.rowHint}>Prices and balances show in this currency</Text>
            </View>
            <View style={st.curCurrent}>
              <CurrencyMark flag={cur.currency?.flag} symbol={cur.currency?.symbol} />
              <Text style={st.rowRight}>{cur.currency?.symbol ?? cur.code.toUpperCase()}</Text>
            </View>
            {showCurrency
              ? <ChevronUpIcon size={14} color={colors.muted2} />
              : <ChevronDownIcon size={14} color={colors.muted2} />}
          </Pressable>
          <View style={st.hairline} />
          {/* Theme. Same disclosure shape as the currency row above: the picker
              opens as its own card rather than a sheet, so the choice and the
              screen it repaints are visible at the same time. */}
          <Pressable
            onPress={() => setShowTheme((v) => !v)}
            style={({ pressed }) => [st.row, pressed && { opacity: 0.7 }]}
          >
            <View style={st.rowIcon}>
              {theme.theme === "dark"
                ? <MoonIcon size={15} color={colors.brand2} />
                : <SunIcon size={15} color={colors.amber} />}
            </View>
            <View style={{ flex: 1 }}>
              <Text style={st.rowLabel}>Theme</Text>
              <Text style={st.rowHint}>{THEME_HINT[theme.pref]}</Text>
            </View>
            <Text style={st.rowRight}>{THEME_LABEL[theme.pref]}</Text>
            {showTheme
              ? <ChevronUpIcon size={14} color={colors.muted2} />
              : <ChevronDownIcon size={14} color={colors.muted2} />}
          </Pressable>
        </Card>
        {showTheme && (
          <Card style={{ marginTop: 8 }}>
            {THEME_OPTIONS.map(({ pref, Icon, tint }, i) => {
              const on = theme.pref === pref;
              return (
                <Pressable
                  key={pref}
                  style={({ pressed }) => [
                    st.row, i > 0 && st.themeRowDivider, pressed && { opacity: 0.7 },
                  ]}
                  onPress={() => { theme.setPref(pref); setShowTheme(false); }}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: on }}
                >
                  <View style={st.rowIcon}>
                    <Icon size={15} color={tint === "amber" ? colors.amber : colors.brand2} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={[st.rowLabel, on && { color: colors.brand2 }]}>
                      {THEME_LABEL[pref]}
                    </Text>
                    <Text style={st.rowHint}>{THEME_HINT[pref]}</Text>
                  </View>
                  {on && <CheckIcon size={14} color={colors.brand2} />}
                </Pressable>
              );
            })}
          </Card>
        )}
        {showCurrency && (
          <Card style={{ marginTop: 8, maxHeight: 320 }}>
            <View style={{ padding: 10 }}>
              <Field placeholder="Search currencies…" value={currencySearch} onChangeText={setCurrencySearch} />
            </View>
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {filteredCurrencies.map((c) => {
                const active = cur.code === c.code;
                return (
                  <Tappable feedback="row"
                    key={c.code}
                    style={st.curRow}
                    onPress={() => { cur.setCode(c.code); setShowCurrency(false); }}
                  >
                    <CurrencyMark flag={c.flag} symbol={c.symbol} />
                    <Text style={[st.curName, active && { color: colors.brand2 }]} numberOfLines={1}>
                      {c.name}
                    </Text>
                    <Text style={st.curCode}>{c.code.toUpperCase()}</Text>
                    {active && <CheckIcon size={14} color={colors.brand2} />}
                  </Tappable>
                );
              })}
              {filteredCurrencies.length === 0 && (
                <Text style={[st.rowHint, { textAlign: "center", padding: 16 }]}>No currencies found</Text>
              )}
            </ScrollView>
          </Card>
        )}

        {/* ── Danger zone ── */}
        <SectionLabel text="Danger zone" style={{ marginTop: 18, marginBottom: 6 } as object} />
        <Card style={{ padding: 14 }}>
          <Text style={st.rowHint}>
            Removing the wallet deletes every key from this phone. The recovery
            phrase is the ONLY way back in.
          </Text>
          {/* Was a tap-once-then-tap-again button, which is a confirmation the
              user can complete by accident with one impatient double tap. The
              sheet makes the second act a different act. */}
          <Btn
            label="Remove all wallets from this device"
            variant="danger"
            onPress={() => setConfirmWipe(true)}
          />
        </Card>

        <Tappable feedback="ghost"
          onPress={() => {
            // 5 taps on the version footer opens the hidden developer screen.
            (SettingsScreen as unknown as { _t?: number })._t =
              ((SettingsScreen as unknown as { _t?: number })._t ?? 0) + 1;
            if (((SettingsScreen as unknown as { _t?: number })._t ?? 0) >= 5) {
              (SettingsScreen as unknown as { _t?: number })._t = 0;
              onDev();
            }
          }}
        >
          {/* Keep in step with app.json `version`. A footer that disagrees with
              the installed build makes "which version are you on?" unanswerable
              during support. */}
          <Text style={st.version}>NumPay · v1.02</Text>
        </Tappable>
        <View style={{ height: 20 }} />
      </ScrollView>

      {/* Re-auth gate. Rendered OVER the screen so the phrase cannot appear
          behind it, and the mnemonic is read only once it passes. */}
      <RevealGate
        open={revealGate}
        title="Reveal recovery phrase"
        body="These words control this wallet on any device. Confirm your PIN before they are shown."
        onCancel={() => setRevealGate(false)}
        onPass={async () => {
          setRevealGate(false);
          const mn = await getActiveMnemonic();
          if (mn) setRevealed(mn);
        }}
      />

      <ConfirmSheet
        open={!!confirmRemove}
        tone="danger"
        icon={<ShieldIcon size={21} color={colors.dangerText} />}
        title={`Remove ${confirmRemove?.name ?? "this wallet"}?`}
        body="This deletes the wallet's keys from this phone. Its recovery phrase is the only way to get it back."
        confirmLabel="Remove wallet"
        onClose={() => setConfirmRemove(null)}
        onConfirm={async () => {
          const m = confirmRemove;
          setConfirmRemove(null);
          if (!m) return;
          try {
            await removeWallet(m.id);
            reload();
            toast.success("Wallet removed", `${m.name} is no longer on this phone.`);
          } catch (e) {
            toast.error("Could not remove wallet", String((e as Error)?.message ?? e));
          }
        }}
      />

      <ConfirmSheet
        open={confirmWipe}
        tone="danger"
        icon={<ShieldIcon size={21} color={colors.dangerText} />}
        title="Remove everything?"
        body="Every wallet and every key is deleted from this phone. Without the recovery phrases there is no way back in, and nobody can restore them for you."
        confirmLabel="Remove everything"
        onClose={() => setConfirmWipe(false)}
        onConfirm={() => { setConfirmWipe(false); onWipe(); }}
      />

      {/* Arming a self-destruct is itself a destructive act, so it gets the same
          treatment as the wipe above. The body leads with the failure mode the
          user is signing up for, not with the benefit. */}
      <ConfirmSheet
        open={confirmArmWipe}
        tone="danger"
        icon={<ShieldIcon size={21} color={colors.dangerText} />}
        title={`Erase this wallet after ${WIPE_AFTER_ATTEMPTS} wrong PINs?`}
        body={`Forgetting your own PIN would delete this phone's copy of every wallet in it. Only your recovery phrase brings them back, and nobody can restore it for you. The lockout delays (30s, 5 min, 30 min) still apply on the way there, and the lock screen shows the count once it starts.`}
        confirmLabel="Turn it on"
        onClose={() => setConfirmArmWipe(false)}
        onConfirm={async () => {
          setConfirmArmWipe(false);
          await setWipeOnFail(true);
          setWipeOnFailState(true);
          toast.warn(
            "Erase-on-failure on",
            `${WIPE_AFTER_ATTEMPTS} wrong PINs will delete this phone's copy. Make sure your recovery phrase is written down.`,
          );
        }}
      />
    </View>
  );
}

const st = themedStyles((colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 14,
    paddingVertical: 13,
  },
  rowIcon: { width: 22, alignItems: "center", marginRight: 10 },
  rowLabel: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "500" },
  rowHint: { color: colors.muted, fontSize: ts.small, marginTop: 2, lineHeight: 15 },
  rowRight: { color: colors.brand2, fontSize: ts.body, fontWeight: "600", marginRight: 8 },
  hairline: {
    height: StyleSheet.hairlineWidth,
    backgroundColor: colors.divider,
    marginHorizontal: 14,
  },
  /** Between theme options. A border on the row rather than a separate hairline
   *  view, so the whole row stays one press target. */
  themeRowDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },

  walletRow: { flexDirection: "row", alignItems: "center", paddingHorizontal: 14, paddingVertical: 12 },
  walletDivider: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.divider,
  },
  walletMain: { flexDirection: "row", alignItems: "center", gap: 12, flex: 1 },
  radio: {
    width: 20, height: 20, borderRadius: 10,
    borderWidth: 1.5, borderColor: colors.border,
    alignItems: "center", justifyContent: "center",
  },
  radioOn: { borderColor: colors.brand },
  radioDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: colors.brand },
  walletAction: { paddingHorizontal: 8, paddingVertical: 4 },
  walletActionText: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
  walletSubAction: { color: colors.muted, fontSize: ts.small, fontWeight: "500" },

  curRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 10,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider,
  },
  curName: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "500", flex: 1 },
  curCode: { color: colors.muted, fontSize: ts.small },
  curCurrent: { flexDirection: "row", alignItems: "center", gap: 7 },
  curSymMark: { color: colors.brand2, fontSize: 12, fontWeight: "700", textAlign: "center" },
  // Footer under the revealed phrase: countdown on the left, copy on the right.
  revealFoot: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  countdown: { flexDirection: "row", alignItems: "center", gap: 6 },
  countdownDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.caution },
  countdownText: {
    color: colors.muted, fontSize: ts.small, fontWeight: "600",
    fontVariant: ["tabular-nums"],
  },
  copyBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 2 },
  copyText: { color: colors.muted, fontSize: ts.small, fontWeight: "600" },
  version: {
    color: colors.muted2, fontSize: ts.label, textAlign: "center",
    paddingVertical: 24, letterSpacing: 0.4,
  },
}));
