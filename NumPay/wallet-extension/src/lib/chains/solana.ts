/**
 * Solana support — Ed25519 address derivation, balance fetching, and transfer.
 * Uses SLIP-0010 HD derivation (Ed25519) with BIP44 path m/44'/501'/0'/0'.
 */
import { derivePath } from "./slip10";
import nacl from "tweetnacl";
import bs58 from "bs58";
import { ethers } from "ethers";

// Solana BIP44 derivation path
const SOL_DERIVATION_PATH = "m/44'/501'/0'/0'";

const ALCHEMY_KEY = "REDACTED_ROTATE_ME";
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
 *   1. Token2022 on-chain extension  — reads mint account directly, no external API
 *      └─ also fetches the JSON URI for the logo image
 *   2. Alchemy DAS getAssetBatch     — covers indexed Metaplex / standard SPL tokens
 *   3. pump.fun API                  — bonding-curve tokens not yet indexed by DAS
 *   4. DexScreener                   — graduated tokens listed on any DEX
 */
export async function fetchSolanaTokens(address: string): Promise<Array<{
  symbol: string; name: string; address: string; decimals: number; balance: string; logo?: string;
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

    // ── Step 1: Token2022 on-chain metadata (no external API) ────────────────
    try {
      const mintResp = await fetch(SOL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 3,
          method: "getMultipleAccounts",
          params: [holdings.slice(0, 50).map((h) => h.mint), { encoding: "base64" }],
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
            metaMap[holdings[i].mint] = { name: t2.name, symbol: t2.symbol };
            if (t2.uri) uriQueue.push({ mint: holdings[i].mint, uri: t2.uri });
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

    // ── Step 2: Alchemy DAS batch (indexed Metaplex / standard SPL tokens) ───
    const missing1 = holdings.filter((h) => !metaMap[h.mint]?.name).map((h) => h.mint);
    if (missing1.length > 0) {
      try {
        const dasResp = await fetch(SOL_RPC, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            jsonrpc: "2.0", id: 1,
            method: "getAssetBatch",
            params: { ids: missing1.slice(0, 50) },
          }),
        });
        if (dasResp.ok) {
          const dasData = await dasResp.json();
          for (const asset of (dasData.result ?? [])) {
            if (!asset?.id) continue;
            const sym  = asset.content?.metadata?.symbol?.trim();
            const name = asset.content?.metadata?.name?.trim();
            const logo = asset.content?.links?.image ?? asset.content?.files?.[0]?.cdn_uri;
            if (sym || name) metaMap[asset.id] = { symbol: sym, name, logo };
          }
        }
      } catch {}
    }

    // ── Step 3: pump.fun API (bonding-curve tokens not yet indexed) ───────────
    const missing2 = holdings.filter((h) => !metaMap[h.mint]?.name).map((h) => h.mint);
    if (missing2.length > 0) {
      await Promise.allSettled(
        missing2.map(async (mint) => {
          try {
            const r = await fetch(`https://frontend-api.pump.fun/coins/${mint}`);
            if (!r.ok) return;
            const d = await r.json();
            if (d?.name || d?.symbol) {
              metaMap[mint] = {
                symbol: d.symbol?.trim(),
                name:   d.name?.trim(),
                logo:   d.image_uri ? toHttpsUrl(d.image_uri) : undefined,
              };
            }
          } catch {}
        }),
      );
    }

    // ── Step 4: DexScreener (graduated tokens on Raydium / Orca / etc.) ──────
    const missing3 = holdings.filter((h) => !metaMap[h.mint]?.name).map((h) => h.mint);
    if (missing3.length > 0) {
      try {
        const r = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${missing3.slice(0, 10).join(",")}`,
        );
        if (r.ok) {
          const d = await r.json();
          for (const pair of (d.pairs ?? [])) {
            const mint = pair.baseToken?.address;
            if (mint && !metaMap[mint]?.name) {
              metaMap[mint] = {
                symbol: pair.baseToken.symbol?.trim(),
                name:   pair.baseToken.name?.trim(),
                logo:   pair.info?.imageUrl,
              };
            }
          }
        }
      } catch {}
    }

    return holdings.map(({ mint, balance, decimals }) => {
      const meta = metaMap[mint] ?? {};
      const symbol = meta.symbol || mint.slice(0, 6).toUpperCase();
      return {
        symbol,
        name:    meta.name || meta.symbol || mint.slice(0, 6).toUpperCase(),
        address: mint,
        decimals,
        balance: balance.toString(),
        logo:    meta.logo,
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
