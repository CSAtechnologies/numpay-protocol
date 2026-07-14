// EVM dApp signing engine — the platform-free "what am I signing, and sign it"
// layer shared by the mobile WalletConnect signing sheet and (eventually) the
// extension approval window. It mirrors the method handling proven in the
// extension's dappRouter (personal_sign / eth_signTypedData_v4 /
// eth_sendTransaction) but is transport-agnostic: the caller feeds it the
// already-unwrapped { method, params, chainId, account } from whatever
// transport it uses (WalletConnect session_request, window.ethereum, ...).
//
// Split in two on purpose:
//   • previewDappRequest — PURE. No keys, no network, must never throw. Builds
//     the human-reviewable preview + risk flags for the approval UI, and is the
//     single gate that validates the method and binds the request to the
//     connected account. Runs on untrusted dApp input in a render path.
//   • signDappRequest — takes a caller-provided ethers Signer (built from the
//     unlocked vault on the platform side) and produces the JSON-RPC result
//     the transport returns to the dApp. Core never touches the mnemonic.

import { ethers } from "ethers";
import type { DappTxRequest } from "./types";
import {
  decodePersonalSignMessage,
  parseTypedData,
  typesForEthers,
  assessTypedDataRisk,
  type DecodedPersonalSign,
  type ParsedTypedData,
  type RiskFlag,
} from "./signDecode";
import {
  decodeTxData,
  formatNativeValue,
  normalizeTxForEthers,
  type DecodedTxData,
} from "./txDecode";

// Guard against a hostile dApp streaming a huge payload into the approval
// render path (same cap the extension router applies). Local copy so the core
// engine stays free of the extension's transport constants.
export const MAX_PAYLOAD_BYTES = 128 * 1024;

// The three EVM methods NumPay signs. eth_sign (blind sign) is intentionally
// NOT here: per the security posture it never signs without the same guardrails
// personal_sign/typed-data get, so the engine simply rejects it as unsupported.
export type EvmSignMethod =
  | "personal_sign"
  | "eth_signTypedData_v4"
  | "eth_sendTransaction";

export const SUPPORTED_EVM_METHODS: readonly EvmSignMethod[] = [
  "personal_sign",
  "eth_signTypedData_v4",
  "eth_sendTransaction",
];

export function isSupportedEvmMethod(m: string): m is EvmSignMethod {
  return (SUPPORTED_EVM_METHODS as readonly string[]).includes(m);
}

// Standard EIP-1193 / JSON-RPC error codes the transport can relay verbatim.
export const DAPP_ERR = {
  userRejected: { code: 4001, message: "User rejected the request" },
  unsupportedMethod: { code: 4200, message: "Unsupported method" },
  unauthorized: { code: 4100, message: "Requested address is not the connected account" },
  invalidParams: { code: -32602, message: "Invalid request parameters" },
} as const;

export interface DappRequestInput {
  method: string;
  params: readonly unknown[];
  /** Numeric EVM chain id (caller parses it from CAIP-2 `eip155:N`). */
  chainId: number;
  /** The session's connected EVM account; the request is bound to it. */
  account: string;
  /** Native currency of `chainId`, for formatting a tx's value. */
  native: { symbol: string; decimals: number };
}

export type PreviewDetail =
  | { kind: "personal_sign"; message: DecodedPersonalSign }
  | { kind: "typed_data"; typed: ParsedTypedData }
  | { kind: "send_tx"; tx: DappTxRequest; decoded: DecodedTxData; valueLabel: string };

export type DappRequestPreview =
  | { ok: false; code: number; error: string }
  | {
      ok: true;
      method: EvmSignMethod;
      chainId: number;
      account: string;
      risk: RiskFlag[];
      detail: PreviewDetail;
    };

// A DAPP_ERR (code + JSON-RPC message) as a preview rejection (code + error).
function rej(e: { code: number; message: string }): DappRequestPreview {
  return { ok: false, code: e.code, error: e.message };
}

// ── address helpers (match dappRouter exactly) ───────────────────────────────

function isHexAddr(s: unknown): s is string {
  return typeof s === "string" && /^0x[0-9a-fA-F]{40}$/.test(s);
}

function eqAddr(a: string, b: string): boolean {
  return a.toLowerCase() === b.toLowerCase();
}

// ── param extraction (shared by preview + sign) ──────────────────────────────

// personal_sign spec order is [message, address]; some libraries reverse it.
// Detect which param is the address and take the other as the message.
function extractPersonalSign(
  params: readonly unknown[],
): { message?: string; address?: string } {
  let message: unknown;
  let address: string | undefined;
  if (isHexAddr(params[1])) {
    message = params[0];
    address = params[1];
  } else if (isHexAddr(params[0])) {
    address = params[0];
    message = params[1];
  } else {
    message = params[0];
  }
  return {
    message: typeof message === "string" ? message : undefined,
    address,
  };
}

// eth_signTypedData_v4 order is [address, typedData]; typedData may arrive as a
// JSON string or an object.
function extractTypedData(
  params: readonly unknown[],
): { address?: string; payload?: string } {
  const address = isHexAddr(params[0]) ? params[0] : undefined;
  const data = params[1];
  let payload: string | undefined;
  if (typeof data === "string") payload = data;
  else if (data && typeof data === "object") {
    try {
      payload = JSON.stringify(data);
    } catch {
      payload = undefined;
    }
  }
  return { address, payload };
}

function extractTx(params: readonly unknown[]): DappTxRequest | undefined {
  const raw = params[0];
  if (!raw || typeof raw !== "object") return undefined;
  return raw as DappTxRequest;
}

// ── preview (pure, never throws) ─────────────────────────────────────────────

/**
 * Validate + decode a dApp request into a preview for the approval sheet. Pure:
 * no keys, no network, and MUST NOT throw — it runs on untrusted input in the
 * UI render path, so every failure returns a typed { ok: false } instead.
 */
export function previewDappRequest(input: DappRequestInput): DappRequestPreview {
  try {
    const { method, params, chainId, account, native } = input;

    if (!isSupportedEvmMethod(method)) {
      return rej(DAPP_ERR.unsupportedMethod);
    }
    if (!Array.isArray(params)) {
      return rej(DAPP_ERR.invalidParams);
    }

    if (method === "personal_sign") {
      const { message, address } = extractPersonalSign(params);
      if (message === undefined) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Missing sign message" };
      }
      if (!address) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Missing signing address" };
      }
      if (!eqAddr(address, account)) {
        return rej(DAPP_ERR.unauthorized);
      }
      if (message.length > MAX_PAYLOAD_BYTES) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Sign payload too large" };
      }
      const decoded = decodePersonalSignMessage(message);
      return {
        ok: true, method, chainId, account, risk: [],
        detail: { kind: "personal_sign", message: decoded },
      };
    }

    if (method === "eth_signTypedData_v4") {
      const { address, payload } = extractTypedData(params);
      if (!address) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Missing signing address" };
      }
      if (!eqAddr(address, account)) {
        return rej(DAPP_ERR.unauthorized);
      }
      if (payload === undefined) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Missing typed-data payload" };
      }
      if (payload.length > MAX_PAYLOAD_BYTES) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Sign payload too large" };
      }
      const parsed = parseTypedData(payload);
      if (!parsed.ok) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: parsed.error };
      }
      const risk = assessTypedDataRisk(parsed, chainId);
      return {
        ok: true, method, chainId, account, risk,
        detail: { kind: "typed_data", typed: parsed },
      };
    }

    // eth_sendTransaction
    const tx = extractTx(params);
    if (!tx) {
      return rej(DAPP_ERR.invalidParams);
    }
    // A transaction must do something: carry a recipient or calldata (a contract
    // deploy has no `to` but does have `data`).
    if (!tx.to && !tx.data) {
      return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Transaction has no 'to' or 'data'" };
    }
    if (typeof tx.data === "string" && tx.data.length > MAX_PAYLOAD_BYTES) {
      return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Transaction data too large" };
    }
    // Bind the sender to the connected account when the dApp specifies `from`.
    if (tx.from && !eqAddr(tx.from, account)) {
      return { ok: false, code: DAPP_ERR.unauthorized.code, error: "Transaction 'from' is not the connected account" };
    }
    const decoded = decodeTxData(tx.data);
    const valueLabel = formatNativeValue(tx.value, native.decimals, native.symbol);
    return {
      ok: true, method, chainId, account, risk: decoded.risk,
      detail: { kind: "send_tx", tx: { ...tx, from: account }, decoded, valueLabel },
    };
  } catch {
    // Belt and braces: any unexpected shape resolves to a safe rejection rather
    // than throwing into the approval render path.
    return rej(DAPP_ERR.invalidParams);
  }
}

// ── signing (uses a caller-provided signer; core never sees the mnemonic) ─────

/**
 * Produce the JSON-RPC result for an already-previewed request: a signature hex
 * for personal_sign / eth_signTypedData_v4, or the broadcast tx hash for
 * eth_sendTransaction. `signer` must be built from the connected account's key
 * and, for eth_sendTransaction, connected to the target chain's RPC. Assumes
 * the input already passed previewDappRequest (throws on anything it rejects).
 */
export async function signDappRequest(
  input: { method: EvmSignMethod; params: readonly unknown[] },
  signer: ethers.Signer,
): Promise<string> {
  const { method, params } = input;

  if (method === "personal_sign") {
    const { message } = extractPersonalSign(params);
    if (message === undefined) throw new Error("Missing sign message");
    // personal_sign signs the raw message bytes. decodePersonalSignMessage
    // normalises both hex and utf-8 inputs to the same hex bytes, so signing
    // those bytes reproduces the dApp's intended digest either way.
    const { hex } = decodePersonalSignMessage(message);
    return signer.signMessage(ethers.getBytes(hex));
  }

  if (method === "eth_signTypedData_v4") {
    const { payload } = extractTypedData(params);
    if (payload === undefined) throw new Error("Missing typed-data payload");
    const parsed = parseTypedData(payload);
    if (!parsed.ok) throw new Error(parsed.error);
    // ethers v6 derives EIP712Domain from `domain`; it must be absent from types.
    return signer.signTypedData(parsed.domain, typesForEthers(parsed.types), parsed.message);
  }

  // eth_sendTransaction
  const tx = extractTx(params);
  if (!tx) throw new Error("Invalid transaction");
  const resp = await signer.sendTransaction(normalizeTxForEthers(tx));
  return resp.hash;
}
