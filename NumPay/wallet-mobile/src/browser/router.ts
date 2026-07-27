// EIP-1193 router for the mobile in-app browser. The counterpart of the
// extension's background/dappRouter.ts, and deliberately much smaller: there is
// one WebView rather than N tabs, and no service worker that can suspend
// mid-approval, so the extension's port registry, per-origin outbox and
// reconnect machinery have no equivalent here.
//
// The router DECIDES; it never signs and never renders. Every request resolves
// to one of three outcomes: an immediate result, an immediate error, or a
// pending approval the host must put in front of the user. That split is what
// makes the whole surface testable without React or a device, and it mirrors
// the extension's rule that the router is key-free.
//
// Everything reaching `route()` is untrusted page input. The one thing the
// router must be able to rely on is `ctx.origin`, which the host derives from
// native navigation state — never from the page (see BrowserScreen).

import {
  RPC_ERR,
  DEFERRED_METHODS,
  isReadMethod,
  proxyRead,
  getPermission,
  grant,
  setOriginChain,
  parseChainId,
  resolveInternalChainId,
  buildAddChainCandidate,
  previewDappRequest,
  type RpcError,
  type DappRequestPreview,
  type EvmSignMethod,
} from "@numpay/core/dapp";
import type { CustomChain } from "@numpay/core/customChains";
import { NETWORKS } from "@numpay/core/networks";
import { hexChainId, nativeFor, numericChainId, rpcUrlFor } from "./session";

/** A preview that passed validation. Only these ever reach a sheet. */
export type OkPreview = Extract<DappRequestPreview, { ok: true }>;

/** Something the user has to decide before the dApp gets an answer. */
export type BrowserPending =
  | { type: "connect"; origin: string; account: string; chainId: number }
  | {
      type: "sign";
      origin: string;
      method: EvmSignMethod;
      params: unknown[];
      /** Internal NumPay network id the signature/broadcast is bound to. */
      internalChainId: string;
      preview: OkPreview;
    }
  | {
      type: "switchChain";
      origin: string;
      targetInternalId: string;
      chainId: number;
      chainName: string;
    }
  | { type: "addChain"; origin: string; chain: CustomChain };

export type RouteOutcome =
  | { kind: "result"; result: unknown }
  | { kind: "error"; error: RpcError }
  | { kind: "approve"; pending: BrowserPending };

export interface RouterCtx {
  /** AUTHORITATIVE origin, from native navigation state. */
  origin: string;
  /** The wallet's EVM address, or null when no wallet is set up. */
  account: string | null;
  /** Whether the vault is currently unlocked. */
  unlocked: boolean;
  /** The browser session's chain, as an internal NumPay network id. */
  chainId: string;
}

function err(e: { code: number; message: string }): RouteOutcome {
  return { kind: "error", error: { code: e.code, message: e.message } };
}

function errWith(code: number, message: string): RouteOutcome {
  return { kind: "error", error: { code, message } };
}

export async function route(
  method: string,
  params: unknown[],
  ctx: RouterCtx,
): Promise<RouteOutcome> {
  try {
    switch (method) {
      // ── connection ──────────────────────────────────────────────────────────
      case "eth_requestAccounts": {
        const perm = await getPermission(ctx.origin);
        // Already granted and the wallet is open: reconnect silently, exactly
        // as the extension does. A locked wallet falls through to the sheet
        // rather than exposing an address we could not sign with anyway.
        if (perm && ctx.unlocked) return { kind: "result", result: [perm.account] };
        if (!ctx.account) {
          return errWith(RPC_ERR.internal.code, "No wallet set up");
        }
        return {
          kind: "approve",
          pending: {
            type: "connect",
            origin: ctx.origin,
            account: ctx.account,
            chainId: await numericChainId(ctx.chainId),
          },
        };
      }

      case "eth_accounts": {
        // Silent by contract: an origin with no grant gets [] and must go
        // through eth_requestAccounts. Never leaks the address to a page the
        // user has not connected.
        const perm = await getPermission(ctx.origin);
        return {
          kind: "result",
          result: perm && ctx.unlocked ? [perm.account] : [],
        };
      }

      case "eth_chainId":
        return { kind: "result", result: await hexChainId(ctx.chainId) };

      case "net_version":
        return { kind: "result", result: String(await numericChainId(ctx.chainId)) };

      // ── signing ─────────────────────────────────────────────────────────────
      case "personal_sign":
      case "eth_signTypedData_v4":
      case "eth_sendTransaction": {
        const perm = await getPermission(ctx.origin);
        if (!perm) {
          return errWith(RPC_ERR.unauthorized.code, "Connect the wallet first");
        }
        // A locked wallet cannot sign. Say so instead of opening a sheet that
        // would fail at the vault gate anyway.
        if (!ctx.unlocked) {
          return err(RPC_ERR.disconnected);
        }

        // A transaction has to reach the right chain's RPC. Refuse on a chain
        // we have no endpoint for rather than broadcast to the wrong network.
        // Signature-only methods never touch an RPC, so they are unaffected.
        if (method === "eth_sendTransaction" && !(await rpcUrlFor(ctx.chainId))) {
          return errWith(
            RPC_ERR.unsupportedMethod.code,
            `Chain ${ctx.chainId} is not supported for transactions`,
          );
        }

        // The core engine does the real validation: method support, address
        // binding to the connected account, payload caps, and "does this tx do
        // anything". Identical to the WalletConnect path in signRequests.ts.
        const preview = previewDappRequest({
          method,
          params,
          chainId: await numericChainId(ctx.chainId),
          account: perm.account,
          native: await nativeFor(ctx.chainId),
        });
        if (!preview.ok) {
          return errWith(preview.code, preview.error);
        }
        return {
          kind: "approve",
          pending: {
            type: "sign",
            origin: ctx.origin,
            method: preview.method,
            params,
            internalChainId: ctx.chainId,
            preview,
          },
        };
      }

      // ── chain management ────────────────────────────────────────────────────
      case "wallet_switchEthereumChain": {
        const target = parseChainId((params[0] as { chainId?: unknown })?.chainId);
        if (!target) return err(RPC_ERR.invalidParams);

        if ((await numericChainId(ctx.chainId)) === target) {
          return { kind: "result", result: null }; // already there: no-op success
        }
        const internalId = await resolveInternalChainId(target);
        if (!internalId) {
          // EIP-3326: 4902 tells the dApp to try wallet_addEthereumChain.
          return errWith(4902, "Unrecognized chain ID. Add it to NumPay first.");
        }
        const net = NETWORKS[internalId];
        return {
          kind: "approve",
          pending: {
            type: "switchChain",
            origin: ctx.origin,
            targetInternalId: internalId,
            chainId: target,
            chainName: net ? net.name : `Chain ${target}`,
          },
        };
      }

      case "wallet_addEthereumChain": {
        let candidate;
        try {
          candidate = await buildAddChainCandidate(params[0]);
        } catch (e) {
          return { kind: "error", error: e as RpcError };
        }
        if (candidate.alreadyExists) return { kind: "result", result: null };
        return {
          kind: "approve",
          pending: { type: "addChain", origin: ctx.origin, chain: candidate.chain },
        };
      }

      // ── reads + everything else ─────────────────────────────────────────────
      default: {
        if (isReadMethod(method)) {
          // Proxied to OUR endpoint for the session chain. The page never
          // supplies the RPC, so it cannot redirect reads to a hostile node.
          const result = await proxyRead(ctx.chainId, method, params);
          return { kind: "result", result };
        }
        if (DEFERRED_METHODS.has(method)) {
          return errWith(
            RPC_ERR.unsupportedMethod.code,
            `${method} is not supported in this version of NumPay yet`,
          );
        }
        return err(RPC_ERR.unsupportedMethod);
      }
    }
  } catch (e) {
    const x = e as { code?: number; message?: string };
    return errWith(x.code ?? RPC_ERR.internal.code, x.message ?? "Request failed");
  }
}

/**
 * Persist the grant for an approved connect. Re-reads the live account so a
 * wallet switched while the sheet was open cannot be connected behind the
 * user's back: if it changed, the connect is refused and the dApp can ask
 * again against the account now on screen (the extension's L-01 finding).
 */
export async function commitConnect(
  pending: Extract<BrowserPending, { type: "connect" }>,
  liveAccount: string | null,
): Promise<{ ok: true; account: string } | { ok: false; error: RpcError }> {
  const account = liveAccount ?? pending.account;
  if (account.toLowerCase() !== pending.account.toLowerCase()) {
    return { ok: false, error: { ...RPC_ERR.userRejected } };
  }
  await grant(pending.origin, account, pending.chainId);
  return { ok: true, account };
}

/** Persist the session chain for an approved wallet_switchEthereumChain. */
export async function commitSwitchChain(
  pending: Extract<BrowserPending, { type: "switchChain" }>,
): Promise<void> {
  await setOriginChain(pending.origin, pending.chainId);
}
