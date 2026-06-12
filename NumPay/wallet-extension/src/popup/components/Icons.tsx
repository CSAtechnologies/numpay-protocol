import React, { useState, useEffect } from "react";
import { ICON_DATA } from "../../lib/icons/iconData";
import { ICON_GLYPHS } from "../../lib/icons/iconGlyphs";

interface IconProps {
  size?: number;
  className?: string;
  style?: React.CSSProperties;
}

// ── Action icons ──────────────────────────────────────────────────────────────

export function WalletIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12V7H5a2 2 0 0 1 0-4h14v4" />
      <path d="M3 5v14a2 2 0 0 0 2 2h16v-5" />
      <path d="M18 12a2 2 0 0 0 0 4h4v-4h-4z" />
    </svg>
  );
}

export function SendIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 19V5" />
      <path d="m5 12 7-7 7 7" />
    </svg>
  );
}

export function ReceiveIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 5v14" />
      <path d="m19 12-7 7-7-7" />
    </svg>
  );
}

export function HashIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <line x1="4" x2="20" y1="9" y2="9" />
      <line x1="4" x2="20" y1="15" y2="15" />
      <line x1="10" x2="8" y1="3" y2="21" />
      <line x1="16" x2="14" y1="3" y2="21" />
    </svg>
  );
}

export function SettingsIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  );
}

export function LockIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
      <path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </svg>
  );
}

export function CopyIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <rect width="14" height="14" x="8" y="8" rx="2" ry="2" />
      <path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2" />
    </svg>
  );
}

export function ChevronDownIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

export function ChevronRightIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d="m9 18 6-6-6-6" />
    </svg>
  );
}

export function ArrowUpRightIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d="M7 17 17 7" />
      <path d="M7 7h10v10" />
    </svg>
  );
}

export function ArrowLeftIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m12 19-7-7 7-7" />
      <path d="M19 12H5" />
    </svg>
  );
}

export function RefreshIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
      <path d="M3 3v5h5" />
      <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
      <path d="M16 16h5v5" />
    </svg>
  );
}

export function CheckIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

export function ExternalLinkIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M15 3h6v6" />
      <path d="M10 14 21 3" />
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    </svg>
  );
}

export function SearchIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="11" cy="11" r="8" />
      <path d="m21 21-4.3-4.3" />
    </svg>
  );
}

export function ShieldIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </svg>
  );
}

export function SwapIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m16 3 4 4-4 4" />
      <path d="M20 7H4" />
      <path d="m8 21-4-4 4-4" />
      <path d="M4 17h16" />
    </svg>
  );
}

export function LayersIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <path d="m2 12 8.58 3.91a2 2 0 0 0 1.66 0L21 12" />
      <path d="m2 17 8.58 3.91a2 2 0 0 0 1.66 0L21 17" />
    </svg>
  );
}

export function SunIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
    </svg>
  );
}

export function MoonIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z" />
    </svg>
  );
}

export function TrendingUpIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <polyline points="16 7 22 7 22 13" />
    </svg>
  );
}

export function ActivityIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </svg>
  );
}

export function GlobeIcon({ size = 20, className }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className}>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <path d="M2 12h20" />
    </svg>
  );
}

export function AlertIcon({ size = 20, className, style }: IconProps) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" className={className} style={style}>
      <path d="m21.73 18-8-14a2 2 0 0 0-3.48 0l-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.73-3Z" />
      <path d="M12 9v4" />
      <path d="M12 17h.01" />
    </svg>
  );
}

// ── Real-logo resolution (symbol-keyed) + house framing ───────────────────────
// Port of design_handoff_icons (icon-render.js). PRIMARY art is each asset's own
// brand logo, keyed by SYMBOL (never by contract address): one canonical icon per
// ticker, identical on every chain. Chain art is composited separately as a
// corner badge by the caller. The drawn glyph/monogram coin (ICON_DATA +
// ICON_GLYPHS) is the deterministic FALLBACK when the CDN has no logo.

const FONT = "Geist, 'Helvetica Neue', Arial, 'Noto Sans', system-ui, sans-serif";
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

// ── Deterministic fallback-coin builder (pure, from ICON_DATA + ICON_GLYPHS) ──
function hashStr(s: string): number {
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
function contrastText(disc: string): string { return relLum(hexToRgb(disc)) > 0.42 ? "#16181E" : "#FFFFFF"; }
function isNearBlack(disc: string): boolean { return relLum(hexToRgb(disc)) < 0.045; }
function paletteFor(sym: string): string { const p = ICON_DATA.palette; return p[hashStr(sym.toUpperCase()) % p.length]; }
function escapeXml(s: string): string {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
function monogram(sym: string): string { return sym.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 4); }
function fontSizeFor(txt: string): number { const n = txt.length; return n <= 1 ? 60 : n === 2 ? 46 : n === 3 ? 35 : 27; }
function markText(txt: string, color: string): string {
  const n = txt.length;
  const ls = n >= 4 ? -1.6 : n === 3 ? -0.8 : 0;
  return '<text x="64" y="65" text-anchor="middle" dominant-baseline="central" font-family="' +
    FONT + '" font-weight="600" font-size="' + fontSizeFor(txt) + '" letter-spacing="' + ls +
    '" fill="' + color + '">' + escapeXml(txt) + "</text>";
}

interface ResolvedRec { disc?: string; mark?: string; glyph?: string; char?: string; mono?: string; }

function buildSvg(rec: ResolvedRec | null | undefined, sym: string): string {
  const discColor = (rec && rec.disc) || paletteFor(sym);
  const mark = (rec && rec.mark) || contrastText(discColor);
  let inner: string;
  if (rec && rec.glyph && ICON_GLYPHS[rec.glyph]) {
    inner = ICON_GLYPHS[rec.glyph](mark, discColor);
  } else if (rec && rec.char) {
    inner = markText(rec.char, mark);
  } else {
    const label = (rec && rec.mono) || monogram(sym);
    inner = markText(label, mark);
  }
  const ring = isNearBlack(discColor)
    ? '<circle cx="64" cy="64" r="59" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="1.5"/>'
    : "";
  return '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">' +
    '<circle cx="64" cy="64" r="60" fill="' + discColor + '"/>' + inner + ring + "</svg>";
}

function tokenFallbackSvg(sym: string): string {
  const u = sym.toUpperCase();
  const key = ICON_DATA.aliases[u] || u;
  const brand = ICON_DATA.brand[key] || ICON_DATA.brand[u];
  return buildSvg(brand, key);
}
function chainFallbackSvg(chainId: string): string {
  const rec = ICON_DATA.chains[chainId];
  if (!rec) return buildSvg(null, chainId);
  return buildSvg(rec, rec.label || chainId);
}

// ── Real-logo URL resolvers ────────────────────────────────────────────────────
// Resolve a packaged asset path (e.g. logoOverride "token-logos/x.png") to an
// extension URL; pass through absolute http(s) values unchanged.
function assetUrl(p: string): string {
  if (/^https?:/.test(p)) return p;
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) return chrome.runtime.getURL(p);
  } catch { /* not in an extension context */ }
  return p;
}

export function tokenIconUrl(symbol: string): string {
  const canon = (ICON_DATA.aliases[symbol.toUpperCase()] || symbol).toUpperCase();
  const ov = ICON_DATA.logoOverrides[canon];
  if (ov) return assetUrl(ov);
  const slug = canon.toLowerCase().replace(/[^a-z0-9]/g, "");
  return TOK_BASE + slug + "@2x.png";
}

export function chainIconUrl(chainId: string): string | null {
  const s = CHAIN_SLUG[chainId];
  return s ? CHAIN_BASE + s + "?w=64&h=64" : null;
}

// ── FramedCoin — house disc + ring, walks candidate logo URLs then the SVG ─────
function FramedCoin({
  sources,
  fallbackSvg,
  alt,
  size,
}: {
  sources: string[];
  fallbackSvg: string;
  alt: string;
  size: number;
}) {
  const srcs = sources.filter(Boolean);
  const listKey = srcs.join("|");
  const [idx, setIdx] = useState(0);

  useEffect(() => { setIdx(0); }, [listKey]);

  const exhausted = idx >= srcs.length;

  return (
    <span className="coin" style={{ width: size, height: size }}>
      {!exhausted ? (
        <img
          src={srcs[idx]}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setIdx((i) => i + 1)}
        />
      ) : (
        <span className="coin-fb" dangerouslySetInnerHTML={{ __html: fallbackSvg }} />
      )}
    </span>
  );
}

// ── ChainIcon component ────────────────────────────────────────────────────────
// Real chain logo (DefiLlama, by slug) → app-supplied logo → drawn fallback.
export function ChainIcon({
  chainId,
  logo,
  size = 24,
}: {
  chainId: string;
  logo?: string;
  size?: number;
}) {
  const sources = [chainIconUrl(chainId) || "", logo || ""];
  return <FramedCoin sources={sources} fallbackSvg={chainFallbackSvg(chainId)} alt={chainId} size={size} />;
}

// ── TokenIcon component ───────────────────────────────────────────────────────
// Symbol-keyed: pinned override / coincap (by symbol) → app-streamed logo →
// drawn coin. Identical icon for a ticker on every chain. `chainId`/`tokenAddress`
// are accepted for call-site compatibility but intentionally not used for art.
export function TokenIcon({
  symbol,
  logo,
  size = 32,
}: {
  symbol: string;
  logo?: string;
  chainId?: string;
  tokenAddress?: string;
  size?: number;
}) {
  const sources = [tokenIconUrl(symbol), logo || ""];
  return <FramedCoin sources={sources} fallbackSvg={tokenFallbackSvg(symbol)} alt={symbol} size={size} />;
}
