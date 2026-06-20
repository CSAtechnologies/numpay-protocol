// Chain-management helpers for wallet_switchEthereumChain / wallet_addEthereumChain
// (P3b). Pure-ish: no key access. Used by the background router to validate and
// resolve chain requests before/after the approval window. The window only adds
// the runtime host-permission grant (which needs a user gesture).

import { NETWORKS } from "../networks";
import { getCustomChains, type CustomChain } from "../customChains";
import { ERR, type RpcError } from "./types";

function rpcErr(code: number, message: string): RpcError {
  return { code, message };
}

// Parse an EIP-1193 hex chain id ("0x89") to a positive integer, or null.
export function parseChainId(hex: unknown): number | null {
  if (typeof hex !== "string" || !/^0x[0-9a-fA-F]+$/.test(hex)) return null;
  const n = parseInt(hex, 16);
  return Number.isSafeInteger(n) && n > 0 ? n : null;
}

// Internal network id (built-in key or custom id) for a numeric chain id, or
// null when the chain is not configured in NumPay.
export async function resolveInternalChainId(chainId: number): Promise<string | null> {
  const builtin = Object.values(NETWORKS).find((n) => n.chainId === chainId);
  if (builtin) return builtin.id;
  const custom = (await getCustomChains()).find((c) => c.chainId === chainId);
  return custom ? custom.id : null;
}

// https-only RPC URL validation. dApp-added endpoints must be TLS; we do not
// allow the plain-http localhost dev exception here (that is a manual,
// developer-only path in the UI, not something a website should trigger).
export function validateHttpsRpc(raw: unknown): string {
  if (typeof raw !== "string" || !raw.trim()) throw rpcErr(ERR.invalidParams.code, "Missing rpcUrls");
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw rpcErr(ERR.invalidParams.code, "Invalid rpcUrls");
  }
  if (u.protocol !== "https:") throw rpcErr(ERR.invalidParams.code, "rpcUrls must use https://");
  return u.toString();
}

// Ask an RPC which chain it serves (eth_chainId). Returns the numeric id, or
// null on any failure. Used to confirm a freshly added RPC actually serves the
// chain it claims, so a site cannot point a chain id at an unrelated node.
export async function rpcServesChain(rpcUrl: string): Promise<number | null> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
    });
    if (!res.ok) return null;
    const j = await res.json().catch(() => null);
    if (!j || typeof j.result !== "string") return null;
    const n = parseInt(j.result, 16);
    return Number.isSafeInteger(n) ? n : null;
  } catch {
    return null;
  }
}

export interface AddChainCandidate {
  chain: CustomChain;
  alreadyExists: boolean;
}

// Validate wallet_addEthereumChain params into a CustomChain candidate. Throws
// an RpcError on bad params or a collision with a BUILT-IN chain (we never let
// a website redefine the RPC for a canonical network). A chain that already
// exists as a custom network is reported as a no-op (alreadyExists).
export async function buildAddChainCandidate(param: unknown): Promise<AddChainCandidate> {
  if (!param || typeof param !== "object") throw rpcErr(ERR.invalidParams.code, "Invalid parameters");
  const p = param as Record<string, any>;

  const chainId = parseChainId(p.chainId);
  if (!chainId) throw rpcErr(ERR.invalidParams.code, "Invalid chainId");

  const builtin = Object.values(NETWORKS).find((n) => n.chainId === chainId);
  if (builtin) throw rpcErr(ERR.invalidParams.code, `Chain ${chainId} is a built-in network and cannot be overridden`);

  const existing = (await getCustomChains()).find((c) => c.chainId === chainId);
  if (existing) return { chain: existing, alreadyExists: true };

  const rpcUrl = validateHttpsRpc(Array.isArray(p.rpcUrls) ? p.rpcUrls[0] : undefined);
  const name =
    typeof p.chainName === "string" && p.chainName.trim() ? p.chainName.trim() : `Chain ${chainId}`;
  const cur = p.nativeCurrency || {};
  const symbol = typeof cur.symbol === "string" && cur.symbol ? cur.symbol : "ETH";
  const decimals = Number.isInteger(cur.decimals) ? cur.decimals : 18;
  const explorer =
    Array.isArray(p.blockExplorerUrls) && typeof p.blockExplorerUrls[0] === "string"
      ? p.blockExplorerUrls[0]
      : "";

  const chain: CustomChain = {
    id: `custom_${chainId}_${Date.now()}`,
    name,
    chainId,
    rpcUrl,
    symbol,
    decimals,
    explorer,
  };
  return { chain, alreadyExists: false };
}
