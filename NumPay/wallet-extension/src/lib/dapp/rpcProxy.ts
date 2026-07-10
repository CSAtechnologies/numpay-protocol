// Forwards dApp READ methods to NumPay's own configured RPC for the active EVM
// chain. The page never supplies the endpoint, so it cannot redirect reads to a
// hostile node. Only methods on the READ_METHODS allowlist reach this.

import { NETWORKS, DEFAULT_NETWORK } from "@numpay/core/networks";
import { READ_METHODS, ERR, type RpcError } from "./types";

// The EVM chain exposed to dApps. The wallet's active chain may be non-EVM
// (e.g. solana); in that case we fall back to Ethereum mainnet for the dApp
// context, since window.ethereum is an EVM surface.
export function dappEvmChainId(activeChainId: string): string {
  return NETWORKS[activeChainId] ? activeChainId : DEFAULT_NETWORK;
}

export function evmChainIdHex(activeChainId: string): string {
  const net = NETWORKS[dappEvmChainId(activeChainId)] ?? NETWORKS[DEFAULT_NETWORK];
  return "0x" + net.chainId.toString(16);
}

export function evmChainIdNumber(activeChainId: string): number {
  const net = NETWORKS[dappEvmChainId(activeChainId)] ?? NETWORKS[DEFAULT_NETWORK];
  return net.chainId;
}

export function isReadMethod(method: string): boolean {
  return READ_METHODS.has(method);
}

// Proxy a JSON-RPC read to the active EVM chain's RPC. Throws an RpcError.
export async function proxyRead(
  activeChainId: string,
  method: string,
  params: unknown[] = []
): Promise<unknown> {
  if (!READ_METHODS.has(method)) throw ERR.unsupportedMethod as RpcError;
  const net = NETWORKS[dappEvmChainId(activeChainId)] ?? NETWORKS[DEFAULT_NETWORK];

  let res: Response;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 15000);
  try {
    res = await fetch(net.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: ctrl.signal,
    });
  } catch {
    throw { code: ERR.internal.code, message: "RPC request failed" } as RpcError;
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) throw { code: ERR.internal.code, message: `RPC HTTP ${res.status}` } as RpcError;
  const json = await res.json().catch(() => null);
  if (!json) throw { code: ERR.internal.code, message: "Malformed RPC response" } as RpcError;
  if (json.error) throw { code: json.error.code ?? -32603, message: json.error.message ?? "RPC error" } as RpcError;
  return json.result;
}
