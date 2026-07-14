// Pure WalletConnect session logic: proposal summarising, the namespace offer,
// and session-info mapping. NO transport imports — sessions.ts wraps these with
// the actual WalletKit calls. Split out so the security-relevant decisions
// (which chains/methods/accounts a session is offered, what the user is told
// about a proposal) are unit-testable in node (wallet-mobile/test/wc-sessions.mjs).
//
// Approval policy (eip155 + solana mainnet):
//   • Chains offered = every EVM network in core's NETWORKS table, plus Solana
//     mainnet when the wallet's Solana account is derived.
//   • Methods offered = what the signing engines actually sign, plus a small
//     compat list many dApps insist on at proposal time (eth_sign, older
//     typed-data variants, chain switching). Advertising them keeps
//     buildApprovedNamespaces from failing the whole connection; at request
//     time the engine still rejects everything it does not support (eth_sign
//     stays blind-sign-blocked, per the security posture), and
//     wallet_switchEthereumChain is acked without signing anything.
import { buildApprovedNamespaces } from "@walletconnect/utils";
import type { ProposalTypes, SessionTypes } from "@walletconnect/types";
import type { WalletKitTypes } from "@reown/walletkit";
import { NETWORKS } from "@numpay/core/networks";
import {
  SUPPORTED_EVM_METHODS,
  SUPPORTED_SOL_METHODS,
  SOL_MAINNET_CHAIN_IDS,
} from "@numpay/core/dapp";

/** The session's connected accounts, one per supported namespace. */
export interface WcAccounts {
  evm: string;
  solana?: string;
}

// Methods a session may negotiate beyond what the engines sign. Every one of
// these is still gated (or rejected) per request; see the module comment.
export const COMPAT_METHODS = [
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

// ── the namespace offer (what approveSession exposes) ────────────────────────

type SupportedNamespaces = Parameters<
  typeof buildApprovedNamespaces
>[0]["supportedNamespaces"];

/**
 * Everything NumPay is willing to expose to a session: the EVM account on all
 * supported chains, plus the Solana account on mainnet when derived.
 */
export function buildWcSupportedNamespaces(accounts: WcAccounts): SupportedNamespaces {
  const chains = supportedEip155Chains();
  const ns: SupportedNamespaces = {
    eip155: {
      chains,
      methods: [...SUPPORTED_EVM_METHODS, ...COMPAT_METHODS],
      events: SESSION_EVENTS,
      accounts: chains.map((c) => `${c}:${accounts.evm}`),
    },
  };
  if (accounts.solana) {
    ns.solana = {
      chains: [...SOL_MAINNET_CHAIN_IDS],
      methods: [...SUPPORTED_SOL_METHODS],
      events: [],
      accounts: SOL_MAINNET_CHAIN_IDS.map((c) => `${c}:${accounts.solana}`),
    };
  }
  return ns;
}

/**
 * Intersect a proposal with the offer above. Throws (with
 * buildApprovedNamespaces' reason) if the proposal REQUIRES something NumPay
 * cannot provide — the sheet surfaces that and offers reject.
 */
export function buildSessionNamespaces(
  proposal: ProposalTypes.Struct,
  accounts: WcAccounts,
): SessionTypes.Namespaces {
  return buildApprovedNamespaces({
    proposal,
    supportedNamespaces: buildWcSupportedNamespaces(accounts),
  });
}

// ── proposal summary (feeds the approval sheet) ───────────────────────────────

export interface ProposalSummary {
  id: number;
  /** dApp self-declared metadata. */
  name: string;
  url: string;
  iconUrl?: string;
  /** WalletKit verify-context: does the relay attest the origin matches? */
  verification: "verified" | "unverified" | "mismatch" | "scam";
  /** Chain names the dApp asked for that NumPay supports. */
  chainNames: string[];
  /** Namespaces/chains the dApp REQUIRES that NumPay cannot satisfy. */
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
  const meta = p.params?.proposer?.metadata;
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
  collect(p.params?.requiredNamespaces ?? {}, true);
  collect(p.params?.optionalNamespaces ?? {}, false);

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

// ── sessions list mapping ─────────────────────────────────────────────────────

export interface SessionInfo {
  topic: string;
  name: string;
  url: string;
  iconUrl?: string;
  chainNames: string[];
  /** Unix ms the session expires (WalletConnect sessions are time-boxed). */
  expiryMs: number;
}

export function sessionInfoFrom(s: SessionTypes.Struct): SessionInfo {
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
}
