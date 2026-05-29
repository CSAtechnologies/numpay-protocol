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
};

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

    for (const entry of trc20List) {
      for (const [contract, rawBalance] of Object.entries(entry)) {
        const known = KNOWN_TRC20[contract];
        const decimals = known?.decimals ?? 6;
        const balance = Number(rawBalance) / Math.pow(10, decimals);
        if (balance <= 0) continue;
        tokens.push({
          symbol:   known?.symbol ?? contract.slice(0, 6),
          name:     known?.name   ?? contract.slice(0, 6),
          address:  contract,
          decimals,
          balance:  balance.toString(),
          logo:     known?.logo,
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

    const unknowns = tokens.filter(
      (t) => !KNOWN_TRC20[t.address] && !t.address.startsWith("trc10:"),
    );

    // Resolve unknown contracts via TronScan token overview
    if (unknowns.length > 0) {
      await Promise.allSettled(
        unknowns.map(async (token) => {
          try {
            const r = await fetch(
              `https://apilist.tronscanapi.com/api/token/overview?address=${token.address}`,
              { headers: { Accept: "application/json" } },
            );
            if (!r.ok) return;
            const d = await r.json();
            if (d?.name || d?.symbol) {
              token.name   = d.name?.trim()   || token.name;
              token.symbol = d.symbol?.trim() || token.symbol;
              if (d.logo) token.logo = d.logo;
            }
          } catch {}
        }),
      );
    }

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
