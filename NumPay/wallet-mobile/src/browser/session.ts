// Browser session state: which EVM chain the in-app browser is presenting to
// the current page, and the plumbing that lets the wallet push provider events
// into a live WebView.
//
// WHY A SESSION CHAIN AT ALL
// The extension answers eth_chainId from `numpay_active_chain`, a wallet-wide
// setting, and wallet_switchEthereumChain mutates it for the whole wallet.
// Mobile has no such setting: the dashboard is chain-agnostic and shows every
// chain's balances at once, which is why no `numpay_active_chain` key exists
// anywhere in wallet-mobile. So the browser owns its own chain instead.
//
// That is not a workaround, it is the better model. A dApp calling
// wallet_switchEthereumChain changes only what the browser tab is pointed at.
// It cannot repoint anything the rest of the app does. The connection bar shows
// the current chain so the user is never guessing which network a signature is
// bound to.

import { NETWORKS, DEFAULT_NETWORK } from "@numpay/core/networks";
import { getCustomChains } from "@numpay/core/customChains";

/** Internal NumPay network id the browser starts on. */
export const DEFAULT_BROWSER_CHAIN = DEFAULT_NETWORK; // "ethereum"

export interface BrowserSession {
  /** Internal NumPay network id (built-in key or custom chain id). */
  chainId: string;
  /** The wallet's EVM address. Connection is still per-origin (permissions.ts). */
  account: string;
}

/** Numeric EVM chain id for an internal network id, falling back to mainnet. */
export async function numericChainId(internalId: string): Promise<number> {
  const builtin = NETWORKS[internalId];
  if (builtin) return builtin.chainId;
  const custom = (await getCustomChains()).find((c) => c.id === internalId);
  return custom ? custom.chainId : NETWORKS[DEFAULT_NETWORK].chainId;
}

/** Hex EVM chain id ("0x1") for an internal network id. */
export async function hexChainId(internalId: string): Promise<string> {
  return "0x" + (await numericChainId(internalId)).toString(16);
}

/** Display name for the connection bar. */
export async function chainLabel(internalId: string): Promise<string> {
  const builtin = NETWORKS[internalId];
  if (builtin) return builtin.name;
  const custom = (await getCustomChains()).find((c) => c.id === internalId);
  return custom ? custom.name : `Chain ${internalId}`;
}

/** RPC endpoint for an internal network id, or null when unknown. */
export async function rpcUrlFor(internalId: string): Promise<string | null> {
  const builtin = NETWORKS[internalId];
  if (builtin) return builtin.rpcUrl;
  const custom = (await getCustomChains()).find((c) => c.id === internalId);
  return custom ? custom.rpcUrl : null;
}

/** Native currency for value formatting, falling back to ETH. */
export async function nativeFor(
  internalId: string,
): Promise<{ symbol: string; decimals: number }> {
  const builtin = NETWORKS[internalId];
  if (builtin) return { symbol: builtin.symbol, decimals: builtin.decimals };
  const custom = (await getCustomChains()).find((c) => c.id === internalId);
  return custom
    ? { symbol: custom.symbol, decimals: custom.decimals }
    : { symbol: "ETH", decimals: 18 };
}

// ── origin formatting ────────────────────────────────────────────────────────

/**
 * The origin of a URL, or null if it is not one we will ever talk to.
 *
 * https ONLY. This is the single gate that decides whether a page can reach the
 * wallet at all, so it is deliberately strict: no http (a signature request
 * over cleartext is not something we want to normalise), no file:, no
 * javascript:, no app schemes.
 */
export function originOf(url: string | undefined | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    if (u.protocol !== "https:") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** Host for display, with a leading "www." dropped. */
export function displayHost(origin: string): string {
  try {
    return new URL(origin).host.replace(/^www\./, "");
  } catch {
    return origin;
  }
}
