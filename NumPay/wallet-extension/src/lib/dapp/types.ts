// Shared types + constants for the dApp connect layer (EVM, EIP-1193).
// Kept dependency-free so the inpage provider and content bridge (built as
// standalone IIFE bundles) can import it without pulling in ethers/chrome.

// postMessage targets between the page-world provider and the content bridge.
export const TO_CONTENT = "numpay-content"; // inpage  -> content
export const TO_INPAGE = "numpay-inpage"; // content -> inpage

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

export interface RpcRequest {
  id: string;
  method: string;
  params?: unknown[];
}

export interface RpcError {
  code: number;
  message: string;
}

// inpage -> content
export interface RequestMessage extends RpcRequest {
  target: typeof TO_CONTENT;
  channel: string;
}

// content -> inpage (response to a request)
export interface ResponseMessage {
  target: typeof TO_INPAGE;
  kind: "response";
  channel: string;
  id: string;
  result?: unknown;
  error?: RpcError;
}

// content -> inpage (unsolicited provider event)
export interface EventMessage {
  target: typeof TO_INPAGE;
  kind: "event";
  name: ProviderEventName;
  data: unknown;
}

export type ProviderEventName =
  | "connect"
  | "disconnect"
  | "accountsChanged"
  | "chainChanged";

// EIP-1193 standard error codes.
export const ERR = {
  userRejected: { code: 4001, message: "User rejected the request" },
  unauthorized: { code: 4100, message: "The requested account/method has not been authorized" },
  unsupportedMethod: { code: 4200, message: "Method not supported in this version of NumPay yet" },
  disconnected: { code: 4900, message: "Provider is disconnected" },
  requestPending: { code: -32002, message: "A NumPay request is already pending. Finish it first." },
  invalidParams: { code: -32602, message: "Invalid method parameters" },
  internal: { code: -32603, message: "Internal error" },
} as const;

// Hard cap on a single sign/transaction payload (typed-data JSON, message hex,
// or calldata). Untrusted page input is stored in storage.session and rendered;
// anything beyond this is rejected rather than buffered.
export const MAX_PAYLOAD_BYTES = 128 * 1024;

// Read methods proxied straight to our configured RPC. Anything not listed and
// not handled explicitly is rejected, so the page can never drive arbitrary
// node methods through the wallet.
export const READ_METHODS = new Set<string>([
  "eth_blockNumber",
  "eth_getBalance",
  "eth_call",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_getTransactionCount",
  "eth_getCode",
  "eth_getStorageAt",
  "eth_getTransactionByHash",
  "eth_getTransactionReceipt",
  "eth_getBlockByNumber",
  "eth_getBlockByHash",
  "eth_getLogs",
  "eth_chainId", // also handled locally; harmless as a read fallback
]);

// Signing methods supported from P2 on. The router routes these to a dedicated
// approval window; the window (not the router) holds the key and signs.
// Deliberately excludes eth_sign (blind raw-hash signing, a known drainer
// footgun) and the legacy v1/v3 typed-data variants.
export const SIGN_METHODS = new Set<string>([
  "personal_sign",
  "eth_signTypedData_v4",
]);

// Signing / state-changing methods that arrive in later phases, or that we
// intentionally do not support. Listed so the router can return a clear
// "not yet / not supported" instead of a generic failure (P3+).
export const DEFERRED_METHODS = new Set<string>([
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_sendRawTransaction",
  "wallet_watchAsset",
  "wallet_requestPermissions",
  "wallet_getPermissions",
]);

// EIP-1193 transaction object as dApps send it (hex quantities, optional fields).
export interface DappTxRequest {
  from?: string;
  to?: string;
  value?: string;
  data?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string;
}

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
  chain: import("../customChains").CustomChain; // validated candidate to save
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

export type DappPending =
  | PendingConnect
  | PendingSign
  | PendingSendTx
  | PendingSwitchChain
  | PendingAddChain
  | PendingSolConnect
  | PendingSolSign;
