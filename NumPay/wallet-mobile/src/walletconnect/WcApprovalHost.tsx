// Always-mounted (while unlocked) WalletConnect approval surface. Subscribes to
// the transport's events and renders, over whatever screen is open:
//   • the session-proposal sheet (Slice 2) — which dApp, origin attestation,
//     chains; Connect / Reject.
//   • the signing sheet (Slice 3 UI) — the core engine's decoded preview of
//     personal_sign / eth_signTypedData_v4 / eth_sendTransaction plus risk
//     flags; Confirm / Reject. Confirm runs the gated vault path in
//     approveSessionRequest; NOTHING here signs without a tap.
// Requests queue in arrival order; one sheet shows at a time. The re-lock
// overlay in App.tsx sits at a higher zIndex, so an expired session always
// covers these sheets.
import { useEffect, useMemo, useState } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import type { WalletKitTypes } from "@reown/walletkit";
import { NETWORKS } from "@numpay/core/networks";
import type { RiskFlag } from "@numpay/core/dapp";
import { colors, radius, spacing, type as ts } from "../ui/theme";
import { AlertCard, Btn, Card, SectionLabel } from "../ui/components";
import { TxResultOverlay } from "../ui/TxResultOverlay";
import { hasProjectId } from "./config";
import { getActiveSessions, initWalletKit, pair, setWcHandlers } from "./client";
import { subscribeWcDeepLinks } from "./deepLink";
import {
  approveProposal,
  emitSessionsChanged,
  rejectProposal,
  summarizeProposal,
} from "./sessions";
import {
  approveSessionRequest,
  previewSessionRequest,
  rejectSessionRequest,
  tryAutoRespond,
  type WcAccounts,
  type WcBroadcastResult,
} from "./signRequests";

function chainName(chainId: number): string {
  const net = Object.values(NETWORKS).find((n) => n.chainId === chainId);
  return net ? net.name : `Chain ${chainId}`;
}

// Cap huge payloads at display time; the engine already capped them at 128 KB,
// but even a few KB of hex is unreadable and janks the sheet's scroll.
function clip(s: string, max = 1200): string {
  return s.length <= max ? s : `${s.slice(0, max)}… (${s.length - max} more chars)`;
}

export function WcApprovalHost({
  accounts,
  onSessionExpired,
}: {
  accounts: WcAccounts;
  onSessionExpired: () => void;
}) {
  const [proposals, setProposals] = useState<WalletKitTypes.SessionProposal[]>([]);
  const [requests, setRequests] = useState<WalletKitTypes.SessionRequest[]>([]);
  const [pairError, setPairError] = useState("");

  useEffect(() => {
    setWcHandlers({
      onSessionProposal: (p) => {
        setPairError(""); // a proposal proves the pairing worked after all
        setProposals((q) => [...q, p]);
      },
      onSessionRequest: (r) => {
        if (tryAutoRespond(r)) return;
        setRequests((q) => [...q, r]);
      },
      onSessionDelete: () => emitSessionsChanged(),
      // A sheet whose request died dApp-side must dismiss itself; answering an
      // expired id errors, and a zombie sheet blocks every later request.
      onProposalExpire: (e) => setProposals((q) => q.filter((p) => p.id !== e.id)),
      onRequestExpire: (e) => setRequests((q) => q.filter((r) => r.id !== e.id)),
    });
    // Resume existing sessions after an app restart so already-connected dApps
    // can reach the wallet again, and DRAIN anything that arrived while the
    // wallet was locked: the host unmounts on lock, so proposals/requests that
    // landed in that window fired into no handler and only exist in WalletKit's
    // pending stores. Without this drain they are silently lost until expiry
    // (observed live: pair while locked -> unlock -> no sheet). Best-effort:
    // without a projectId (or offline) the transport stays down until the user
    // opens the Connected dApps screen.
    if (hasProjectId()) {
      initWalletKit()
        .then((kit) => {
          // The store holds raw proposal structs; the sheets expect the event
          // shape. Verify-context only travels with the live event, so a
          // drained proposal gets the conservative "unverified" fallback.
          for (const p of Object.values(kit.getPendingSessionProposals() ?? {})) {
            const s = p as { id: number; proposer?: { metadata?: { url?: string } } };
            const proposal = {
              id: s.id,
              params: s,
              verifyContext: {
                verified: {
                  origin: s.proposer?.metadata?.url ?? "",
                  validation: "UNKNOWN",
                  verifyUrl: "",
                },
              },
            } as unknown as WalletKitTypes.SessionProposal;
            setProposals((q) =>
              q.some((x) => x.id === proposal.id) ? q : [...q, proposal],
            );
          }
          // Pending requests are stored event-shaped already.
          for (const r of kit.getPendingSessionRequests() ?? []) {
            const request = r as unknown as WalletKitTypes.SessionRequest;
            if (tryAutoRespond(request)) continue;
            setRequests((q) =>
              q.some((x) => x.id === request.id) ? q : [...q, request],
            );
          }
        })
        .catch(() => {});
    }
    // `wc:` deep links ("open in wallet" buttons, tapped QR fallbacks) start a
    // pairing directly; the proposal that follows renders above. The tap is the
    // user's intent, so a failure must be visible, not a silent nothing.
    const unsubLinks = subscribeWcDeepLinks((uri) => {
      pair(uri).catch((e) =>
        setPairError(`Could not connect: ${String((e as Error)?.message ?? e)}`),
      );
    });
    return () => {
      setWcHandlers({});
      unsubLinks();
    };
  }, []);

  if (!accounts.evm) return null;

  // Proposals first: a request for a session mid-approval cannot exist, and the
  // connect decision is the more consequential one.
  const proposal = proposals[0];
  const request = proposal ? undefined : requests[0];

  if (!proposal && !request && !pairError) return null;

  return (
    <View style={st.overlay}>
      {!proposal && !request && !!pairError && (
        <View style={st.sheet}>
          <View style={{ flex: 1, justifyContent: "center" }}>
            <AlertCard
              tone="danger"
              title="Connection failed"
              body={pairError}
              hint="Ask the dApp for a fresh WalletConnect link or QR code; they expire quickly."
            />
          </View>
          <Btn label="Dismiss" variant="secondary" onPress={() => setPairError("")} />
        </View>
      )}
      {proposal && (
        <ProposalSheet
          key={proposal.id}
          proposal={proposal}
          accounts={accounts}
          onDone={() => setProposals((q) => q.filter((p) => p.id !== proposal.id))}
        />
      )}
      {request && (
        <RequestSheet
          key={`${request.topic}:${request.id}`}
          request={request}
          accounts={accounts}
          onSessionExpired={onSessionExpired}
          onDone={() => setRequests((q) => q.filter((r) => r.id !== request.id))}
        />
      )}
    </View>
  );
}

// ── shared sheet chrome ───────────────────────────────────────────────────────

function SheetHeader({ title, name, url, iconUrl }: {
  title: string; name: string; url: string; iconUrl?: string;
}) {
  return (
    <View style={{ alignItems: "center", marginBottom: 16 }}>
      {iconUrl ? (
        <Image source={{ uri: iconUrl }} style={st.dappIcon} />
      ) : (
        <View style={[st.dappIcon, st.dappIconFallback]}>
          <Text style={{ color: colors.brand2, fontSize: 20, fontWeight: "700" }}>
            {(name || "?").slice(0, 1).toUpperCase()}
          </Text>
        </View>
      )}
      <Text style={st.sheetTitle}>{title}</Text>
      <Text style={st.dappName}>{name}</Text>
      {!!url && <Text style={st.dappUrl} numberOfLines={1}>{url}</Text>}
    </View>
  );
}

function VerifyWarning({ verification }: {
  verification: "verified" | "unverified" | "mismatch" | "scam";
}) {
  if (verification === "verified") return null;
  if (verification === "scam") {
    return (
      <AlertCard
        tone="danger"
        title="Flagged as malicious"
        body="WalletConnect flags this site as a known scam. Reject this request."
        style={{ marginBottom: 10 }}
      />
    );
  }
  if (verification === "mismatch") {
    return (
      <AlertCard
        tone="danger"
        title="Origin mismatch"
        body="The site that sent this does not match the dApp it claims to be. This is a common phishing sign."
        style={{ marginBottom: 10 }}
      />
    );
  }
  return (
    <AlertCard
      tone="amber"
      title="Unverified site"
      body="This dApp's domain could not be verified. Only continue if you opened it yourself and trust it."
      style={{ marginBottom: 10 }}
    />
  );
}

function RiskRows({ risk }: { risk: RiskFlag[] }) {
  return (
    <>
      {risk.map((r, i) => (
        <View key={i} style={[st.riskRow, r.level === "warn" && st.riskRowWarn]}>
          <Text style={[st.riskText, r.level === "warn" && { color: colors.amber }]}>
            {r.level === "warn" ? "⚠ " : ""}{r.text}
          </Text>
        </View>
      ))}
    </>
  );
}

function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ marginTop: 8 }}>
      <SectionLabel text={label} />
      <Text style={[st.kvValue, mono && { fontFamily: "monospace" }]} selectable>
        {value}
      </Text>
    </View>
  );
}

// ── session proposal (Slice 2) ────────────────────────────────────────────────

function ProposalSheet({ proposal, accounts, onDone }: {
  proposal: WalletKitTypes.SessionProposal;
  accounts: WcAccounts;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const sum = useMemo(
    () => summarizeProposal(proposal, !!accounts.solana),
    [proposal, accounts.solana],
  );
  const blocked = sum.unsupportedRequired.length > 0;

  const reject = () => {
    setBusy(true);
    rejectProposal(proposal).catch(() => {}).finally(onDone);
  };
  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      await approveProposal(proposal, accounts);
      onDone();
    } catch (e) {
      setError(`Could not approve this connection: ${String((e as Error)?.message ?? e)}`);
      setBusy(false);
    }
  };

  return (
    <View style={st.sheet}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <SheetHeader title="Connection request" name={sum.name} url={sum.url} iconUrl={sum.iconUrl} />
        <VerifyWarning verification={sum.verification} />

        {blocked && (
          <AlertCard
            tone="danger"
            title="Can't connect"
            body={`This dApp requires ${sum.unsupportedRequired.join(", ")}, which NumPay does not support yet.`}
            style={{ marginBottom: 10 }}
          />
        )}

        <Card style={{ padding: 14, marginBottom: 10 }}>
          <SectionLabel text="This site will be able to" />
          <Text style={st.permLine}>•  See your wallet address and balance</Text>
          <Text style={st.permLine}>•  Ask you to approve transactions and signatures</Text>
          <Text style={st.permNote}>It cannot move funds without your approval each time.</Text>
        </Card>

        <Card style={{ padding: 14, marginBottom: 10 }}>
          <SectionLabel text="Account" />
          <Text style={[st.kvValue, { fontFamily: "monospace" }]} selectable>{accounts.evm}</Text>
          {!!accounts.solana && (
            <>
              <Text style={[st.permNote, { marginTop: 10 }]}>Solana</Text>
              <Text style={[st.kvValue, { fontFamily: "monospace" }]} selectable>{accounts.solana}</Text>
            </>
          )}
          {sum.chainNames.length > 0 && (
            <Text style={st.permNote}>
              Networks: <Text style={{ color: colors.brand2 }}>{sum.chainNames.join(", ")}</Text>
            </Text>
          )}
        </Card>

        {!!error && <Text style={st.err}>{error}</Text>}
      </ScrollView>

      <View style={st.btnRow}>
        <Btn label="Reject" variant="secondary" onPress={reject} disabled={busy} style={{ flex: 1 }} />
        {!blocked && (
          <Btn label={busy ? "Connecting…" : "Connect"} onPress={() => { void approve(); }} disabled={busy} style={{ flex: 1 }} />
        )}
      </View>
    </View>
  );
}

// ── per-request signing sheet (Slice 3 UI) ────────────────────────────────────

function RequestSheet({ request, accounts, onSessionExpired, onDone }: {
  request: WalletKitTypes.SessionRequest;
  accounts: WcAccounts;
  onSessionExpired: () => void;
  onDone: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Set once a request actually broadcast a transaction: the sheet swaps to
  // the same result overlay in-app sends show, so a dApp send is not a silent
  // sheet-close (observed as "nothing happened" after the exit-test tx).
  const [sent, setSent] = useState<WcBroadcastResult | null>(null);
  const routed = useMemo(() => previewSessionRequest(request, accounts), [request, accounts]);
  const peer = getActiveSessions()[request.topic]?.peer?.metadata;
  const verified = request.verifyContext?.verified;

  // Narrow the namespace union once; exactly one of these is non-null.
  const bad = !routed.preview.ok ? routed.preview : null;
  const evm = routed.ns === "eip155" && routed.preview.ok ? routed.preview : null;
  const sol = routed.ns === "solana" && routed.preview.ok ? routed.preview : null;
  // A Solana tx (or any tx in a batch) whose fee payer isn't the connected
  // account must not offer an approve button (the sign path re-enforces this,
  // but the UI blocks first).
  const solBlocked = !!(
    sol &&
    (sol.detail.kind === "sol_tx" || sol.detail.kind === "sol_tx_batch") &&
    sol.detail.feePayerMismatch
  );
  const canConfirm = !bad && !solBlocked;

  const reject = () => {
    setBusy(true);
    rejectSessionRequest(request).catch(() => {}).finally(onDone);
  };
  const approve = async () => {
    setBusy(true);
    setError("");
    try {
      const broadcast = await approveSessionRequest(request, accounts, onSessionExpired);
      if (broadcast) setSent(broadcast);
      else onDone();
    } catch (e) {
      const msg = String((e as Error)?.message ?? e);
      // Vault expiry: the re-lock overlay is now covering this sheet; keep it
      // mounted so the user can confirm again after re-auth.
      setError(/vault locked/i.test(msg)
        ? "Wallet locked. Unlock and confirm again."
        : `Could not complete this request: ${msg}`);
      setBusy(false);
    }
  };

  const title = bad
    ? "Unsupported request"
    : evm
      ? evm.detail.kind === "personal_sign"
        ? "Signature request"
        : evm.detail.kind === "typed_data"
          ? "Typed data signature"
          : "Transaction request"
      : sol!.detail.kind === "sol_message"
        ? "Signature request"
        : sol!.detail.kind === "sol_tx_batch"
          ? `Sign ${sol!.detail.txsB64.length} transactions`
          : sol!.detail.send
            ? "Transaction request"
            : "Sign transaction";
  const sends =
    (evm && evm.method === "eth_sendTransaction") ||
    (sol && sol.detail.kind === "sol_tx" && sol.detail.send);

  if (sent) {
    return (
      <TxResultOverlay
        status="success"
        kind="send"
        amountLabel={evm && evm.detail.kind === "send_tx" ? evm.detail.valueLabel : undefined}
        detail={`Requested by ${peer?.name || "a connected dApp"}`}
        txHash={sent.txHash}
        explorerUrl={sent.explorerUrl}
        onClose={onDone}
      />
    );
  }

  return (
    <View style={st.sheet}>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <SheetHeader
          title={title}
          name={peer?.name || "Unknown dApp"}
          url={peer?.url || ""}
          iconUrl={peer?.icons?.[0]}
        />
        {(verified?.isScam || verified?.validation === "INVALID") && (
          <VerifyWarning verification={verified?.isScam ? "scam" : "mismatch"} />
        )}

        {bad && (
          <AlertCard
            tone="danger"
            title="NumPay won't sign this"
            body={`${bad.error} (code ${bad.code}). Rejecting is the only safe response.`}
            safe
            style={{ marginBottom: 10 }}
          />
        )}

        {solBlocked && (
          <AlertCard
            tone="danger"
            title="Fee payer mismatch"
            body="The fee payer of this transaction is not your connected account. NumPay will not sign it. Reject it."
            safe
            style={{ marginBottom: 10 }}
          />
        )}

        {(evm || sol) && (
          <>
            {evm && <RiskRows risk={evm.risk} />}

            <Card style={{ padding: 14, marginBottom: 10 }}>
              <SectionLabel text="Signing account" />
              <Text style={[st.kvValue, { fontFamily: "monospace" }]} selectable>
                {evm ? evm.account : sol!.account}
              </Text>
              <Text style={st.permNote}>
                Network:{" "}
                <Text style={{ color: colors.brand2 }}>
                  {evm ? chainName(evm.chainId) : "Solana Mainnet"}
                </Text>
              </Text>
            </Card>
          </>
        )}

        {evm && (
          <>
            {evm.detail.kind === "personal_sign" && (
              <Card style={{ padding: 14, marginBottom: 10 }}>
                <SectionLabel text="Message" />
                {evm.detail.message.isUtf8 ? (
                  <Text style={st.kvValue} selectable>{clip(evm.detail.message.text)}</Text>
                ) : (
                  <>
                    <Text style={st.permNote}>Raw bytes (not readable text):</Text>
                    <Text style={[st.kvValue, st.rawData]} selectable>
                      {clip(evm.detail.message.hex)}
                    </Text>
                  </>
                )}
              </Card>
            )}

            {evm.detail.kind === "typed_data" && (
              <Card style={{ padding: 14, marginBottom: 10 }}>
                <SectionLabel
                  text={
                    (evm.detail.typed.domain.name ? `${evm.detail.typed.domain.name} · ` : "") +
                    evm.detail.typed.primaryType
                  }
                />
                {!!evm.detail.typed.domain.verifyingContract && (
                  <Text style={st.permNote}>
                    Contract:{" "}
                    <Text style={{ fontFamily: "monospace", color: colors.textSecondary }}>
                      {evm.detail.typed.domain.verifyingContract}
                    </Text>
                  </Text>
                )}
                <Text style={[st.kvValue, st.rawData]} selectable>
                  {clip(JSON.stringify(evm.detail.typed.message, null, 2), 2400)}
                </Text>
              </Card>
            )}

            {evm.detail.kind === "send_tx" && (
              <>
                <Card style={{ padding: 14, marginBottom: 10 }}>
                  <KV label="From" value={evm.account} mono />
                  <KV label="To" value={evm.detail.tx.to || "(contract creation)"} mono />
                  <Text style={st.permNote}>
                    Amount: <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{evm.detail.valueLabel}</Text>
                    <Text> · {chainName(evm.chainId)}</Text>
                  </Text>
                </Card>
                <Card style={{ padding: 14, marginBottom: 10 }}>
                  <SectionLabel text="Action" />
                  <Text style={st.kvValue}>{evm.detail.decoded.summary}</Text>
                  {evm.detail.decoded.hasData && !!evm.detail.tx.data && (
                    <>
                      <Text style={[st.permNote, { marginTop: 10 }]}>Raw data</Text>
                      <Text style={[st.kvValue, st.rawData]} selectable>
                        {clip(evm.detail.tx.data)}
                      </Text>
                    </>
                  )}
                </Card>
              </>
            )}
          </>
        )}

        {sol && sol.detail.kind === "sol_message" && (
          <Card style={{ padding: 14, marginBottom: 10 }}>
            <SectionLabel text="Message" />
            {sol.detail.message.isUtf8 ? (
              <Text style={st.kvValue} selectable>{clip(sol.detail.message.text)}</Text>
            ) : (
              <>
                <Text style={st.permNote}>Raw bytes (not readable text), base64:</Text>
                <Text style={[st.kvValue, st.rawData]} selectable>
                  {clip(sol.detail.message.base64)}
                </Text>
              </>
            )}
          </Card>
        )}

        {sol && sol.detail.kind === "sol_tx_batch" && (
          <Card style={{ padding: 14, marginBottom: 10 }}>
            <SectionLabel text={`${sol.detail.txsB64.length} transactions`} />
            <Text style={st.permNote}>
              All are signed together and returned to the site; nothing is sent by NumPay.
            </Text>
            {sol.detail.inspections.map((ins, i) => (
              <View key={i} style={{ marginTop: 10 }}>
                <Text style={st.kvValue}>
                  {i + 1}. {ins.instructionCount} instruction{ins.instructionCount === 1 ? "" : "s"}
                </Text>
                {ins.programs.map((prog, j) => (
                  <Text key={j} style={[st.kvValue, !prog.name && st.rawData]} selectable>
                    {"   "}{prog.name ?? prog.id}
                  </Text>
                ))}
              </View>
            ))}
          </Card>
        )}

        {sol && sol.detail.kind === "sol_tx" && (
          <Card style={{ padding: 14, marginBottom: 10 }}>
            <SectionLabel text="Transaction" />
            <Text style={st.kvValue}>
              {sol.detail.inspection.instructionCount} instruction
              {sol.detail.inspection.instructionCount === 1 ? "" : "s"}
              {sol.detail.send ? ", will be sent after signing" : ", signed and returned to the site"}
            </Text>
            {sol.detail.inspection.programs.length > 0 && (
              <>
                <Text style={[st.permNote, { marginTop: 10 }]}>Programs it calls</Text>
                {sol.detail.inspection.programs.map((prog, i) => (
                  <Text key={i} style={[st.kvValue, !prog.name && st.rawData]} selectable>
                    {prog.name ?? prog.id}
                  </Text>
                ))}
              </>
            )}
            {sol.detail.inspection.usesLookupTables && (
              <Text style={[st.permNote, { marginTop: 10 }]}>
                Uses address lookup tables, so some accounts it touches can't be listed here.
              </Text>
            )}
          </Card>
        )}

        {!!error && <Text style={st.err}>{error}</Text>}
      </ScrollView>

      <View style={st.btnRow}>
        <Btn label="Reject" variant="secondary" onPress={reject} disabled={busy} style={{ flex: 1 }} />
        {canConfirm && (
          <Btn
            label={busy ? (sends ? "Sending…" : "Signing…") : "Confirm"}
            onPress={() => { void approve(); }}
            disabled={busy}
            style={{ flex: 1 }}
          />
        )}
      </View>
    </View>
  );
}

const st = StyleSheet.create({
  // Opaque, full-screen, over every app screen — but UNDER the re-lock overlay
  // (zIndex 10 in App.tsx).
  overlay: {
    position: "absolute",
    top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: colors.bg,
    paddingTop: 56,
    paddingHorizontal: spacing.screen,
    paddingBottom: 24,
    zIndex: 5,
  },
  sheet: { flex: 1 },

  dappIcon: {
    width: 48, height: 48, borderRadius: 14, marginBottom: 10,
    backgroundColor: colors.card,
  },
  dappIconFallback: {
    alignItems: "center", justifyContent: "center",
    borderWidth: 1, borderColor: colors.border,
  },
  sheetTitle: { color: colors.textPrimary, fontSize: ts.h2, fontWeight: "700" },
  dappName: { color: colors.textSecondary, fontSize: ts.body, marginTop: 3 },
  dappUrl: { color: colors.muted, fontSize: ts.small, marginTop: 2 },

  permLine: { color: colors.textSecondary, fontSize: 12, lineHeight: 19, marginTop: 6 },
  permNote: { color: colors.muted, fontSize: ts.small, marginTop: 8 },

  riskRow: {
    borderWidth: 1, borderColor: colors.border,
    backgroundColor: colors.surface2,
    borderRadius: radius.tile,
    paddingHorizontal: 12, paddingVertical: 9,
    marginBottom: 8,
  },
  riskRowWarn: {
    borderColor: "rgba(245, 158, 11, 0.4)",
    backgroundColor: "rgba(245, 158, 11, 0.10)",
  },
  riskText: { color: colors.textSecondary, fontSize: 12, lineHeight: 17 },

  kvValue: { color: colors.textPrimary, fontSize: 12, lineHeight: 18, marginTop: 4 },
  rawData: { color: colors.textSecondary, fontFamily: "monospace", fontSize: 10.5, lineHeight: 15 },

  btnRow: { flexDirection: "row", gap: 8, alignItems: "center" },
  err: { color: colors.danger, fontSize: ts.body, marginTop: 8 },
});
