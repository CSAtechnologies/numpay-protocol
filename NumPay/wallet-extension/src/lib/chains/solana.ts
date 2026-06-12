/**
 * Solana support — Ed25519 address derivation, balance fetching, and transfer.
 * Uses SLIP-0010 HD derivation (Ed25519) with BIP44 path m/44'/501'/0'/0'.
 */
import { derivePath } from "./slip10";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { ethers } from "ethers";
import { ALCHEMY_KEY, MORALIS_KEY } from "../env";

// Solana BIP44 derivation path
const SOL_DERIVATION_PATH = "m/44'/501'/0'/0'";

const SOL_RPC = `https://solana-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;

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

// ── Jupiter swap (Solana DEX aggregator) ─────────────────────────────────────

const JUP_SWAP = "https://lite-api.jup.ag/swap/v1";
// Wrapped SOL mint — Jupiter's stand-in for native SOL on both sides of a swap.
export const WSOL_MINT = "So11111111111111111111111111111111111111112";

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
    const url = `${JUP_SWAP}/quote?inputMint=${inputMint}&outputMint=${outputMint}` +
      `&amount=${amountRaw}&slippageBps=${slippageBps}`;
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

/**
 * Build, sign and submit a Jupiter swap. Jupiter returns a fully-built v0
 * VersionedTransaction with the user as the sole required signer. We sign the
 * message bytes (everything after the signature array) and write the signature
 * into the fee-payer (first) slot — no SDK needed, same approach as transfers.
 */
export async function executeJupiterSwap(
  secretKey: Uint8Array, userPublicKey: string, quoteRaw: any,
): Promise<string> {
  const swapResp = await fetch(`${JUP_SWAP}/swap`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      quoteResponse: quoteRaw,
      userPublicKey,
      wrapAndUnwrapSol: true,
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: "auto",
    }),
  });
  const swapData = await swapResp.json();
  if (!swapData?.swapTransaction) {
    throw new Error(swapData?.error || "Jupiter could not build the swap transaction");
  }

  const txBytes = Uint8Array.from(atob(swapData.swapTransaction), (c) => c.charCodeAt(0));
  const { value: numSigs, length: lenBytes } = decodeCompactU16(txBytes, 0);
  // We can only sign as the user (fee payer). Standard Jupiter swaps need exactly
  // that; if a route requires extra signers, fail clearly instead of submitting
  // a transaction we can't fully sign.
  if (numSigs !== 1) {
    throw new Error("This swap route needs additional signers and isn't supported. Try a different amount or token.");
  }
  const sigStart = lenBytes;
  const message = txBytes.slice(sigStart + numSigs * 64);

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
  if (simData.error) throw new Error(simData.error.message ?? "Swap simulation failed");
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
}>> {
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

    const accounts: any[] = [
      ...(resp1?.result?.value ?? []),
      ...(resp2?.result?.value ?? []),
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

    // ── Step 3: DexScreener (graduated tokens) — fills name/logo + price ─────
    const missing3 = holdings.filter((h) => !metaMap[h.mint]?.name && !moralisMap[h.mint]?.name).map((h) => h.mint);
    if (missing3.length > 0) {
      try {
        const r = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${missing3.slice(0, 10).join(",")}`,
        );
        if (r.ok) {
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
          }
        }
      } catch {}
    }

    return holdings.map(({ mint, balance, decimals }) => {
      const meta = metaMap[mint] ?? {};
      const mor  = moralisMap[mint] ?? {};
      const symbol = meta.symbol || mor.symbol || mint.slice(0, 6).toUpperCase();
      return {
        symbol,
        name:    meta.name || mor.name || meta.symbol || mint.slice(0, 6).toUpperCase(),
        address: mint,
        decimals,
        balance: balance.toString(),
        // Prefer the Moralis CDN logo (survives dead origins); fall back to Jupiter/on-chain.
        logo:    mor.logo || meta.logo,
        priceUsd: priceMap[mint],
        possibleSpam:     mor.possibleSpam,
        verifiedContract: mor.verifiedContract,
        securityScore:    mor.securityScore,
      };
    });
  } catch { return []; }
}

/**
 * Fetch Solana balance using JSON-RPC.
 * Returns balance in SOL.
 */
export async function fetchSolanaBalance(address: string): Promise<number> {
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
    if (!resp.ok) return 0;
    const data = await resp.json();
    const lamports = data.result?.value || 0;
    return lamports / 1e9; // lamports to SOL
  } catch {
    return 0;
  }
}
