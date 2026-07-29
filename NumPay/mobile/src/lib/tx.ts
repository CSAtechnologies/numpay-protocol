// Native-asset transfers for ETH and SOL.
// The Solana builder is ported from the extension's chains/solana.ts:
// a raw legacy transaction (SystemProgram.transfer), no SDK required.
// base64 is implemented locally rather than relying on btoa in Hermes.
import { ethers } from "ethers";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { derivePath } from "./slip10";
import { ETH_RPC, SOL_RPC, SOL_PATH } from "./chains";

// ── helpers ───────────────────────────────────────────────────────────────────

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

function bytesToBase64(bytes: Uint8Array): string {
  let out = "";
  for (let i = 0; i < bytes.length; i += 3) {
    const a = bytes[i], b = bytes[i + 1], c = bytes[i + 2];
    out += B64[a >> 2];
    out += B64[((a & 3) << 4) | (b === undefined ? 0 : b >> 4)];
    out += b === undefined ? "=" : B64[((b & 15) << 2) | (c === undefined ? 0 : c >> 6)];
    out += c === undefined ? "=" : B64[c & 63];
  }
  return out;
}

function encodeCompactU16(n: number): Uint8Array {
  if (n <= 0x7f) return new Uint8Array([n]);
  if (n <= 0x3fff) return new Uint8Array([(n & 0x7f) | 0x80, n >> 7]);
  return new Uint8Array([(n & 0x7f) | 0x80, ((n >> 7) & 0x7f) | 0x80, n >> 14]);
}

function concatBytes(...arrs: Uint8Array[]): Uint8Array {
  const total = arrs.reduce((s, a) => s + a.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const a of arrs) { out.set(a, off); off += a.length; }
  return out;
}

function u64le(n: bigint): Uint8Array {
  const buf = new Uint8Array(8);
  for (let i = 0; i < 8; i++) { buf[i] = Number(n & 0xffn); n >>= 8n; }
  return buf;
}

async function rpc<T>(url: string, method: string, params: unknown[]): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = await res.json();
  if (json.error) throw new Error(json.error.message ?? "RPC error");
  return json.result as T;
}

// ── validation ────────────────────────────────────────────────────────────────

export function validateEthAddress(addr: string): string | null {
  try { return ethers.getAddress(addr.trim()); } catch { return null; }
}

export function validateSolAddress(addr: string): string | null {
  try {
    const bytes = bs58.decode(addr.trim());
    return bytes.length === 32 ? addr.trim() : null;
  } catch { return null; }
}

// ── Solana ────────────────────────────────────────────────────────────────────

export function deriveSolSecretKey(mnemonic: string): Uint8Array {
  const seed = ethers.getBytes(ethers.Mnemonic.fromPhrase(mnemonic).computeSeed());
  const { key } = derivePath(SOL_PATH, seed);
  return nacl.sign.keyPair.fromSeed(key).secretKey;
}

// Message serialization for a legacy SystemProgram.transfer, ported verbatim
// from the extension (proven in production there). Signs and broadcasts;
// returns the base58 transaction signature.
export async function sendSolTransfer(
  secretKey: Uint8Array,
  toAddress: string,
  lamports: bigint,
): Promise<string> {
  const bh = await rpc<{ value: { blockhash: string } }>(
    SOL_RPC, "getLatestBlockhash", [{ commitment: "finalized" }],
  );

  // In tweetnacl, secretKey = [32-byte seed | 32-byte pubkey]
  const fromPubkey = secretKey.slice(32);
  const toPubkey = bs58.decode(toAddress);
  const sysProgram = new Uint8Array(32); // 11111...1 = all zeros
  const blockhashBytes = bs58.decode(bh.value.blockhash);

  // SystemProgram.transfer: discriminant 2 (u32 LE) + lamports (u64 LE)
  const instrData = concatBytes(new Uint8Array([2, 0, 0, 0]), u64le(lamports));

  const message = concatBytes(
    new Uint8Array([1, 0, 1]),           // header: 1 sig, 0 ro-signed, 1 ro-unsigned
    encodeCompactU16(3),                 // 3 account keys
    fromPubkey, toPubkey, sysProgram,
    blockhashBytes,
    encodeCompactU16(1),                 // 1 instruction
    new Uint8Array([2]),                 // program_id_index = 2 (system program)
    encodeCompactU16(2),                 // 2 accounts used
    new Uint8Array([0, 1]),              // from = 0, to = 1
    encodeCompactU16(instrData.length),
    instrData,
  );

  const sig = nacl.sign.detached(message, secretKey);
  const tx = concatBytes(encodeCompactU16(1), sig, message);

  return rpc<string>(SOL_RPC, "sendTransaction", [
    bytesToBase64(tx),
    { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
  ]);
}

// Exported for the offline test harness (signature + serialization checks).
export function buildSolTransferMessage(
  fromPubkey: Uint8Array, toPubkey: Uint8Array, blockhashBytes: Uint8Array, lamports: bigint,
): Uint8Array {
  const instrData = concatBytes(new Uint8Array([2, 0, 0, 0]), u64le(lamports));
  return concatBytes(
    new Uint8Array([1, 0, 1]),
    encodeCompactU16(3),
    fromPubkey, toPubkey, new Uint8Array(32),
    blockhashBytes,
    encodeCompactU16(1),
    new Uint8Array([2]),
    encodeCompactU16(2),
    new Uint8Array([0, 1]),
    encodeCompactU16(instrData.length),
    instrData,
  );
}

export { bytesToBase64 };

// ── Ethereum ──────────────────────────────────────────────────────────────────

let _ethProvider: ethers.JsonRpcProvider | null = null;
function ethProvider(): ethers.JsonRpcProvider {
  if (!_ethProvider) _ethProvider = new ethers.JsonRpcProvider(ETH_RPC);
  return _ethProvider;
}

// Rough max fee for a simple transfer, in ETH, for the review screen.
export async function estimateEthFee(): Promise<string> {
  const fee = await ethProvider().getFeeData();
  const perGas = fee.maxFeePerGas ?? fee.gasPrice ?? 0n;
  return ethers.formatEther(perGas * 21000n);
}

export async function sendEthTransfer(
  privateKey: string,
  toAddress: string,
  amountEth: string,
): Promise<string> {
  const wallet = new ethers.Wallet(privateKey, ethProvider());
  const tx = await wallet.sendTransaction({
    to: toAddress,
    value: ethers.parseEther(amountEth),
  });
  return tx.hash;
}
