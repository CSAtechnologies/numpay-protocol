// The NumPay in-app dApp browser.
//
// A phone browser cannot host an extension, so without this the mobile wallet
// can only reach dApps that implemented WalletConnect. This screen closes that
// gap by hosting the SAME page-world provider the extension injects (see
// browser/injected.generated.ts) inside a WebView, and routing what the page
// asks for through browser/router.ts to the same approval sheet WalletConnect
// uses.
//
// THE ORIGIN RULE, which everything else here depends on:
// the authoritative origin is the one React Native reads from the WebView's
// navigation state (`event.nativeEvent.url`), NEVER the one the page sends. The
// page also stamps its own `location.origin`; a disagreement means the page
// navigated mid-request or is lying, and the request is dropped. Get this
// wrong and any site can sign as any other site.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator, BackHandler, Keyboard, Pressable, ScrollView,
  StyleSheet, Text, TextInput, View,
} from "react-native";
import { WebView, type WebViewNavigation } from "react-native-webview";
import type { WebViewMessageEvent } from "react-native-webview";
import {
  RPC_ERR, revoke, rpcServesChain, resolveInternalChainId, getPermission,
} from "@numpay/core/dapp";
import { saveCustomChain } from "@numpay/core/customChains";
import { colors, radius, spacing, type as ts } from "../ui/theme";
import { Card, EmptyState, Notice, SectionLabel } from "../ui/components";
import {
  ArrowLeftIcon, ChevronRightIcon, GlobeIcon, LockIcon, RefreshIcon, XIcon,
} from "../ui/icons";
import { TxResultOverlay } from "../ui/TxResultOverlay";
import {
  ConnectPermissionsBody, DappSheetActions, DappSheetHeader, DappSheetShell,
  EvmPreviewBody, VerifyWarning, dappSheetStyles as ds, evmRequestTitle,
} from "../ui/DappApprovalSheet";
import { BRIDGE_SHIM_JS, deliverJs, parseBridgeRequest } from "../browser/bridgeShim";
import { INPAGE_EVM_BUNDLE } from "../browser/injected.generated";
import {
  commitConnect, commitSwitchChain, route,
  type BrowserPending,
} from "../browser/router";
import { executeBrowserSign, type BrowserBroadcastResult } from "../browser/signing";
import {
  DEFAULT_BROWSER_CHAIN, chainLabel, displayHost, originOf,
} from "../browser/session";
import {
  SHORTCUTS, listRecents, normalizeUrlInput, recordVisit, removeRecent,
  type RecentSite,
} from "../browser/recents";

/**
 * Everything injected into the page, in order: the bridge first so the
 * delivery hook exists, then the provider that uses it.
 *
 * Android cannot guarantee `injectedJavaScriptBeforeContentLoaded` runs before
 * the page's own scripts (react-native-webview documents it as "not 100%
 * reliable"), so this is ALSO injected on load. Both halves are idempotent —
 * the shim guards on window.__numpayInjected and the provider only claims
 * window.ethereum when it is unclaimed — so a double run is a no-op.
 */
const INJECTION = `${BRIDGE_SHIM_JS}\n${INPAGE_EVM_BUNDLE}\ntrue;`;

/** A request waiting on the user, with what it needs to be answered. */
interface PendingApproval {
  pending: BrowserPending;
  id: string;
  channel: string;
}

export function BrowserScreen({
  account, unlocked, onBack, onSessionExpired,
}: {
  /** The wallet's EVM address, or null when no wallet is set up. */
  account: string | null;
  unlocked: boolean;
  onBack: () => void;
  onSessionExpired: () => void;
}) {
  const webRef = useRef<WebView>(null);

  const [url, setUrl] = useState<string | null>(null); // committed page
  const [input, setInput] = useState("");
  const [navUrl, setNavUrl] = useState(""); // live, from native nav state
  const [title, setTitle] = useState("");
  const [canGoBack, setCanGoBack] = useState(false);
  const [loading, setLoading] = useState(false);
  const [recents, setRecents] = useState<RecentSite[]>([]);

  // Session chain, per the mobile model: the browser owns it, the wallet has no
  // global "active chain" a dApp could repoint (see browser/session.ts).
  const [chain, setChain] = useState<string>(DEFAULT_BROWSER_CHAIN);
  const [chainName, setChainName] = useState("");
  const [connectedAccount, setConnectedAccount] = useState<string | null>(null);

  const [approval, setApproval] = useState<PendingApproval | null>(null);
  const [busy, setBusy] = useState(false);
  const [sheetError, setSheetError] = useState("");
  const [sent, setSent] = useState<BrowserBroadcastResult | null>(null);

  const origin = useMemo(() => originOf(navUrl), [navUrl]);

  // Refs for the callbacks that must not close over stale state: onMessage is
  // handed to the WebView once, and the back handler is registered once.
  const stateRef = useRef({ origin, chain, account, unlocked, approval });
  stateRef.current = { origin, chain, account, unlocked, approval };

  useEffect(() => { void listRecents().then(setRecents); }, []);
  useEffect(() => { void chainLabel(chain).then(setChainName); }, [chain]);

  // ── page -> wallet plumbing ────────────────────────────────────────────────

  const send = useCallback((js: string) => {
    webRef.current?.injectJavaScript(js);
  }, []);

  const respond = useCallback(
    (id: string, channel: string, result?: unknown, error?: unknown) => {
      send(deliverJs({ kind: "response", id, channel, result, error }));
    },
    [send],
  );

  const emit = useCallback(
    (name: string, data: unknown) => {
      send(deliverJs({ kind: "event", name, data }));
    },
    [send],
  );

  // Re-point the session at whatever chain this origin was last connected on,
  // so returning to a dApp does not silently drop it back to mainnet.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!origin) {
        setConnectedAccount(null);
        return;
      }
      const perm = await getPermission(origin);
      if (cancelled) return;
      setConnectedAccount(perm && unlocked ? perm.account : null);
      if (perm) {
        const internal = await resolveInternalChainId(perm.chainId);
        if (!cancelled && internal) setChain(internal);
      }
    })();
    return () => { cancelled = true; };
  }, [origin, unlocked]);

  const onMessage = useCallback(
    async (e: WebViewMessageEvent) => {
      const req = parseBridgeRequest(e.nativeEvent.data);
      if (!req) return;

      // THE ORIGIN RULE. `nativeEvent.url` comes from the native WebView, not
      // from the page, so it is the only trustworthy answer to "who is asking".
      const trusted = originOf(e.nativeEvent.url);
      if (!trusted) return; // non-https or unparseable: never reaches the wallet
      if (req.pageOrigin !== trusted) {
        // The page's own view of its origin disagrees with the browser's.
        // Benign cause (a redirect landing mid-request) and hostile cause look
        // identical from here, so refuse either way.
        respond(req.id, req.channel, undefined, RPC_ERR.unauthorized);
        return;
      }

      const s = stateRef.current;

      // One approval at a time. Without this a hostile page can loop requests
      // and bury the user in sheets until one is tapped by accident.
      if (s.approval) {
        respond(req.id, req.channel, undefined, RPC_ERR.requestPending);
        return;
      }

      const outcome = await route(req.method, req.params, {
        origin: trusted,
        account: s.account,
        unlocked: s.unlocked,
        chainId: s.chain,
      });

      if (outcome.kind === "result") {
        respond(req.id, req.channel, outcome.result);
      } else if (outcome.kind === "error") {
        respond(req.id, req.channel, undefined, outcome.error);
      } else {
        setSheetError("");
        setApproval({ pending: outcome.pending, id: req.id, channel: req.channel });
      }
    },
    [respond],
  );

  // ── approval decisions ─────────────────────────────────────────────────────

  const closeApproval = useCallback(() => {
    setApproval(null);
    setBusy(false);
    setSheetError("");
  }, []);

  const reject = useCallback(() => {
    if (!approval) return;
    respond(approval.id, approval.channel, undefined, RPC_ERR.userRejected);
    closeApproval();
  }, [approval, respond, closeApproval]);

  const confirm = useCallback(async () => {
    if (!approval) return;
    setBusy(true);
    setSheetError("");
    const { pending, id, channel } = approval;
    try {
      if (pending.type === "connect") {
        const res = await commitConnect(pending, account);
        if (!res.ok) {
          respond(id, channel, undefined, res.error);
          closeApproval();
          return;
        }
        respond(id, channel, [res.account]);
        setConnectedAccount(res.account);
        emit("connect", { chainId: "0x" + pending.chainId.toString(16) });
        closeApproval();
        return;
      }

      if (pending.type === "switchChain") {
        await commitSwitchChain(pending);
        setChain(pending.targetInternalId);
        respond(id, channel, null);
        emit("chainChanged", "0x" + pending.chainId.toString(16));
        closeApproval();
        return;
      }

      if (pending.type === "addChain") {
        // Confirm the endpoint really serves the chain id it claims before
        // persisting it, so a site cannot register a chain id pointed at an
        // unrelated node. Same guard the extension applies.
        const served = await rpcServesChain(pending.chain.rpcUrl);
        if (served !== pending.chain.chainId) {
          respond(id, channel, undefined, {
            code: RPC_ERR.invalidParams.code,
            message: `RPC does not serve chain ${pending.chain.chainId}`,
          });
          closeApproval();
          return;
        }
        await saveCustomChain(pending.chain);
        respond(id, channel, null);
        closeApproval();
        return;
      }

      // sign / typed data / sendTransaction
      const { result, broadcast } = await executeBrowserSign(pending, onSessionExpired);
      respond(id, channel, result);
      if (broadcast) {
        setSent(broadcast); // keep the sheet mounted; the overlay replaces it
        setBusy(false);
      } else {
        closeApproval();
      }
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      // Vault expiry: the re-lock overlay is now covering this sheet, so keep
      // it mounted and let the user confirm again after re-auth.
      setSheetError(
        /vault locked/i.test(msg)
          ? "Wallet locked. Unlock and confirm again."
          : `Could not complete this request: ${msg}`,
      );
      setBusy(false);
    }
  }, [approval, account, respond, emit, closeApproval, onSessionExpired]);

  // A locked wallet must not leave a page believing it is still connected.
  useEffect(() => {
    if (!unlocked && origin) {
      emit("accountsChanged", []);
      setConnectedAccount(null);
    }
  }, [unlocked, origin, emit]);

  // ── navigation ─────────────────────────────────────────────────────────────

  const go = useCallback((raw: string) => {
    const next = normalizeUrlInput(raw);
    if (!next) return;
    Keyboard.dismiss();
    setUrl(next);
    setInput(next);
  }, []);

  const onNavChange = useCallback((nav: WebViewNavigation) => {
    setNavUrl(nav.url);
    setTitle(nav.title || "");
    setCanGoBack(nav.canGoBack);
    setLoading(nav.loading);
    if (!nav.loading && nav.url) {
      setInput(nav.url);
      void recordVisit(nav.url, nav.title || "").then(() => listRecents().then(setRecents));
    }
  }, []);

  /**
   * The navigation sandbox. https only, so a page cannot walk itself out into
   * another app (intent:, tel:, a wallet's deep link) or into a local file.
   */
  const allowNavigation = useCallback((req: { url: string }) => originOf(req.url) !== null, []);

  // Hardware back walks the PAGE history first and only leaves the browser at
  // the top of it, which is what a browser is expected to do. A pending
  // approval swallows back entirely: dismissing it with a gesture would leave
  // the dApp's promise hanging with no visible reason.
  const canGoBackRef = useRef(canGoBack);
  canGoBackRef.current = canGoBack;
  const urlRef = useRef(url);
  urlRef.current = url;
  useEffect(() => {
    const sub = BackHandler.addEventListener("hardwareBackPress", () => {
      if (stateRef.current.approval) return true;
      if (canGoBackRef.current) {
        webRef.current?.goBack();
        return true;
      }
      if (urlRef.current) {
        setUrl(null); // back to the start page rather than out of the browser
        setNavUrl("");
        setInput("");
        return true;
      }
      onBack();
      return true;
    });
    return () => sub.remove();
  }, [onBack]);

  const disconnect = useCallback(async () => {
    if (!origin) return;
    await revoke(origin);
    setConnectedAccount(null);
    emit("accountsChanged", []);
  }, [origin, emit]);

  // ── render ─────────────────────────────────────────────────────────────────

  if (sent) {
    return (
      <TxResultOverlay
        status="success"
        kind="send"
        amountLabel={
          approval?.pending.type === "sign" &&
          approval.pending.preview.detail.kind === "send_tx"
            ? approval.pending.preview.detail.valueLabel
            : undefined
        }
        detail={`Requested by ${origin ? displayHost(origin) : "a site"}`}
        txHash={sent.txHash}
        explorerUrl={sent.explorerUrl}
        onClose={() => { setSent(null); closeApproval(); }}
      />
    );
  }

  return (
    <View style={st.wrap}>
      {/* Address bar. The lock glyph is not decoration: every page here is
          https by construction, and showing the host the WALLET resolved (not
          the one the page claims) is the anti-phishing anchor. */}
      <View style={st.bar}>
        <Pressable onPress={onBack} hitSlop={8} style={st.barBtn} accessibilityLabel="Leave the browser">
          <ArrowLeftIcon size={16} color={colors.muted} />
        </Pressable>
        <View style={st.urlBox}>
          <LockIcon size={11} color={origin ? colors.success : colors.muted} />
          <TextInput
            style={st.urlInput}
            value={input}
            onChangeText={setInput}
            onSubmitEditing={() => go(input)}
            placeholder="Search or enter a dApp address"
            placeholderTextColor={colors.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            selectTextOnFocus
          />
          {!!url && (
            <Pressable onPress={() => webRef.current?.reload()} hitSlop={8} accessibilityLabel="Reload">
              <RefreshIcon size={13} color={colors.muted} />
            </Pressable>
          )}
        </View>
      </View>

      {url ? (
        <>
          {loading && <ActivityIndicator style={st.spinner} color={colors.brand} />}
          <WebView
            ref={webRef}
            source={{ uri: url }}
            style={st.web}
            // Best effort at document-start injection; onLoadStart re-injects
            // because Android does not guarantee this runs first.
            injectedJavaScriptBeforeContentLoaded={INJECTION}
            injectedJavaScriptBeforeContentLoadedForMainFrameOnly
            onLoadStart={() => send(INJECTION)}
            onMessage={(e) => { void onMessage(e); }}
            onNavigationStateChange={onNavChange}
            onShouldStartLoadWithRequest={allowNavigation}
            originWhitelist={["https://*"]}
            // No provider in iframes: an embedded frame's origin is not the
            // one shown in the address bar, so it must not be able to ask for
            // a signature the user would attribute to the top-level site.
            javaScriptEnabled
            setSupportMultipleWindows={false}
            allowsInlineMediaPlayback
            thirdPartyCookiesEnabled={false}
          />
          <ConnectionBar
            origin={origin}
            chainName={chainName}
            account={connectedAccount}
            onDisconnect={() => { void disconnect(); }}
          />
        </>
      ) : (
        <StartPage
          recents={recents}
          onOpen={go}
          onForget={(o) => { void removeRecent(o).then(() => listRecents().then(setRecents)); }}
        />
      )}

      {approval && (
        <ApprovalSheet
          approval={approval}
          origin={origin}
          title={title}
          busy={busy}
          error={sheetError}
          onReject={reject}
          onConfirm={() => { void confirm(); }}
        />
      )}
    </View>
  );
}

// ── the approval sheet ───────────────────────────────────────────────────────

function ApprovalSheet({ approval, origin, title, busy, error, onReject, onConfirm }: {
  approval: PendingApproval;
  origin: string | null;
  title: string;
  busy: boolean;
  error: string;
  onReject: () => void;
  onConfirm: () => void;
}) {
  const p = approval.pending;
  const host = origin ? displayHost(origin) : "Unknown site";
  // No "unsupported request" branch here, unlike the WalletConnect sheet: the
  // router rejects a failed preview over the wire, so a request that cannot be
  // signed never becomes a pending approval and never reaches this component.

  const heading =
    p.type === "connect" ? "Connection request"
      : p.type === "switchChain" ? "Switch network"
        : p.type === "addChain" ? "Add network"
          : evmRequestTitle(p.preview);

  const confirmLabel = busy
    ? (p.type === "sign" && p.method === "eth_sendTransaction" ? "Sending…" : "Working…")
    : p.type === "connect" ? "Connect" : "Confirm";

  return (
    <DappSheetShell
      footer={
        <DappSheetActions
          onReject={onReject}
          onConfirm={onConfirm}
          confirmLabel={confirmLabel}
          busy={busy}
        />
      }
    >
      <>
        <DappSheetHeader title={heading} name={title || host} url={origin ?? ""} />
        {/* Every site in the in-app browser is one the user typed or tapped;
            nothing attests to it, so it is never shown as "verified". */}
        <VerifyWarning verification="unverified" />

        {p.type === "connect" && <ConnectPermissionsBody account={p.account} />}

        {p.type === "sign" && <EvmPreviewBody preview={p.preview} />}

        {p.type === "switchChain" && (
          <Card style={{ padding: 14, marginBottom: 10 }}>
            <SectionLabel text="Network" />
            <Text style={ds.kvValue}>
              This site wants to switch to{" "}
              <Text style={{ color: colors.brand2, fontWeight: "600" }}>{p.chainName}</Text>.
            </Text>
            <Text style={ds.permNote}>
              Only this browser tab changes. The rest of NumPay is unaffected.
            </Text>
          </Card>
        )}

        {p.type === "addChain" && (
          <>
            <Notice
              tone="caution"
              title="A site is adding a network"
              body="NumPay will check that the RPC really serves this chain before saving it, but the endpoint itself is chosen by the site."
              style={{ marginBottom: 10 }}
            />
            <Card style={{ padding: 14, marginBottom: 10 }}>
              <SectionLabel text={p.chain.name} />
              <Text style={ds.permNote}>Chain ID: {p.chain.chainId}</Text>
              <Text style={ds.permNote}>Currency: {p.chain.symbol}</Text>
              <Text style={[ds.kvValue, ds.rawData]} selectable>{p.chain.rpcUrl}</Text>
            </Card>
          </>
        )}

        {!!error && <Text style={ds.err}>{error}</Text>}
      </>
    </DappSheetShell>
  );
}

// ── chrome ───────────────────────────────────────────────────────────────────

function ConnectionBar({ origin, chainName, account, onDisconnect }: {
  origin: string | null;
  chainName: string;
  account: string | null;
  onDisconnect: () => void;
}) {
  return (
    <View style={st.connBar}>
      <View style={[st.dot, { backgroundColor: account ? colors.success : colors.muted }]} />
      <Text style={st.connText} numberOfLines={1}>
        {account
          ? `Connected · ${chainName} · ${account.slice(0, 6)}…${account.slice(-4)}`
          : origin
            ? "Not connected"
            : "No site loaded"}
      </Text>
      {!!account && (
        <Pressable onPress={onDisconnect} hitSlop={8} accessibilityLabel="Disconnect this site">
          <XIcon size={13} color={colors.muted} />
        </Pressable>
      )}
    </View>
  );
}

function StartPage({ recents, onOpen, onForget }: {
  recents: RecentSite[];
  onOpen: (url: string) => void;
  onForget: (origin: string) => void;
}) {
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ padding: spacing.screen }}>
      <Notice
        tone="caution"
        title="You are browsing the open web"
        body="NumPay does not vet these sites. Never approve a signature you did not expect, and check the address bar before you connect."
        style={{ marginBottom: 14 }}
      />

      <SectionLabel text="Popular dApps" />
      <View style={st.grid}>
        {SHORTCUTS.map((s) => (
          <Pressable
            key={s.url}
            onPress={() => onOpen(s.url)}
            style={({ pressed }) => [st.tile, pressed && { borderColor: colors.brand }]}
          >
            <GlobeIcon size={15} color={colors.muted} />
            <Text style={st.tileLabel} numberOfLines={1}>{s.name}</Text>
          </Pressable>
        ))}
      </View>

      <View style={{ marginTop: 18 }}>
        <SectionLabel text="Recent" />
        {recents.length === 0 ? (
          <EmptyState
            icon={<GlobeIcon size={20} color={colors.muted} />}
            title="Nothing yet"
            hint="Sites you open here will show up for quick access."
          />
        ) : (
          recents.map((r) => (
            <Pressable key={r.origin} onPress={() => onOpen(r.origin)} style={st.recentRow}>
              <View style={{ flex: 1 }}>
                <Text style={st.recentHost} numberOfLines={1}>{displayHost(r.origin)}</Text>
                {!!r.title && <Text style={st.recentTitle} numberOfLines={1}>{r.title}</Text>}
              </View>
              <Pressable onPress={() => onForget(r.origin)} hitSlop={10} accessibilityLabel={`Forget ${displayHost(r.origin)}`}>
                <XIcon size={12} color={colors.muted} />
              </Pressable>
              <ChevronRightIcon size={14} color={colors.muted} />
            </Pressable>
          ))
        )}
      </View>
    </ScrollView>
  );
}

const st = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: colors.bg },

  bar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: spacing.screen, paddingTop: 8, paddingBottom: 8,
  },
  barBtn: { padding: 4 },
  urlBox: {
    flex: 1, flexDirection: "row", alignItems: "center", gap: 7,
    backgroundColor: colors.surface2,
    borderWidth: 1, borderColor: colors.border,
    borderRadius: radius.tile,
    paddingHorizontal: 10, paddingVertical: 6,
  },
  urlInput: { flex: 1, color: colors.textPrimary, fontSize: ts.small, padding: 0 },

  web: { flex: 1, backgroundColor: colors.bg },
  spinner: { position: "absolute", top: 52, alignSelf: "center", zIndex: 2 },

  connBar: {
    flexDirection: "row", alignItems: "center", gap: 8,
    paddingHorizontal: spacing.screen, paddingVertical: 9,
    borderTopWidth: 1, borderTopColor: colors.border,
    backgroundColor: colors.surface2,
  },
  dot: { width: 7, height: 7, borderRadius: 4 },
  connText: { flex: 1, color: colors.textSecondary, fontSize: ts.small },

  grid: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 8 },
  tile: {
    width: "23.5%", alignItems: "center", gap: 6,
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.card,
    borderRadius: radius.tile, paddingVertical: 12,
  },
  tileLabel: { color: colors.textSecondary, fontSize: 10, maxWidth: "90%" },

  recentRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingVertical: 11,
    borderBottomWidth: 1, borderBottomColor: colors.divider,
  },
  recentHost: { color: colors.textPrimary, fontSize: ts.body },
  recentTitle: { color: colors.muted, fontSize: ts.small, marginTop: 2 },
});
