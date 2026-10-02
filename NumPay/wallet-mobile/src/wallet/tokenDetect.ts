// Token detection by contract address: the one place the app turns a pasted
// address into a token it can display. Manage assets, the Swap picker and the
// Send picker all import a token the same way, so the lookups, the shapes and
// the failure messages live here rather than being re-written per screen.
//
// Detection is deliberately RPC-only (no indexer): the free-tier discovery
// sweep misses tokens outright on several chains, and importing by address is
// exactly the escape hatch for that, so it must not depend on the same data
// source that failed.
import { ethers } from "ethers";
import { NETWORKS, type Network } from "@numpay/core/networks";
import { isAddress, isSolanaMint } from "@numpay/core/swap";
import { SOL_RPC } from "@numpay/core/chains/solana";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
  "function balanceOf(address) view returns (uint256)",
];

export interface TokenPreview {
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
  /** Formatted holding, present only when an owner address was supplied. */
  balance?: string;
}

/**
 * Does this string look like a token address on `chainId`? Shape only — the
 * two families are not interchangeable, and an EVM 0x address pasted while
 * Solana is selected must read as the wrong network rather than as a failed
 * lookup. Callers use this to decide whether to offer the import affordance.
 */
export function isTokenAddressFor(chainId: string, raw: string): boolean {
  return chainId === "solana" ? isSolanaMint(raw) : isAddress(raw);
}

/** Any address shape we can import, on any chain. Drives "this is an address,
 *  not a search term" in the pickers before a chain is even considered. */
export function looksLikeTokenAddress(raw: string): boolean {
  return isAddress(raw) || isSolanaMint(raw);
}

export async function detectEvmToken(
  rpcUrl: string, address: string, owner?: string, chainId?: number,
): Promise<TokenPreview> {
  const provider = chainId === undefined
    ? new ethers.JsonRpcProvider(rpcUrl)
    : new ethers.JsonRpcProvider(rpcUrl, chainId, { staticNetwork: true });
  try {
    const contract = new ethers.Contract(address, ERC20_ABI, provider);
    const [symbol, name, decimals] = await Promise.all([
      contract.symbol(), contract.name(), contract.decimals(),
    ]);
    const dec = Number(decimals);
    const out: TokenPreview = {
      symbol: String(symbol).trim(), name: String(name).trim(), decimals: dec,
    };
    if (owner) {
      // A missing balance must not sink the import: the metadata read already
      // proved the contract, and a token you hold zero of is still importable.
      try {
        const raw = (await contract.balanceOf(owner)) as bigint;
        out.balance = ethers.formatUnits(raw, dec);
      } catch { /* leave undefined */ }
    }
    return out;
  } finally {
    provider.destroy?.();
  }
}

export async function detectSolanaToken(mint: string, owner?: string): Promise<TokenPreview> {
  const [dasRes, mintRes] = await Promise.all([
    solRpc("getAsset", { id: mint }),
    solRpc("getAccountInfo", [mint, { encoding: "jsonParsed" }]),
  ]);
  const meta = dasRes?.result?.content?.metadata;
  if (!meta?.symbol) throw new Error("Token not found");
  const decimals = mintRes?.result?.value?.data?.parsed?.info?.decimals ?? 9;
  const logo = dasRes?.result?.content?.links?.image ?? dasRes?.result?.content?.files?.[0]?.cdn_uri;
  const out: TokenPreview = {
    symbol: String(meta.symbol).trim(),
    name: String(meta.name || meta.symbol).trim(),
    decimals: Number(decimals),
    logo,
  };
  if (owner) out.balance = await solTokenBalance(owner, mint);
  return out;
}

/** Sum of every token account the owner holds for this mint (a wallet can hold
 *  more than one, and only the total is meaningful to the user). */
async function solTokenBalance(owner: string, mint: string): Promise<string | undefined> {
  try {
    const res = await solRpc("getTokenAccountsByOwner", [
      owner, { mint }, { encoding: "jsonParsed" },
    ]);
    const accounts = (res?.result?.value ?? []) as any[];
    if (accounts.length === 0) return "0";
    let total = 0;
    for (const a of accounts) {
      total += Number(a.account?.data?.parsed?.info?.tokenAmount?.uiAmount ?? 0);
    }
    return String(total);
  } catch { return undefined; }
}

async function solRpc(method: string, params: unknown): Promise<any> {
  return fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  }).then((r) => r.json()).catch(() => null);
}

/**
 * Detect on whichever chain is selected. `nets` carries custom networks so an
 * import works on a user-added chain too; owner addresses are optional and
 * only affect whether a balance comes back.
 */
export async function detectToken(
  chainId: string, address: string,
  opts: { evmAddress?: string; solanaAddress?: string; customNets?: Record<string, Network> } = {},
): Promise<TokenPreview> {
  if (chainId === "solana") return detectSolanaToken(address, opts.solanaAddress);
  const net = NETWORKS[chainId] ?? opts.customNets?.[chainId];
  if (!net) throw new Error("No RPC for this chain.");
  return detectEvmToken(net.rpcUrl, address, opts.evmAddress, net.chainId);
}

/** ethers' revert noise is unreadable; the common case by far is "right
 *  address, wrong network", so say that instead of echoing the decode error. */
export function detectErrorMessage(e: any): string {
  const msg = String(e?.message ?? "");
  if (msg.includes("could not decode") || msg.includes("call revert") || msg.includes("BAD_DATA")) {
    return "Not a valid token contract on this chain. Check the network above.";
  }
  if (msg === "Token not found") return "Could not find that token. Check the mint address.";
  return msg || "Could not fetch token info.";
}
