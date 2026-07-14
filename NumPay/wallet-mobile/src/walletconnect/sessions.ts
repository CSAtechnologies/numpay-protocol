// WalletConnect session lifecycle for NumPay mobile (Slice 2): summarise a
// session_proposal for the approval sheet, approve/reject it, and expose the
// active-sessions list for the Connected dApps screen.
//
// Approval policy (eip155 only for now; solana is Slice 5):
//   • Chains offered = every EVM network in core's NETWORKS table.
//   • Methods offered = the three methods the signing engine actually signs,
//     plus a small compat list many dApps insist on at proposal time
//     (eth_sign, older typed-data variants, chain switching). Advertising them
//     keeps buildApprovedNamespaces from failing the whole connection; at
//     request time the engine still rejects everything it does not support
//     (eth_sign stays blind-sign-blocked, per the security posture), and
//     wallet_switchEthereumChain is acked without signing anything.
import { buildApprovedNamespaces, getSdkError } from "@walletconnect/utils";
import type { SessionTypes } from "@walletconnect/types";
import type { WalletKitTypes } from "@reown/walletkit";
import { NETWORKS } from "@numpay/core/networks";
import {
  SUPPORTED_EVM_METHODS,
  SUPPORTED_SOL_METHODS,
  SOL_MAINNET_CHAIN_IDS,
} from "@numpay/core/dapp";
import type { WcAccounts } from "./signRequests";
import { initWalletKit, getActiveSessions } from "./client";

// Methods a session may negotiate beyond what the engine signs. Every one of
// these is still gated (or rejected) per request; see the module comment.
const COMPAT_METHODS = [
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
] as const;

const SESSION_EVENTS = ["chainChanged", "accountsChanged"];

/** All EVM chains NumPay supports, as CAIP-2 ids (`eip155:1`, ...). */
export function supportedEip155Chains(): string[] {
  return Object.values(NETWORKS)
    .filter((n) => Number.isSafeInteger(n.chainId) && n.chainId > 0)
    .map((n) => `eip155:${n.chainId}`);
}

export function chainNameById(chainId: number): string {
  const net = Object.values(NETWORKS).find((n) => n.chainId === chainId);
  return net ? net.name : `Chain ${chainId}`;
}

// ── proposal summary (feeds the approval sheet; pure) ────────────────────────

export interface ProposalSummary {
  id: number;
  /** dApp self-declared metadata. */
  name: string;
  url: string;
  iconUrl?: string;
  /** WalletKit verify-context: does the relay attest the origin matches? */
  verification: "verified" | "unverified" | "mismatch" | "scam";
  /** EVM chain names the dApp asked for that NumPay supports. */
  chainNames: string[];
  /** Namespaces the dApp REQUIRES that NumPay cannot satisfy (e.g. cosmos). */
  unsupportedRequired: string[];
}

/**
 * Flatten a session_proposal into what the user must actually review: who is
 * asking, whether the origin is attested, and which chains the session covers.
 * `hasSolana` = the wallet has a Solana account to offer (it always does once
 * derivation finished; the flag guards the brief post-unlock window).
 */
export function summarizeProposal(
  p: WalletKitTypes.SessionProposal,
  hasSolana: boolean,
): ProposalSummary {
  const meta = p.params.proposer?.metadata;
  const verified = p.verifyContext?.verified;
  const verification: ProposalSummary["verification"] = verified?.isScam
    ? "scam"
    : verified?.validation === "INVALID"
      ? "mismatch"
      : verified?.validation === "VALID"
        ? "verified"
        : "unverified";

  const supported = new Set(supportedEip155Chains());
  if (hasSolana) for (const c of SOL_MAINNET_CHAIN_IDS) supported.add(c);

  const requestedChains = new Set<string>();
  const unsupportedRequired: string[] = [];

  // A namespace key is either a bare namespace ("eip155", "solana") with its
  // chains listed inside, or a CAIP-2 chain used directly as the key.
  const collect = (entries: Record<string, { chains?: string[] } | undefined>, required: boolean) => {
    for (const [ns, def] of Object.entries(entries)) {
      const isCaip2Key = ns.includes(":");
      const chains = isCaip2Key ? [ns] : (def?.chains ?? []);
      const known = ns === "eip155" || ns === "solana" || ns.startsWith("eip155:") || ns.startsWith("solana:");
      if (!known) {
        if (required) unsupportedRequired.push(ns);
        continue;
      }
      for (const c of chains) {
        requestedChains.add(c);
        if (required && !supported.has(c)) unsupportedRequired.push(c);
      }
    }
  };
  collect(p.params.requiredNamespaces ?? {}, true);
  collect(p.params.optionalNamespaces ?? {}, false);

  const chainNames = [...requestedChains]
    .filter((c) => supported.has(c))
    .map((c) => (c.startsWith("solana:") ? "Solana" : chainNameById(Number(c.split(":")[1]))));

  return {
    id: p.id,
    name: meta?.name || "Unknown dApp",
    url: meta?.url || "",
    iconUrl: meta?.icons?.[0],
    verification,
    chainNames: [...new Set(chainNames)],
    unsupportedRequired: [...new Set(unsupportedRequired)],
  };
}

// ── approve / reject ─────────────────────────────────────────────────────────

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
  const chains = supportedEip155Chains();
  const supportedNamespaces: Parameters<typeof buildApprovedNamespaces>[0]["supportedNamespaces"] = {
    eip155: {
      chains,
      methods: [...SUPPORTED_EVM_METHODS, ...COMPAT_METHODS],
      events: SESSION_EVENTS,
      accounts: chains.map((c) => `${c}:${accounts.evm}`),
    },
  };
  if (accounts.solana) {
    supportedNamespaces.solana = {
      chains: [...SOL_MAINNET_CHAIN_IDS],
      methods: [...SUPPORTED_SOL_METHODS],
      events: [],
      accounts: SOL_MAINNET_CHAIN_IDS.map((c) => `${c}:${accounts.solana}`),
    };
  }
  const namespaces = buildApprovedNamespaces({
    proposal: p.params,
    supportedNamespaces,
  });
  const session = await kit.approveSession({ id: p.id, namespaces });
  emitSessionsChanged();
  return session;
}

export async function rejectProposal(p: WalletKitTypes.SessionProposal): Promise<void> {
  const kit = await initWalletKit();
  await kit.rejectSession({ id: p.id, reason: getSdkError("USER_REJECTED") });
}

// ── sessions list ─────────────────────────────────────────────────────────────

export interface SessionInfo {
  topic: string;
  name: string;
  url: string;
  iconUrl?: string;
  chainNames: string[];
  /** Unix ms the session expires (WalletConnect sessions are time-boxed). */
  expiryMs: number;
}

export function listSessions(): SessionInfo[] {
  return Object.values(getActiveSessions()).map((s) => {
    const chains = Object.values(s.namespaces ?? {})
      .flatMap((ns) => ns.accounts ?? [])
      .map((a) => a.split(":").slice(0, 2).join(":"));
    const names = [
      ...new Set(
        [...new Set(chains)]
          .filter((c) => c.startsWith("eip155:") || c.startsWith("solana:"))
          .map((c) => (c.startsWith("solana:") ? "Solana" : chainNameById(Number(c.split(":")[1])))),
      ),
    ];
    return {
      topic: s.topic,
      name: s.peer?.metadata?.name || "Unknown dApp",
      url: s.peer?.metadata?.url || "",
      iconUrl: s.peer?.metadata?.icons?.[0],
      chainNames: names,
      expiryMs: (s.expiry ?? 0) * 1000,
    };
  });
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
