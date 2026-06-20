// Decode + risk assessment for eth_sendTransaction (P3a). Dependency-light (no
// ethers) so it stays trivially testable. It turns a dApp transaction request
// into a human-reviewable summary and flags the calldata shapes that hand a
// contract control over the user's tokens. The approval window owns signing and
// broadcasting; this module never touches a key or the network.

import type { RiskFlag } from "./signDecode";
import type { DappTxRequest } from "./types";

// Permit2 packs allowance into uint160; its "max" is the common unlimited value.
const MAX_UINT160 = (1n << 160n) - 1n;

// Well-known function selectors that grant token/NFT control.
const SELECTORS: Record<string, string> = {
  "0x095ea7b3": "approve",
  "0xa9059cbb": "transfer",
  "0x23b872dd": "transferFrom",
  "0xa22cb465": "setApprovalForAll",
  "0x39509351": "increaseAllowance",
  "0xd505accf": "permit",
};

export interface DecodedTxData {
  hasData: boolean;
  selector: string | null;
  fn: string | null; // friendly function name when recognised
  summary: string; // one-line human description
  risk: RiskFlag[];
}

function word(data: string, index: number): string {
  // data is 0x + selector(8 hex) + 32-byte words. index 0 = first arg word.
  const start = 2 + 8 + index * 64;
  return data.slice(start, start + 64);
}

function addrFromWord(w: string): string {
  return "0x" + w.slice(24); // last 20 bytes of the 32-byte word
}

function uintFromWord(w: string): bigint {
  return w ? BigInt("0x" + w) : 0n;
}

function shortAddr(a: string): string {
  return a.length >= 10 ? a.slice(0, 6) + "…" + a.slice(-4) : a;
}

// Decode the calldata of a transaction far enough to describe what it authorises
// and flag the dangerous approval shapes. Unknown calldata is reported as a
// generic contract interaction (still shown, never silently trusted).
export function decodeTxData(data?: string): DecodedTxData {
  if (!data || data === "0x" || data.length < 10) {
    return { hasData: false, selector: null, fn: null, summary: "Native value transfer (no contract call)", risk: [] };
  }
  const selector = data.slice(0, 10).toLowerCase();
  const fn = SELECTORS[selector] ?? null;
  const risk: RiskFlag[] = [];

  if (fn === "approve") {
    const spender = addrFromWord(word(data, 0));
    const amount = uintFromWord(word(data, 1));
    const unlimited = amount >= MAX_UINT160; // covers uint256 and Permit2 maxes
    risk.push({
      level: "warn",
      text: unlimited
        ? `Unlimited token approval to ${shortAddr(spender)}. This lets that address spend your tokens with no cap. Only approve a site you trust.`
        : `Token approval to ${shortAddr(spender)}. This lets that address spend your tokens up to the set amount.`,
    });
    return {
      hasData: true, selector, fn,
      summary: `approve(${shortAddr(spender)}, ${unlimited ? "unlimited" : amount.toString()})`,
      risk,
    };
  }

  if (fn === "increaseAllowance") {
    const spender = addrFromWord(word(data, 0));
    risk.push({ level: "warn", text: `Increases a token spending allowance for ${shortAddr(spender)}.` });
    return { hasData: true, selector, fn, summary: `increaseAllowance(${shortAddr(spender)}, …)`, risk };
  }

  if (fn === "setApprovalForAll") {
    const operator = addrFromWord(word(data, 0));
    const approved = uintFromWord(word(data, 1)) !== 0n;
    if (approved) {
      risk.push({
        level: "warn",
        text: `Grants ${shortAddr(operator)} control over ALL your NFTs in this collection. A common drainer pattern. Verify the site.`,
      });
    }
    return {
      hasData: true, selector, fn,
      summary: `setApprovalForAll(${shortAddr(operator)}, ${approved})`,
      risk,
    };
  }

  if (fn === "permit") {
    risk.push({ level: "warn", text: "Gasless token approval (permit). Grants a spending allowance by signature/relayer. Verify the site." });
    return { hasData: true, selector, fn, summary: "permit(...)", risk };
  }

  if (fn === "transfer") {
    const to = addrFromWord(word(data, 0));
    return { hasData: true, selector, fn, summary: `transfer(${shortAddr(to)}, …)`, risk };
  }

  if (fn === "transferFrom") {
    const from = addrFromWord(word(data, 0));
    const to = addrFromWord(word(data, 1));
    return { hasData: true, selector, fn, summary: `transferFrom(${shortAddr(from)}, ${shortAddr(to)}, …)`, risk };
  }

  // Unknown contract call: surface the selector so the user sees it is not a
  // plain transfer, but make no claims about what it does.
  return {
    hasData: true, selector, fn: null,
    summary: `Contract call (${selector})`,
    risk: [{ level: "info", text: "This calls a contract function NumPay cannot decode. Only continue if you trust the site and know what it does." }],
  };
}

// Format a hex wei value with the chain's native decimals/symbol for display.
export function formatNativeValue(valueHex: string | undefined, decimals: number, symbol: string): string {
  let v: bigint;
  try {
    v = valueHex ? BigInt(valueHex) : 0n;
  } catch {
    return `0 ${symbol}`;
  }
  if (v === 0n) return `0 ${symbol}`;
  const base = 10n ** BigInt(decimals);
  const whole = v / base;
  const frac = v % base;
  if (frac === 0n) return `${whole} ${symbol}`;
  // Trim trailing zeros on the fractional part, keep up to `decimals` digits.
  let fracStr = frac.toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${whole}.${fracStr} ${symbol}`;
}

// Map a dApp tx (hex quantities, `gas` field) to the shape ethers' signer
// expects (`gasLimit`, BigNumberish values). Undefined fields are dropped so
// ethers fills nonce/fees/gas itself.
export function normalizeTxForEthers(tx: DappTxRequest): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (tx.to) out.to = tx.to;
  if (tx.data && tx.data !== "0x") out.data = tx.data;
  if (tx.value) out.value = tx.value;
  if (tx.gas) out.gasLimit = tx.gas;
  if (tx.gasPrice) out.gasPrice = tx.gasPrice;
  if (tx.maxFeePerGas) out.maxFeePerGas = tx.maxFeePerGas;
  if (tx.maxPriorityFeePerGas) out.maxPriorityFeePerGas = tx.maxPriorityFeePerGas;
  if (tx.nonce !== undefined && tx.nonce !== null) out.nonce = Number(tx.nonce);
  return out;
}
