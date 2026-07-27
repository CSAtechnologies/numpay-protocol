// Shared approval-sheet chrome for every dApp surface NumPay exposes.
//
// Extracted from WcApprovalHost so the in-app browser and WalletConnect show
// the USER the identical thing. That matters more than the code saving: the
// approval sheet is the last screen between a dApp and someone's funds, so a
// signature request must not look one way when it arrives over WalletConnect
// and another way when it comes from a page in the in-app browser. One layout,
// one set of risk warnings, one place to fix a mistake.
//
// Kept full-screen and opaque rather than moved onto the Sheet primitive: the
// deliberate choice for this surface (see WcApprovalHost) is that an approval
// takes over the screen so nothing can be rendered behind or around it.
//
// Presentational only. It renders a preview and reports taps; it never decodes,
// never signs, and holds no transport state.

import type { ReactNode } from "react";
import { Image, ScrollView, StyleSheet, Text, View } from "react-native";
import { NETWORKS } from "@numpay/core/networks";
import type { DappRequestPreview, RiskFlag } from "@numpay/core/dapp";
import { colors, radius, spacing, type as ts } from "./theme";
import { Notice, Btn, Card, SectionLabel } from "./components";

/** A preview that passed validation. */
type OkPreview = Extract<DappRequestPreview, { ok: true }>;

export function chainName(chainId: number): string {
  const net = Object.values(NETWORKS).find((n) => n.chainId === chainId);
  return net ? net.name : `Chain ${chainId}`;
}

// Cap huge payloads at display time; the engine already capped them at 128 KB,
// but even a few KB of hex is unreadable and janks the sheet's scroll.
export function clip(s: string, max = 1200): string {
  return s.length <= max ? s : `${s.slice(0, max)}… (${s.length - max} more chars)`;
}

// ── chrome ───────────────────────────────────────────────────────────────────

/**
 * Full-screen approval surface. Sits above every app screen but BELOW the
 * re-lock overlay (zIndex 10 in App.tsx), so an expired session always covers
 * a pending approval rather than the other way round.
 */
export function DappSheetShell({ children, footer }: {
  children: ReactNode;
  footer: ReactNode;
}) {
  return (
    <View style={st.overlay}>
      <View style={st.sheet}>
        <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
          {children}
        </ScrollView>
        <View style={st.btnRow}>{footer}</View>
      </View>
    </View>
  );
}

export function DappSheetHeader({ title, name, url, iconUrl }: {
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

export type DappVerification = "verified" | "unverified" | "mismatch" | "scam";

export function VerifyWarning({ verification }: { verification: DappVerification }) {
  if (verification === "verified") return null;
  if (verification === "scam") {
    return (
      <Notice
        tone="danger"
        title="Flagged as malicious"
        body="This site is flagged as a known scam. Reject this request."
        style={{ marginBottom: 10 }}
      />
    );
  }
  if (verification === "mismatch") {
    return (
      <Notice
        tone="danger"
        title="Origin mismatch"
        body="The site that sent this does not match the dApp it claims to be. This is a common phishing sign."
        style={{ marginBottom: 10 }}
      />
    );
  }
  return (
    <Notice
      tone="caution"
      title="Unverified site"
      body="This dApp's domain could not be verified. Only continue if you opened it yourself and trust it."
      style={{ marginBottom: 10 }}
    />
  );
}

export function RiskRows({ risk }: { risk: RiskFlag[] }) {
  return (
    <>
      {risk.map((r, i) => (
        <View key={i} style={[st.riskRow, r.level === "warn" && st.riskRowWarn]}>
          <Text style={[st.riskText, r.level === "warn" && { color: colors.caution }]}>
            {r.level === "warn" ? "⚠ " : ""}{r.text}
          </Text>
        </View>
      ))}
    </>
  );
}

export function KV({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <View style={{ marginTop: 8 }}>
      <SectionLabel text={label} />
      <Text style={[st.kvValue, mono && { fontFamily: "monospace" }]} selectable>
        {value}
      </Text>
    </View>
  );
}

/** The "NumPay won't sign this" card for a preview that failed validation. */
export function UnsupportedNotice({ code, error }: { code: number; error: string }) {
  return (
    <Notice
      tone="danger"
      title="NumPay won't sign this"
      body={`${error} (code ${code}). Rejecting is the only safe response.`}
      safe
      style={{ marginBottom: 10 }}
    />
  );
}

// ── the EVM request body ─────────────────────────────────────────────────────

/** Title for an EVM request, by what it actually does. */
export function evmRequestTitle(preview: OkPreview): string {
  switch (preview.detail.kind) {
    case "personal_sign": return "Signature request";
    case "typed_data": return "Typed data signature";
    default: return "Transaction request";
  }
}

/**
 * Everything below the header for an eip155 request: risk flags, the signing
 * account, and the decoded detail. Shared verbatim between WalletConnect and
 * the in-app browser.
 */
export function EvmPreviewBody({ preview }: { preview: OkPreview }) {
  const d = preview.detail;
  return (
    <>
      <RiskRows risk={preview.risk} />

      <Card style={{ padding: 14, marginBottom: 10 }}>
        <SectionLabel text="Signing account" />
        <Text style={[st.kvValue, { fontFamily: "monospace" }]} selectable>
          {preview.account}
        </Text>
        <Text style={st.permNote}>
          Network: <Text style={{ color: colors.brand2 }}>{chainName(preview.chainId)}</Text>
        </Text>
      </Card>

      {d.kind === "personal_sign" && (
        <Card style={{ padding: 14, marginBottom: 10 }}>
          <SectionLabel text="Message" />
          {d.message.isUtf8 ? (
            <Text style={st.kvValue} selectable>{clip(d.message.text)}</Text>
          ) : (
            <>
              <Text style={st.permNote}>Raw bytes (not readable text):</Text>
              <Text style={[st.kvValue, st.rawData]} selectable>{clip(d.message.hex)}</Text>
            </>
          )}
        </Card>
      )}

      {d.kind === "typed_data" && (
        <Card style={{ padding: 14, marginBottom: 10 }}>
          <SectionLabel
            text={(d.typed.domain.name ? `${d.typed.domain.name} · ` : "") + d.typed.primaryType}
          />
          {!!d.typed.domain.verifyingContract && (
            <Text style={st.permNote}>
              Contract:{" "}
              <Text style={{ fontFamily: "monospace", color: colors.textSecondary }}>
                {d.typed.domain.verifyingContract}
              </Text>
            </Text>
          )}
          <Text style={[st.kvValue, st.rawData]} selectable>
            {clip(JSON.stringify(d.typed.message, null, 2), 2400)}
          </Text>
        </Card>
      )}

      {d.kind === "send_tx" && (
        <>
          <Card style={{ padding: 14, marginBottom: 10 }}>
            <KV label="From" value={preview.account} mono />
            <KV label="To" value={d.tx.to || "(contract creation)"} mono />
            <Text style={st.permNote}>
              Amount:{" "}
              <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{d.valueLabel}</Text>
              <Text> · {chainName(preview.chainId)}</Text>
            </Text>
          </Card>
          <Card style={{ padding: 14, marginBottom: 10 }}>
            <SectionLabel text="Action" />
            <Text style={st.kvValue}>{d.decoded.summary}</Text>
            {d.decoded.hasData && !!d.tx.data && (
              <>
                <Text style={[st.permNote, { marginTop: 10 }]}>Raw data</Text>
                <Text style={[st.kvValue, st.rawData]} selectable>{clip(d.tx.data)}</Text>
              </>
            )}
          </Card>
        </>
      )}
    </>
  );
}

/**
 * The connect-approval body: what the site gets, and which account it gets it
 * for. `chains` is free text so each transport can describe its own scope (one
 * chain for the browser, a namespace list for WalletConnect).
 */
export function ConnectPermissionsBody({ account, solanaAccount, chains }: {
  account: string;
  solanaAccount?: string;
  chains?: string;
}) {
  return (
    <>
      <Card style={{ padding: 14, marginBottom: 10 }}>
        <SectionLabel text="This site will be able to" />
        <Text style={st.permLine}>•  See your wallet address and balance</Text>
        <Text style={st.permLine}>•  Ask you to approve transactions and signatures</Text>
        <Text style={st.permNote}>It cannot move funds without your approval each time.</Text>
      </Card>

      <Card style={{ padding: 14, marginBottom: 10 }}>
        <SectionLabel text="Account" />
        <Text style={[st.kvValue, { fontFamily: "monospace" }]} selectable>{account}</Text>
        {!!solanaAccount && (
          <>
            <Text style={[st.permNote, { marginTop: 10 }]}>Solana</Text>
            <Text style={[st.kvValue, { fontFamily: "monospace" }]} selectable>{solanaAccount}</Text>
          </>
        )}
        {!!chains && (
          <Text style={st.permNote}>
            Networks: <Text style={{ color: colors.brand2 }}>{chains}</Text>
          </Text>
        )}
      </Card>
    </>
  );
}

/** Reject + confirm, with the confirm hidden when there is nothing safe to do. */
export function DappSheetActions({ onReject, onConfirm, confirmLabel, busy }: {
  onReject: () => void;
  onConfirm?: () => void;
  confirmLabel: string;
  busy?: boolean;
}) {
  return (
    <>
      <Btn label="Reject" variant="secondary" onPress={onReject} disabled={busy} style={{ flex: 1 }} />
      {!!onConfirm && (
        <Btn label={confirmLabel} onPress={onConfirm} disabled={busy} style={{ flex: 1 }} />
      )}
    </>
  );
}

export const dappSheetStyles = StyleSheet.create({
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

const st = dappSheetStyles;
