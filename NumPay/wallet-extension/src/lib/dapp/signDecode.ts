// Decode + risk-assessment helpers for dApp signing requests (P2).
// Dependency-light on purpose (no ethers/chrome) so it stays trivially testable
// and could be reused on either side of the port. The approval window owns the
// actual signing; this module only turns raw request params into something a
// human can review and flags the known signature-phishing shapes.

// Canonical Permit2 contract, identical across every EVM chain it is deployed on.
const PERMIT2_ADDRESS = "0x000000000022d473030f116ddee9f6b43ac78ba3";

// True if the text contains C0 control characters other than tab/newline/CR,
// which are legitimate in multi-line sign-in messages (SIWE). Implemented with
// char codes so no literal control bytes live in source.
function hasControlSoup(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i);
    if (c === 9 || c === 10 || c === 13) continue; // tab, LF, CR
    if (c < 0x20 || c === 0x7f) return true;
  }
  return false;
}

export interface DecodedPersonalSign {
  hex: string; // normalised 0x-prefixed message bytes
  text: string; // UTF-8 decode when valid, else the hex itself
  isUtf8: boolean; // true when the bytes decoded as valid, readable UTF-8
}

// personal_sign messages are an arbitrary byte string passed as hex (sometimes
// raw utf-8). We normalise to hex bytes, then attempt a strict UTF-8 decode so
// the user reads "Sign in to Foo" instead of a wall of hex when possible.
export function decodePersonalSignMessage(raw: unknown): DecodedPersonalSign {
  let bytes: Uint8Array;
  let hex: string;

  if (typeof raw === "string" && /^0x[0-9a-fA-F]*$/.test(raw)) {
    hex = "0x" + raw.slice(2).toLowerCase();
    bytes = hexToBytes(hex);
  } else if (typeof raw === "string") {
    // Non-hex string: treat as literal UTF-8 text.
    bytes = new TextEncoder().encode(raw);
    hex = "0x" + bytesToHex(bytes);
  } else {
    hex = "0x";
    bytes = new Uint8Array();
  }

  try {
    const text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    if (text.length > 0 && !hasControlSoup(text)) {
      return { hex, text, isUtf8: true };
    }
  } catch {
    /* not valid UTF-8 */
  }
  return { hex, text: hex, isUtf8: false };
}

export interface TypedDataDomain {
  name?: string;
  version?: string;
  chainId?: number;
  verifyingContract?: string;
}

export interface ParsedTypedData {
  ok: true;
  domain: TypedDataDomain;
  primaryType: string;
  types: Record<string, Array<{ name: string; type: string }>>;
  message: Record<string, unknown>;
  raw: any;
}
export interface TypedDataError {
  ok: false;
  error: string;
}

// Parse + validate an eth_signTypedData_v4 payload (object or JSON string).
// Only checks the shape ethers needs to sign; it does not re-implement EIP-712.
export function parseTypedData(input: unknown): ParsedTypedData | TypedDataError {
  let obj: any;
  if (typeof input === "string") {
    try {
      obj = JSON.parse(input);
    } catch {
      return { ok: false, error: "Typed data is not valid JSON" };
    }
  } else if (input && typeof input === "object") {
    obj = input;
  } else {
    return { ok: false, error: "Typed data payload missing" };
  }

  if (!obj.types || typeof obj.types !== "object")
    return { ok: false, error: "Typed data has no 'types'" };
  if (typeof obj.primaryType !== "string" || !obj.primaryType)
    return { ok: false, error: "Typed data has no 'primaryType'" };
  if (!obj.types[obj.primaryType])
    return { ok: false, error: `primaryType '${obj.primaryType}' not found in types` };
  if (!obj.message || typeof obj.message !== "object")
    return { ok: false, error: "Typed data has no 'message'" };

  const domain: TypedDataDomain = obj.domain && typeof obj.domain === "object" ? obj.domain : {};
  return {
    ok: true,
    domain,
    primaryType: obj.primaryType,
    types: obj.types,
    message: obj.message,
    raw: obj,
  };
}

// Strip the EIP712Domain entry: ethers v6 signTypedData derives it from `domain`
// and throws if it is also present in `types`.
export function typesForEthers(
  types: Record<string, Array<{ name: string; type: string }>>
): Record<string, Array<{ name: string; type: string }>> {
  const out: typeof types = {};
  for (const k of Object.keys(types)) {
    if (k === "EIP712Domain") continue;
    out[k] = types[k];
  }
  return out;
}

export interface RiskFlag {
  level: "warn" | "info";
  text: string;
}

// Surface the high-signal phishing shapes. Kept conservative: a warn here is
// meant to make the user actually read the request, not to block it.
export function assessTypedDataRisk(
  parsed: ParsedTypedData,
  activeChainId: number
): RiskFlag[] {
  const flags: RiskFlag[] = [];
  const pt = parsed.primaryType.toLowerCase();
  const verifying = String(parsed.domain.verifyingContract || "").toLowerCase();

  // Token spend approval by signature (Permit / Permit2 / DAI permit). This is
  // the dominant drainer pattern: a signature, not a tx, that hands an address
  // allowance over your tokens.
  if (verifying === PERMIT2_ADDRESS) {
    flags.push({
      level: "warn",
      text: "This is a Permit2 approval. Signing lets the site move your tokens. Only sign on a site you trust.",
    });
  } else if (pt.includes("permit")) {
    flags.push({
      level: "warn",
      text: "This signature approves token spending (Permit). It grants an allowance without a transaction. Verify the site.",
    });
  }

  // Domain chainId disagreeing with the wallet's active chain. Legitimate for
  // some cross-chain flows, but also a classic way to slip a mainnet permit
  // past a user who thinks they are on a testnet.
  if (
    parsed.domain.chainId !== undefined &&
    Number(parsed.domain.chainId) !== activeChainId
  ) {
    flags.push({
      level: "warn",
      text: `This request targets chain ${Number(parsed.domain.chainId)}, but your active network is chain ${activeChainId}.`,
    });
  }

  return flags;
}

// ── byte helpers (no deps) ───────────────────────────────────────────────────

function hexToBytes(hex: string): Uint8Array {
  const h = hex.slice(2);
  const clean = h.length % 2 ? "0" + h : h;
  const out = new Uint8Array(clean.length / 2);
  for (let i = 0; i < out.length; i++) out[i] = parseInt(clean.substr(i * 2, 2), 16);
  return out;
}

function bytesToHex(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) s += b.toString(16).padStart(2, "0");
  return s;
}
