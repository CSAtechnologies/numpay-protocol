/**
 * Sui support — Ed25519 address derivation + balance fetching.
 * Uses SLIP-0010 HD derivation with BIP44 path m/44'/784'/0'/0'/0'.
 * Sui address = 0x + hex(BLAKE2b-256(0x00 || pubkey)), where 0x00 is the
 * Ed25519 signature-scheme flag. This matches the Mysten Sui SDK/CLI; using
 * SHA-256/SHA3-256 here produces an address the key does NOT control.
 */
import { derivePath } from "./slip10";
import nacl from "tweetnacl";
import { ethers } from "ethers";
import { blake2b } from "@noble/hashes/blake2b";

// Sui BIP44 derivation path
const SUI_DERIVATION_PATH = "m/44'/784'/0'/0'/0'";

const SUI_RPCS = [
  "https://fullnode.mainnet.sui.io",
  "https://sui-mainnet.nodeinfra.com",
  "https://mainnet.sui.rpcpool.com",
];

/**
 * Compute Sui address from an Ed25519 public key.
 * address = BLAKE2b-256(0x00 || pubkey), hex-encoded with 0x prefix.
 * The 0x00 byte is the Ed25519 signature-scheme flag. This is the canonical
 * Sui derivation (verified against the Mysten Sui SDK).
 */
function suiAddressFromPubkey(pubkey: Uint8Array): string {
  const payload = new Uint8Array(1 + pubkey.length);
  payload[0] = 0x00; // Ed25519 scheme flag
  payload.set(pubkey, 1);

  const hashBytes = blake2b(payload, { dkLen: 32 });

  const hex = Array.from(hashBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
  return "0x" + hex;
}

/**
 * Derive a Sui address from a BIP39 mnemonic.
 */
export async function deriveSuiAddress(mnemonic: string): Promise<{
  address: string;
  publicKey: string;
  secretKey: Uint8Array;
}> {
  const seed = ethers.Mnemonic.fromPhrase(mnemonic).computeSeed();
  const seedHex = seed.slice(2);

  // SLIP-0010 derivation for Ed25519
  const derived = await derivePath(SUI_DERIVATION_PATH, seedHex);

  // Generate Ed25519 keypair
  const keypair = nacl.sign.keyPair.fromSeed(derived.key);

  // Derive Sui address from public key
  const address = suiAddressFromPubkey(keypair.publicKey);

  const pubHex = Array.from(keypair.publicKey)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

  return {
    address,
    publicKey: "0x" + pubHex,
    secretKey: keypair.secretKey,
  };
}

/** Minimal Sui JSON-RPC call; throws on transport or RPC-level errors. */
async function suiRpc(rpc: string, method: string, params: any[]): Promise<any> {
  const resp = await fetch(rpc, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!resp.ok) throw new Error(`Sui RPC ${resp.status}`);
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message || `Sui RPC error (${method})`);
  return data.result;
}

// Max gas the transfer may burn (0.01 SUI). Unused gas is refunded by the network.
const SUI_GAS_BUDGET = 10_000_000n;

/**
 * Send native SUI and return the transaction digest.
 *
 * Uses the same "node builds, we sign" approach as the Tron path so the only
 * client-side crypto is the well-defined Sui intent signature:
 *   1. Gather SUI coin objects covering amount + gas (`suix_getCoins`).
 *   2. The node builds the unsigned transfer (`unsafe_paySui`, which merges and
 *      splits the input coins and uses the first as the gas coin).
 *   3. Intent-sign: digest = BLAKE2b-256([0,0,0] || txBytes); Ed25519 over the
 *      digest; serialized signature = flag(0x00) || sig(64) || pubkey(32).
 *   4. Execute once (`sui_executeTransactionBlock`).
 *
 * Build is retried across RPCs, but signing/execution happen once on a single
 * node so a flaky response can never cause a double-spend re-submit.
 *
 * @param secretKey  tweetnacl 64-byte secret key (seed || pubkey).
 * @param fromAddress Sender (0x...).
 * @param toAddress   Recipient (0x...).
 * @param amountMist  Amount in MIST (1 SUI = 1e9 MIST).
 */
export async function sendSuiTransfer(
  secretKey: Uint8Array,
  fromAddress: string,
  toAddress: string,
  amountMist: bigint,
): Promise<string> {
  if (amountMist <= 0n) throw new Error("Enter an amount greater than zero");

  // ── Phase 1: find a working RPC and build the unsigned transfer ──────────
  let rpc = "";
  let txBytesB64 = "";
  let buildErr: Error | null = null;
  for (const candidate of SUI_RPCS) {
    try {
      const coins = await suiRpc(candidate, "suix_getCoins", [fromAddress, "0x2::sui::SUI", null, 50]);
      const list: any[] = coins?.data ?? [];
      if (list.length === 0) throw new Error("No SUI coins available to spend");
      list.sort((a, b) => (BigInt(b.balance) > BigInt(a.balance) ? 1 : -1));

      const needed = amountMist + SUI_GAS_BUDGET;
      const selected: string[] = [];
      let sum = 0n;
      for (const c of list) {
        selected.push(c.coinObjectId);
        sum += BigInt(c.balance);
        if (sum >= needed) break;
      }
      if (sum < needed) throw new Error("Insufficient SUI to cover the amount plus network gas");

      const built = await suiRpc(candidate, "unsafe_paySui", [
        fromAddress, selected, [toAddress], [amountMist.toString()], SUI_GAS_BUDGET.toString(),
      ]);
      if (!built?.txBytes) throw new Error("Could not build the Sui transaction");
      rpc = candidate;
      txBytesB64 = built.txBytes;
      break;
    } catch (e: any) {
      buildErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  if (!txBytesB64) throw buildErr ?? new Error("Could not reach a Sui node");

  // ── Phase 2: intent-sign (once) ──────────────────────────────────────────
  const txBytes = Uint8Array.from(atob(txBytesB64), (c) => c.charCodeAt(0));
  const intentMessage = new Uint8Array(3 + txBytes.length);
  intentMessage.set([0, 0, 0], 0); // intent: TransactionData / V0 / Sui
  intentMessage.set(txBytes, 3);
  const digest = blake2b(intentMessage, { dkLen: 32 });
  const signature = nacl.sign.detached(digest, secretKey);

  const pubkey = secretKey.slice(32);
  const serialized = new Uint8Array(1 + signature.length + pubkey.length);
  serialized[0] = 0x00; // Ed25519 scheme flag
  serialized.set(signature, 1);
  serialized.set(pubkey, 1 + signature.length);
  let bin = "";
  for (let i = 0; i < serialized.length; i++) bin += String.fromCharCode(serialized[i]);
  const sigB64 = btoa(bin);

  // ── Phase 3: execute (once, on the node that built it) ───────────────────
  const exec = await suiRpc(rpc, "sui_executeTransactionBlock", [
    txBytesB64, [sigB64], { showEffects: true }, "WaitForLocalExecution",
  ]);
  const status = exec?.effects?.status?.status;
  if (status && status !== "success") {
    throw new Error(exec?.effects?.status?.error || "Transaction failed on-chain");
  }
  if (!exec?.digest) throw new Error("No transaction digest returned");
  return exec.digest as string;
}

/**
 * Fetch Sui balance using JSON-RPC.
 * Returns balance in SUI.
 */
export async function fetchSuiBalance(address: string): Promise<number> {
  const body = JSON.stringify({
    jsonrpc: "2.0", id: 1,
    method: "suix_getBalance",
    params: [address, "0x2::sui::SUI"],
  });
  for (const rpc of SUI_RPCS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const mist = parseInt(data.result?.totalBalance || "0", 10);
      return mist / 1e9; // MIST to SUI
    } catch {}
  }
  return 0;
}

/**
 * Fetch all non-native coin balances held by a Sui address.
 * `suix_getAllBalances` enumerates every coin type the address holds (full
 * auto-detect, no curated list needed); `suix_getCoinMetadata` resolves
 * symbol/decimals/icon per type. Native SUI is skipped (shown via the chain
 * balance). Returns [] on failure so a flaky fetch never drops holdings.
 */
export async function fetchSuiTokens(address: string): Promise<Array<{
  symbol: string; name: string; address: string; decimals: number; balance: string; logo?: string;
}>> {
  const NATIVE = "0x2::sui::SUI";
  for (const rpc of SUI_RPCS) {
    try {
      const resp = await fetch(rpc, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getAllBalances", params: [address] }),
      });
      if (!resp.ok) continue;
      const data = await resp.json();
      const balances: any[] = data.result ?? [];
      const held = balances.filter(
        (b) => b.coinType && b.coinType !== NATIVE && b.totalBalance && b.totalBalance !== "0",
      );
      if (held.length === 0) return [];

      // Resolve metadata per coin type (parallel, best-effort).
      const out = await Promise.all(held.map(async (b) => {
        let decimals = 9;
        let symbol = "";
        let name = "";
        let logo: string | undefined;
        try {
          const m = await fetch(rpc, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "suix_getCoinMetadata", params: [b.coinType] }),
          });
          if (m.ok) {
            const md = (await m.json()).result;
            if (md) {
              decimals = Number(md.decimals ?? 9);
              symbol = String(md.symbol ?? "");
              name = String(md.name ?? "");
              logo = md.iconUrl || undefined;
            }
          }
        } catch {}
        // Fallback to the coin type's module/struct tail (e.g. 0x..::usdc::USDC).
        const tail = b.coinType.split("::").pop() || b.coinType.slice(0, 8);
        if (!symbol) symbol = tail;
        if (!name) name = tail;
        let balance = "0";
        try { balance = ethers.formatUnits(b.totalBalance, decimals); } catch {}
        return { symbol, name, address: b.coinType as string, decimals, balance, logo };
      }));

      return out.filter((t) => parseFloat(t.balance) > 0);
    } catch {}
  }
  return [];
}
