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
  invalidParams: { code: -32602, message: "Invalid method parameters" },
  internal: { code: -32603, message: "Internal error" },
} as const;

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
  "eth_sendTransaction",
  "eth_sendRawTransaction",
  "wallet_switchEthereumChain",
  "wallet_addEthereumChain",
  "wallet_watchAsset",
  "wallet_requestPermissions",
  "wallet_getPermissions",
]);

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

export type DappPending = PendingConnect | PendingSign;
