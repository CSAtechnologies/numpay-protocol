// Pending-transaction lifecycle: reconcile logged sends against on-chain
// receipts, and replace a stuck EVM send (speed-up or cancel) by re-broadcasting
// at the SAME nonce with higher gas. All RPC-only — no indexer — so it works on
// the free-tier keys. Only EVM sends carry the replacement fields (nonce, to,
// value, data, gas); non-EVM chains confirm fast and are left untracked.

import { ethers } from "ethers";
import { NETWORKS } from "./networks";
import { getSigner } from "./wallet";
import { type LoggedTx, updateTx, loadTxLog } from "./txLog";

function readProvider(chainId: string): ethers.JsonRpcProvider | null {
  const net = NETWORKS[chainId];
  if (!net) return null;
  return new ethers.JsonRpcProvider(net.rpcUrl, net.chainId, { staticNetwork: true });
}

/**
 * Resolve every pending EVM send against its receipt and persist the outcome, so
 * a tx that confirmed while the popup was closed no longer shows as pending.
 * Returns the refreshed log. Best-effort per entry (a failed RPC leaves it pending).
 */
export async function reconcilePending(list: LoggedTx[], owner: string): Promise<LoggedTx[]> {
  const pending = list.filter((e) => e.status === "pending" && NETWORKS[e.chainId]);
  if (pending.length === 0) return list;
  await Promise.all(pending.map(async (e) => {
    try {
      const provider = readProvider(e.chainId);
      if (!provider) return;
      const rc = await provider.getTransactionReceipt(e.hash);
      if (rc) await updateTx(e.chainId, e.hash, { status: rc.status === 0 ? "failed" : "confirmed" });
    } catch { /* stays pending, retried next load */ }
  }));
  return loadTxLog(owner);
}

// Bump gas at least ~20% over both the original and the current network rate so
// the replacement clears the node's +10% replacement-fee minimum.
async function bumpedGas(entry: LoggedTx, provider: ethers.Provider): Promise<ethers.Overrides> {
  const fd = await provider.getFeeData().catch(() => null);
  const bump = (cur?: bigint | null, orig?: string) => {
    const a = cur ?? 0n;
    const b = orig ? BigInt(orig) : 0n;
    const base = a > b ? a : b;
    return base + base / 5n; // +20%
  };
  if ((fd?.maxFeePerGas ?? null) != null || entry.maxFeeWei) {
    return {
      maxFeePerGas: bump(fd?.maxFeePerGas, entry.maxFeeWei),
      maxPriorityFeePerGas: bump(fd?.maxPriorityFeePerGas, entry.maxPrioWei),
    };
  }
  return { gasPrice: bump(fd?.gasPrice, entry.gasPriceWei) };
}

function gasToLog(g: ethers.Overrides): Partial<LoggedTx> {
  return {
    maxFeeWei: g.maxFeePerGas != null ? g.maxFeePerGas.toString() : undefined,
    maxPrioWei: g.maxPriorityFeePerGas != null ? g.maxPriorityFeePerGas.toString() : undefined,
    gasPriceWei: g.gasPrice != null ? g.gasPrice.toString() : undefined,
  };
}

/** Re-broadcast the same send at a higher gas price (same nonce). Returns the new hash. */
export async function speedUpTx(entry: LoggedTx, privateKey: string): Promise<string> {
  const net = NETWORKS[entry.chainId];
  if (!net) throw new Error("Speed-up is only available on EVM chains");
  if (entry.nonce == null || !entry.to) throw new Error("This transaction can't be sped up");
  const signer = getSigner(privateKey, net.rpcUrl);
  const gas = await bumpedGas(entry, signer.provider!);
  const tx = await signer.sendTransaction({
    to: entry.to,
    value: entry.valueWei ? BigInt(entry.valueWei) : 0n,
    data: entry.data || "0x",
    nonce: entry.nonce,
    ...gas,
  });
  await updateTx(entry.chainId, entry.hash, { hash: tx.hash, timestamp: Date.now(), status: "pending", ...gasToLog(gas) });
  return tx.hash;
}

/** Replace a stuck send with a 0-value self-transfer at the same nonce (cancel). */
export async function cancelTx(entry: LoggedTx, privateKey: string): Promise<string> {
  const net = NETWORKS[entry.chainId];
  if (!net) throw new Error("Cancel is only available on EVM chains");
  if (entry.nonce == null || !entry.from) throw new Error("This transaction can't be cancelled");
  const signer = getSigner(privateKey, net.rpcUrl);
  const gas = await bumpedGas(entry, signer.provider!);
  const tx = await signer.sendTransaction({ to: entry.from, value: 0n, nonce: entry.nonce, ...gas });
  await updateTx(entry.chainId, entry.hash, {
    hash: tx.hash, timestamp: Date.now(), status: "pending",
    to: entry.from, valueWei: "0", data: "0x",
    counterparty: entry.from, symbol: net.symbol, value: "0",
    ...gasToLog(gas),
  });
  return tx.hash;
}
