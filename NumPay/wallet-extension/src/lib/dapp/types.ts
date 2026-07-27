// Shared types + constants for the dApp connect layer (EVM, EIP-1193).
// Kept dependency-free so the inpage provider and content bridge (built as
// standalone IIFE bundles) can import it without pulling in ethers/chrome.

// The platform-free request SHAPES a decoder needs now live in
// @numpay/core/dapp so the mobile WalletConnect signing sheet shares them.
// Re-exported here so existing importers of this module are unaffected.
import type { DappTxRequest } from "@numpay/core/dapp/types";
export type { DappTxRequest };

// The TRANSPORT vocabulary (wire shapes, method allowlists, error codes) also
// moved to @numpay/core/dapp, so the mobile in-app browser can host the very
// same injected provider. Re-exported here under the original names so every
// importer in this extension is unaffected. `ERR` is core's RPC_ERR.
// Imported from the NARROW path, not the "@numpay/core/dapp" barrel: the
// barrel re-exports signEngine, which imports ethers, and this module is
// imported by the inpage provider and content bridge — standalone IIFE bundles
// injected into every page. rpcTypes.ts is import-free precisely so that
// injection stays small.
export {
  TO_CONTENT,
  TO_INPAGE,
  RPC_ERR as ERR,
  MAX_PAYLOAD_BYTES,
  READ_METHODS,
  SIGN_METHODS,
  DEFERRED_METHODS,
} from "@numpay/core/dapp/rpcTypes";
export type {
  RpcRequest,
  RpcError,
  RequestMessage,
  ResponseMessage,
  EventMessage,
  ProviderEventName,
} from "@numpay/core/dapp/rpcTypes";

// chrome.runtime port name the content bridge opens to the background router.
export const DAPP_PORT = "numpay-dapp";

// Background <-> popup runtime messages.
export const MSG_DAPP_DECISION = "DAPP_DECISION"; // approval window -> background
export const MSG_DAPP_STATE_CHANGED = "DAPP_STATE_CHANGED"; // popup -> background

// ── Solana dApp protocol ────────────────────────────────────────────────────────
// Internal request method names for the Solana surface (window.solana + Wallet
// Standard). Namespaced with "sol_" so the router can dispatch EVM and Solana
// over the same transport. P1 is connect-only; signing methods arrive later.
export const SOL_METHODS = {
  connect: "sol_connect",
  disconnect: "sol_disconnect",
  accounts: "sol_accounts", // silent: returns the permitted account or null
  signMessage: "sol_signMessage", // ed25519 sign of arbitrary bytes (P2)
  signTransaction: "sol_signTransaction", // sign a serialized tx, return it (P3)
  signAndSendTransaction: "sol_signAndSendTransaction", // sign + broadcast (P3)
} as const;

// Solana provider event names. Distinct from the EVM event names so each
// page-world provider ignores the other's events on the shared message channel.
export const SOL_EVENTS = {
  connect: "sol:connect",
  disconnect: "sol:disconnect",
  accountChanged: "sol:accountChanged",
} as const;

export type SolEventName = (typeof SOL_EVENTS)[keyof typeof SOL_EVENTS];

// The Solana cluster NumPay exposes to dApps. The wallet is mainnet-only today.
export const SOL_CLUSTER = "solana:mainnet" as const;

// ── Approval-window pending records (stored in chrome.storage.session) ──────────
// Discriminated union so one approval window can serve both connect and sign.

export interface PendingBase {
  requestId: string;
  origin: string;
  id: string; // dApp-side request id, echoed back on the port
  channel: string; // inpage<->content channel id
}

export interface PendingConnect extends PendingBase {
  type: "connect";
  account: string;
  chainId: number;
}

export interface PendingSign extends PendingBase {
  type: "sign";
  method: "personal_sign" | "eth_signTypedData_v4";
  account: string; // the address the signature is bound to (= connected account)
  chainId: number; // active EVM chain at request time
  payload: string; // personal_sign: message hex; typed data: the JSON string
}

export interface PendingSendTx extends PendingBase {
  type: "sendTx";
  account: string; // the sender, bound to the connected account
  chainId: number; // active EVM chain at request time
  tx: DappTxRequest;
}

export interface PendingSwitchChain extends PendingBase {
  type: "switchChain";
  targetInternalId: string; // NumPay network id to make active
  chainId: number; // numeric EVM chain id being switched to
  chainName: string; // for display
}

export interface PendingAddChain extends PendingBase {
  type: "addChain";
  chain: import("@numpay/core/customChains").CustomChain; // validated candidate to save
}

// Solana connect approval. Unlike EVM connect, the router does not know the
// active wallet's Solana address (it is derived from the mnemonic, not stored in
// cleartext vault metadata), so the approval window derives and returns it; the
// router only persists the grant.
export interface PendingSolConnect extends PendingBase {
  type: "solConnect";
}

export interface PendingSolSign extends PendingBase {
  type: "solSign";
  account: string; // base58 connected account the signature is bound to
  message: string; // base64-encoded message bytes (binary-safe over storage/wire)
}

// Solana sign-transaction approval. The approval window decodes the serialized
// transaction, binds its fee payer to the connected account, signs the user's
// slot, and (when `send`) broadcasts it. The router only relays the result.
export interface PendingSolSignTx extends PendingBase {
  type: "solSignTx";
  account: string; // base58 connected account; must equal the tx fee payer
  transaction: string; // base64-encoded serialized transaction (legacy or v0)
  send: boolean; // true = signAndSendTransaction; false = signTransaction
}

export type DappPending =
  | PendingConnect
  | PendingSign
  | PendingSendTx
  | PendingSwitchChain
  | PendingAddChain
  | PendingSolConnect
  | PendingSolSign
  | PendingSolSignTx;
