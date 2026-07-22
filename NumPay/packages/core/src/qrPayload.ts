/**
 * What a scanned QR code means.
 *
 * Deliberately a PURE parser with no camera, no network and no storage, so the
 * decision that routes a scan (and can therefore misdirect a send) is unit
 * testable on its own. The scanner UI only feeds it a string.
 *
 * Supported payloads:
 *   • `wc:…`                      WalletConnect pairing (existing dApp flow)
 *   • EIP-681 `ethereum:0x…@1?value=…`, incl. the ERC-20 `/transfer` form
 *   • BIP-21-style `solana:…?amount=`, `tron:`, `bitcoin:`, `litecoin:`
 *   • a bare address (EVM, Sui, Solana, Tron, Bitcoin, Litecoin)
 *   • 11 digits — a BPAN
 *
 * CHAIN SAFETY. A bare `0x` + 40 hex string is a valid address on EVERY EVM
 * chain, so this parser never guesses which one. It returns the address with
 * `chainId` undefined and the caller keeps whatever chain the user already
 * chose. Only a payload that states its chain (an EIP-681 `@chainId`, or a
 * scheme like `solana:`) ever sets one. Guessing here would put a correct
 * address on the wrong network, which is unrecoverable.
 */
import { NETWORKS } from "./networks";
import { isValidNonEvmAddress } from "./addressValidation";

export type ScanPayload =
  | { kind: "walletconnect"; uri: string }
  | {
      kind: "address";
      address: string;
      /** Only set when the payload itself named a chain. Never inferred. */
      chainId?: string;
      /** Decimal amount when the payload carried one (EIP-681 / BIP-21). */
      amount?: string;
    }
  | { kind: "bpan"; bpan: string }
  | { kind: "unknown"; raw: string };

/** URI schemes that name a non-EVM chain directly. */
const SCHEME_CHAIN: Record<string, string> = {
  solana: "solana",
  tron: "tron",
  bitcoin: "bitcoin",
  litecoin: "litecoin",
  sui: "sui",
};

const EVM_ADDR_RE = /^0x[0-9a-fA-F]{40}$/;
// Sui addresses are 0x + 32 bytes, so they can never collide with an EVM one.
const SUI_ADDR_RE = /^0x[0-9a-fA-F]{64}$/;

/** Numeric EIP-155 chain id -> our network id ("1" -> "ethereum"). */
function networkIdOfChainId(numeric: string): string | undefined {
  const n = parseInt(numeric, 10);
  if (!Number.isFinite(n)) return undefined;
  for (const net of Object.values(NETWORKS)) {
    if (net.chainId === n) return net.id;
  }
  return undefined;
}

/** Parse `?a=1&b=2` (or a whole URI's query) into a plain object. */
function queryOf(s: string): Record<string, string> {
  const out: Record<string, string> = {};
  const q = s.includes("?") ? s.slice(s.indexOf("?") + 1) : "";
  if (!q) return out;
  for (const pair of q.split("&")) {
    if (!pair) continue;
    const eq = pair.indexOf("=");
    const k = eq === -1 ? pair : pair.slice(0, eq);
    const v = eq === -1 ? "" : pair.slice(eq + 1);
    try { out[decodeURIComponent(k)] = decodeURIComponent(v); }
    catch { out[k] = v; }
  }
  return out;
}

/**
 * EIP-681 `value` is in wei (or the token's base units) and may use scientific
 * notation (`2.014e18`). Convert to a plain decimal string; return "" when it
 * is not a number we can trust, so a bad amount never silently prefills.
 */
function weiToDecimal(value: string, decimals: number): string {
  if (!value) return "";
  const m = /^([0-9]*\.?[0-9]+)(?:e([+-]?\d+))?$/i.exec(value.trim());
  if (!m) return "";
  const n = parseFloat(m[1]) * Math.pow(10, m[2] ? parseInt(m[2], 10) : 0);
  if (!Number.isFinite(n) || n < 0) return "";
  const amount = n / Math.pow(10, decimals);
  if (!Number.isFinite(amount)) return "";
  // Trim to the asset's precision, then drop trailing zeros.
  return String(Number(amount.toFixed(Math.min(decimals, 12))));
}

/** Detect the chain of a bare, scheme-less address. EVM stays undecided. */
function bareAddress(s: string): ScanPayload | null {
  if (EVM_ADDR_RE.test(s)) {
    // Valid on every EVM chain. See CHAIN SAFETY above: do not guess.
    return { kind: "address", address: s };
  }
  if (SUI_ADDR_RE.test(s)) return { kind: "address", address: s, chainId: "sui" };
  // Non-EVM formats are mutually distinguishable, so a positive match names
  // its chain. Order matters only for speed, not correctness.
  for (const chainId of ["solana", "tron", "bitcoin", "litecoin"]) {
    if (isValidNonEvmAddress(s, chainId)) return { kind: "address", address: s, chainId };
  }
  return null;
}

export function parseScannedPayload(raw: string): ScanPayload {
  const s = (raw ?? "").trim();
  if (!s) return { kind: "unknown", raw: s };

  // WalletConnect keeps its own handoff untouched.
  if (s.toLowerCase().startsWith("wc:")) return { kind: "walletconnect", uri: s };

  // 11 digits is a BPAN. Checked before the address paths because it shares no
  // shape with any of them.
  const digits = s.replace(/[\s-]/g, "");
  if (/^\d{11}$/.test(digits)) return { kind: "bpan", bpan: digits };

  const colon = s.indexOf(":");
  if (colon > 0) {
    // "pay-" is the EIP-681 prefix some wallets emit (pay-ethereum:0x…).
    const scheme = s.slice(0, colon).toLowerCase().replace(/^pay-/, "");
    const rest = s.slice(colon + 1);
    const query = queryOf(rest);
    // Strip the query, then any EIP-681 function suffix ("0x…/transfer").
    const beforeQuery = rest.includes("?") ? rest.slice(0, rest.indexOf("?")) : rest;
    const [targetRaw, fn] = beforeQuery.split("/");
    // "ethereum:0x…@8453" pins the chain; without @ it is Ethereum mainnet.
    const [addrPart, chainPart] = targetRaw.split("@");
    const target = addrPart.trim();

    // A scheme that names a non-EVM chain is checked FIRST. Falling through to
    // the EVM branch on the address shape alone made `solana:0x<evm addr>`
    // parse as Ethereum, i.e. a scheme/address mismatch silently became a
    // send on a chain the payload never named.
    const schemeChain = SCHEME_CHAIN[scheme];
    if (schemeChain) {
      const ok = schemeChain === "sui"
        ? SUI_ADDR_RE.test(target)
        : isValidNonEvmAddress(target, schemeChain);
      if (!ok) return { kind: "unknown", raw: s };
      // BIP-21 style amounts are already in whole coins.
      const amt = (query.amount ?? "").trim();
      const amount = /^\d*\.?\d+$/.test(amt) ? String(Number(amt)) : "";
      return { kind: "address", address: target, chainId: schemeChain, ...(amount ? { amount } : {}) };
    }

    if (scheme === "ethereum" || networkIdOfChainId(chainPart ?? "") || EVM_ADDR_RE.test(target)) {
      if (!EVM_ADDR_RE.test(target)) return { kind: "unknown", raw: s };
      const chainId = chainPart ? networkIdOfChainId(chainPart) : "ethereum";
      if (chainPart && !chainId) {
        // A chain we do not support. Surfacing the address without its chain
        // would invite sending on the wrong one, so refuse the whole payload.
        return { kind: "unknown", raw: s };
      }
      if (fn === "transfer") {
        // ERC-20 transfer: the real recipient is the `address` parameter and
        // `uint256` is in TOKEN units, which we cannot decode without knowing
        // the token's decimals. Take the recipient, drop the amount.
        const to = (query.address ?? "").trim();
        if (!EVM_ADDR_RE.test(to)) return { kind: "unknown", raw: s };
        return { kind: "address", address: to, chainId };
      }
      const amount = weiToDecimal(query.value ?? "", 18);
      return { kind: "address", address: target, chainId, ...(amount ? { amount } : {}) };
    }

    return { kind: "unknown", raw: s };
  }

  return bareAddress(s) ?? { kind: "unknown", raw: s };
}
