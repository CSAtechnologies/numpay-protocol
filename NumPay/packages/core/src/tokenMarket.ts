/**
 * Token market data + price chart with a multi-source fallback chain, so even
 * unlisted memecoins resolve as far as the data physically allows:
 *
 *   1. CoinGecko     — listed coins by id or contract: price, 24h, mcap, vol,
 *                      supply, ATH, and a real historical chart.
 *   2. GeckoTerminal — ANY on-chain token with a DEX pool, by address: price,
 *                      24h, mcap, vol, and a real OHLCV chart (covers tokens that
 *                      just migrated off pump.fun and aren't on CoinGecko yet).
 *   3. DexScreener   — broadest price source by address: price + 24h + mcap/vol,
 *                      but NO chart.
 *
 * A bonding-curve-only token (no pool yet) usually still gets a price via #3 but
 * has no chart — that's a data limitation, not a bug. Callers show a "limited
 * history" state when the chart comes back empty but a price exists.
 */

import { setTokenLogo } from "./logoCache";

export interface MarketData {
  current_price: number;
  price_change_percentage_24h: number;
  market_cap: number;
  total_volume: number;
  circulating_supply: number;
  ath: number; // 0 when the source doesn't provide it (GeckoTerminal / DexScreener)
  source: "coingecko" | "geckoterminal" | "dexscreener";
}

// ── Symbol / chain maps ────────────────────────────────────────────────────────

// Canonical CoinGecko ids for natives + well-known majors/memecoins. Used first
// (chain-agnostic, so SHIB held on BNB still shows the real SHIB chart).
const SYMBOL_TO_COINGECKO: Record<string, string> = {
  ETH: "ethereum", BTC: "bitcoin", SOL: "solana", SUI: "sui",
  MATIC: "matic-network", POL: "matic-network",
  AVAX: "avalanche-2", BNB: "binancecoin", FTM: "fantom",
  MNT: "mantle", SEI: "sei-network", TRX: "tron", XRP: "ripple", LTC: "litecoin",
  USDT: "tether", USDC: "usd-coin", DAI: "dai", BUSD: "binance-usd",
  WBTC: "wrapped-bitcoin", WETH: "weth", STETH: "staked-ether",
  LINK: "chainlink", UNI: "uniswap", AAVE: "aave", ARB: "arbitrum",
  OP: "optimism", DOT: "polkadot", ADA: "cardano", ATOM: "cosmos",
  NEAR: "near", APT: "aptos", TON: "the-open-network", INJ: "injective-protocol",
  DOGE: "dogecoin", SHIB: "shiba-inu", PEPE: "pepe", BONK: "bonk",
  WIF: "dogwifcoin", FLOKI: "floki", BRETT: "based-brett", MOG: "mog-coin",
  POPCAT: "popcat", NEIRO: "neiro-3", TURBO: "turbo", DEGEN: "degen-base",
  JUP: "jupiter-exchange-solana", RAY: "raydium", JTO: "jito-governance-token",
  PYTH: "pyth-network", RENDER: "render-token", WLD: "worldcoin-wld",
};

// our network id -> CoinGecko asset-platform id (contract-address lookups).
const CHAIN_TO_CG_PLATFORM: Record<string, string> = {
  ethereum: "ethereum", bsc: "binance-smart-chain", polygon: "polygon-pos",
  arbitrum: "arbitrum-one", optimism: "optimistic-ethereum", base: "base",
  avalanche: "avalanche", fantom: "fantom", cronos: "cronos", gnosis: "xdai",
  celo: "celo", moonbeam: "moonbeam", aurora: "aurora", metis: "metis-andromeda",
  zksync: "zksync", linea: "linea", scroll: "scroll", mantle: "mantle",
  blast: "blast", polygonzkevm: "polygon-zkevm", solana: "solana", tron: "tron",
};

// our network id -> GeckoTerminal network slug (on-chain DEX lookups).
const CHAIN_TO_GT_NETWORK: Record<string, string> = {
  ethereum: "eth", bsc: "bsc", polygon: "polygon_pos", arbitrum: "arbitrum",
  optimism: "optimism", base: "base", avalanche: "avax", fantom: "ftm",
  cronos: "cro", aurora: "aurora", metis: "metis", zksync: "zksync",
  linea: "linea", scroll: "scroll", mantle: "mantle", blast: "blast",
  polygonzkevm: "polygon-zkevm", sei: "sei-evm", solana: "solana",
};

// ── Source resolution ──────────────────────────────────────────────────────────

type CgRef = { kind: "id"; id: string } | { kind: "contract"; platform: string; address: string };

export interface MarketSource {
  cg: CgRef | null;
  gtNetwork: string | null;
  address: string | null;
}

export function resolveMarketSource(
  symbol: string,
  chainId?: string,
  address?: string,
): MarketSource | null {
  let cg: CgRef | null = null;
  const id = SYMBOL_TO_COINGECKO[symbol.toUpperCase()];
  if (id) cg = { kind: "id", id };
  else if (chainId && address && CHAIN_TO_CG_PLATFORM[chainId])
    cg = { kind: "contract", platform: CHAIN_TO_CG_PLATFORM[chainId], address: address.toLowerCase() };

  const gtNetwork = chainId ? CHAIN_TO_GT_NETWORK[chainId] ?? null : null;
  const addr = address ? address.toLowerCase() : null;
  if (!cg && !addr) return null; // nothing to query
  return { cg, gtNetwork, address: addr };
}

// Stable cache key for a source (id, contract, or bare address).
export function marketSourceKey(s: MarketSource): string {
  if (s.cg) return s.cg.kind === "id" ? `cg:${s.cg.id}` : `cg:${s.cg.platform}:${s.cg.address}`;
  return `addr:${s.gtNetwork ?? "?"}:${s.address}`;
}

// ── Fetch helpers ──────────────────────────────────────────────────────────────

async function fetchJson(url: string): Promise<any | null> {
  try {
    const r = await fetch(url);
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

const num = (v: unknown): number => {
  const n = typeof v === "string" ? parseFloat(v) : typeof v === "number" ? v : 0;
  return Number.isFinite(n) ? n : 0;
};

// ── 1. CoinGecko ───────────────────────────────────────────────────────────────

const cgBase = (r: CgRef) =>
  r.kind === "id"
    ? `https://api.coingecko.com/api/v3/coins/${r.id}`
    : `https://api.coingecko.com/api/v3/coins/${r.platform}/contract/${r.address}`;

async function cgMarket(r: CgRef): Promise<MarketData | null> {
  const data = await fetchJson(`${cgBase(r)}?localization=false&tickers=false&community_data=false&developer_data=false`);
  const m = data?.market_data;
  if (!m) return null;
  return {
    current_price: num(m.current_price?.usd),
    price_change_percentage_24h: num(m.price_change_percentage_24h),
    market_cap: num(m.market_cap?.usd),
    total_volume: num(m.total_volume?.usd),
    circulating_supply: num(m.circulating_supply),
    ath: num(m.ath?.usd),
    source: "coingecko",
  };
}

async function cgChart(r: CgRef, days: number): Promise<[number, number][]> {
  const data = await fetchJson(`${cgBase(r)}/market_chart?vs_currency=usd&days=${days}`);
  return (data?.prices as [number, number][]) ?? [];
}

// ── 2. GeckoTerminal (on-chain DEX, by token address) ────────────────────────────

// Top liquidity pool for the token — carries price/24h/mcap/vol and the pool
// address needed for the OHLCV chart.
async function gtTopPool(network: string, address: string): Promise<any | null> {
  const j = await fetchJson(`https://api.geckoterminal.com/api/v2/networks/${network}/tokens/${address}/pools?page=1`);
  return j?.data?.[0]?.attributes ?? null;
}

async function gtMarket(network: string, address: string): Promise<MarketData | null> {
  const a = await gtTopPool(network, address);
  if (!a) return null;
  const price = num(a.base_token_price_usd);
  if (!price) return null;
  const mcap = num(a.market_cap_usd) || num(a.fdv_usd);
  return {
    current_price: price,
    price_change_percentage_24h: num(a.price_change_percentage?.h24),
    market_cap: mcap,
    total_volume: num(a.volume_usd?.h24),
    circulating_supply: price ? mcap / price : 0,
    ath: 0,
    source: "geckoterminal",
  };
}

// GeckoTerminal OHLCV → [tsMs, closePrice][], chronological. Mirrors CoinGecko's
// market_chart shape so the chart component needs no change.
async function gtChart(network: string, address: string, days: number): Promise<[number, number][]> {
  const a = await gtTopPool(network, address);
  const pool = a?.address;
  if (!pool) return [];
  const tf = days <= 1 ? "hour" : days <= 7 ? "hour" : "day";
  const limit = days <= 1 ? 24 : days <= 7 ? days * 24 : days;
  const j = await fetchJson(
    `https://api.geckoterminal.com/api/v2/networks/${network}/pools/${pool}/ohlcv/${tf}?aggregate=1&limit=${limit}&currency=usd`,
  );
  const list = j?.data?.attributes?.ohlcv_list as number[][] | undefined;
  if (!list?.length) return [];
  // ohlcv_list rows are [ts(sec), open, high, low, close, volume], newest-first.
  return list
    .map((row) => [row[0] * 1000, row[4]] as [number, number])
    .sort((x, y) => x[0] - y[0]);
}

// ── 3. DexScreener (price breadth, by token address — no chart) ───────────────────

async function dsMarket(address: string): Promise<MarketData | null> {
  const j = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${address}`);
  const pairs = j?.pairs as any[] | undefined;
  if (!pairs?.length) return null;
  const p = pairs.slice().sort((a, b) => num(b.liquidity?.usd) - num(a.liquidity?.usd))[0];
  const price = num(p.priceUsd);
  if (!price) return null;
  setTokenLogo(address, p?.info?.imageUrl); // capture the logo for the detail-page path too
  const mcap = num(p.marketCap) || num(p.fdv);
  return {
    current_price: price,
    price_change_percentage_24h: num(p.priceChange?.h24),
    market_cap: mcap,
    total_volume: num(p.volume?.h24),
    circulating_supply: price ? mcap / price : 0,
    ath: 0,
    source: "dexscreener",
  };
}

// Batch price lookup by token address (DexScreener, up to 30 per request) for the
// token LIST — fills in USD prices the detector (Moralis/GoldRush) didn't provide,
// so memecoins/alts show a value on the dashboard, not just on their detail page.
// Returns a map of lowercased-address -> priceUsd (highest-liquidity pair wins).
// The lowercased key is consistent for EVM (hex) and Solana (base58) lookups since
// callers lowercase the same way — it's only ever used as a map key, not an address.
export async function fetchDexPrices(addresses: string[]): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  const bestLiq: Record<string, number> = {};
  const uniq = [...new Set(addresses.filter(Boolean))];
  for (let i = 0; i < uniq.length; i += 30) {
    const batch = uniq.slice(i, i + 30);
    const j = await fetchJson(`https://api.dexscreener.com/latest/dex/tokens/${batch.join(",")}`);
    const pairs = j?.pairs as any[] | undefined;
    if (!pairs) continue;
    for (const p of pairs) {
      const addr = p?.baseToken?.address?.toLowerCase();
      const price = num(p?.priceUsd);
      const liq = num(p?.liquidity?.usd);
      if (!addr || !price) continue;
      if (liq >= (bestLiq[addr] ?? -1)) { bestLiq[addr] = liq; out[addr] = price; }
      // The same response carries the token's logo — stash it so icons can use a
      // real image for memecoins the indexers/coincap have no logo for.
      setTokenLogo(addr, p?.info?.imageUrl);
    }
  }
  return out;
}

// Address-keyed logo backfill via GeckoTerminal's multi-token endpoint, which
// serves CoinGecko's broad logo set — covering tokens DexScreener has no uploaded
// image for (e.g. ARB, QUICK). GeckoTerminal endpoints are per-network, so callers
// pass tokens grouped by our chain id; each chain is batched 30 addresses per call.
// Only chains in CHAIN_TO_GT_NETWORK are attempted; the rest are skipped silently.
// Populates the shared logo cache as a side effect.
export async function fetchTokenLogos(byChain: Record<string, string[]>): Promise<void> {
  for (const [chainId, addrs] of Object.entries(byChain)) {
    const network = CHAIN_TO_GT_NETWORK[chainId];
    if (!network) continue;
    const uniq = [...new Set(addrs.filter(Boolean))];
    for (let i = 0; i < uniq.length; i += 30) {
      const batch = uniq.slice(i, i + 30);
      const j = await fetchJson(
        `https://api.geckoterminal.com/api/v2/networks/${network}/tokens/multi/${batch.join(",")}`,
      );
      const list = j?.data as any[] | undefined;
      if (!list) continue;
      for (const t of list) {
        const a = t?.attributes;
        const img = a?.image_url as string | undefined;
        if (a?.address && img && img !== "missing.png") setTokenLogo(a.address, img);
      }
    }
  }
}

// ── Public loaders (walk the fallback chain) ─────────────────────────────────────

export async function loadMarketData(s: MarketSource): Promise<MarketData | null> {
  if (s.cg) { const m = await cgMarket(s.cg); if (m && m.current_price) return m; }
  if (s.gtNetwork && s.address) { const m = await gtMarket(s.gtNetwork, s.address); if (m) return m; }
  if (s.address) { const m = await dsMarket(s.address); if (m) return m; }
  return null;
}

export async function loadChart(s: MarketSource, days: number): Promise<[number, number][]> {
  if (s.cg) { const c = await cgChart(s.cg, days); if (c.length >= 2) return c; }
  if (s.gtNetwork && s.address) { const c = await gtChart(s.gtNetwork, s.address, days); if (c.length >= 2) return c; }
  return [];
}
