// WalletConnect eip155 request handling for NumPay mobile: the bridge between a
// WalletKit `session_request` and the platform-free @numpay/core/dapp engine.
//
// The engine does all the decoding, validation and signing; this module only
// unwraps the WalletConnect envelope (CAIP-2 chainId, nested request), resolves
// the target chain's RPC + native currency from core's NETWORKS table, builds
// the signer from the unlocked vault (the SAME gated getUnlockedMnemonic ->
// getSigner path Send/BPAN use), and formats the JSON-RPC response. Nothing
// here auto-approves: previewSessionRequest feeds the approval sheet, and
// approveSessionRequest only runs after the user taps sign.

import type { WalletKitTypes } from "@reown/walletkit";
import {
  previewDappRequest,
  signDappRequest,
  DAPP_ERR,
  type DappRequestPreview,
} from "@numpay/core/dapp";
import { NETWORKS, BPAN_MAINNET_RPC } from "@numpay/core/networks";
import { importFromMnemonic, getSigner } from "@numpay/core/wallet";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import { getWalletKit } from "./client";

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
    params: (Array.isArray(request.params) ? request.params : []) as unknown[],
    chainId: parseEip155ChainId(req.params.chainId),
    topic: req.topic,
    id: req.id,
  };
}

/**
 * Build the approval-sheet preview for a session_request bound to `account`
 * (the session's connected EVM address). Pure: no keys, no network. Returns
 * { ok:false } for non-EVM chains or unsupported methods so the sheet can show
 * a clear rejection rather than an approve button.
 */
export function previewSessionRequest(
  req: WalletKitTypes.SessionRequest,
  account: string,
): DappRequestPreview {
  const { method, params, chainId } = unwrap(req);
  if (chainId === null) {
    return {
      ok: false,
      code: DAPP_ERR.unsupportedMethod.code,
      error: "Unsupported (non-EVM) chain",
    };
  }
  const net = networkByChainId(chainId);
  const native = net ? { symbol: net.symbol, decimals: net.decimals } : DEFAULT_NATIVE;
  return previewDappRequest({ method, params, chainId, account, native });
}

/**
 * Sign an approved request with the vault and return the result to the dApp.
 * Re-runs the preview (re-validates method + binds the request to `account`),
 * then re-checks the vault lock (H-06 parity with Send/BPAN): a locked/expired
 * session fires onSessionExpired and signs nothing. Rejects the request over
 * the wire on validation failure and rethrows signing errors so the caller can
 * surface them.
 */
export async function approveSessionRequest(
  req: WalletKitTypes.SessionRequest,
  account: string,
  onSessionExpired?: () => void,
): Promise<void> {
  const wk = getWalletKit();
  if (!wk) throw new Error("WalletConnect is not initialised");

  const preview = previewSessionRequest(req, account);
  if (!preview.ok) {
    await rejectSessionRequest(req, { code: preview.code, message: preview.error });
    return;
  }

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

  const { params, topic, id } = unwrap(req);
  const result = await signDappRequest({ method: preview.method, params }, signer);
  await wk.respondSessionRequest({
    topic,
    response: { id, jsonrpc: "2.0", result },
  });
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
