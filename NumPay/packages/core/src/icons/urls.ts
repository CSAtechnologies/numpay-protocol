// Platform-neutral icon resolution shared by the extension and mobile: the
// URL resolvers (which CDN/vendored source a symbol or chain resolves to) and
// the deterministic fallback-coin math (disc colour, mark colour, monogram).
// Rendering stays platform-side — the extension draws an SVG coin (with the
// glyph art in iconGlyphs.ts), mobile draws a disc + monogram natively — but
// both derive from the SAME spec here, so a given ticker gets the same colours
// and label everywhere.
import { ICON_DATA, type BrandEntry } from "./iconData";
import { VENDORED_TOKENS, VENDORED_CHAINS } from "./vendoredLogos";
import { assetUrl, hasAssetResolver } from "./assets";

const TOK_BASE = "https://assets.coincap.io/assets/icons/";
const CHAIN_BASE = "https://icons.llamao.fi/icons/chains/rsz_";

// our network id -> DefiLlama chain slug
const CHAIN_SLUG: Record<string, string> = {
  ethereum: "ethereum", sepolia: "ethereum", polygon: "polygon", arbitrum: "arbitrum",
  optimism: "optimism", base: "base", avalanche: "avalanche", bsc: "binance",
  zksync: "zksync-era", scroll: "scroll", linea: "linea", mantle: "mantle",
  blast: "blast", polygonzkevm: "polygon_zkevm", fantom: "fantom", cronos: "cronos",
  celo: "celo", gnosis: "xdai", moonbeam: "moonbeam", aurora: "aurora", sei: "sei",
  klaytn: "kaia", metis: "metis", solana: "solana", bitcoin: "bitcoin",
  tron: "tron", xrp: "ripple", sui: "sui", litecoin: "litecoin",
};

// ETH-L2 chains whose native gas token is ETH. Only for these does a native-coin
// row swap the generic ETH diamond for the CHAIN mark (e.g. Base's Square, the
// Arbitrum / Optimism logo), since "ETH on Arbitrum" reads more clearly as the
// chain. Everything else keeps its own symbol logo.
export const ETH_L2_CHAINS = new Set([
  "arbitrum", "optimism", "base", "zksync",
  "scroll", "linea", "blast", "polygonzkevm",
]);

// ── Real-logo URL resolvers ────────────────────────────────────────────────────
// Vendored packaged assets only exist where the platform injected an asset-URL
// resolver (the extension); without one (mobile, tests) resolution goes straight
// to the CDN so no candidate is a dead relative path.

export function tokenIconUrl(symbol: string): string {
  const canon = (ICON_DATA.aliases[symbol.toUpperCase()] || symbol).toUpperCase();
  const slug = canon.toLowerCase().replace(/[^a-z0-9]/g, "");
  // Vendored local asset wins — instant, no CDN round-trip. Covers the curated
  // override logos (blast/scroll/usdc/pol/ton) too, since those were vendored.
  if (hasAssetResolver() && VENDORED_TOKENS.has(slug)) return assetUrl(`token-logos/${slug}.png`);
  const ov = ICON_DATA.logoOverrides[canon];
  if (ov && (hasAssetResolver() || /^https?:/.test(ov))) return assetUrl(ov);
  return TOK_BASE + slug + "@2x.png";
}

// Local vendored chain logo (instant) or null when not vendored / not packaged.
export function chainLogoLocal(chainId: string): string | null {
  return hasAssetResolver() && VENDORED_CHAINS.has(chainId)
    ? assetUrl(`chain-logos/${chainId}.png`)
    : null;
}

export function chainIconUrl(chainId: string): string | null {
  const s = CHAIN_SLUG[chainId];
  return s ? CHAIN_BASE + s + "?w=64&h=64" : null;
}

// ── Deterministic fallback-coin spec (pure, from ICON_DATA) ───────────────────
export function hashStr(s: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
function hexToRgb(h: string): number[] {
  h = h.replace("#", "");
  if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h, 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
function relLum(rgb: number[]): number {
  const a = rgb.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); });
  return 0.2126 * a[0] + 0.7152 * a[1] + 0.0722 * a[2];
}
export function contrastText(disc: string): string { return relLum(hexToRgb(disc)) > 0.42 ? "#16181E" : "#FFFFFF"; }
export function isNearBlack(disc: string): boolean { return relLum(hexToRgb(disc)) < 0.045; }
export function paletteFor(sym: string): string { const p = ICON_DATA.palette; return p[hashStr(sym.toUpperCase()) % p.length]; }
export function monogram(sym: string): string { return sym.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4); }
export function fontSizeFor(txt: string): number { const n = txt.length; return n <= 1 ? 60 : n === 2 ? 46 : n === 3 ? 35 : 27; }

/**
 * Everything a renderer needs to draw the fallback coin for a token symbol or
 * chain id: disc colour, mark colour, the text label (single char or monogram)
 * and — extension only — the drawn-glyph key. label/textColor are ignored when
 * a glyph renderer honours `glyph`.
 */
export interface FallbackCoinSpec {
  disc: string;
  textColor: string;
  label: string;
  glyph?: string;
  /** Near-black discs get a faint ring so they read against dark surfaces. */
  needsRing: boolean;
}

function specFrom(rec: BrandEntry | undefined, sym: string): FallbackCoinSpec {
  const disc = rec?.disc || paletteFor(sym);
  const textColor = rec?.mark || contrastText(disc);
  const label = rec?.char || rec?.mono || monogram(sym);
  return { disc, textColor, label, glyph: rec?.glyph, needsRing: isNearBlack(disc) };
}

export function tokenFallbackSpec(symbol: string): FallbackCoinSpec {
  const u = symbol.toUpperCase();
  const key = ICON_DATA.aliases[u] || u;
  return specFrom(ICON_DATA.brand[key] || ICON_DATA.brand[u], key);
}

export function chainFallbackSpec(chainId: string): FallbackCoinSpec {
  const rec = ICON_DATA.chains[chainId];
  return specFrom(rec, rec?.label || chainId);
}
