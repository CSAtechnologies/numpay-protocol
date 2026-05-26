import React, { useState, useEffect } from "react";

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

// ── Chain brand colors (used as fallback when logo fails to load) ──────────────
const CHAIN_COLORS: Record<string, string> = {
  ethereum:     "#627EEA",
  sepolia:      "#627EEA",
  polygon:      "#8247E5",
  arbitrum:     "#28A0F0",
  optimism:     "#FF0420",
  base:         "#0052FF",
  avalanche:    "#E84142",
  bsc:          "#F3BA2F",
  zksync:       "#8C8DFC",
  scroll:       "#FFDBA0",
  linea:        "#121212",
  mantle:       "#1B1B1B",
  blast:        "#FCFC03",
  polygonzkevm: "#8247E5",
  fantom:       "#1969FF",
  cronos:       "#002D74",
  celo:         "#35D07F",
  gnosis:       "#04795B",
  moonbeam:     "#53CBC9",
  aurora:       "#78D64B",
  sei:          "#9E1F19",
  klaytn:       "#FF6B00",
  metis:        "#00DACC",
  solana:       "#9945FF",
  bitcoin:      "#F7931A",
  tron:         "#FF0013",
  xrp:          "#346AA9",
  sui:          "#6FBCF0",
  litecoin:     "#BFBBBB",
};

// ── Token logo resolution via TrustWallet CDN ────────────────────────────────
// TrustWallet chain names differ from our network IDs in some cases.
const TW_CHAIN: Record<string, string> = {
  ethereum:     "ethereum",
  sepolia:      "ethereum",
  polygon:      "polygon",
  arbitrum:     "arbitrum",
  optimism:     "optimism",
  base:         "base",
  avalanche:    "avalanchec",
  bsc:          "smartchain",
  zksync:       "zksync",
  scroll:       "scroll",
  linea:        "linea",
  mantle:       "mantle",
  blast:        "blast",
  polygonzkevm: "polygonzkevm",
  fantom:       "fantom",
  cronos:       "cronos",
  celo:         "celo",
  gnosis:       "xdai",
  moonbeam:     "moonbeam",
  aurora:       "aurora",
  sei:          "sei",
  klaytn:       "klaytn",
  metis:        "metis",
  solana:       "solana",
  bitcoin:      "bitcoin",
  tron:         "tron",
  xrp:          "ripple",
  sui:          "sui",
  litecoin:     "litecoin",
};

const TW_BASE = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";

export function getTrustWalletChainLogo(chainId: string): string {
  const chain = TW_CHAIN[chainId] || "ethereum";
  return `${TW_BASE}/${chain}/info/logo.png`;
}

export function getTrustWalletTokenLogo(chainId: string, tokenAddress: string): string {
  const chain = TW_CHAIN[chainId] || "ethereum";
  return `${TW_BASE}/${chain}/assets/${tokenAddress}/logo.png`;
}

// Well-known token logos by symbol (TrustWallet Ethereum chain addresses)
const TOKEN_LOGO_BY_SYMBOL: Record<string, string> = {
  ETH:  `${TW_BASE}/ethereum/info/logo.png`,
  BTC:  `${TW_BASE}/bitcoin/info/logo.png`,
  SOL:  `${TW_BASE}/solana/info/logo.png`,
  BNB:  `${TW_BASE}/smartchain/info/logo.png`,
  MATIC:`${TW_BASE}/polygon/info/logo.png`,
  POL:  `${TW_BASE}/polygon/info/logo.png`,
  AVAX: `${TW_BASE}/avalanchec/info/logo.png`,
  FTM:  `${TW_BASE}/fantom/info/logo.png`,
  SUI:  `${TW_BASE}/sui/info/logo.png`,
  TRX:  `${TW_BASE}/tron/info/logo.png`,
  XRP:  `${TW_BASE}/ripple/info/logo.png`,
  LTC:  `${TW_BASE}/litecoin/info/logo.png`,
  USDT: `${TW_BASE}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png`,
  USDC: `${TW_BASE}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png`,
  DAI:  `${TW_BASE}/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png`,
  WBTC: `${TW_BASE}/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png`,
  LINK: `${TW_BASE}/ethereum/assets/0x514910771AF9Ca656af840dff83E8264EcF986CA/logo.png`,
  UNI:  `${TW_BASE}/ethereum/assets/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984/logo.png`,
  AAVE: `${TW_BASE}/ethereum/assets/0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9/logo.png`,
  ARB:  `${TW_BASE}/arbitrum/info/logo.png`,
  OP:   `${TW_BASE}/optimism/info/logo.png`,
  MNT:  `${TW_BASE}/mantle/info/logo.png`,
  SEI:  `${TW_BASE}/sei/info/logo.png`,
  CRO:  `${TW_BASE}/cronos/info/logo.png`,
  CELO: `${TW_BASE}/celo/info/logo.png`,
  GLMR: `${TW_BASE}/moonbeam/info/logo.png`,
  KLAY: `${TW_BASE}/klaytn/info/logo.png`,
  METIS:`${TW_BASE}/metis/info/logo.png`,
};

// ── ChainIcon component ────────────────────────────────────────────────────────
export function ChainIcon({
  chainId,
  logo,
  size = 24,
}: {
  chainId: string;
  logo?: string;
  size?: number;
}) {
  const color = CHAIN_COLORS[chainId] || "#6366f1";
  const letter = chainId.charAt(0).toUpperCase();
  const [errored, setErrored] = useState(false);

  // Prefer TrustWallet CDN over whatever URL is passed in
  const resolvedLogo = logo || getTrustWalletChainLogo(chainId);

  useEffect(() => { setErrored(false); }, [resolvedLogo]);

  return (
    <div
      className="rounded-full flex items-center justify-center font-bold text-white flex-shrink-0 overflow-hidden"
      style={{ width: size, height: size, backgroundColor: color, fontSize: size * 0.42 }}
    >
      {!errored ? (
        <img
          src={resolvedLogo}
          alt={chainId}
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        letter
      )}
    </div>
  );
}

// ── TokenIcon component ───────────────────────────────────────────────────────
export function TokenIcon({
  symbol,
  logo,
  chainId,
  tokenAddress,
  size = 32,
}: {
  symbol: string;
  logo?: string;
  chainId?: string;
  tokenAddress?: string;
  size?: number;
}) {
  const fallback = symbol.slice(0, 2).toUpperCase();
  const [errored, setErrored] = useState(false);
  const [src, setSrc] = useState("");

  useEffect(() => {
    setErrored(false);
    // Resolution priority:
    // 1. Passed-in logo URL
    // 2. TrustWallet by token address + chain
    // 3. Well-known symbol lookup
    if (logo) { setSrc(logo); return; }
    if (chainId && tokenAddress) { setSrc(getTrustWalletTokenLogo(chainId, tokenAddress)); return; }
    const bySymbol = TOKEN_LOGO_BY_SYMBOL[symbol.toUpperCase()];
    if (bySymbol) { setSrc(bySymbol); return; }
    setSrc("");
  }, [logo, symbol, chainId, tokenAddress]);

  return (
    <div
      className="rounded-full flex items-center justify-center font-bold flex-shrink-0 overflow-hidden"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.35,
        background: src && !errored
          ? "transparent"
          : "linear-gradient(135deg, rgba(139,92,246,0.25) 0%, rgba(99,102,241,0.18) 100%)",
        color: "#c4b5fd",
        border: src && !errored ? "none" : "1px solid rgba(139,92,246,0.22)",
      }}
    >
      {src && !errored ? (
        <img
          src={src}
          alt={symbol}
          width={size}
          height={size}
          loading="lazy"
          referrerPolicy="no-referrer"
          className="w-full h-full object-cover"
          onError={() => setErrored(true)}
        />
      ) : (
        fallback
      )}
    </div>
  );
}
