// WalletConnect request handling for NumPay mobile: the bridge between a
// WalletKit `session_request` and the platform-free @numpay/core/dapp engines
// (eip155 + solana).
//
// The engines do all the decoding, validation and signing; this module only
// unwraps the WalletConnect envelope (CAIP-2 chainId, nested request), routes
// by namespace, resolves chain RPC/native (EVM) from core's NETWORKS table,
// builds the signer key material from the unlocked vault (the SAME gated
// getUnlockedMnemonic path Send/BPAN use), and formats the JSON-RPC response.
// Nothing here auto-approves: previewSessionRequest feeds the approval sheet,
// and approveSessionRequest only runs after the user taps sign.

import type { WalletKitTypes } from "@reown/walletkit";
import {
  previewDappRequest,
  signDappRequest,
  previewSolanaDappRequest,
  signSolanaDappRequest,
  isSolanaMainnetCaip2,
  DAPP_ERR,
  type DappRequestPreview,
  type SolDappRequestPreview,
} from "@numpay/core/dapp";
import { ethers } from "ethers";
import { NETWORKS, BPAN_MAINNET_RPC } from "@numpay/core/networks";
import { importFromMnemonic, getSigner } from "@numpay/core/wallet";
import { deriveSolanaAddress } from "@numpay/core/chains/solana";
import { logTx, updateTx, explorerTxUrl } from "@numpay/core/txLog";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import { getWalletKit } from "./client";

/** What the approval sheet shows after a dApp request BROADCAST a tx. */
export interface WcBroadcastResult {
  txHash: string;
  explorerUrl: string;
}
import type { WcAccounts } from "./sessionsCore";

export type { WcAccounts } from "./sessionsCore";

/** CAIP-2 `eip155:1` -> 1. Returns null for non-eip155 or malformed ids. */
export function parseEip155ChainId(caip2: unknown): number | null {
  if (typeof caip2 !== "string") return null;
  const m = /^eip155:(\d+)$/.exec(caip2.trim());
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

/** Resolve a known EVM network by numeric chainId (RPC + native currency). */
function networkByChainId(chainId: number) {
  return Object.values(NETWORKS).find((n) => n.chainId === chainId);
}

const DEFAULT_NATIVE = { symbol: "ETH", decimals: 18 };

function unwrap(req: WalletKitTypes.SessionRequest) {
  const request = req.params.request;
  return {
    method: request.method,
    params: request.params as unknown,
    caip2: req.params.chainId,
    topic: req.topic,
    id: req.id,
  };
}

/** A previewed request, tagged with the namespace that will sign it. */
export type WcRequestPreview =
  | { ns: "eip155"; preview: DappRequestPreview }
  | { ns: "solana"; preview: SolDappRequestPreview };

/**
 * Build the approval-sheet preview for a session_request bound to the
 * session's connected accounts. Pure: no keys, no network. Returns an
 * { ok:false } preview for unknown namespaces or unsupported methods so the
 * sheet can show a clear rejection rather than an approve button.
 */
export function previewSessionRequest(
  req: WalletKitTypes.SessionRequest,
  accounts: WcAccounts,
): WcRequestPreview {
  const { method, params, caip2 } = unwrap(req);

  if (isSolanaMainnetCaip2(caip2)) {
    if (!accounts.solana) {
      return {
        ns: "solana",
        preview: { ok: false, code: DAPP_ERR.unauthorized.code, error: "No Solana account is available" },
      };
    }
    return {
      ns: "solana",
      preview: previewSolanaDappRequest({ method, params, account: accounts.solana }),
    };
  }

  const chainId = parseEip155ChainId(caip2);
  if (chainId === null) {
    return {
      ns: "eip155",
      preview: {
        ok: false,
        code: DAPP_ERR.unsupportedMethod.code,
        error: "Unsupported chain",
      },
    };
  }
  const net = networkByChainId(chainId);
  const native = net ? { symbol: net.symbol, decimals: net.decimals } : DEFAULT_NATIVE;
  return {
    ns: "eip155",
    preview: previewDappRequest({
      method,
      params: (Array.isArray(params) ? params : []) as unknown[],
      chainId,
      account: accounts.evm,
      native,
    }),
  };
}

/**
 * Sign an approved request with the vault and return the result to the dApp.
 * Re-runs the preview (re-validates method + binds the request to the
 * connected account), then re-checks the vault lock (H-06 parity with
 * Send/BPAN): a locked/expired session fires onSessionExpired and signs
 * nothing. Rejects the request over the wire on validation failure and
 * rethrows signing errors so the caller can surface them. Returns broadcast
 * details when the request actually sent a transaction (so the sheet can show
 * the result overlay); undefined for signature-only requests.
 */
export async function approveSessionRequest(
  req: WalletKitTypes.SessionRequest,
  accounts: WcAccounts,
  onSessionExpired?: () => void,
): Promise<WcBroadcastResult | undefined> {
  const wk = getWalletKit();
  if (!wk) throw new Error("WalletConnect is not initialised");

  const routed = previewSessionRequest(req, accounts);
  if (!routed.preview.ok) {
    await rejectSessionRequest(req, {
      code: routed.preview.code,
      message: routed.preview.error,
    });
    return;
  }

  const { params, topic, id } = unwrap(req);

  if (routed.ns === "solana") {
    const preview = routed.preview;
    if (
      (preview.detail.kind === "sol_tx" || preview.detail.kind === "sol_tx_batch") &&
      preview.detail.feePayerMismatch
    ) {
      // The hard gate is inside signSolanaTransaction; refusing here returns a
      // proper error to the dApp instead of a thrown-away exception.
      await rejectSessionRequest(req, {
        code: DAPP_ERR.unauthorized.code,
        message: "Transaction fee payer is not the connected account",
      });
      return;
    }
    const mnemonic = await getUnlockedMnemonic();
    if (!mnemonic) {
      onSessionExpired?.();
      throw new Error("Vault locked");
    }
    const derived = await deriveSolanaAddress(mnemonic);
    if (derived.address !== preview.account) {
      throw new Error("Derived Solana account does not match the connected account");
    }
    const result = await signSolanaDappRequest(
      { method: preview.method, params, account: preview.account },
      derived.secretKey,
    );
    await wk.respondSessionRequest({
      topic,
      response: { id, jsonrpc: "2.0", result },
    });
    if (preview.detail.kind === "sol_tx" && preview.detail.send && "signature" in result) {
      return { txHash: result.signature, explorerUrl: explorerTxUrl("solana", result.signature) };
    }
    return undefined;
  }

  // eip155
  const preview = routed.preview;
  const net = networkByChainId(preview.chainId);
  // A transaction must go to the correct chain's RPC; refuse to broadcast on an
  // unknown chain rather than fall back to the wrong network. Signature methods
  // never touch the RPC, so an offline-only signer is fine for them.
  if (preview.method === "eth_sendTransaction" && !net) {
    await rejectSessionRequest(req, {
      code: DAPP_ERR.unsupportedMethod.code,
      message: `Chain ${preview.chainId} is not supported for transactions`,
    });
    return;
  }

  const mnemonic = await getUnlockedMnemonic();
  if (!mnemonic) {
    onSessionExpired?.();
    throw new Error("Vault locked");
  }

  const rpc = net?.rpcUrl ?? BPAN_MAINNET_RPC;
  const wd = importFromMnemonic(mnemonic);
  const signer = getSigner(wd.privateKey, rpc);

  const evmParams = (Array.isArray(params) ? params : []) as unknown[];
  const result = await signDappRequest({ method: preview.method, params: evmParams }, signer);
  await wk.respondSessionRequest({
    topic,
    response: { id, jsonrpc: "2.0", result },
  });

  if (preview.method !== "eth_sendTransaction" || !net || preview.detail.kind !== "send_tx") {
    return undefined;
  }

  // A dApp-initiated broadcast is still one of this wallet's sends: log it so
  // the Activity page shows it (the history-consistency rule) — the closed
  // sheet otherwise leaves no visible trace anywhere in the app.
  const dtx = preview.detail.tx;
  let valueWei: bigint | undefined;
  try {
    valueWei = BigInt(dtx.value ?? "0x0");
  } catch {
    valueWei = undefined; // hostile hex already survived preview; log without it
  }
  void logTx({
    owner: accounts.evm,
    hash: result, chainId: net.id, kind: "send", timestamp: Date.now(),
    symbol: net.symbol,
    value: valueWei !== undefined ? ethers.formatUnits(valueWei, net.decimals) : "0",
    logo: net.logo,
    counterparty: dtx.to ?? undefined,
    status: "pending",
    from: accounts.evm, to: dtx.to ?? undefined,
    valueWei: valueWei?.toString(), data: dtx.data,
  });
  void signer.provider?.waitForTransaction(result).then((rc) => {
    void updateTx(net.id, result, { status: rc && rc.status === 0 ? "failed" : "confirmed" });
  }).catch(() => { /* replaced/dropped — the Activity reconciler settles it */ });

  return { txHash: result, explorerUrl: explorerTxUrl(net.id, result) };
}

/**
 * Handle the requests that never need the signing sheet. Currently only
 * wallet_switchEthereumChain: every WalletConnect request already carries its
 * own CAIP-2 chainId, so a "switch" changes nothing on the wallet side and is
 * simply acknowledged (for a chain NumPay runs) or rejected (for one it
 * doesn't). Returns true when the request was consumed here.
 */
export function tryAutoRespond(req: WalletKitTypes.SessionRequest): boolean {
  if (req.params.request.method !== "wallet_switchEthereumChain") return false;
  const wk = getWalletKit();
  if (!wk) return true; // no transport, nothing to answer
  const raw = (req.params.request.params as Array<{ chainId?: string }> | undefined)?.[0]?.chainId;
  const target = typeof raw === "string" ? Number.parseInt(raw, 16) : NaN;
  const known = Number.isSafeInteger(target) && networkByChainId(target) !== undefined;
  void wk.respondSessionRequest({
    topic: req.topic,
    response: known
      ? { id: req.id, jsonrpc: "2.0", result: null }
      : {
          id: req.id,
          jsonrpc: "2.0",
          error: { code: 4902, message: `Chain ${raw ?? "?"} is not supported` },
        },
  }).catch(() => {});
  return true;
}

/** Reject a request with a JSON-RPC error the dApp receives (default 4001). */
export async function rejectSessionRequest(
  req: WalletKitTypes.SessionRequest,
  err: { code: number; message: string } = DAPP_ERR.userRejected,
): Promise<void> {
  const wk = getWalletKit();
  if (!wk) return;
  await wk.respondSessionRequest({
    topic: req.topic,
    response: {
      id: req.id,
      jsonrpc: "2.0",
      error: { code: err.code, message: err.message },
    },
  });
}
