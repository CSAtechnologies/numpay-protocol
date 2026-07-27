// Transport-level vocabulary for the injected EIP-1193 provider: the wire
// shapes the page-world provider and its host exchange, the method allowlists,
// and the standard error codes.
//
// Platform-free and dependency-free on purpose. Two very different transports
// speak this: the extension (page -> content script -> background port) and
// mobile (page -> WebView bridge -> RN router). Keeping the vocabulary in one
// place is what lets both clients share ONE provider implementation.
//
// This is the TRANSPORT layer. The decode/preview/sign brain is signEngine.ts
// and solEngine.ts; those own what a request MEANS, this owns how it travels.

// This module MUST stay import-free. The page-world provider and the host
// bridges are built as standalone IIFE bundles that get injected into every
// visited page, so a single import reaching signEngine would pull ethers into
// the injected script. signEngine imports the payload cap FROM here, never the
// other way round.

// Hard cap on a single sign/transaction payload (typed-data JSON, message hex,
// or calldata). Untrusted page input is buffered and rendered; anything beyond
// this is rejected rather than stored.
export const MAX_PAYLOAD_BYTES = 128 * 1024;

// postMessage targets between the page-world provider and its host bridge.
// The extension's content script and mobile's WebView shim both answer to
// these, which is why the injected provider needs no per-client build.
export const TO_CONTENT = "numpay-content"; // inpage -> host bridge
export const TO_INPAGE = "numpay-inpage"; // host bridge -> inpage

export interface RpcRequest {
  id: string;
  method: string;
  params?: unknown[];
}

export interface RpcError {
  code: number;
  message: string;
}

// inpage -> host bridge
export interface RequestMessage extends RpcRequest {
  target: typeof TO_CONTENT;
  channel: string;
}

// host bridge -> inpage (response to a request)
export interface ResponseMessage {
  target: typeof TO_INPAGE;
  kind: "response";
  channel: string;
  id: string;
  result?: unknown;
  error?: RpcError;
}

// host bridge -> inpage (unsolicited provider event)
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

// EIP-1193 standard error codes, as the transport returns them.
//
// NOTE: this deliberately does NOT merge with DAPP_ERR in signEngine.ts. The
// two overlap on four codes but carry different `message` strings, and
// DAPP_ERR's are already shipping in the extension's approval UI and over
// WalletConnect. Merging them would silently change user-visible error text.
// DAPP_ERR is the ENGINE's vocabulary (what a request means); this is the
// TRANSPORT's (how it failed to travel), and it carries the three codes the
// engine has no concept of: disconnected, requestPending, internal.
export const RPC_ERR = {
  userRejected: { code: 4001, message: "User rejected the request" },
  unauthorized: { code: 4100, message: "The requested account/method has not been authorized" },
  unsupportedMethod: { code: 4200, message: "Method not supported in this version of NumPay yet" },
  disconnected: { code: 4900, message: "Provider is disconnected" },
  requestPending: { code: -32002, message: "A NumPay request is already pending. Finish it first." },
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

// Signing methods routed to an approval surface. The surface (not the router)
// holds the key and signs. Deliberately excludes eth_sign (blind raw-hash
// signing, a known drainer footgun) and the legacy v1/v3 typed-data variants.
export const SIGN_METHODS = new Set<string>([
  "personal_sign",
  "eth_signTypedData_v4",
]);

// Signing / state-changing methods that arrive later, or that we intentionally
// do not support. Listed so a router can return a clear "not yet / not
// supported" instead of a generic failure.
export const DEFERRED_METHODS = new Set<string>([
  "eth_sign",
  "eth_signTypedData",
  "eth_signTypedData_v3",
  "eth_sendRawTransaction",
  "wallet_watchAsset",
  "wallet_requestPermissions",
  "wallet_getPermissions",
]);
