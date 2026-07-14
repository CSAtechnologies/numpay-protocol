/**
 * Solana support — Ed25519 address derivation, balance fetching, and transfer.
 * Uses SLIP-0010 HD derivation (Ed25519) with BIP44 path m/44'/501'/0'/0'.
 */
import { derivePath } from "./slip10";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { ethers } from "ethers";
import { sha256 } from "@noble/hashes/sha256";
import { ed25519 } from "@noble/curves/ed25519";
import { ALCHEMY_KEY, MORALIS_KEY, HELIUS_KEY } from "../env";

// Solana BIP44 derivation path
const SOL_DERIVATION_PATH = "m/44'/501'/0'/0'";

// Prefer Helius for Solana balances + token reads when its key is set; fall back
// to Alchemy's Solana endpoint, then to the keyless public RPC when no key is
// injected at all (mobile ships proxy-only with no bundled provider keys; the
// public endpoint is rate-limited per IP, fine for per-user reads). Single
// canonical endpoint for every Solana JSON-RPC call below.
export const SOL_RPC = HELIUS_KEY
  ? `https://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
  : ALCHEMY_KEY
    ? `https://solana-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`
    : "https://api.mainnet-beta.solana.com";

/**
 * Derive a Solana address from a BIP39 mnemonic.
 */
export async function deriveSolanaAddress(mnemonic: string): Promise<{
  address: string;
  publicKey: string;
  secretKey: Uint8Array;
}> {
  // Mnemonic → 64-byte seed
  const seed = ethers.Mnemonic.fromPhrase(mnemonic).computeSeed();
  const seedHex = seed.slice(2); // remove 0x prefix

  // SLIP-0010 derivation for Ed25519
  const derived = await derivePath(SOL_DERIVATION_PATH, seedHex);

  // Generate Ed25519 keypair from the 32-byte derived seed
  const keypair = nacl.sign.keyPair.fromSeed(derived.key);

  // Solana address = base58 of 32-byte public key
  const address = bs58.encode(keypair.publicKey);

  return {
    address,
    publicKey: address,
    secretKey: keypair.secretKey,
  };
}

// ---------- transaction helpers ----------

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

function bytesToB64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

/**
 * Send SOL (native transfer) using raw JSON-RPC, no SDK required.
 * Returns the transaction signature (base58).
 */
export async function sendSolanaTransfer(
  secretKey: Uint8Array,
  toAddress: string,
  lamports: bigint,
): Promise<string> {
  const bhResp = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "getLatestBlockhash",
      params: [{ commitment: "finalized" }],
    }),
  });
  const bhData = await bhResp.json();
  if (bhData.error) throw new Error(bhData.error.message);

  // In tweetnacl, secretKey = [32-byte seed | 32-byte pubkey]
  const fromPubkey = secretKey.slice(32);
  const toPubkey   = bs58.decode(toAddress);
  // A Solana account key is exactly 32 bytes. The recipient is spliced into the
  // message at a fixed 32-byte offset, so a non-32-byte decode would silently
  // corrupt the serialized message (DERIVATION-3). Reject before signing.
  if (toPubkey.length !== 32) {
    throw new Error("Invalid Solana recipient address (must decode to 32 bytes).");
  }
  const sysProgram = new Uint8Array(32); // 11111…1 = all zeros

  const blockhashBytes = bs58.decode(bhData.result.value.blockhash);

  // SystemProgram.transfer: discriminant 2 (u32 LE) + lamports (u64 LE)
  const instrData = concatBytes(new Uint8Array([2, 0, 0, 0]), u64le(lamports));

  const message = concatBytes(
    new Uint8Array([1, 0, 1]),           // header: 1 sig, 0 readonly-signed, 1 readonly-unsigned
    encodeCompactU16(3),                 // 3 account keys
    fromPubkey, toPubkey, sysProgram,
    blockhashBytes,
    encodeCompactU16(1),                 // 1 instruction
    new Uint8Array([2]),                 // program_id_index = 2 (sysProgram)
    encodeCompactU16(2),                 // 2 accounts used
    new Uint8Array([0, 1]),              // from=0, to=1
    encodeCompactU16(instrData.length),
    instrData,
  );

  const sig = nacl.sign.detached(message, secretKey);
  const tx  = concatBytes(encodeCompactU16(1), sig, message);

  let binary = "";
  for (let i = 0; i < tx.length; i++) binary += String.fromCharCode(tx[i]);
  const txB64 = btoa(binary);

  const sendResp = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "sendTransaction",
      params: [txB64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" }],
    }),
  });
  const sendData = await sendResp.json();
  if (sendData.error) throw new Error(sendData.error.message ?? JSON.stringify(sendData.error));
  return sendData.result as string;
}

// ── SPL / Token-2022 transfer ────────────────────────────────────────────────

const TOKEN_PROGRAM       = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const TOKEN_2022_PROGRAM  = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";
const ATA_PROGRAM         = "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL";
const ATA_PROGRAM_BYTES   = bs58.decode(ATA_PROGRAM);
const PDA_MARKER          = new TextEncoder().encode("ProgramDerivedAddress");

function toHexStr(b: Uint8Array): string {
  return Array.from(b).map((x) => x.toString(16).padStart(2, "0")).join("");
}

// A 32-byte value is "on curve" when it decodes to a valid Ed25519 point. A
// Program Derived Address must be OFF the curve, so ATA derivation walks the
// bump down from 255 until the hash is off-curve (the same canonical algorithm
// web3.js's PublicKey.findProgramAddress uses).
function isOnCurve(point: Uint8Array): boolean {
  try { ed25519.ExtendedPoint.fromHex(toHexStr(point)); return true; } catch { return false; }
}

// Canonical associated-token-account address for (owner, mint, tokenProgram).
function findAssociatedTokenAccount(
  owner: Uint8Array, mint: Uint8Array, tokenProgram: Uint8Array,
): Uint8Array {
  for (let bump = 255; bump >= 0; bump--) {
    const h = sha256(
      concatBytes(owner, tokenProgram, mint, new Uint8Array([bump]), ATA_PROGRAM_BYTES, PDA_MARKER),
    );
    if (!isOnCurve(h)) return h;
  }
  throw new Error("Unable to derive the associated token account.");
}

// Minimal Solana JSON-RPC call; throws on RPC-level errors.
async function solRpc(method: string, params: any[]): Promise<any> {
  const r = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const d = await r.json();
  if (d.error) throw new Error(d.error.message ?? JSON.stringify(d.error));
  return d.result;
}

/**
 * Send an SPL or Token-2022 token. Solana has no server-side transaction
 * builder, so the transfer is assembled and signed client-side:
 *   1. Read the mint's owner program to pick SPL vs Token-2022.
 *   2. Find the sender's source token account for the mint.
 *   3. Derive the recipient's associated token account (created idempotently in
 *      the same transaction if it does not exist yet — the sender pays its rent).
 *   4. transferChecked (carries decimals, so a wrong-decimals mint reverts).
 * Preflight simulation (skipPreflight:false) catches a bad build before it lands.
 *
 * @param secretKey  tweetnacl 64-byte secret key (seed || pubkey) of the sender.
 * @param mintAddress Mint of the token to send (base58).
 * @param toAddress   Recipient WALLET address (base58) — not a token account.
 * @param amount      Amount in the token's base units.
 * @param decimals    Token decimals (asserted on-chain by transferChecked).
 */
export async function sendSolanaTokenTransfer(
  secretKey: Uint8Array,
  mintAddress: string,
  toAddress: string,
  amount: bigint,
  decimals: number,
): Promise<string> {
  if (amount <= 0n) throw new Error("Enter an amount greater than zero");

  const fromPubkey = secretKey.slice(32);
  const mint    = bs58.decode(mintAddress);
  const toOwner = bs58.decode(toAddress);
  // Account keys are spliced into the message at fixed 32-byte offsets, so a
  // non-32-byte decode would silently corrupt the serialized message.
  if (mint.length !== 32)    throw new Error("Invalid token mint address.");
  if (toOwner.length !== 32) throw new Error("Invalid Solana recipient address (must decode to 32 bytes).");

  // 1. Token program comes from the mint account's owner.
  const mintInfo = await solRpc("getAccountInfo", [mintAddress, { encoding: "base64" }]);
  const ownerProgram = mintInfo?.value?.owner as string | undefined;
  if (ownerProgram !== TOKEN_PROGRAM && ownerProgram !== TOKEN_2022_PROGRAM) {
    throw new Error("Unsupported token: this mint is not owned by a known SPL token program.");
  }
  const tokenProgram = bs58.decode(ownerProgram);

  // 2. Source = the sender's token account for this mint with enough balance.
  const owned = await solRpc("getTokenAccountsByOwner", [
    bs58.encode(fromPubkey), { mint: mintAddress }, { encoding: "jsonParsed" },
  ]);
  let source: Uint8Array | null = null;
  for (const acc of (owned?.value ?? [])) {
    const raw = BigInt(acc.account?.data?.parsed?.info?.tokenAmount?.amount ?? "0");
    if (raw >= amount) { source = bs58.decode(acc.pubkey); break; }
  }
  if (!source) throw new Error("Your token account does not hold enough of this token to cover the transfer.");

  // 3. Recipient ATA (canonical, deterministic).
  const recipientAta = findAssociatedTokenAccount(toOwner, mint, tokenProgram);
  const sysProgram = new Uint8Array(32); // System program = all-zero key

  // Account keys, ordered: writable-signer, writable non-signers, readonly
  // non-signers. Header below declares 1 signer and 5 readonly-unsigned.
  const keys = [
    fromPubkey,      // 0 writable signer (fee payer + ATA rent)
    source,          // 1 writable
    recipientAta,    // 2 writable
    toOwner,         // 3 readonly
    mint,            // 4 readonly
    sysProgram,      // 5 readonly
    tokenProgram,    // 6 readonly (transferChecked program id)
    ATA_PROGRAM_BYTES, // 7 readonly (create program id)
  ];
  const header = new Uint8Array([1, 0, 5]);

  // CreateIdempotent (ATA program, data [1]): funding, ata, owner, mint, system, tokenProgram
  const createIx = concatBytes(
    new Uint8Array([7]),
    encodeCompactU16(6), new Uint8Array([0, 2, 3, 4, 5, 6]),
    encodeCompactU16(1), new Uint8Array([1]),
  );
  // transferChecked (token program, data [12, amount u64, decimals u8]): source, mint, dest, owner
  const transferData = concatBytes(new Uint8Array([12]), u64le(amount), new Uint8Array([decimals & 0xff]));
  const transferIx = concatBytes(
    new Uint8Array([6]),
    encodeCompactU16(4), new Uint8Array([1, 4, 2, 0]),
    encodeCompactU16(transferData.length), transferData,
  );

  const bh = await solRpc("getLatestBlockhash", [{ commitment: "finalized" }]);
  const blockhashBytes = bs58.decode(bh.value.blockhash);

  const message = concatBytes(
    header,
    encodeCompactU16(keys.length), ...keys,
    blockhashBytes,
    encodeCompactU16(2), createIx, transferIx,
  );

  const sig = nacl.sign.detached(message, secretKey);
  const txB64 = bytesToB64(concatBytes(encodeCompactU16(1), sig, message));

  const result = await solRpc("sendTransaction", [
    txB64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
  ]);
  return result as string;
}

// ── Unwrap wrapped SOL → native SOL ──────────────────────────────────────────
// A wrapped-SOL (wSOL) token account is just a normal SPL account whose lamport
// balance IS the wrapped SOL (plus the ~0.00204 SOL rent-exempt reserve).
// "Unwrapping" is the SPL CloseAccount instruction: it moves ALL of the
// account's lamports to a destination and deletes the account, so the wrapped
// balance and the rent both return to the owner's native SOL. There is no
// partial unwrap. We close every wSOL account the owner holds (normally just
// the ATA) in one transaction, with the owner as both authority and destination.
export interface UnwrapWsolResult {
  signature: string;
  /** Total lamports returned to native SOL (wrapped balance + reclaimed rent). */
  lamports: bigint;
  /** How many wSOL accounts were closed. */
  accounts: number;
}

export async function unwrapWsol(secretKey: Uint8Array): Promise<UnwrapWsolResult> {
  const fromPubkey = secretKey.slice(32);
  const owner = bs58.encode(fromPubkey);

  const owned = await solRpc("getTokenAccountsByOwner", [
    owner, { mint: WSOL_MINT }, { encoding: "jsonParsed" },
  ]);
  const list = (owned?.value ?? []) as any[];
  if (list.length === 0) throw new Error("No wrapped SOL to unwrap.");

  // wSOL is a classic SPL-Token mint, but read the program from the account
  // itself so a Token-2022 wSOL-style account would still close correctly.
  const programId = list[0].account?.owner as string | undefined;
  if (programId !== TOKEN_PROGRAM && programId !== TOKEN_2022_PROGRAM) {
    throw new Error("Unexpected token program for wrapped SOL.");
  }
  const tokenProgram = bs58.decode(programId);

  let lamports = 0n;
  const accountKeys: Uint8Array[] = [];
  for (const acc of list) {
    lamports += BigInt(acc.account?.lamports ?? 0);
    const pk = bs58.decode(acc.pubkey);
    if (pk.length !== 32) throw new Error("Invalid wrapped-SOL account address.");
    accountKeys.push(pk);
  }

  // Keys, in the required order: writable-signer, writable non-signers, then
  // readonly non-signers. Index 0 (owner) is the fee payer, the CloseAccount
  // authority AND the lamport destination; the wSOL accounts are writable; the
  // token program is the only readonly-unsigned key.
  const keys = [fromPubkey, ...accountKeys, tokenProgram];
  const header = new Uint8Array([1, 0, 1]); // 1 signer, 0 readonly-signed, 1 readonly-unsigned
  const tokenProgramIdx = keys.length - 1;

  // CloseAccount (token program, data [9]): [account, destination, owner].
  // destination + authority are both index 0 (the owner's native account).
  const ixs = accountKeys.map((_, i) => concatBytes(
    new Uint8Array([tokenProgramIdx]),
    encodeCompactU16(3), new Uint8Array([1 + i, 0, 0]),
    encodeCompactU16(1), new Uint8Array([9]),
  ));

  const bh = await solRpc("getLatestBlockhash", [{ commitment: "finalized" }]);
  const blockhashBytes = bs58.decode(bh.value.blockhash);

  const message = concatBytes(
    header,
    encodeCompactU16(keys.length), ...keys,
    blockhashBytes,
    encodeCompactU16(ixs.length), ...ixs,
  );

  const sig = nacl.sign.detached(message, secretKey);
  const txB64 = bytesToB64(concatBytes(encodeCompactU16(1), sig, message));

  const signature = await solRpc("sendTransaction", [
    txB64, { encoding: "base64", skipPreflight: false, preflightCommitment: "confirmed" },
  ]) as string;
  return { signature, lamports, accounts: accountKeys.length };
}

// ── Jupiter swap (Solana DEX aggregator) ─────────────────────────────────────

const JUP_SWAP = "https://lite-api.jup.ag/swap/v1";
// Wrapped SOL mint — Jupiter's stand-in for native SOL on both sides of a swap.
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

// ── Jupiter platform fee (revenue) ───────────────────────────────────────────
// Unlike the EVM aggregators, a Solana fee can ONLY be collected into a real SPL
// token account (ATA) owned by a SOLANA wallet — an EVM fee address cannot hold
// SPL tokens — and that ATA must already exist on-chain (Jupiter's /swap will not
// create it). The fee is taken in one token, so a swap earns only when its input
// or output mint is configured below. `platformFeeBps` rides on /quote and the
// matching `feeAccount` on /swap. Disabled until at least one ATA is filled in.
const USDC_MINT = "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";
const USDT_MINT = "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB";
const JUP_FEE_BPS = "50"; // 0.5%
// SPL mint → that token's ATA under your Solana fee wallet (must exist on-chain).
const JUP_FEE_ATAS: Record<string, string> = {
  [USDC_MINT]: "5Hkjinap4PzeM5fp6VKMxm7BoZ2RU9N7yAkX1e3tvHR", // fee wallet 3tgG96wN… USDC
  [USDT_MINT]: "ZfVanBfkpvsK4iQJiGoMsu7KbmYdL3yu2ycuaLMx8kw", // fee wallet 3tgG96wN… USDT
  [WSOL_MINT]: "", // <- your fee wallet's wrapped-SOL token account (not created yet)
};
const jupFeeActive = () => Object.values(JUP_FEE_ATAS).some(Boolean);
// ExactIn lets the fee sit on either side; prefer the output mint, then the input.
function jupiterFeeAccountFor(inputMint?: string, outputMint?: string): string | null {
  if (!jupFeeActive()) return null;
  const a = (outputMint && JUP_FEE_ATAS[outputMint]) || (inputMint && JUP_FEE_ATAS[inputMint]);
  return a || null;
}

// A small curated set of popular Solana tokens for the swap "buy" side, so users
// can swap into them even when they hold none yet. Held tokens are added separately.
export const SOLANA_SWAP_TOKENS = [
  { symbol: "USDC", name: "USD Coin",   address: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v", decimals: 6 },
  { symbol: "USDT", name: "Tether USD", address: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB", decimals: 6 },
  { symbol: "BONK", name: "Bonk",       address: "DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263", decimals: 5 },
  { symbol: "JUP",  name: "Jupiter",    address: "JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN", decimals: 6 },
  { symbol: "WIF",  name: "dogwifhat",  address: "EKpQGSJtjMFqKZ9KQanSqYXRcF8fBopzLHYxdM65zcjm", decimals: 6 },
  { symbol: "JTO",  name: "Jito",       address: "jtojtomepa8beP8AuQc6eXt5FriJwfFMwQx2v2f9mCL", decimals: 9 },
  // Popular SPL tokens (mints + decimals verified on-chain via Solana RPC).
  { symbol: "RAY",     name: "Raydium",        address: "4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R", decimals: 6 },
  { symbol: "PYTH",    name: "Pyth Network",   address: "HZ1JovNiVvGrGNiiYvEozEVgZ58xaU3RKwX8eACQBCt3", decimals: 6 },
  { symbol: "JLP",     name: "Jupiter LP",     address: "27G8MtK7VtTcCHkpASjSDdkWWYfoqT6ggEuKidVJidD4", decimals: 6 },
  { symbol: "W",       name: "Wormhole",       address: "85VBFQZC9TZkfaptBWjvUw7YbZjy52A6mjtPGjstQAmQ", decimals: 6 },
  { symbol: "PENGU",   name: "Pudgy Penguins", address: "2zMMhcVQEXDtdE6vsFS7S7D5oUodfJHE8vd1gnBouauv", decimals: 6 },
  { symbol: "POPCAT",  name: "Popcat",         address: "7GCihgDB8fe6KNjn2MYtkzZcRjQy3t9GHdC8uHYmW2hr", decimals: 9 },
  { symbol: "MEW",     name: "cat in a dogs world", address: "MEW1gQWJ3nEXg2qgERiKu7FAFj79PHvQVREQUzScPP5", decimals: 5 },
  { symbol: "RENDER",  name: "Render",         address: "rndrizKT3MK1iimdxRdWabcF7Zg7AR5T4nud4EkHBof", decimals: 8 },
  { symbol: "HNT",     name: "Helium",         address: "hntyVP6YFm1Hg25TN9WGLqM12b8TQmcknKrdu1oxWux", decimals: 8 },
  { symbol: "ORCA",    name: "Orca",           address: "orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE", decimals: 6 },
  { symbol: "JitoSOL", name: "Jito Staked SOL",address: "J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn", decimals: 9 },
  { symbol: "mSOL",    name: "Marinade SOL",   address: "mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So", decimals: 9 },
] as const;

export interface JupiterQuote {
  outAmount: string;        // raw, in the output token's smallest unit
  priceImpactPct: string;
  raw: any;                 // full quote response, passed straight back to /swap
}

/** Resolve a single Solana token's metadata by mint (for swap import). */
export async function resolveSolanaToken(mint: string): Promise<{
  symbol: string; name: string; address: string; decimals: number; logo?: string;
} | null> {
  try {
    const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${mint}`);
    if (!r.ok) return null;
    const arr = await r.json();
    const d = Array.isArray(arr) ? arr.find((x: any) => x.id === mint) : null;
    if (!d) return null;
    return {
      symbol:   d.symbol?.trim() || mint.slice(0, 6),
      name:     d.name?.trim() || d.symbol?.trim() || mint.slice(0, 6),
      address:  mint,
      decimals: Number(d.decimals ?? 0),
      logo:     d.icon ? toHttpsUrl(String(d.icon)) : undefined,
    };
  } catch { return null; }
}

/** Get a Jupiter swap quote. `amountRaw` is in the input token's smallest unit. */
export async function fetchJupiterQuote(
  inputMint: string, outputMint: string, amountRaw: string, slippageBps: number,
): Promise<JupiterQuote | null> {
  try {
    let url = `${JUP_SWAP}/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
      `&amount=${amountRaw}&slippageBps=${slippageBps}`;
    // Bake the platform fee into the quote so the shown receive amount is post-fee.
    // executeJupiterSwap re-derives the same feeAccount from the quote's mints, so
    // the two stay consistent without threading extra state through the UI.
    if (jupiterFeeAccountFor(inputMint, outputMint)) url += `&platformFeeBps=${JUP_FEE_BPS}`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const d = await r.json();
    if (!d || d.error || !d.outAmount) return null;
    return { outAmount: String(d.outAmount), priceImpactPct: String(d.priceImpactPct ?? "0"), raw: d };
  } catch { return null; }
}

/**
 * Turn a simulateTransaction failure into an actionable message. The raw err
 * object ("InstructionError: Custom 6001") means nothing to a user; the common
 * cases are missing SOL for fee/rent and a stale quote past slippage.
 */
function decodeSimulationFailure(err: any, logs: string[]): string {
  const haystack = logs.join("\n") + " " + JSON.stringify(err);
  if (/insufficient lamports|InsufficientFundsForRent|InsufficientFundsForFee|insufficient funds for rent/i.test(haystack)) {
    return "Not enough SOL to pay the network fee and token-account rent. Keep at least ~0.01 SOL in your wallet and try again.";
  }
  // Jupiter 6024 (0x1788) InsufficientFunds — swap amount, fee, or rent.
  if (/0x1788|InsufficientFunds/i.test(haystack)) {
    return "Insufficient funds: the amount plus network fees exceeds what this wallet holds. " +
      "Lower the amount slightly, and make sure you keep ~0.01 SOL for fees and token-account rent.";
  }
  if (/SlippageToleranceExceeded|0x1771|RequireGteViolated/i.test(haystack)) {
    return "The price moved beyond your slippage tolerance before sending. Re-enter the amount for a fresh quote, or raise slippage slightly.";
  }
  if (/BlockhashNotFound/i.test(haystack)) {
    return "The quote expired before sending. Re-enter the amount to get a fresh quote and try again.";
  }
  const lastErrLog = [...logs].reverse().find((l) => /error|failed/i.test(l));
  return "Swap simulation failed — the transaction would fail, so it was not sent." +
    (lastErrLog ? ` (${lastErrLog.trim()})` : "");
}

/** Decode a Solana compact-u16 (shortvec) length prefix. */
function decodeCompactU16(bytes: Uint8Array, offset: number): { value: number; length: number } {
  let value = 0, shift = 0, i = offset;
  for (;;) {
    const b = bytes[i++];
    value |= (b & 0x7f) << shift;
    if ((b & 0x80) === 0) break;
    shift += 7;
  }
  return { value, length: i - offset };
}

// Well-known Solana program IDs that a legitimate Jupiter swap routes through.
// Used to label the preview; an id outside this set is shown as "unknown".
const KNOWN_SOLANA_PROGRAMS: Record<string, string> = {
  "11111111111111111111111111111111": "System",
  "ComputeBudget111111111111111111111111111111": "Compute Budget",
  "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA": "SPL Token",
  "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb": "Token-2022",
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL": "Associated Token",
  "AddressLookupTab1e1111111111111111111111111": "Address Lookup Table",
  "MemoSq4gq7tT4WcYr2DLRUFf6N8e6m8e6m8e6m8e6m8": "Memo",
  "JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4": "Jupiter Aggregator v6",
  "JUP4Fb2cqiRUcaaoMpEbVUorfNwd4mZyaeUw8r3o4nA": "Jupiter Aggregator v4",
};

/**
 * Decode a (legacy or v0) Solana transaction message enough to bind it to user
 * intent and build a human-readable preview. Returns the fee payer (first
 * account key), the set of program IDs invoked from the static account list,
 * and whether the message uses address lookup tables (whose entries cannot be
 * resolved offline).
 */
export function decodeSolanaMessage(message: Uint8Array): {
  feePayer: string;
  programs: Array<{ id: string; name: string | null }>;
  usesLookupTables: boolean;
  instructionCount: number;
} {
  let off = 0;
  // v0 messages are prefixed with 0x80 | version; legacy messages start with
  // the (small) numRequiredSignatures byte and have no prefix.
  if (message[0] & 0x80) off += 1;

  off += 3; // header: numRequiredSignatures, numReadonlySigned, numReadonlyUnsigned

  const keyCount = decodeCompactU16(message, off);
  off += keyCount.length;
  const keys: Uint8Array[] = [];
  // Bound the loop by the bytes actually present: a hostile/malformed message
  // can encode an enormous key count (up to ~2M in 3 varint bytes), which would
  // otherwise allocate millions of slices and OOM the approval window. Each key
  // is exactly 32 bytes, so we can never read more than the buffer holds.
  for (let i = 0; i < keyCount.value && off + 32 <= message.length; i++) {
    keys.push(message.slice(off, off + 32));
    off += 32;
  }

  off += 32; // recent blockhash

  const ixCount = decodeCompactU16(message, off);
  off += ixCount.length;
  const programIdxs = new Set<number>();
  // Likewise bound by remaining bytes; each instruction consumes at least one
  // byte, so we stop as soon as we run off the end of the message. Count the
  // instructions we actually parsed rather than the declared count, which a
  // malformed message can inflate.
  let parsedIxCount = 0;
  for (let i = 0; i < ixCount.value && off < message.length; i++) {
    const programIdIndex = message[off];
    off += 1;
    programIdxs.add(programIdIndex);
    const accs = decodeCompactU16(message, off);
    off += accs.length + accs.value;
    const dataLen = decodeCompactU16(message, off);
    off += dataLen.length + dataLen.value;
    parsedIxCount++;
  }

  let usesLookupTables = false;
  if (off < message.length) {
    const lutCount = decodeCompactU16(message, off);
    usesLookupTables = lutCount.value > 0;
  }

  const programs = Array.from(programIdxs)
    .filter((idx) => idx < keys.length) // ALT-resolved program ids can't be decoded offline
    .map((idx) => {
      const id = bs58.encode(keys[idx]);
      return { id, name: KNOWN_SOLANA_PROGRAMS[id] ?? null };
    });

  return {
    feePayer: keys.length ? bs58.encode(keys[0]) : "",
    programs,
    usesLookupTables,
    instructionCount: parsedIxCount,
  };
}

// ── dApp signTransaction / signAndSendTransaction (P3) ────────────────────────

export interface SolTxInspection {
  feePayer: string;
  programs: Array<{ id: string; name: string | null }>;
  usesLookupTables: boolean;
  instructionCount: number;
  numSigs: number; // required signers (sig slots) the serialized tx carries
}

/**
 * Inspect a serialized Solana transaction (legacy or v0) for the approval
 * preview. Runs entirely offline and must NOT throw on hostile bytes — a dApp
 * controls this input and a throw would white-screen the approval window. On
 * malformed input it returns a best-effort/empty inspection; the fee-payer bind
 * in signSolanaTransaction is the real safety gate before any key is used.
 */
export function inspectSolanaTransaction(txBytes: Uint8Array): SolTxInspection {
  try {
    const { value: numSigs, length: lenBytes } = decodeCompactU16(txBytes, 0);
    const message = txBytes.slice(lenBytes + numSigs * 64);
    const decoded = decodeSolanaMessage(message);
    return { ...decoded, numSigs };
  } catch {
    return { feePayer: "", programs: [], usesLookupTables: false, instructionCount: 0, numSigs: 0 };
  }
}

/**
 * Simulate a serialized (base64) transaction against current chain state. Used
 * both for the approval preview (sigVerify off, the tx may be unsigned yet) and
 * as the pre-broadcast guard in signSolanaTransaction (sigVerify on). Never
 * throws: returns ok=false with a human-readable reason on any failure.
 */
export async function simulateSolanaTx(
  signedB64: string,
  sigVerify: boolean,
): Promise<{ ok: boolean; err?: string; logs: string[] }> {
  try {
    const resp = await fetch(SOL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "simulateTransaction",
        params: [signedB64, { encoding: "base64", sigVerify, commitment: "confirmed" }],
      }),
    });
    const data = await resp.json();
    if (data.error) return { ok: false, err: data.error.message ?? "Simulation failed", logs: [] };
    const v = data.result?.value;
    if (v?.err) {
      // Transaction-neutral copy (this path serves arbitrary dApp transactions,
      // not just swaps, so it must not say "swap"/"quote"/"amount").
      const logs: string[] = v.logs ?? [];
      const hay = logs.join("\n") + " " + JSON.stringify(v.err);
      let err: string;
      if (/insufficient|InsufficientFunds|0x1788|rent/i.test(hay)) {
        err = "Insufficient SOL to cover this transaction and the network fee.";
      } else if (/BlockhashNotFound/i.test(hay)) {
        err = "The transaction's blockhash has expired. The site needs to rebuild it.";
      } else {
        const last = [...logs].reverse().find((l) => /error|failed/i.test(l));
        err = "Simulation says this transaction would fail, so it was not sent." +
          (last ? ` (${last.trim()})` : "");
      }
      return { ok: false, err, logs };
    }
    return { ok: true, logs: v?.logs ?? [] };
  } catch {
    return { ok: false, err: "Could not reach the Solana network to simulate this transaction.", logs: [] };
  }
}

/** Broadcast a signed (base64) transaction. Returns the base58 signature. */
export async function broadcastSolanaTx(signedB64: string): Promise<string> {
  const resp = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "sendTransaction",
      // We simulate locally before calling this, so node preflight can be skipped.
      params: [signedB64, { encoding: "base64", skipPreflight: true, maxRetries: 3, preflightCommitment: "confirmed" }],
    }),
  });
  const data = await resp.json();
  if (data.error) throw new Error(data.error.message ?? JSON.stringify(data.error));
  return data.result as string;
}

/**
 * Sign the user's slot of a serialized Solana transaction and, when `send`,
 * simulate + broadcast it. Same SDK-free approach as the Jupiter swap path:
 * the user is the fee payer (first account key = first signature slot), so we
 * sign the message bytes and write the signature into slot 0.
 *
 * Binds the transaction to the user BEFORE signing (the fee payer must be the
 * connected account); a tampered or unexpected payer is refused rather than
 * blind-signed. Address-lookup-table entries can't be resolved offline, so
 * deeper instruction binding is left to the local simulation.
 *
 * For signTransaction (send=false) a multi-signer transaction is signed only in
 * the user's slot and returned for the dApp to complete (legitimate partial
 * signing). For signAndSendTransaction (send=true) we must be the sole signer,
 * since we cannot supply the others.
 */
export async function signSolanaTransaction(
  secretKey: Uint8Array,
  userPublicKey: string,
  txBytes: Uint8Array,
  send: boolean,
): Promise<{ signedB64: string; signature?: string; userSignature: string }> {
  const { value: numSigs, length: lenBytes } = decodeCompactU16(txBytes, 0);
  const sigStart = lenBytes;
  const message = txBytes.slice(sigStart + numSigs * 64);

  const decoded = decodeSolanaMessage(message);
  if (!decoded.feePayer || decoded.feePayer !== userPublicKey) {
    throw new Error(
      "Blocked for safety: the transaction's fee payer is not your wallet. Aborted before signing.",
    );
  }
  if (send && numSigs !== 1) {
    throw new Error(
      "This transaction needs additional signers, so NumPay cannot send it. The site must collect the other signatures.",
    );
  }

  const sig = nacl.sign.detached(message, secretKey);
  const signed = txBytes.slice(); // copy; never mutate the caller's bytes
  signed.set(sig, sigStart);      // user = fee payer = first signature slot
  const signedB64 = bytesToB64(signed);
  // The fee payer's signature doubles as the transaction id, and WalletConnect's
  // solana_signTransaction result wants it base58 even without a broadcast.
  const userSignature = bs58.encode(sig);

  if (!send) return { signedB64, userSignature };

  // Pre-broadcast simulation guard (same as swaps): never send a transaction we
  // have not checked against current state.
  const sim = await simulateSolanaTx(signedB64, true);
  if (!sim.ok) throw new Error(sim.err ?? "Transaction simulation failed");

  const signature = await broadcastSolanaTx(signedB64);
  return { signedB64, signature, userSignature };
}

/**
 * Build, sign and submit a Jupiter swap. Jupiter returns a fully-built v0
 * VersionedTransaction with the user as the sole required signer. We sign the
 * message bytes (everything after the signature array) and write the signature
 * into the fee-payer (first) slot — no SDK needed, same approach as transfers.
 */
export async function executeJupiterSwap(
  secretKey: Uint8Array, userPublicKey: string, quoteRaw: any,
): Promise<string> {
  // Collect the platform fee into our SPL fee account, but only when the quote
  // was actually built with a platformFeeBps (same gate as fetchJupiterQuote).
  // Derived from the quote's own mints so it can never disagree with the quote.
  const feeAccount = quoteRaw?.platformFee
    ? jupiterFeeAccountFor(quoteRaw?.inputMint, quoteRaw?.outputMint)
    : null;
  const swapResp = await fetch(`${JUP_SWAP}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quoteRaw,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      ...(feeAccount ? { feeAccount } : {}),
      // Bounded priority fee (max 0.001 SOL) so the total cost of a swap is
      // predictable; "auto" could spend an uncapped estimate during congestion.
      prioritizationFeeLamports: {
        priorityLevelWithMaxLamports: { maxLamports: 1_000_000, priorityLevel: "veryHigh" },
      },
    }),
  });
  const swapData = await swapResp.json();
  if (!swapData?.swapTransaction) {
    throw new Error(swapData?.error || "Jupiter could not build the swap transaction");
  }
  return signSimulateSendSolanaTx(secretKey, userPublicKey, swapData.swapTransaction);
}

/**
 * Sign, locally simulate, and broadcast a pre-built base64 v0 transaction
 * returned by a quote API (Jupiter swap, LI.FI bridge). Shared guards:
 * the user must be the SOLE required signer and the fee payer (SWAP-2
 * binding), and the signed transaction must pass simulateTransaction against
 * current state before it is sent (node preflight is then skipped).
 */
export async function signSimulateSendSolanaTx(
  secretKey: Uint8Array, userPublicKey: string, txB64: string,
): Promise<string> {
  const txBytes = Uint8Array.from(atob(txB64), (c) => c.charCodeAt(0));
  const { value: numSigs, length: lenBytes } = decodeCompactU16(txBytes, 0);
  // We can only sign as the user (fee payer). Standard Jupiter swaps and LI.FI
  // bridge txs need exactly that; if a route requires extra signers, fail
  // clearly instead of submitting a transaction we can't fully sign.
  if (numSigs !== 1) {
    throw new Error("This route needs additional signers and isn't supported. Try a different amount or token.");
  }
  const sigStart = lenBytes;
  const message = txBytes.slice(sigStart + numSigs * 64);

  // Bind the node-built message to the user before signing (SWAP-2). The fee
  // payer (first account key) is the account whose signature we are about to
  // produce; it MUST be the user. If a tampered Jupiter response put another
  // account first, we would otherwise blind-sign a message whose instructions
  // we never inspected. (Address-lookup-table entries can't be resolved
  // offline, so deeper instruction binding is left to the local simulation and
  // the fresh-quote slippage guard upstream.)
  const decoded = decodeSolanaMessage(message);
  if (decoded.feePayer !== userPublicKey) {
    throw new Error(
      "Blocked for safety: the transaction's fee payer is not your wallet. Aborted before signing.",
    );
  }

  const sig = nacl.sign.detached(message, secretKey);
  txBytes.set(sig, sigStart); // user is the fee payer / first signer

  let binary = "";
  for (let i = 0; i < txBytes.length; i++) binary += String.fromCharCode(txBytes[i]);
  const signedB64 = btoa(binary);

  // Local simulation before broadcast. Jupiter recommends skipPreflight for the
  // actual send (their v0 txs can fail node preflight on slot timing yet still
  // land), so we run our own simulateTransaction first and abort if it would
  // fail — never send a transaction we haven't checked against current state.
  const simResp = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "simulateTransaction",
      params: [signedB64, { encoding: "base64", sigVerify: true, commitment: "confirmed" }],
    }),
  });
  const simData = await simResp.json();
  if (simData.error) throw new Error(simData.error.message ?? "Transaction simulation failed");
  if (simData.result?.value?.err) {
    throw new Error(decodeSimulationFailure(simData.result.value.err, simData.result?.value?.logs ?? []));
  }

  const sendResp = await fetch(SOL_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "sendTransaction",
      // Safe to skip node preflight here: we just simulated locally above.
      params: [signedB64, { encoding: "base64", skipPreflight: true, maxRetries: 3, preflightCommitment: "confirmed" }],
    }),
  });
  const sendData = await sendResp.json();
  if (sendData.error) throw new Error(sendData.error.message ?? JSON.stringify(sendData.error));
  return sendData.result as string;
}

/**
 * Whether `owner` already has a token account for `mint` (SPL or Token2022).
 * Used to predict if a swap must pay ~0.002 SOL rent to create one.
 * Returns null when the check itself fails (caller should not assume either way).
 */
export async function hasTokenAccount(owner: string, mint: string): Promise<boolean | null> {
  try {
    const resp = await fetch(SOL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1,
        method: "getTokenAccountsByOwner",
        params: [owner, { mint }, { encoding: "jsonParsed" }],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.error) return null;
    return (data.result?.value?.length ?? 0) > 0;
  } catch { return null; }
}

// ---------- balance ----------

// ── Token2022 on-chain metadata helpers ──────────────────────────────────────

function readU32LE(data: Uint8Array, offset: number): number {
  return (data[offset] | (data[offset + 1] << 8) | (data[offset + 2] << 16) | (data[offset + 3] << 24)) >>> 0;
}

function toHttpsUrl(uri: string): string {
  if (uri.startsWith("ipfs://")) return uri.replace("ipfs://", "https://cf-ipfs.com/ipfs/");
  return uri;
}

/**
 * Parse the Token2022 TokenMetadata extension (type 19) from a base64-encoded
 * mint account. Returns name, symbol, and the JSON metadata URI if found.
 * Layout after the 6-byte TLV header:
 *   8  bytes  discriminator
 *   32 bytes  update_authority (OptionalNonZeroPubkey)
 *   32 bytes  mint
 *   4+n bytes name   (Borsh string)
 *   4+n bytes symbol (Borsh string)
 *   4+n bytes uri    (Borsh string)
 */
function parseToken2022Metadata(
  rawBase64: string,
): { name?: string; symbol?: string; uri?: string } | null {
  try {
    const bytes = Uint8Array.from(atob(rawBase64), (c) => c.charCodeAt(0));
    // Standard SPL mint = 82 bytes; Token2022 adds AccountType byte + TLV extensions
    if (bytes.length <= 82) return null;
    // Byte 82: AccountType — 1 = Mint (Token2022)
    if (bytes[82] !== 1) return null;

    const decoder = new TextDecoder();
    let offset = 83;
    while (offset + 6 <= bytes.length) {
      const extType = bytes[offset] | (bytes[offset + 1] << 8);
      const extLen  = readU32LE(bytes, offset + 2);
      offset += 6;

      if (extType === 19) {
        // TokenMetadata extension
        let pos = offset;
        pos += 8;  // discriminator
        pos += 32; // update_authority
        pos += 32; // mint

        if (pos + 4 > bytes.length) break;
        const nameLen = readU32LE(bytes, pos); pos += 4;
        if (pos + nameLen > bytes.length) break;
        const name = decoder.decode(bytes.slice(pos, pos + nameLen)).trim();
        pos += nameLen;

        if (pos + 4 > bytes.length) break;
        const symLen = readU32LE(bytes, pos); pos += 4;
        if (pos + symLen > bytes.length) break;
        const symbol = decoder.decode(bytes.slice(pos, pos + symLen)).trim();
        pos += symLen;

        if (pos + 4 > bytes.length) break;
        const uriLen = readU32LE(bytes, pos); pos += 4;
        if (pos + uriLen > bytes.length) break;
        const uri = decoder.decode(bytes.slice(pos, pos + uriLen)).trim();

        return {
          name:   name   || undefined,
          symbol: symbol || undefined,
          uri:    uri    || undefined,
        };
      }

      offset += extLen;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Fetch all SPL + Token2022 token balances and metadata for a Solana address.
 *
 * Metadata resolution chain (each step only runs for tokens still missing data):
 *   1.  Jupiter Token API v2  — name, symbol, icon, usd price (most coverage)
 *   1b. Moralis Solana        — CDN-cached logo + spam/verify flags (one call)
 *   2.  Token2022 on-chain    — reads mint account directly when both missed it
 *   3.  DexScreener           — graduated tokens listed on any DEX (+ price)
 */
export async function fetchSolanaTokens(address: string): Promise<Array<{
  symbol: string; name: string; address: string; decimals: number; balance: string; logo?: string; priceUsd?: number;
  possibleSpam?: boolean; verifiedContract?: boolean; securityScore?: number;
  liquidityUsd?: number; marketCapUsd?: number;
}> | null> {
  // Returns null when the RPC could not be reached / answered garbage, so
  // callers keep their last-known list. An empty array is an authoritative
  // "this wallet holds no tokens" and must be allowed to clear stale entries
  // (e.g. after swapping the only SPL token back to SOL).
  try {
    // ── Step 0: get all token accounts (SPL + Token2022) ─────────────────────
    const [resp1, resp2] = await Promise.all([
      fetch(SOL_RPC, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "getTokenAccountsByOwner",
          params: [address, { programId: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" }, { encoding: "jsonParsed" }],
        }),
      }).then((r) => r.json()).catch(() => null),
      fetch(SOL_RPC, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 2, method: "getTokenAccountsByOwner",
          params: [address, { programId: "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb" }, { encoding: "jsonParsed" }],
        }),
      }).then((r) => r.json()).catch(() => null),
    ]);

    // Authoritative only when BOTH token programs answered; a partial failure
    // must not report "no tokens" for the program that never responded.
    if (!Array.isArray(resp1?.result?.value) || !Array.isArray(resp2?.result?.value)) return null;

    const accounts: any[] = [
      ...resp1.result.value,
      ...resp2.result.value,
    ];

    const holdings: { mint: string; balance: number; decimals: number }[] = [];
    for (const acc of accounts) {
      const info = acc.account?.data?.parsed?.info;
      if (!info) continue;
      const uiAmount = Number(info.tokenAmount?.uiAmount ?? 0);
      if (uiAmount <= 0) continue;
      holdings.push({ mint: info.mint, balance: uiAmount, decimals: info.tokenAmount.decimals ?? 0 });
    }
    if (holdings.length === 0) return [];

    const metaMap: Record<string, { symbol?: string; name?: string; logo?: string }> = {};
    const priceMap: Record<string, number> = {};
    // DexScreener market data for spam classification, keyed by mint. liqMap
    // tracks the deepest pair's liquidity so the matching market cap is kept.
    const liqMap: Record<string, number> = {};
    const mcMap: Record<string, number> = {};
    // Moralis-sourced data: CDN logo + risk flags, keyed by mint.
    const moralisMap: Record<string, {
      name?: string; symbol?: string; logo?: string;
      possibleSpam?: boolean; verifiedContract?: boolean; securityScore?: number;
    }> = {};

    // ── Step 1: Jupiter Token API v2 — name, symbol, logo AND usd price ──────
    // Covers nearly all tradeable + pump.fun tokens in one call per mint.
    await Promise.allSettled(
      holdings.slice(0, 50).map(async (h) => {
        try {
          const r = await fetch(`https://lite-api.jup.ag/tokens/v2/search?query=${h.mint}`);
          if (!r.ok) return;
          const arr = await r.json();
          const d = Array.isArray(arr) ? arr.find((x: any) => x.id === h.mint) : null;
          if (!d) return;
          if (d.symbol || d.name) {
            metaMap[h.mint] = {
              symbol: d.symbol?.trim(),
              name:   d.name?.trim(),
              logo:   d.icon ? toHttpsUrl(String(d.icon)) : undefined,
            };
          }
          if (typeof d.usdPrice === "number") priceMap[h.mint] = d.usdPrice;
        } catch {}
      }),
    );

    // ── Step 1b: Moralis Solana — one call for CDN-cached logos + risk flags ──
    // Moralis re-hosts token images, so logos resolve even when the original
    // metadata host (IPFS/Arweave/custom) is dead — fixes pump.fun/bonk.fun art.
    if (MORALIS_KEY) {
      try {
        const r = await fetch(
          `https://solana-gateway.moralis.io/account/mainnet/${address}/tokens`,
          { headers: { "X-API-Key": MORALIS_KEY, Accept: "application/json" } },
        );
        if (r.ok) {
          const list = await r.json();
          for (const t of (Array.isArray(list) ? list : [])) {
            if (!t?.mint) continue;
            moralisMap[t.mint] = {
              name:             t.name?.trim() || undefined,
              symbol:           t.symbol?.trim() || undefined,
              logo:             t.logo || undefined,
              possibleSpam:     t.possibleSpam === true,
              verifiedContract: t.isVerifiedContract === true,
              securityScore:    typeof t.score === "number" ? t.score : undefined,
            };
          }
        }
      } catch {}
    }

    // ── Step 2: Token2022 on-chain metadata for mints Jupiter/Moralis missed ─
    const onchainMints = holdings.filter((h) => !metaMap[h.mint]?.name && !moralisMap[h.mint]?.name);
    if (onchainMints.length > 0) {
      try {
        const mintResp = await fetch(SOL_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 3,
            method: "getMultipleAccounts",
            params: [onchainMints.slice(0, 50).map((h) => h.mint), { encoding: "base64" }],
          }),
        });
        if (mintResp.ok) {
          const mintData = await mintResp.json();
          const mintAccounts: any[] = mintData.result?.value ?? [];
          const uriQueue: { mint: string; uri: string }[] = [];

          for (let i = 0; i < mintAccounts.length; i++) {
            const acc = mintAccounts[i];
            if (!acc?.data?.[0]) continue;
            const t2 = parseToken2022Metadata(acc.data[0]);
            if (t2?.name || t2?.symbol) {
              metaMap[onchainMints[i].mint] = { name: t2.name, symbol: t2.symbol };
              if (t2.uri) uriQueue.push({ mint: onchainMints[i].mint, uri: t2.uri });
            }
          }

          // Fetch logo from the JSON metadata URI (IPFS / Arweave)
          await Promise.allSettled(
            uriQueue.map(async ({ mint, uri }) => {
              try {
                const r = await fetch(toHttpsUrl(uri));
                if (!r.ok) return;
                const json = await r.json();
                if (json?.image && metaMap[mint]) {
                  metaMap[mint].logo = toHttpsUrl(String(json.image));
                }
              } catch {}
            }),
          );
        }
      } catch {}
    }

    // ── Step 3: DexScreener — fills missing name/logo/price AND captures the
    // liquidity + market cap of each token's deepest pair (used for spam
    // classification). Queried for ALL held mints, batched 30 per call.
    const allMints = holdings.map((h) => h.mint);
    for (let i = 0; i < allMints.length; i += 30) {
      const batch = allMints.slice(i, i + 30);
      try {
        const r = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${batch.join(",")}`);
        if (!r.ok) continue;
        const d = await r.json();
        for (const pair of (d.pairs ?? [])) {
          const mint = pair.baseToken?.address;
          if (!mint) continue;
          if (!metaMap[mint]?.name) {
            metaMap[mint] = {
              symbol: pair.baseToken.symbol?.trim(),
              name:   pair.baseToken.name?.trim(),
              logo:   pair.info?.imageUrl,
            };
          }
          if (priceMap[mint] == null && pair.priceUsd) {
            const p = parseFloat(pair.priceUsd);
            if (p > 0) priceMap[mint] = p;
          }
          // Keep the deepest pair's liquidity and its market cap together.
          const liq = typeof pair.liquidity?.usd === "number" ? pair.liquidity.usd : null;
          if (liq != null && (liqMap[mint] == null || liq > liqMap[mint])) {
            liqMap[mint] = liq;
            const mc = typeof pair.marketCap === "number" ? pair.marketCap
                     : typeof pair.fdv === "number" ? pair.fdv : null;
            if (mc != null) mcMap[mint] = mc;
          }
        }
      } catch {}
    }

    // Wrapped SOL's canonical metadata symbol is "SOL", which both collides
    // with the native row's symbol in the UI and used to trip the dashboard's
    // native-pseudo-token dedupe (hiding bridged wSOL entirely). Label it
    // distinctly; the mint address stays the routing/identity key everywhere.
    const WSOL_MINT = "So11111111111111111111111111111111111111112";

    return holdings.map(({ mint, balance, decimals }) => {
      const meta = metaMap[mint] ?? {};
      const mor  = moralisMap[mint] ?? {};
      const symbol = mint === WSOL_MINT
        ? "wSOL"
        : (meta.symbol || mor.symbol || mint.slice(0, 6).toUpperCase());
      return {
        symbol,
        name:    mint === WSOL_MINT ? "Wrapped SOL"
               : meta.name || mor.name || meta.symbol || mint.slice(0, 6).toUpperCase(),
        address: mint,
        decimals,
        balance: balance.toString(),
        // Prefer the Moralis CDN logo (survives dead origins); fall back to Jupiter/on-chain.
        logo:    mor.logo || meta.logo,
        priceUsd: priceMap[mint],
        possibleSpam:     mor.possibleSpam,
        verifiedContract: mor.verifiedContract,
        securityScore:    mor.securityScore,
        liquidityUsd: liqMap[mint],
        marketCapUsd: mcMap[mint],
      };
    });
  } catch { return null; }
}

/**
 * Fetch Solana balance using JSON-RPC.
 * Returns balance in SOL, or null when the source failed — 0 must only ever
 * mean a verified empty account (callers keep last-known on null).
 */
export async function fetchSolanaBalance(address: string): Promise<number | null> {
  try {
    const resp = await fetch(SOL_RPC, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "getBalance",
        params: [address],
      }),
    });
    if (!resp.ok) return null;
    const data = await resp.json();
    if (data.error || !data.result) return null;
    const lamports = data.result?.value || 0;
    return lamports / 1e9; // lamports to SOL
  } catch {
    return null;
  }
}
