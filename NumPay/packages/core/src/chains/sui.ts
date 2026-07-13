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
import { Transaction } from "@mysten/sui/transactions";
import { SuiJsonRpcClient } from "@mysten/sui/jsonRpc";

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
 * Build an unsigned transfer client-side with the official Sui SDK, trying
 * each RPC in turn. `tx.coin({ balance })` draws from address balances when
 * available and falls back to owned coin objects, so funds received via the
 * accumulator (address-balance) mechanism are spendable — the legacy
 * `unsafe_paySui` node builder cannot fetch the compat-layer fake-coin
 * reservations at all ("unable to fetch object", observed 2026-07-13).
 * Recipient and amount are fixed in the command list here on the client; the
 * node is only consulted to resolve inputs, gas payment, and gas price.
 */
async function buildSuiSend(
  fromAddress: string,
  toAddress: string,
  amount: bigint,
  coinType: string | null,
  gasBudget: bigint,
): Promise<{ rpc: string; txBytes: Uint8Array; txBytesB64: string }> {
  let buildErr: Error | null = null;
  for (const candidate of SUI_RPCS) {
    try {
      const client = new SuiJsonRpcClient({ url: candidate, network: "mainnet" });
      const tx = new Transaction();
      tx.setSender(fromAddress);
      tx.setGasBudget(gasBudget);
      tx.transferObjects(
        [tx.coin(coinType ? { balance: amount, type: coinType } : { balance: amount })],
        toAddress,
      );
      const txBytes = await tx.build({ client });
      let bin = "";
      for (let i = 0; i < txBytes.length; i++) bin += String.fromCharCode(txBytes[i]);
      return { rpc: candidate, txBytes, txBytesB64: btoa(bin) };
    } catch (e: any) {
      buildErr = e instanceof Error ? e : new Error(String(e));
    }
  }
  throw buildErr ?? new Error("Could not reach a Sui node");
}

/**
 * Send native SUI and return the transaction digest.
 *
 *   1. Build the transfer client-side (SDK, see buildSuiSend) on the first
 *      reachable RPC.
 *   2. Dry-run on the same node and assert the effects match user intent.
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

  // ── Phase 0: friendly affordability pre-check (coins + address balance) ──
  let known: bigint | null = null;
  for (const candidate of SUI_RPCS) {
    try {
      const bal = await suiRpc(candidate, "suix_getBalance", [fromAddress, "0x2::sui::SUI"]);
      known = BigInt(bal?.totalBalance ?? "0");
      break;
    } catch {}
  }
  if (known !== null && known < amountMist + SUI_GAS_BUDGET) {
    throw new Error("Insufficient SUI to cover the amount plus network gas");
  }

  // ── Phase 1: build the unsigned transfer client-side ─────────────────────
  const { rpc, txBytes, txBytesB64 } = await buildSuiSend(
    fromAddress, toAddress, amountMist, null, SUI_GAS_BUDGET,
  );

  // ── Phase 1.5: dry-run and bind the built bytes to user intent ───────────
  // The commands are authored client-side, but input/gas resolution consults
  // the node (SWAP-3 defense-in-depth): a hostile RPC could still poison the
  // resolved inputs within the signer's own authority. Dry-run returns the
  // exact effects; assert they match what the user asked for before signing.
  // Address-balance movements are reported as accumulatorEvents, NOT
  // balanceChanges, so the assert must consider both.
  const dry = await suiRpc(rpc, "sui_dryRunTransactionBlock", [txBytesB64]);
  const dryStatus = dry?.effects?.status?.status;
  if (dryStatus !== "success") {
    throw new Error(dry?.effects?.status?.error || "Sui dry-run failed; transaction was not signed.");
  }
  assertSuiBalanceChanges(
    dry?.balanceChanges ?? [],
    dry?.accumulatorEvents ?? dry?.effects?.accumulatorEvents ?? [],
    fromAddress, toAddress, amountMist,
  );

  // ── Phase 2: intent-sign (once) ──────────────────────────────────────────
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
  // Require an explicit success status. The old check skipped on a falsy/absent
  // status, so a response with a digest but no effects.status would be treated
  // as success (SWAP-M1, fail-open) — a merchant could read an unpaid transfer
  // as paid and the sender could retry into a duplicate. Treat missing
  // effects/status as unconfirmed, not success.
  const status = exec?.effects?.status?.status;
  if (status !== "success") {
    throw new Error(exec?.effects?.status?.error || "Transaction not confirmed on-chain.");
  }
  if (!exec?.digest) throw new Error("No transaction digest returned");
  return exec.digest as string;
}

// A non-SUI transfer merges/splits input coins, so it needs a little more gas
// headroom than the native path. Unused gas is refunded.
const SUI_TOKEN_GAS_BUDGET = 20_000_000n;

/**
 * Send a non-SUI coin (any coinType) and return the transaction digest. Same
 * "build client-side, verify the dry-run, sign once" flow as the native path;
 * the SDK resolves token inputs and SUI gas from coin objects and address
 * balances alike.
 *
 * @param secretKey   tweetnacl 64-byte secret key (seed || pubkey).
 * @param fromAddress Sender (0x...).
 * @param coinType    Full Sui coin type (e.g. 0x..::usdc::USDC).
 * @param toAddress   Recipient (0x...).
 * @param amount      Amount in the coin's base units.
 */
export async function sendSuiTokenTransfer(
  secretKey: Uint8Array,
  fromAddress: string,
  coinType: string,
  toAddress: string,
  amount: bigint,
): Promise<string> {
  if (amount <= 0n) throw new Error("Enter an amount greater than zero");
  // Native SUI must use paySui (gas comes from the same coin); guard against misuse.
  if (normCoinType(coinType) === normCoinType("0x2::sui::SUI")) {
    return sendSuiTransfer(secretKey, fromAddress, toAddress, amount);
  }

  // ── Phase 0: friendly affordability pre-checks (coins + address balance) ─
  for (const candidate of SUI_RPCS) {
    try {
      const tokenBal = await suiRpc(candidate, "suix_getBalance", [fromAddress, coinType]);
      if (BigInt(tokenBal?.totalBalance ?? "0") < amount) {
        throw new Error("Insufficient token balance for this transfer");
      }
      const suiBal = await suiRpc(candidate, "suix_getBalance", [fromAddress, "0x2::sui::SUI"]);
      if (BigInt(suiBal?.totalBalance ?? "0") < SUI_TOKEN_GAS_BUDGET) {
        throw new Error("You need a little SUI to pay the network gas for this transfer.");
      }
      break;
    } catch (e: any) {
      // Re-throw our own verdicts; a transport failure just tries the next RPC.
      if (e instanceof Error && /Insufficient token|network gas/.test(e.message)) throw e;
    }
  }

  // ── Phase 1: build the unsigned transfer client-side ─────────────────────
  const { rpc, txBytes, txBytesB64 } = await buildSuiSend(
    fromAddress, toAddress, amount, coinType, SUI_TOKEN_GAS_BUDGET,
  );

  // ── Phase 1.5: dry-run and bind the built bytes to user intent ───────────
  const dry = await suiRpc(rpc, "sui_dryRunTransactionBlock", [txBytesB64]);
  if (dry?.effects?.status?.status !== "success") {
    throw new Error(dry?.effects?.status?.error || "Sui dry-run failed; transaction was not signed.");
  }
  assertSuiTokenBalanceChanges(
    dry?.balanceChanges ?? [],
    dry?.accumulatorEvents ?? dry?.effects?.accumulatorEvents ?? [],
    fromAddress, toAddress, coinType, amount,
  );

  // ── Phase 2: intent-sign (once) ──────────────────────────────────────────
  const intentMessage = new Uint8Array(3 + txBytes.length);
  intentMessage.set([0, 0, 0], 0);
  intentMessage.set(txBytes, 3);
  const digest = blake2b(intentMessage, { dkLen: 32 });
  const signature = nacl.sign.detached(digest, secretKey);

  const pubkey = secretKey.slice(32);
  const serialized = new Uint8Array(1 + signature.length + pubkey.length);
  serialized[0] = 0x00;
  serialized.set(signature, 1);
  serialized.set(pubkey, 1 + signature.length);
  let bin = "";
  for (let i = 0; i < serialized.length; i++) bin += String.fromCharCode(serialized[i]);
  const sigB64 = btoa(bin);

  // ── Phase 3: execute (once, on the node that built it) ───────────────────
  const exec = await suiRpc(rpc, "sui_executeTransactionBlock", [
    txBytesB64, [sigB64], { showEffects: true }, "WaitForLocalExecution",
  ]);
  if (exec?.effects?.status?.status !== "success") {
    throw new Error(exec?.effects?.status?.error || "Transaction not confirmed on-chain.");
  }
  if (!exec?.digest) throw new Error("No transaction digest returned");
  return exec.digest as string;
}

// Canonicalize a coin type so short/long address forms compare equal
// (e.g. 0x2::sui::SUI === 0x0000…0002::sui::SUI).
function normCoinType(ct: string): string {
  const [addr, ...rest] = ct.split("::");
  const a = addr.replace(/^0x/i, "").replace(/^0+/, "") || "0";
  return a.toLowerCase() + "::" + rest.join("::");
}

// Accumulator events report ADDRESS-BALANCE movements, which never appear in
// balanceChanges. Shape (dry-run and effects alike):
//   { address, ty: "0x2::balance::Balance<coinType>", operation: "split"|"merge",
//     value: { integer } }
// split = funds leave the address's balance, merge = funds arrive.
function parseAccumulatorEvent(ev: any): { address: string; coinType: string; op: string; amount: bigint } | null {
  const address: string | undefined = ev?.address;
  const ty: string = String(ev?.ty ?? "");
  const m = ty.match(/Balance<(.+)>/);
  if (!address || !m) return null;
  let amount = 0n;
  try { amount = BigInt(ev?.value?.integer ?? ev?.value ?? 0); } catch {}
  return { address, coinType: m[1], op: String(ev?.operation ?? ""), amount };
}

/**
 * Assert the dry-run effects match a transfer of exactly `amount` of
 * `coinType` to `toAddress` and nothing else. Considers both classic
 * balanceChanges (coin objects) and accumulatorEvents (address balances).
 * Gas is spent from the sender's own SUI, which is allowed; any gain by a
 * third party, a wrong asset reaching the recipient, or a wrong amount is
 * rejected. A self-send (to === from) cannot express a "recipient gain", so
 * it instead requires that no third party gains anything.
 */
function assertSuiTokenBalanceChanges(
  changes: any[], accEvents: any[], fromAddress: string, toAddress: string, coinType: string, amount: bigint,
): void {
  const norm = (a: string) => a.toLowerCase();
  const to = norm(toAddress);
  const from = norm(fromAddress);
  const wantCoin = normCoinType(coinType);
  let recipientGain = 0n;

  for (const ch of changes) {
    const owner: string | undefined = ch?.owner?.AddressOwner;
    if (!owner) continue; // shared/object owner, not an address balance
    const o = norm(owner);
    const amt = BigInt(ch.amount);
    if (o === to && o !== from) {
      if (normCoinType(ch.coinType) !== wantCoin) {
        throw new Error("Blocked for safety: Sui transaction sends an unexpected asset to the recipient.");
      }
      recipientGain += amt;
    } else if (o !== from && amt > 0n) {
      throw new Error("Blocked for safety: Sui transaction sends funds to an unexpected address.");
    }
  }

  for (const raw of accEvents) {
    const ev = parseAccumulatorEvent(raw);
    if (!ev) continue;
    const o = norm(ev.address);
    const evCoin = normCoinType(ev.coinType);
    if (ev.op === "merge") {
      if (o === to && o !== from) {
        if (evCoin !== wantCoin) {
          throw new Error("Blocked for safety: Sui transaction sends an unexpected asset to the recipient.");
        }
        recipientGain += ev.amount;
      } else if (o !== from) {
        throw new Error("Blocked for safety: Sui transaction sends funds to an unexpected address.");
      }
    } else if (ev.op === "split" && o !== from) {
      // Only the sender's own balance may be drawn from.
      throw new Error("Blocked for safety: Sui transaction spends from an unexpected address.");
    } else if (o === from && evCoin !== wantCoin && evCoin !== normCoinType("0x2::sui::SUI")) {
      throw new Error("Blocked for safety: Sui transaction moves an unexpected asset.");
    }
  }

  if (to !== from && recipientGain !== amount) {
    throw new Error(
      `Blocked for safety: the built transfer would move ${recipientGain} to the recipient, not the ${amount} you entered.`,
    );
  }
}

/**
 * Assert the dry-run effects match a native SUI transfer of exactly
 * `amountMist` to `toAddress` and nothing else. Considers both classic
 * balanceChanges (coin objects) and accumulatorEvents (address balances).
 * Throws on any mismatch:
 *  - a non-SUI asset moving (a native transfer only touches SUI),
 *  - any unexpected third party gaining or being drawn from,
 *  - the recipient's gain differing from the intended amount.
 * A self-send (to === from) cannot express a "recipient gain", so it instead
 * requires that no third party gains anything.
 */
function assertSuiBalanceChanges(
  changes: any[],
  accEvents: any[],
  fromAddress: string,
  toAddress: string,
  amountMist: bigint,
): void {
  const norm = (a: string) => a.toLowerCase();
  const to = norm(toAddress);
  const from = norm(fromAddress);
  const nativeCoin = normCoinType("0x2::sui::SUI");
  let recipientGain = 0n;

  for (const ch of changes) {
    const owner: string | undefined = ch?.owner?.AddressOwner;
    if (!owner) continue; // shared/object owner, not an address balance
    if (normCoinType(ch.coinType) !== nativeCoin) {
      throw new Error("Blocked for safety: Sui transaction moves a non-SUI asset.");
    }
    const amount = BigInt(ch.amount);
    const o = norm(owner);
    if (o === to && o !== from) {
      recipientGain += amount;
    } else if (o !== from && amount > 0n) {
      throw new Error("Blocked for safety: Sui transaction sends funds to an unexpected address.");
    }
  }

  for (const raw of accEvents) {
    const ev = parseAccumulatorEvent(raw);
    if (!ev) continue;
    if (normCoinType(ev.coinType) !== nativeCoin) {
      throw new Error("Blocked for safety: Sui transaction moves a non-SUI asset.");
    }
    const o = norm(ev.address);
    if (ev.op === "merge") {
      if (o === to && o !== from) recipientGain += ev.amount;
      else if (o !== from) {
        throw new Error("Blocked for safety: Sui transaction sends funds to an unexpected address.");
      }
    } else if (ev.op === "split" && o !== from) {
      throw new Error("Blocked for safety: Sui transaction spends from an unexpected address.");
    }
  }

  if (to !== from && recipientGain !== amountMist) {
    throw new Error(
      `Blocked for safety: the built Sui transfer would move ${recipientGain} MIST to the recipient, not the ${amountMist} MIST you entered.`,
    );
  }
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
}> | null> {
  // null = every RPC failed (callers keep last-known); [] = authoritative
  // "no tokens" (callers must clear stale entries).
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
  return null;
}
