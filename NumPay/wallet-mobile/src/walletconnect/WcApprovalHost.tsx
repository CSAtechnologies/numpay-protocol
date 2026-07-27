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
import { Text, View } from "react-native";
import type { WalletKitTypes } from "@reown/walletkit";
import { colors } from "../ui/theme";
import { Notice, Btn, Card, SectionLabel } from "../ui/components";
import { TxResultOverlay } from "../ui/TxResultOverlay";
// The sheet chrome is shared with the in-app browser so a signature request
// looks identical wherever it arrives from. Only the Solana bodies below are
// WalletConnect-specific (the browser's EVM-only surface has no equivalent).
import {
  ConnectPermissionsBody,
  DappSheetActions,
  DappSheetHeader,
  DappSheetShell,
  EvmPreviewBody,
  UnsupportedNotice,
  VerifyWarning,
  clip,
  dappSheetStyles as st,
} from "../ui/DappApprovalSheet";
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

  if (!proposal && !request && !!pairError) {
    return (
      <DappSheetShell
        footer={
          <Btn
            label="Dismiss"
            variant="secondary"
            onPress={() => setPairError("")}
            style={{ flex: 1 }}
          />
        }
      >
        <View style={{ flex: 1, justifyContent: "center" }}>
          <Notice
            tone="danger"
            title="Connection failed"
            body={pairError}
            hint="Ask the dApp for a fresh WalletConnect link or QR code; they expire quickly."
          />
        </View>
      </DappSheetShell>
    );
  }

  if (proposal) {
    return (
      <ProposalSheet
        key={proposal.id}
        proposal={proposal}
        accounts={accounts}
        onDone={() => setProposals((q) => q.filter((p) => p.id !== proposal.id))}
      />
    );
  }

  return (
    <RequestSheet
      key={`${request!.topic}:${request!.id}`}
      request={request!}
      accounts={accounts}
      onSessionExpired={onSessionExpired}
      onDone={() => setRequests((q) => q.filter((r) => r.id !== request!.id))}
    />
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
    <DappSheetShell
      footer={
        <DappSheetActions
          onReject={reject}
          onConfirm={blocked ? undefined : () => { void approve(); }}
          confirmLabel={busy ? "Connecting…" : "Connect"}
          busy={busy}
        />
      }
    >
      <DappSheetHeader title="Connection request" name={sum.name} url={sum.url} iconUrl={sum.iconUrl} />
      <VerifyWarning verification={sum.verification} />

      {blocked && (
        <Notice
          tone="danger"
          title="Can't connect"
          body={`This dApp requires ${sum.unsupportedRequired.join(", ")}, which NumPay does not support yet.`}
          style={{ marginBottom: 10 }}
        />
      )}

      <ConnectPermissionsBody
        account={accounts.evm}
        solanaAccount={accounts.solana}
        chains={sum.chainNames.length > 0 ? sum.chainNames.join(", ") : undefined}
      />

      {!!error && <Text style={st.err}>{error}</Text>}
    </DappSheetShell>
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
    <DappSheetShell
      footer={
        <DappSheetActions
          onReject={reject}
          onConfirm={canConfirm ? () => { void approve(); } : undefined}
          confirmLabel={busy ? (sends ? "Sending…" : "Signing…") : "Confirm"}
          busy={busy}
        />
      }
    >
      <>
        <DappSheetHeader
          title={title}
          name={peer?.name || "Unknown dApp"}
          url={peer?.url || ""}
          iconUrl={peer?.icons?.[0]}
        />
        {(verified?.isScam || verified?.validation === "INVALID") && (
          <VerifyWarning verification={verified?.isScam ? "scam" : "mismatch"} />
        )}

        {bad && <UnsupportedNotice code={bad.code} error={bad.error} />}

        {solBlocked && (
          <Notice
            tone="danger"
            title="Fee payer mismatch"
            body="The fee payer of this transaction is not your connected account. NumPay will not sign it. Reject it."
            safe
            style={{ marginBottom: 10 }}
          />
        )}

        {evm && <EvmPreviewBody preview={evm} />}

        {sol && (
          <Card style={{ padding: 14, marginBottom: 10 }}>
            <SectionLabel text="Signing account" />
            <Text style={[st.kvValue, { fontFamily: "monospace" }]} selectable>
              {sol.account}
            </Text>
            <Text style={st.permNote}>
              Network: <Text style={{ color: colors.brand2 }}>Solana Mainnet</Text>
            </Text>
          </Card>
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
      </>
    </DappSheetShell>
  );
}
