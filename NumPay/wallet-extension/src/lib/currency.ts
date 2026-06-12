import { getItem, setItem } from "./storage";

export interface Currency {
  code: string;
  name: string;
  symbol: string;
  flag?: string;
  logo?: string;
}

const TW = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";

// Comprehensive list: crypto + all major fiat currencies
export const CURRENCIES: Currency[] = [
  // Crypto
  { code: "btc", name: "Bitcoin",  symbol: "BTC", logo: `${TW}/bitcoin/info/logo.png` },
  { code: "eth", name: "Ethereum", symbol: "ETH", logo: `${TW}/ethereum/info/logo.png` },

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
const CACHE_DURATION = 15 * 60 * 1000; // 15 minutes — reduce CoinGecko free-tier rate-limit risk

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

// Fetch live rates from CoinGecko (free, no API key)
export async function fetchRates(): Promise<Rates> {
  // Check cache first
  const cached = await getItem(RATES_KEY);
  const ts = await getItem(RATES_TS_KEY);
  if (cached && ts && Date.now() - Number(ts) < CACHE_DURATION) {
    try {
      return JSON.parse(cached);
    } catch {}
  }

  const coinIds = "ethereum,bitcoin,matic-network,avalanche-2,binancecoin,fantom,mantle,sei-network,solana,sui,tron,ripple,litecoin,tether,crypto-com-chain,celo,xdai,moonbeam,klay-token,metis-token";
  const vsCurrencies = CURRENCIES.map((c) => c.code).join(",");

  const res = await fetch(
    `https://api.coingecko.com/api/v3/simple/price?ids=${coinIds}&vs_currencies=${vsCurrencies}`
  );

  if (!res.ok) {
    // Return cached data if available, even if stale
    if (cached) return JSON.parse(cached);
    throw new Error("Failed to fetch rates");
  }

  const data = await res.json();
  await setItem(RATES_KEY, JSON.stringify(data));
  await setItem(RATES_TS_KEY, String(Date.now()));
  return data;
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
  KLAY: "klay-token",
  METIS: "metis-token",
};

// Get USD price for a native symbol using live rates.
// Unknown symbols return 0 — never another coin's price.
export function getUsdPrice(networkSymbol: string, rates: Rates): number {
  const coinId = SYMBOL_TO_COINGECKO[networkSymbol];
  if (!coinId) return 0;
  return rates[coinId]?.["usd"] || 0;
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
