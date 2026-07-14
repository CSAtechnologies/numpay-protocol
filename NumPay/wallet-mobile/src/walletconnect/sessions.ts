// WalletConnect session lifecycle for NumPay mobile (Slice 2): approve/reject
// a session_proposal and expose the active-sessions list for the Connected
// dApps screen. All the decision logic (what to offer, how to summarise a
// proposal) is pure and lives in sessionsCore.ts — this module only performs
// the WalletKit calls and notifies the UI of changes.
import { getSdkError } from "@walletconnect/utils";
import type { SessionTypes } from "@walletconnect/types";
import type { WalletKitTypes } from "@reown/walletkit";
import {
  buildSessionNamespaces,
  sessionInfoFrom,
  type SessionInfo,
  type WcAccounts,
} from "./sessionsCore";
import { initWalletKit, getActiveSessions } from "./client";

export {
  chainNameById,
  summarizeProposal,
  supportedEip155Chains,
  type ProposalSummary,
  type SessionInfo,
} from "./sessionsCore";

/**
 * Approve a session proposal, exposing the EVM account on every supported EVM
 * chain and (when derived) the Solana account on mainnet. Throws (with
 * buildApprovedNamespaces' reason) if the proposal REQUIRES something NumPay
 * cannot provide — the sheet surfaces that and offers reject.
 */
export async function approveProposal(
  p: WalletKitTypes.SessionProposal,
  accounts: WcAccounts,
): Promise<SessionTypes.Struct> {
  const kit = await initWalletKit();
  const namespaces = buildSessionNamespaces(p.params, accounts);
  const session = await kit.approveSession({ id: p.id, namespaces });
  emitSessionsChanged();
  return session;
}

export async function rejectProposal(p: WalletKitTypes.SessionProposal): Promise<void> {
  const kit = await initWalletKit();
  await kit.rejectSession({ id: p.id, reason: getSdkError("USER_REJECTED") });
}

export function listSessions(): SessionInfo[] {
  return Object.values(getActiveSessions()).map(sessionInfoFrom);
}

// ── change notifications (sessions screen re-render) ─────────────────────────
// Deliberately tiny: the approval host and the disconnect button call
// emitSessionsChanged(); the Connected dApps screen subscribes.

const listeners = new Set<() => void>();

export function subscribeSessionsChanged(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

export function emitSessionsChanged(): void {
  for (const cb of listeners) cb();
}
