// Solana dApp signing engine — the WalletConnect-solana counterpart of
// signEngine.ts, and the same split: previewSolanaDappRequest is PURE and
// never throws (it renders untrusted dApp input for the approval sheet, and is
// the single gate that validates the method and binds the request to the
// connected account); signSolanaDappRequest takes the caller-derived ed25519
// secret key and produces the JSON-RPC result object. All the actual byte
// handling reuses the proven chains/solana path (fee-payer bind, partial-sign
// rules, pre-broadcast simulation).
//
// Param/result shapes follow the WalletConnect Solana RPC reference
// (verified 2026-07-14): params are an OBJECT, not an array.
//   solana_signMessage            { message: base58, pubkey }        → { signature: base58 }
//   solana_signTransaction        { transaction: base64 }            → { signature: base58, transaction?: base64 }
//   solana_signAndSendTransaction { transaction: base64, sendOptions? } → { signature: base58 }

import bs58 from "bs58";
import nacl from "tweetnacl";
import { DAPP_ERR, MAX_PAYLOAD_BYTES } from "./signEngine";
import {
  decodeSolSignMessage,
  bytesToBase64,
  base64ToBytes,
  type DecodedSolMessage,
} from "./solDecode";
import {
  inspectSolanaTransaction,
  signSolanaTransaction,
  type SolTxInspection,
} from "../chains/solana";

// CAIP-2 ids a session may carry for Solana MAINNET. The canonical reference is
// truncate(genesisHash, 32) per the CAIP-2 solana namespace; the second is
// WalletConnect's older mainnet id, still emitted by some dApps. NumPay treats
// both as mainnet and supports nothing else (no devnet/testnet signing).
export const SOL_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
export const SOL_MAINNET_CAIP2_LEGACY = "solana:4sGjMW1sUnHzSxGspuhpqLDx6wiyjNtZ";
export const SOL_MAINNET_CHAIN_IDS: readonly string[] = [
  SOL_MAINNET_CAIP2,
  SOL_MAINNET_CAIP2_LEGACY,
];

export function isSolanaMainnetCaip2(chainId: unknown): boolean {
  return typeof chainId === "string" && SOL_MAINNET_CHAIN_IDS.includes(chainId.trim());
}

export type SolWcMethod =
  | "solana_signMessage"
  | "solana_signTransaction"
  | "solana_signAndSendTransaction"
  | "solana_signAllTransactions";

export const SUPPORTED_SOL_METHODS: readonly SolWcMethod[] = [
  "solana_signMessage",
  "solana_signTransaction",
  "solana_signAndSendTransaction",
  "solana_signAllTransactions",
];

// signAllTransactions is sign-only batching (dApps like Jupiter split a flow
// into several transactions). Cap the batch so a hostile dApp cannot make the
// user rubber-stamp an unreadable wall of transactions in one tap.
export const MAX_BATCH_TXS = 10;

export function isSupportedSolMethod(m: string): m is SolWcMethod {
  return (SUPPORTED_SOL_METHODS as readonly string[]).includes(m);
}

export interface SolDappRequestInput {
  method: string;
  /** The request's raw params (object per the WC solana spec; untrusted). */
  params: unknown;
  /** The session's connected base58 Solana address. */
  account: string;
}

export type SolPreviewDetail =
  | { kind: "sol_message"; message: DecodedSolMessage }
  | {
      kind: "sol_tx";
      /** true = signAndSend (broadcasts); false = sign-only (partial signing). */
      send: boolean;
      txB64: string;
      inspection: SolTxInspection;
      /**
       * Fee payer of the serialized tx is not the connected account (or the
       * bytes did not parse). The sheet must block approve; signSolanaTransaction
       * re-enforces this at sign time as the hard gate.
       */
      feePayerMismatch: boolean;
    }
  | {
      kind: "sol_tx_batch";
      txsB64: string[];
      inspections: SolTxInspection[];
      /** Any transaction in the batch with a foreign/unparsable fee payer. */
      feePayerMismatch: boolean;
    };

export type SolDappRequestPreview =
  | { ok: false; code: number; error: string }
  | { ok: true; method: SolWcMethod; account: string; detail: SolPreviewDetail };

function rej(e: { code: number; message: string }): SolDappRequestPreview {
  return { ok: false, code: e.code, error: e.message };
}

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v && typeof v === "object" && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : undefined;
}

// bs58.decode throws on any non-alphabet character; untrusted input never may.
function b58ToBytes(s: string): Uint8Array | null {
  try {
    return bs58.decode(s);
  } catch {
    return null;
  }
}

function extractTxB64(params: unknown): string | undefined {
  const p = asRecord(params);
  const tx = p?.transaction;
  return typeof tx === "string" && tx.length > 0 ? tx : undefined;
}

/**
 * Validate + decode a WalletConnect solana request into a preview for the
 * approval sheet. Pure: no keys, no network, must not throw.
 */
export function previewSolanaDappRequest(input: SolDappRequestInput): SolDappRequestPreview {
  try {
    const { method, params, account } = input;

    if (!isSupportedSolMethod(method)) {
      return rej(DAPP_ERR.unsupportedMethod);
    }

    if (method === "solana_signMessage") {
      const p = asRecord(params);
      const message = p?.message;
      const pubkey = p?.pubkey;
      if (typeof message !== "string" || message.length === 0) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Missing sign message" };
      }
      if (message.length > MAX_PAYLOAD_BYTES) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Sign payload too large" };
      }
      // The spec requires pubkey; when present it must be the connected account.
      if (typeof pubkey === "string" && pubkey.length > 0 && pubkey !== account) {
        return rej(DAPP_ERR.unauthorized);
      }
      const bytes = b58ToBytes(message);
      if (!bytes) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Message is not valid base58" };
      }
      const decoded = decodeSolSignMessage(bytesToBase64(bytes));
      return { ok: true, method, account, detail: { kind: "sol_message", message: decoded } };
    }

    if (method === "solana_signAllTransactions") {
      const p = asRecord(params);
      const txs = p?.transactions;
      if (!Array.isArray(txs) || txs.length === 0) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Missing transactions array" };
      }
      if (txs.length > MAX_BATCH_TXS) {
        return { ok: false, code: DAPP_ERR.invalidParams.code, error: `Too many transactions (max ${MAX_BATCH_TXS})` };
      }
      const txsB64: string[] = [];
      const inspections: SolTxInspection[] = [];
      let mismatch = false;
      for (const t of txs) {
        if (typeof t !== "string" || t.length === 0 || t.length > MAX_PAYLOAD_BYTES) {
          return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Invalid transaction in batch" };
        }
        const bytes = base64ToBytes(t);
        if (bytes.length === 0) {
          return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Transaction is not valid base64" };
        }
        const inspection = inspectSolanaTransaction(bytes);
        if (inspection.feePayer !== account) mismatch = true;
        txsB64.push(t);
        inspections.push(inspection);
      }
      return {
        ok: true,
        method,
        account,
        detail: { kind: "sol_tx_batch", txsB64, inspections, feePayerMismatch: mismatch },
      };
    }

    // solana_signTransaction / solana_signAndSendTransaction
    const txB64 = extractTxB64(params);
    if (!txB64) {
      return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Missing serialized transaction" };
    }
    if (txB64.length > MAX_PAYLOAD_BYTES) {
      return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Transaction too large" };
    }
    const txBytes = base64ToBytes(txB64); // never throws; empty on bad base64
    if (txBytes.length === 0) {
      return { ok: false, code: DAPP_ERR.invalidParams.code, error: "Transaction is not valid base64" };
    }
    const inspection = inspectSolanaTransaction(txBytes);
    return {
      ok: true,
      method,
      account,
      detail: {
        kind: "sol_tx",
        send: method === "solana_signAndSendTransaction",
        txB64,
        inspection,
        feePayerMismatch: inspection.feePayer !== account,
      },
    };
  } catch {
    return rej(DAPP_ERR.invalidParams);
  }
}

/**
 * Produce the JSON-RPC result object for an already-previewed solana request.
 * `secretKey` is the connected account's ed25519 secret key, derived by the
 * platform from the unlocked vault; core never sees the mnemonic. Assumes the
 * input already passed previewSolanaDappRequest (throws on anything it
 * rejects, including the fee-payer bind inside signSolanaTransaction).
 */
export async function signSolanaDappRequest(
  input: { method: SolWcMethod; params: unknown; account: string },
  secretKey: Uint8Array,
): Promise<{ signature: string; transaction?: string } | { transactions: string[] }> {
  const { method, params, account } = input;

  if (method === "solana_signMessage") {
    const p = asRecord(params);
    const bytes = typeof p?.message === "string" ? b58ToBytes(p.message) : null;
    if (!bytes) throw new Error("Missing sign message");
    const sig = nacl.sign.detached(bytes, secretKey);
    return { signature: bs58.encode(sig) };
  }

  if (method === "solana_signAllTransactions") {
    const p = asRecord(params);
    const txs = p?.transactions;
    if (!Array.isArray(txs) || txs.length === 0 || txs.length > MAX_BATCH_TXS) {
      throw new Error("Invalid transactions batch");
    }
    // Sign-only, in order; each pass re-enforces the fee-payer bind.
    const signed: string[] = [];
    for (const t of txs) {
      if (typeof t !== "string") throw new Error("Invalid transaction in batch");
      const { signedB64 } = await signSolanaTransaction(
        secretKey, account, base64ToBytes(t), false,
      );
      signed.push(signedB64);
    }
    return { transactions: signed };
  }

  const txB64 = extractTxB64(params);
  if (!txB64) throw new Error("Missing serialized transaction");
  const txBytes = base64ToBytes(txB64);

  if (method === "solana_signTransaction") {
    const { signedB64, userSignature } = await signSolanaTransaction(
      secretKey, account, txBytes, false,
    );
    return { signature: userSignature, transaction: signedB64 };
  }

  // solana_signAndSendTransaction — simulation guard + broadcast inside.
  const { signature, userSignature } = await signSolanaTransaction(
    secretKey, account, txBytes, true,
  );
  return { signature: signature ?? userSignature };
}
