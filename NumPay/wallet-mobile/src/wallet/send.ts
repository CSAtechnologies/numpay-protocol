/**
 * Mobile send primitives — the same core calls the extension's Send page makes
 * (getSigner + sendTransaction for EVM natives, chains/sendSolanaTransfer for
 * SOL), over the keyless public RPC fallbacks. Key material is derived from
 * the vault mnemonic per call and goes out of scope immediately after signing.
 *
 * Slice scope: EVM native + Solana native. Tokens and the other non-EVM chains
 * follow (the core transfer functions already exist).
 */
import { ethers } from "ethers";
import { importFromMnemonic, getSigner } from "@numpay/core/wallet";
import { NETWORKS, type Network } from "@numpay/core/networks";
import {
  deriveNonEvmAddresses, sendSolanaTransfer, sendTronTransfer, sendSuiTransfer,
} from "@numpay/core/chains";
import { logTx, updateTx, explorerTxUrl } from "@numpay/core/txLog";

// Explorer links come from core so Activity rows and send receipts agree.
export { explorerTxUrl };

// ── Fee reserve heuristics (ported from the extension Send page) ─────────────
// Native-coin headroom to leave for the network fee on a MAX send. Rollups'
// posted L2 gas price omits the L1 data fee, so the live estimate is only
// trusted on L1-like chains; everywhere else the flat cushion applies.
const NATIVE_FEE_RESERVE: Record<string, number> = {
  ethereum: 0.0012,
  polygon: 0.05, avalanche: 0.003, bsc: 0.0003, fantom: 0.1, cronos: 0.3,
  celo: 0.03, gnosis: 0.02, moonbeam: 0.05, klaytn: 0.1, sei: 0.05,
  mantle: 0.1, metis: 0.002,
  solana: 0.0015, tron: 2, sui: 0.005,
};
const DEFAULT_FEE_RESERVE = 0.00002;
const HIDDEN_L1_FEE_CHAINS = new Set([
  "arbitrum", "optimism", "base", "zksync", "scroll", "linea", "blast", "mantle", "polygonzkevm",
]);
const NATIVE_TRANSFER_GAS = 21_000n;

export interface EvmFeeEstimate {
  /** Estimated fee for a plain native transfer, in native units. */
  feeNative: number;
  /** Headroom to subtract from the balance on a MAX send, in native units. */
  reserveNative: number;
}

export async function estimateEvmNativeFee(chainId: string): Promise<EvmFeeEstimate> {
  const net = requireNetwork(chainId);
  const flat = NATIVE_FEE_RESERVE[chainId] ?? DEFAULT_FEE_RESERVE;
  try {
    const provider = new ethers.JsonRpcProvider(net.rpcUrl, net.chainId, { staticNetwork: true });
    const fd = await provider.getFeeData();
    const perGas = fd.maxFeePerGas ?? fd.gasPrice;
    if (perGas == null) return { feeNative: flat, reserveNative: flat };
    const feeNative = Number((NATIVE_TRANSFER_GAS * perGas)) / 10 ** net.decimals;
    // Live estimate (+20% margin) is a safe MAX reserve on an L1; on rollups it
    // omits the L1 data fee, so never reserve below the flat cushion there.
    const live = feeNative * 1.2;
    const reserveNative = HIDDEN_L1_FEE_CHAINS.has(chainId) ? Math.max(flat, live) : live;
    return { feeNative, reserveNative };
  } catch {
    return { feeNative: flat, reserveNative: flat };
  }
}

export function nonEvmNativeReserve(chainId: string): number {
  return NATIVE_FEE_RESERVE[chainId] ?? DEFAULT_FEE_RESERVE;
}

// Parse a decimal amount string into an integer base-unit bigint without
// floating point, rejecting more fraction digits than the chain supports.
export function toBaseUnits(amount: string, decimals: number): bigint {
  const v = amount.trim();
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error("Invalid amount");
  const [whole, frac = ""] = v.split(".");
  if (frac.length > decimals) throw new Error(`At most ${decimals} decimal places are supported`);
  const base = BigInt(whole + frac.padEnd(decimals, "0"));
  if (base <= 0n) throw new Error("Enter an amount greater than zero");
  return base;
}

function requireNetwork(chainId: string): Network {
  const net = NETWORKS[chainId];
  if (!net) throw new Error(`Unknown network: ${chainId}`);
  return net;
}

// ── EVM native send ───────────────────────────────────────────────────────────
export async function sendEvmNative(
  mnemonic: string,
  chainId: string,
  to: string,
  amount: string,
  overrides?: ethers.Overrides,
): Promise<string> {
  const net = requireNetwork(chainId);
  const w = importFromMnemonic(mnemonic);
  const signer = getSigner(w.privateKey, net.rpcUrl);

  // Guard: confirm the RPC actually serves the selected chain before signing,
  // so a stale/wrong RPC can never produce a wrong-chain send (same guard as
  // the extension's Send page).
  const providerNet = await signer.provider!.getNetwork();
  if (Number(providerNet.chainId) !== net.chainId) {
    throw new Error(
      `Network mismatch: RPC reports chain ${providerNet.chainId}, expected ${net.chainId} (${net.name}). Send cancelled.`
    );
  }

  const tx = await signer.sendTransaction({
    to,
    value: ethers.parseUnits(amount, net.decimals),
    ...(overrides ?? {}),
  });

  void logTx({
    owner: w.address,
    hash: tx.hash, chainId: net.id, kind: "send", timestamp: Date.now(),
    symbol: net.symbol, value: amount,
    logo: net.logo,
    counterparty: to,
    status: "pending",
    nonce: tx.nonce, from: tx.from ?? w.address,
    to: tx.to ?? undefined, valueWei: tx.value?.toString(), data: tx.data,
    maxFeeWei: tx.maxFeePerGas?.toString(), maxPrioWei: tx.maxPriorityFeePerGas?.toString(),
    gasPriceWei: tx.gasPrice?.toString(),
  });
  void tx.wait().then((rc) => {
    void updateTx(net.id, tx.hash, { status: rc && rc.status === 0 ? "failed" : "confirmed" });
  }).catch(() => { /* replaced/dropped — the Activity reconciler settles it */ });

  return tx.hash;
}

// ── Non-EVM native sends (Solana / Tron / Sui — the chains the extension can
// send natively; BTC/LTC/XRP stay receive-only there too) ────────────────────
export const NON_EVM_SENDABLE: Record<string, { symbol: string; decimals: number }> = {
  solana: { symbol: "SOL", decimals: 9 },
  tron:   { symbol: "TRX", decimals: 6 },
  sui:    { symbol: "SUI", decimals: 9 },
};

export async function sendNonEvmNative(
  mnemonic: string,
  chainId: string,
  to: string,
  amount: string,
): Promise<string> {
  const meta = NON_EVM_SENDABLE[chainId];
  if (!meta) throw new Error(`Native sending is not wired up for ${chainId}`);
  const base = toBaseUnits(amount, meta.decimals);
  const derived = await deriveNonEvmAddresses(mnemonic);
  const owner = importFromMnemonic(mnemonic).address;

  let hash: string;
  if (chainId === "solana") {
    hash = await sendSolanaTransfer(derived.solana.secretKey, to, base);
  } else if (chainId === "tron") {
    hash = await sendTronTransfer(derived.tron.privateKey, derived.tron.address, to, base);
  } else {
    hash = await sendSuiTransfer(derived.sui.secretKey, derived.sui.address, to, base);
  }

  void logTx({
    owner,
    hash, chainId, kind: "send", timestamp: Date.now(),
    symbol: meta.symbol, value: amount,
    counterparty: to,
    status: "confirmed",
  });
  return hash;
}
