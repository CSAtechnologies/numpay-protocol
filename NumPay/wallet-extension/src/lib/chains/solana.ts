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

/**
 * Fetch all SPL token balances for a Solana address.
 * Uses getTokenAccountsByOwner + Alchemy DAS batch metadata (covers pump.fun & all Metaplex tokens).
 */
export async function fetchSolanaTokens(address: string): Promise<Array<{
  symbol: string; name: string; address: string; decimals: number; balance: string; logo?: string;
}>> {
  try {
    // Query both SPL Token program and Token2022 (pump.fun uses both)
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

    // Collect mints with positive balance
    const holdings: { mint: string; balance: number; decimals: number }[] = [];
    for (const acc of accounts) {
      const info = acc.account?.data?.parsed?.info;
      if (!info) continue;
      const uiAmount = Number(info.tokenAmount?.uiAmount ?? 0);
      if (uiAmount <= 0) continue;
      holdings.push({ mint: info.mint, balance: uiAmount, decimals: info.tokenAmount.decimals ?? 0 });
    }
    if (holdings.length === 0) return [];

    // Batch-fetch Metaplex metadata via Alchemy DAS (works for pump.fun tokens too)
    const metaMap: Record<string, { symbol?: string; name?: string; logo?: string }> = {};
    try {
      const dasResp = await fetch(SOL_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1,
          method: "getAssetBatch",
          params: { ids: holdings.slice(0, 50).map((h) => h.mint) },
        }),
      });
      if (dasResp.ok) {
        const dasData = await dasResp.json();
        for (const asset of (dasData.result ?? [])) {
          if (!asset?.id) continue;
          metaMap[asset.id] = {
            symbol: asset.content?.metadata?.symbol?.trim(),
            name:   asset.content?.metadata?.name?.trim(),
            logo:   asset.content?.links?.image ?? asset.content?.files?.[0]?.cdn_uri,
          };
        }
      }
    } catch {}

    return holdings.map(({ mint, balance, decimals }) => {
      const meta = metaMap[mint] ?? {};
      const symbol = meta.symbol || mint.slice(0, 4).toUpperCase();
      return {
        symbol,
        name: meta.name || symbol,
        address: mint,
        decimals,
        balance: balance.toString(),
        logo: meta.logo,
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
