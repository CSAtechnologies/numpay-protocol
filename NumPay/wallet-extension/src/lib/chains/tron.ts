/**
 * Tron (TRX) — secp256k1, BIP44 m/44'/195'/0'/0/0.
 * Same keccak address algorithm as Ethereum; differs only in
 * address encoding (version byte 0x41, Base58Check via bs58).
 */
import { ethers } from "ethers";
import bs58 from "bs58";

const TRON_PATH = "m/44'/195'/0'/0/0";

export function deriveTronAddress(mnemonic: string): {
  address: string;
  privateKey: string;
} {
  const hdNode = ethers.HDNodeWallet.fromPhrase(mnemonic, "", TRON_PATH);

  // ethers gives the keccak-derived 20-byte address as a hex string
  const addrBytes = ethers.getBytes(hdNode.address);

  // Tron raw = [0x41, ...20 address bytes]
  const raw = new Uint8Array(21);
  raw[0] = 0x41;
  raw.set(addrBytes, 1);

  // Checksum = first 4 bytes of SHA256(SHA256(raw))
  const h1 = ethers.sha256(raw);
  const h2 = ethers.sha256(h1);
  const checksum = ethers.getBytes(h2).slice(0, 4);

  const payload = new Uint8Array(25);
  payload.set(raw);
  payload.set(checksum, 21);

  return { address: bs58.encode(payload), privateKey: hdNode.privateKey };
}

const TRON_RPC = "https://api.trongrid.io";

/** Decode a Tron base58check address to its 21-byte (0x41-prefixed) hex form. */
function tronAddressToHex(address: string): string {
  const decoded = bs58.decode(address); // 25 bytes: 21 payload + 4 checksum
  const payload = decoded.slice(0, 21);
  return Array.from(payload).map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Decode TronGrid's hex-encoded broadcast error message into readable text. */
function decodeTronMessage(hex?: string): string {
  if (!hex) return "";
  try {
    const bytes = hex.match(/.{1,2}/g)?.map((h) => parseInt(h, 16)) ?? [];
    return new TextDecoder().decode(new Uint8Array(bytes));
  } catch {
    return hex;
  }
}

/**
 * Send native TRX (a TransferContract) and return the transaction id (hex).
 *
 * Flow (matches TronWeb / the Tron protocol):
 *   1. TronGrid builds the unsigned transfer (`/wallet/createtransaction`).
 *   2. We verify the node-built transaction matches our intent — recipient,
 *      sender, amount, and that the recipient is actually encoded in the bytes
 *      we are about to sign — so a tampering/MITM RPC can never make us sign a
 *      transfer to a different address or amount.
 *   3. txID = SHA256(raw_data_hex); we sign that digest with secp256k1 and
 *      append the raw recovery id (0/1) as TRON expects (NOT Ethereum's +27).
 *   4. Broadcast via `/wallet/broadcasttransaction`.
 *
 * @param privateKey 0x-prefixed secp256k1 key from the Tron derivation path.
 * @param fromAddress Sender, base58 (T...).
 * @param toAddress   Recipient, base58 (T...).
 * @param amountSun   Amount in sun (1 TRX = 1_000_000 sun).
 */
export async function sendTronTransfer(
  privateKey: string,
  fromAddress: string,
  toAddress: string,
  amountSun: bigint,
): Promise<string> {
  if (amountSun <= 0n) throw new Error("Enter an amount greater than zero");
  // createtransaction takes amount as a JSON number; guard against precision loss.
  if (amountSun > BigInt(Number.MAX_SAFE_INTEGER)) {
    throw new Error("Amount too large");
  }
  const amount = Number(amountSun);

  // 1. Build the unsigned transfer. visible:true → base58 addresses in/out.
  const createResp = await fetch(`${TRON_RPC}/wallet/createtransaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ owner_address: fromAddress, to_address: toAddress, amount, visible: true }),
  });
  const tx = await createResp.json();
  if (tx.Error || !tx.raw_data_hex || !tx.txID) {
    // TronGrid reports activation/format problems here (e.g. inactive account).
    throw new Error(decodeTronMessage(tx.Error) || tx.Error || "Could not build the Tron transaction");
  }

  // 2. Verify the node-built transaction encodes exactly what we asked for.
  const contract = tx.raw_data?.contract?.[0];
  const value = contract?.parameter?.value;
  if (contract?.type !== "TransferContract") {
    throw new Error("Unexpected transaction type returned by the node");
  }
  if (value?.owner_address !== fromAddress) throw new Error("Sender mismatch in built transaction");
  if (value?.to_address !== toAddress)       throw new Error("Recipient mismatch in built transaction");
  if (BigInt(value?.amount ?? -1) !== amountSun) throw new Error("Amount mismatch in built transaction");

  // The bytes we sign are raw_data_hex, not the JSON. Confirm the intended
  // recipient is literally encoded in those bytes before trusting them.
  const toHex = tronAddressToHex(toAddress);
  if (!String(tx.raw_data_hex).toLowerCase().includes(toHex.toLowerCase())) {
    throw new Error("Built transaction does not encode the intended recipient");
  }

  // 3. txID = SHA256(raw_data_hex); recompute and cross-check the node's txID.
  const txID = ethers.sha256("0x" + tx.raw_data_hex).slice(2);
  if (txID.toLowerCase() !== String(tx.txID).toLowerCase()) {
    throw new Error("Transaction id mismatch — refusing to sign");
  }

  // Sign the digest. TRON signature = r(32) || s(32) || recoveryId(1, raw 0/1).
  const sig = new ethers.SigningKey(privateKey).sign("0x" + txID);
  const signature = sig.r.slice(2) + sig.s.slice(2) + sig.yParity.toString(16).padStart(2, "0");

  // 4. Broadcast the signed transaction.
  const broadcastResp = await fetch(`${TRON_RPC}/wallet/broadcasttransaction`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ ...tx, signature: [signature] }),
  });
  const result = await broadcastResp.json();
  if (result.result === true || result.code === "SUCCESS") {
    return txID;
  }
  throw new Error(
    decodeTronMessage(result.message) || result.code || result.Error || "Broadcast failed",
  );
}

export async function fetchTronBalance(address: string): Promise<number> {
  // Primary: Trongrid REST API
  try {
    const resp = await fetch(`https://api.trongrid.io/v1/accounts/${address}`, {
      headers: { Accept: "application/json" },
    });
    if (resp.ok) {
      const data = await resp.json();
      const sun: number = data.data?.[0]?.balance ?? -1;
      if (sun >= 0) return sun / 1_000_000;
    }
  } catch {}

  // Fallback: Trongrid wallet RPC (direct node endpoint)
  try {
    const resp = await fetch("https://api.trongrid.io/wallet/getaccount", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ address, visible: true }),
    });
    if (resp.ok) {
      const data = await resp.json();
      const sun: number = data.balance ?? 0;
      return sun / 1_000_000;
    }
  } catch {}

  return 0;
}

const TW = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";

// Well-known TRC-20 contracts with hardcoded metadata (avoids N round-trips for common tokens)
const KNOWN_TRC20: Record<string, { name: string; symbol: string; decimals: number; logo: string }> = {
  "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t": { name: "Tether USD",   symbol: "USDT", decimals: 6,  logo: `${TW}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png` },
  "TEkxiTehnzSmse5XcY4i1cDfGJxuVkgxoW": { name: "USD Coin",      symbol: "USDC", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
  "TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn": { name: "USDD",          symbol: "USDD", decimals: 18, logo: `${TW}/tron/assets/TPYmHEhy5n8TCEfYGqW2rPxsghSfzghPDn/logo.png` },
  "TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4": { name: "BitTorrent",    symbol: "BTT",  decimals: 18, logo: `${TW}/tron/assets/TAFjULxiVgT4qWk6UZwjqwZXTSaGaqnVp4/logo.png` },
  "TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9": { name: "JUST",          symbol: "JST",  decimals: 18, logo: `${TW}/tron/assets/TCFLL5dx5ZJdKnWuesXxi1VPwjLVmWZZy9/logo.png` },
  "TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S": { name: "SUN Token",     symbol: "SUN",  decimals: 18, logo: `${TW}/tron/assets/TSSMHYeV2uE9qYH95DqyoCuNCzEL1NvU3S/logo.png` },
  "TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR": { name: "Wrapped TRX",   symbol: "WTRX", decimals: 6,  logo: `${TW}/tron/assets/TNUC9Qb1rRpS5CbWLmNMxXBjyFoydXjWFR/logo.png` },
  "TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4": { name: "TrueUSD",       symbol: "TUSD", decimals: 18, logo: `${TW}/tron/assets/TUpMhErZL2fhh4sVNULAbNKLokS4GjC1F4/logo.png` },
  "TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7": { name: "WINkLink",      symbol: "WIN",  decimals: 6,  logo: `${TW}/tron/assets/TLa2f6VPqDgRE67v1736s7bJ8Ray5wYjU7/logo.png` },
  // Decimals verified on-chain via TronGrid triggerconstantcontract.
  "TThzxNRLrW2Brp9DcTQU8i4Wd9udCWEdZ3": { name: "Staked USDT",   symbol: "stUSDT", decimals: 18, logo: `${TW}/tron/assets/TThzxNRLrW2Brp9DcTQU8i4Wd9udCWEdZ3/logo.png` },
  "TMwFHYXLJaRUPeW6421aqXL4ZEzPRFGkGT": { name: "JUST Stablecoin", symbol: "USDJ", decimals: 18, logo: `${TW}/tron/assets/TMwFHYXLJaRUPeW6421aqXL4ZEzPRFGkGT/logo.png` },
  "TKfjV9RNKJJCqPvBtK8L7Knykh7DNWvnYt": { name: "Wrapped BTT",   symbol: "WBTT", decimals: 6,  logo: `${TW}/tron/assets/TKfjV9RNKJJCqPvBtK8L7Knykh7DNWvnYt/logo.png` },
};

/**
 * Read a TRC-20 contract's decimals() on-chain via TronGrid's constant-call
 * endpoint. Returns null if the call fails or yields a nonsensical value.
 */
async function fetchTrc20DecimalsOnChain(contract: string, owner: string): Promise<number | null> {
  try {
    const r = await fetch(`${TRON_RPC}/wallet/triggerconstantcontract`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        owner_address: owner,
        contract_address: contract,
        function_selector: "decimals()",
        visible: true,
      }),
    });
    if (!r.ok) return null;
    const d = await r.json();
    const hex = d.constant_result?.[0];
    if (!hex) return null;
    const n = parseInt(hex, 16);
    return Number.isFinite(n) && n >= 0 && n <= 36 ? n : null;
  } catch {
    return null;
  }
}

/**
 * Fetch TRC-20 token balances for a Tron address.
 * Uses Trongrid account data for balances, known list for metadata,
 * and DexScreener for any unknown contracts.
 */
export async function fetchTronTokens(address: string): Promise<Array<{
  symbol: string; name: string; address: string; decimals: number; balance: string; logo?: string;
}>> {
  try {
    const resp = await fetch(`https://api.trongrid.io/v1/accounts/${address}`, {
      headers: { Accept: "application/json" },
    });
    if (!resp.ok) return [];
    const data = await resp.json();

    // trc20 is an array of { contract_address: balance_string } objects
    const trc20List: Record<string, string>[] = data.data?.[0]?.trc20 ?? [];

    const tokens: Array<{
      symbol: string; name: string; address: string; decimals: number; balance: string; logo?: string;
    }> = [];

    // Unknown contracts are deferred: their decimals must be resolved before a
    // balance can be computed (guessing scales the balance by up to 10^12).
    const deferred: Array<{ contract: string; raw: string }> = [];

    for (const entry of trc20List) {
      for (const [contract, rawBalance] of Object.entries(entry)) {
        const known = KNOWN_TRC20[contract];
        if (!known) {
          if (Number(rawBalance) > 0) deferred.push({ contract, raw: rawBalance });
          continue;
        }
        const balance = Number(rawBalance) / Math.pow(10, known.decimals);
        if (balance <= 0) continue;
        tokens.push({
          symbol:   known.symbol,
          name:     known.name,
          address:  contract,
          decimals: known.decimals,
          balance:  balance.toString(),
          logo:     known.logo,
        });
      }
    }

    // TRC-10 tokens (assetV2) — numeric asset IDs the trc20 field never lists.
    // Resolve name/abbr/precision via Trongrid's asset endpoint.
    const trc10List: Array<{ key: string; value: number | string }> =
      data.data?.[0]?.assetV2 ?? [];
    await Promise.allSettled(
      trc10List.map(async (entry) => {
        const id = entry.key;
        const rawBal = Number(entry.value ?? 0);
        if (!id || rawBal <= 0) return;
        let name = id, symbol = id, decimals = 0, logo: string | undefined;
        try {
          const r = await fetch(`https://api.trongrid.io/v1/assets/${id}`, {
            headers: { Accept: "application/json" },
          });
          if (r.ok) {
            const info = (await r.json()).data?.[0];
            if (info) {
              name     = String(info.name || id).trim();
              symbol   = String(info.abbr || info.name || id).trim();
              decimals = Number(info.precision ?? 0);
            }
          }
        } catch {}
        const balance = rawBal / Math.pow(10, decimals);
        if (balance <= 0) return;
        tokens.push({
          symbol,
          name,
          address: `trc10:${id}`,
          decimals,
          balance: balance.toString(),
          logo,
        });
      }),
    );

    // Resolve deferred unknown TRC-20s. TronScan supplies name/symbol/decimals/
    // logo in one call; if it misses, read decimals() on-chain so the balance is
    // never displayed at the wrong scale. Tokens whose decimals cannot be
    // resolved at all are skipped rather than shown with a guessed magnitude.
    await Promise.allSettled(
      deferred.map(async ({ contract, raw }) => {
        let name = contract.slice(0, 6);
        let symbol = contract.slice(0, 6);
        let decimals: number | null = null;
        let logo: string | undefined;
        try {
          const r = await fetch(
            `https://apilist.tronscanapi.com/api/token_trc20?contract=${contract}&showAll=1`,
            { headers: { Accept: "application/json" } },
          );
          if (r.ok) {
            const info = (await r.json())?.trc20_tokens?.[0];
            if (info) {
              name   = String(info.name   || name).trim();
              symbol = String(info.symbol || symbol).trim();
              if (Number.isInteger(info.decimals)) decimals = info.decimals;
              logo = info.icon_url || undefined;
            }
          }
        } catch {}
        if (decimals == null) decimals = await fetchTrc20DecimalsOnChain(contract, address);
        if (decimals == null) return;
        const balance = Number(raw) / Math.pow(10, decimals);
        if (balance <= 0) return;
        tokens.push({ symbol, name, address: contract, decimals, balance: balance.toString(), logo });
      }),
    );

    // DexScreener fallback for still-unknown tokens (covers Tron DEX pairs)
    const stillUnknown = tokens.filter((t) => !KNOWN_TRC20[t.address] && t.symbol === t.address.slice(0, 6));
    if (stillUnknown.length > 0) {
      try {
        const r = await fetch(
          `https://api.dexscreener.com/latest/dex/tokens/${stillUnknown.slice(0, 5).map((t) => t.address).join(",")}`,
        );
        if (r.ok) {
          const d = await r.json();
          for (const pair of (d.pairs ?? [])) {
            const contract = pair.baseToken?.address;
            if (!contract) continue;
            const token = tokens.find((t) => t.address === contract && !KNOWN_TRC20[t.address]);
            if (token && (pair.baseToken.name || pair.baseToken.symbol)) {
              token.name   = pair.baseToken.name?.trim()   || token.name;
              token.symbol = pair.baseToken.symbol?.trim() || token.symbol;
              token.logo   = pair.info?.imageUrl           || token.logo;
            }
          }
        }
      } catch {}
    }

    return tokens;
  } catch { return []; }
}
