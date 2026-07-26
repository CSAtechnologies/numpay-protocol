import { getItem, setItem } from "./storage";
import { tokenLogoAsset } from "./icons/assets";
import { apiGet } from "./walletApi";

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  flag?: string;
  logo?: string;
}

// Comprehensive list: crypto + all major fiat currencies
export const CURRENCIES: Currency[] = [
  // Crypto (logos vendored in public/token-logos — no CDN round-trip)
  { code: "btc", name: "Bitcoin",  symbol: "BTC", logo: tokenLogoAsset("btc") },
  { code: "eth", name: "Ethereum", symbol: "ETH", logo: tokenLogoAsset("eth") },

  // Major fiat
  { code: "usd", name: "US Dollar", symbol: "$", flag: "🇺🇸" },
  { code: "eur", name: "Euro", symbol: "€", flag: "🇪🇺" },
  { code: "gbp", name: "British Pound", symbol: "£", flag: "🇬🇧" },
  { code: "jpy", name: "Japanese Yen", symbol: "¥", flag: "🇯🇵" },
  { code: "cny", name: "Chinese Yuan", symbol: "¥", flag: "🇨🇳" },
  { code: "krw", name: "South Korean Won", symbol: "₩", flag: "🇰🇷" },
  { code: "inr", name: "Indian Rupee", symbol: "₹", flag: "🇮🇳" },
  { code: "cad", name: "Canadian Dollar", symbol: "C$", flag: "🇨🇦" },
  { code: "aud", name: "Australian Dollar", symbol: "A$", flag: "🇦🇺" },
  { code: "chf", name: "Swiss Franc", symbol: "CHF", flag: "🇨🇭" },
  { code: "sgd", name: "Singapore Dollar", symbol: "S$", flag: "🇸🇬" },
  { code: "hkd", name: "Hong Kong Dollar", symbol: "HK$", flag: "🇭🇰" },

  // Americas
  { code: "brl", name: "Brazilian Real", symbol: "R$", flag: "🇧🇷" },
  { code: "mxn", name: "Mexican Peso", symbol: "MX$", flag: "🇲🇽" },
  { code: "ars", name: "Argentine Peso", symbol: "ARS", flag: "🇦🇷" },
  { code: "clp", name: "Chilean Peso", symbol: "CLP", flag: "🇨🇱" },
  { code: "cop", name: "Colombian Peso", symbol: "COP", flag: "🇨🇴" },
  { code: "pen", name: "Peruvian Sol", symbol: "S/.", flag: "🇵🇪" },

  // Europe
  { code: "sek", name: "Swedish Krona", symbol: "kr", flag: "🇸🇪" },
  { code: "nok", name: "Norwegian Krone", symbol: "kr", flag: "🇳🇴" },
  { code: "dkk", name: "Danish Krone", symbol: "kr", flag: "🇩🇰" },
  { code: "pln", name: "Polish Zloty", symbol: "zł", flag: "🇵🇱" },
  { code: "czk", name: "Czech Koruna", symbol: "Kč", flag: "🇨🇿" },
  { code: "huf", name: "Hungarian Forint", symbol: "Ft", flag: "🇭🇺" },
  { code: "ron", name: "Romanian Leu", symbol: "lei", flag: "🇷🇴" },
  { code: "bgn", name: "Bulgarian Lev", symbol: "лв", flag: "🇧🇬" },
  { code: "hrk", name: "Croatian Kuna", symbol: "kn", flag: "🇭🇷" },
  { code: "isk", name: "Icelandic Krona", symbol: "kr", flag: "🇮🇸" },
  { code: "rub", name: "Russian Ruble", symbol: "₽", flag: "🇷🇺" },
  { code: "uah", name: "Ukrainian Hryvnia", symbol: "₴", flag: "🇺🇦" },
  { code: "try", name: "Turkish Lira", symbol: "₺", flag: "🇹🇷" },
  { code: "gel", name: "Georgian Lari", symbol: "₾", flag: "🇬🇪" },

  // Asia & Pacific
  { code: "idr", name: "Indonesian Rupiah", symbol: "Rp", flag: "🇮🇩" },
  { code: "myr", name: "Malaysian Ringgit", symbol: "RM", flag: "🇲🇾" },
  { code: "thb", name: "Thai Baht", symbol: "฿", flag: "🇹🇭" },
  { code: "php", name: "Philippine Peso", symbol: "₱", flag: "🇵🇭" },
  { code: "vnd", name: "Vietnamese Dong", symbol: "₫", flag: "🇻🇳" },
  { code: "twd", name: "Taiwan Dollar", symbol: "NT$", flag: "🇹🇼" },
  { code: "pkr", name: "Pakistani Rupee", symbol: "₨", flag: "🇵🇰" },
  { code: "bdt", name: "Bangladeshi Taka", symbol: "৳", flag: "🇧🇩" },
  { code: "lkr", name: "Sri Lankan Rupee", symbol: "Rs", flag: "🇱🇰" },
  { code: "mmk", name: "Myanmar Kyat", symbol: "K", flag: "🇲🇲" },
  { code: "nzd", name: "New Zealand Dollar", symbol: "NZ$", flag: "🇳🇿" },

  // Middle East
  { code: "aed", name: "UAE Dirham", symbol: "د.إ", flag: "🇦🇪" },
  { code: "sar", name: "Saudi Riyal", symbol: "﷼", flag: "🇸🇦" },
  { code: "qar", name: "Qatari Riyal", symbol: "﷼", flag: "🇶🇦" },
  { code: "kwd", name: "Kuwaiti Dinar", symbol: "د.ك", flag: "🇰🇼" },
  { code: "bhd", name: "Bahraini Dinar", symbol: "BD", flag: "🇧🇭" },
  { code: "omr", name: "Omani Rial", symbol: "﷼", flag: "🇴🇲" },
  { code: "ils", name: "Israeli Shekel", symbol: "₪", flag: "🇮🇱" },
  { code: "egp", name: "Egyptian Pound", symbol: "E£", flag: "🇪🇬" },

  // Africa
  { code: "zar", name: "South African Rand", symbol: "R", flag: "🇿🇦" },
  { code: "ngn", name: "Nigerian Naira", symbol: "₦", flag: "🇳🇬" },
  { code: "kes", name: "Kenyan Shilling", symbol: "KSh", flag: "🇰🇪" },
  { code: "ghs", name: "Ghanaian Cedi", symbol: "₵", flag: "🇬🇭" },
  { code: "tzs", name: "Tanzanian Shilling", symbol: "TSh", flag: "🇹🇿" },
  { code: "ugx", name: "Ugandan Shilling", symbol: "USh", flag: "🇺🇬" },
  { code: "mad", name: "Moroccan Dirham", symbol: "MAD", flag: "🇲🇦" },
  { code: "xof", name: "West African CFA", symbol: "CFA", flag: "🇸🇳" },
  { code: "xaf", name: "Central African CFA", symbol: "FCFA", flag: "🇨🇲" },
  { code: "etb", name: "Ethiopian Birr", symbol: "Br", flag: "🇪🇹" },
  { code: "rwf", name: "Rwandan Franc", symbol: "RF", flag: "🇷🇼" },
];

const CURRENCY_KEY = "numpay_currency";
const RATES_KEY = "numpay_rates";
const RATES_TS_KEY = "numpay_rates_ts";
// Client-side rates cache. This sits IN FRONT of the wallet-api proxy, which
// holds its own 5-minute global cache, so a client miss costs a Worker request
// and NOT a CoinGecko call: the upstream quota is governed entirely by the
// worker's GLOBAL_FRESH_MS. Caching here for 15 minutes therefore bought no
// quota headroom and just stacked onto the worker's 5, making prices up to 20
// minutes stale. 60s keeps the app feeling live at zero upstream cost.
//
// Only the direct-to-CoinGecko fallback path below is quota-exposed, and that
// path already has its own timeout, backoff and stale-cache fallback.
const CACHE_DURATION = 60 * 1000;

export const DEFAULT_CURRENCY = "usd";

export async function getSavedCurrency(): Promise<string> {
  return (await getItem(CURRENCY_KEY)) || DEFAULT_CURRENCY;
}

export async function saveCurrency(code: string): Promise<void> {
  await setItem(CURRENCY_KEY, code);
}

export function getCurrency(code: string): Currency | undefined {
  return CURRENCIES.find((c) => c.code === code);
}

// Rates keyed by coin id (e.g. "ethereum") -> currency code -> price
export type Rates = Record<string, Record<string, number>>;

// Fetch live rates from CoinGecko (free, no API key). Resilient by design: the
// keyless public endpoint is frequently rate-limited (Cloudflare can reject the
// request before a response, surfacing as "TypeError: Failed to fetch"). A
// missing rate refresh must never throw or wipe values, so on any failure we
// fall back to the last cached rates (even if stale), and only return an empty
// map if there is no cache at all.
export async function fetchRates(): Promise<Rates> {
  // Check cache first
  const cached = await getItem(RATES_KEY);
  const ts = await getItem(RATES_TS_KEY);
  if (cached && ts && Date.now() - Number(ts) < CACHE_DURATION) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  const coinIds = "ethereum,bitcoin,matic-network,avalanche-2,binancecoin,fantom,mantle,sei-network,solana,sui,tron,ripple,litecoin,tether,crypto-com-chain,celo,xdai,moonbeam,kaia,metis-token";
  const vsCurrencies = CURRENCIES.map((c) => c.code).join(",");
  const url = `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=${vsCurrencies}`;

  // One attempt with an 8s timeout; a network error or non-OK response resolves
  // to null so the caller can retry / fall back rather than throw.
  const attempt = async (): Promise<Rates | null> => {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 8000);
    try {
      const res = await fetch(url, { signal: ctrl.signal });
      return res.ok ? ((await res.json()) as Rates) : null;
    } catch {
      return null;
    } finally {
      clearTimeout(timer);
    }
  };

  // Proxy first when configured: one shared 30s cache at the edge instead of
  // every install hitting CoinGecko. Same response shape (simple/price JSON).
  // Null on any proxy failure drops through to the direct path unchanged.
  let data = await apiGet<Rates>("/v1/prices");

  if (!data) data = await attempt();
  if (!data) {
    // Brief backoff, then a single retry — smooths over transient throttling.
    await new Promise((r) => setTimeout(r, 1200));
    data = await attempt();
  }

  if (data) {
    await setItem(RATES_KEY, JSON.stringify(data));
    await setItem(RATES_TS_KEY, String(Date.now()));
    return data;
  }

  // Both attempts failed — keep the last known rates instead of throwing.
  if (cached) {
    try {
      return JSON.parse(cached);
    } catch {}
  }
  return {};
}

// Map network symbol to CoinGecko coin id
const SYMBOL_TO_COINGECKO: Record<string, string> = {
  ETH: "ethereum",
  BTC: "bitcoin",
  SOL: "solana",
  SUI: "sui",
  MATIC: "matic-network",
  POL: "matic-network",
  AVAX: "avalanche-2",
  BNB: "binancecoin",
  FTM: "fantom",
  MNT: "mantle",
  SEI: "sei-network",
  TRX: "tron",
  XRP: "ripple",
  LTC: "litecoin",
  CRO: "crypto-com-chain",
  CELO: "celo",
  xDAI: "xdai",
  GLMR: "moonbeam",
  KAIA: "kaia",
  KLAY: "kaia", // legacy symbol, in case cached data still says KLAY
  METIS: "metis-token",
};

// Get USD price for a NATIVE (gas-coin) symbol using live rates.
// Unknown symbols return 0 — never another coin's price.
//
// This map is natives ONLY. For ERC-20s use getErc20UsdPrice below: passing a
// token symbol here returns 0, which is what silently valued every stablecoin
// balance at $0 on mobile.
export function getUsdPrice(networkSymbol: string, rates: Rates): number {
  const coinId = SYMBOL_TO_COINGECKO[networkSymbol];
  if (!coinId) return 0;
  return rates[coinId]?.["usd"] || 0;
}

/**
 * Known ERC-20 symbols → the CoinGecko id whose price stands in for them.
 * Stablecoins ride tether (≈ $1); wrapped assets ride their underlying.
 *
 * Shared because BOTH clients need it and a private per-client copy is how the
 * two drift: this table lived only in the extension's Dashboard.tsx, so mobile
 * had no ERC-20 price fallback at all and showed held USDC as $0.00.
 */
const ERC20_TO_COINGECKO: Record<string, string> = {
  // Stablecoins: tether ≈ $1, used as a USD proxy
  USDC: "tether", USDT: "tether", DAI: "tether", CUSD: "tether",
  BUSD: "tether", TUSD: "tether",
  // Wrapped natives — priced via the underlying asset
  WBTC: "bitcoin", BTCB: "bitcoin",
  WETH: "ethereum",
  WAVAX: "avalanche-2",
  WBNB: "binancecoin",
  // BEP-20 bridge tokens priced via their underlying
  XRP: "ripple", ADA: "tether", DOGE: "tether",
};

/**
 * USD unit price for a known ERC-20 symbol, or 0 when we have no basis for one.
 *
 * Returns a PRICE IN USD, deliberately not a display-currency value: callers
 * convert once at render (formatFiat / usdToDisplayCurrency). Returning display
 * currency here is the double-convert trap.
 *
 * 0 means "unknown price", NOT "worthless" — callers must not treat it as dust.
 */
export function getErc20UsdPrice(symbol: string, rates: Rates): number {
  const coinId = ERC20_TO_COINGECKO[symbol.toUpperCase()];
  if (!coinId) return 0;
  return rates[coinId]?.["usd"] || 0;
}

/**
 * Best-effort USD unit price for any token symbol: native table first, then the
 * ERC-20 table. Unknown → 0.
 */
export function getAnyUsdPrice(symbol: string, rates: Rates): number {
  return getUsdPrice(symbol, rates) || getErc20UsdPrice(symbol, rates);
}

/**
 * Convert a USD amount to the display currency.
 * Uses tether (USDT ≈ $1) as a direct USD/fiat exchange rate,
 * falling back to the ETH price ratio when tether isn't in the rates cache.
 */
export function usdToDisplayCurrency(usdAmount: number, currencyCode: string, rates: Rates): number {
  if (!usdAmount) return 0;
  if (currencyCode === "usd") return usdAmount;
  // Tether ≈ $1, so rates["tether"]["ngn"] IS the USD→NGN exchange rate
  const tetherRate = rates["tether"]?.[currencyCode];
  if (tetherRate) return usdAmount * tetherRate;
  // Fallback: derive rate from ETH prices in both currencies
  const ethUsd = rates["ethereum"]?.["usd"];
  const ethTarget = rates["ethereum"]?.[currencyCode];
  if (ethUsd && ethTarget) return usdAmount * (ethTarget / ethUsd);
  return usdAmount;
}

// ── Display formatting ───────────────────────────────────────────────────
// Shared by the extension popup and the mobile app so the two never drift.
// Every one of these converts before formatting: applying a currency symbol
// to an unconverted USD figure states a number that is simply wrong.

// BTC and ETH are selectable display currencies and need far more precision
// than any fiat tier gives: a $12 balance is 0.0001 BTC, which two or even
// four decimals round away to zero. Same distinction convertBalance makes.
const CRYPTO_CODES = new Set(["btc", "eth"]);
const CRYPTO_DECIMALS = 8;
const CRYPTO_MIN = 1e-8;

function symbolOf(code: string, currency: Currency | undefined): string {
  return currency?.symbol || code.toUpperCase();
}

function convert(usd: number, code: string, rates: Rates | null): number {
  return rates ? usdToDisplayCurrency(usd, code, rates) : usd;
}

/**
 * Render an already-converted value. Crypto currencies get 8 decimals; fiat
 * tiers by magnitude (>=1000 none, >=1 two, below 1 four). Trailing zeros
 * past two decimals are trimmed, so 0.1175 BTC does not read "0.11750000".
 */
function fmtValue(v: number, code: string): string {
  const max = CRYPTO_CODES.has(code) ? CRYPTO_DECIMALS : v >= 1000 ? 0 : v >= 1 ? 2 : 4;
  return v.toLocaleString("en", {
    minimumFractionDigits: Math.min(max, 2),
    maximumFractionDigits: max,
  });
}

/** Smallest value this currency can render, used as the "< x" floor. */
function floorFor(code: string): number {
  return CRYPTO_CODES.has(code) ? CRYPTO_MIN : 0.01;
}

/**
 * A USD amount in the display currency, for balances and portfolio totals.
 * Symbol prefix, e.g. "N1,975,790" / "$12.50" / "BTC0.1175".
 */
export function formatFiat(usd: number, code: string, currency: Currency | undefined, rates: Rates | null): string {
  const sym = symbolOf(code, currency);
  if (!usd || usd <= 0) return `${sym}0.00`;
  return `${sym}${fmtValue(convert(usd, code, rates), code)}`;
}

/**
 * Fiat line under a swap/bridge/send amount. A value too small to render at
 * this currency's precision reads "< $0.01" rather than a bare "$0.00" that
 * looks like a failed quote. Returns "" when there is nothing to show, so
 * callers can render a blank line.
 */
export function formatFiatLine(usd: number, code: string, currency: Currency | undefined, rates: Rates | null): string {
  if (!(usd > 0)) return "";
  const sym = symbolOf(code, currency);
  const v = convert(usd, code, rates);
  const floor = floorFor(code);
  if (v < floor) return `< ${sym}${fmtValue(floor, code)}`;
  return `${sym}${fmtValue(v, code)}`;
}

/**
 * Parenthesised tail for a network-fee line, e.g. " ($0.42)". A fee too small
 * to render reads " (<$0.01)" because "$0.00" says nothing about a real cost.
 */
export function formatFeeTail(usd: number, code: string, currency: Currency | undefined, rates: Rates | null): string {
  if (!(usd > 0)) return "";
  const sym = symbolOf(code, currency);
  const v = convert(usd, code, rates);
  const floor = floorFor(code);
  if (v < floor) return ` (<${sym}${fmtValue(floor, code)})`;
  return ` (${sym}${fmtValue(v, code)})`;
}

export function convertBalance(
  balance: string,
  networkSymbol: string,
  targetCurrency: string,
  rates: Rates
): { value: string; display: string } {
  const amount = parseFloat(balance) || 0;

  // If displaying in the same native token
  if (targetCurrency === networkSymbol.toLowerCase()) {
    return {
      value: amount.toFixed(4),
      display: `${amount.toFixed(4)} ${networkSymbol}`,
    };
  }

  // No price feed for this symbol → fall through to the native-amount display
  // below rather than pricing it as some other coin.
  const coinId = SYMBOL_TO_COINGECKO[networkSymbol];
  const rate = coinId ? rates[coinId]?.[targetCurrency] : undefined;

  if (!rate) {
    return { value: amount.toFixed(4), display: `${amount.toFixed(4)} ${networkSymbol}` };
  }

  const converted = amount * rate;
  const currency = getCurrency(targetCurrency);

  // Format based on currency type
  if (targetCurrency === "btc") {
    return { value: converted.toFixed(8), display: `${converted.toFixed(8)} BTC` };
  }

  const sym = currency?.symbol || targetCurrency.toUpperCase();

  // Large values: no decimals. Small values: 2 decimals.
  if (converted >= 1000) {
    return { value: converted.toFixed(0), display: `${sym}${converted.toLocaleString("en", { maximumFractionDigits: 0 })}` };
  }
  if (converted >= 1) {
    return { value: converted.toFixed(2), display: `${sym}${converted.toFixed(2)}` };
  }
  return { value: converted.toFixed(4), display: `${sym}${converted.toFixed(4)}` };
}
