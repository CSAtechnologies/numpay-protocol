import { CSSProperties } from "react";

interface Props {
  sym?: string;
  size?: number;
  className?: string;
}

const wrap = (size: number, bg: string, style?: CSSProperties): CSSProperties => ({
  width: size,
  height: size,
  background: bg,
  borderRadius: "50%",
  display: "grid",
  placeItems: "center",
  flexShrink: 0,
  overflow: "hidden",
  ...style,
});

export function TokenIcon({ sym = "", size = 32, className = "" }: Props) {
  const s = sym.toUpperCase();

  // ETH — diamond logo, official lavender pair on a dark navy circle
  if (s === "ETH" || s === "WETH") {
    return (
      <div className={className} style={wrap(size, "#627eea")}>
        <svg viewBox="0 0 32 32" width={size * 0.78} height={size * 0.78}>
          <g fill="none" fillRule="evenodd">
            <polygon fill="#FFF" fillOpacity=".602" points="16.498 4 16.498 12.87 23.995 16.22" />
            <polygon fill="#FFF" points="16.498 4 9 16.22 16.498 12.87" />
            <polygon fill="#FFF" fillOpacity=".602" points="16.498 21.968 16.498 27.995 24 17.616" />
            <polygon fill="#FFF" points="16.498 27.995 16.498 21.967 9 17.616" />
            <polygon fill="#FFF" fillOpacity=".2" points="16.498 20.573 23.995 16.22 16.498 12.872" />
            <polygon fill="#FFF" fillOpacity=".602" points="9 16.22 16.498 20.573 16.498 12.872" />
          </g>
        </svg>
      </div>
    );
  }

  // USDC — official Circle blue with a $ glyph
  if (s === "USDC") {
    return (
      <div className={className} style={wrap(size, "#2775ca")}>
        <svg viewBox="0 0 32 32" width={size * 0.85} height={size * 0.85}>
          <path
            fill="#fff"
            d="M16 22.5c0-.69-.39-1.06-1.5-1.31-2.04-.3-2.86-.96-2.86-2.27 0-1.06.78-1.95 2.13-2.16v-.92c0-.16.13-.28.28-.28h.78c.16 0 .28.13.28.28v.92c1.31.21 2.06.91 2.13 1.95 0 .19-.16.34-.34.34h-.94c-.19 0-.34-.13-.38-.34-.13-.66-.5-.97-1.31-.97s-1.31.41-1.31.97c0 .53.31.84 1.5 1.06 2.13.3 3 .94 3 2.31 0 1.13-.81 1.97-2.25 2.19v.97c0 .16-.13.28-.28.28h-.78c-.16 0-.28-.13-.28-.28v-.97c-1.31-.22-2.13-.94-2.25-2.06 0-.19.13-.34.31-.34h1c.19 0 .34.13.38.34.13.69.59 1.06 1.5 1.06s1.41-.41 1.41-.97zM12.5 25.6c-3.41-1.22-5.16-5.03-3.91-8.41 1.16-2.4 3.16-4.4 5.6-5.06.16-.06.28-.16.28-.34v-.84c0-.13-.06-.22-.16-.28h-.06c-4.16 1.31-6.4 5.75-5.09 9.91.78 2.44 2.69 4.34 5.09 5.09.16.06.31-.06.34-.22.03-.03.03-.06.03-.13v-.84c0-.13-.13-.31-.28-.41zM17.59 11.62c-.16-.06-.31.06-.34.22-.03.03-.03.06-.03.13v.84c0 .19.13.31.28.41 3.41 1.22 5.16 5.03 3.91 8.41-1.16 2.4-3.16 4.4-5.6 5.06-.16.06-.28.16-.28.34v.84c0 .13.06.22.16.28h.06c4.16-1.31 6.4-5.75 5.09-9.91-.78-2.44-2.69-4.34-5.09-5.09z"
          />
        </svg>
      </div>
    );
  }

  // DAI — official MakerDAO yellow with simplified ⟂ glyph
  if (s === "DAI") {
    return (
      <div className={className} style={wrap(size, "#f4b731")}>
        <svg viewBox="0 0 32 32" width={size * 0.85} height={size * 0.85}>
          <path
            fill="#fff"
            d="M9.28 8.5h7.84c4.4 0 7.7 2.32 8.92 5.7H28v1.7H26.4c.05.36.07.72.07 1.1s-.02.74-.07 1.1H28v1.7h-1.96c-1.22 3.38-4.52 5.7-8.92 5.7H9.28v-5.7H7v-1.7h2.28v-2.2H7v-1.7h2.28V8.5zm1.96 12h5.88c2.96 0 5.18-1.4 6.18-3.7H11.24v-1.1h12.62c.05-.36.07-.72.07-1.1s-.02-.74-.07-1.1H11.24v-1.1h12.06c-1-2.3-3.22-3.7-6.18-3.7h-5.88v11.8z"
          />
        </svg>
      </div>
    );
  }

  // BTC / WBTC — bitcoin orange with B glyph
  if (s === "BTC" || s === "WBTC") {
    return (
      <div className={className} style={wrap(size, "#f7931a")}>
        <svg viewBox="0 0 32 32" width={size * 0.85} height={size * 0.85}>
          <path
            fill="#fff"
            d="M22.96 14.34c.32-2.13-1.3-3.28-3.5-4.05l.71-2.86-1.74-.43-.69 2.78c-.46-.11-.93-.22-1.4-.32l.7-2.8L15.3 6.23l-.71 2.86c-.38-.09-.75-.17-1.11-.26v-.01l-2.4-.6-.46 1.86s1.29.3 1.27.31c.7.18.83.65.81 1.02l-.81 3.27c.05.01.11.03.18.06l-.18-.05-1.14 4.58c-.09.21-.3.53-.79.4.01.02-1.27-.32-1.27-.32l-.86 2 2.27.57c.42.11.83.22 1.24.32l-.72 2.9 1.74.43.71-2.86c.48.13.94.25 1.4.36l-.71 2.85 1.74.43.72-2.89c2.97.56 5.21.34 6.15-2.35.76-2.16-.04-3.41-1.6-4.22 1.13-.26 1.99-1 2.22-2.55zm-3.97 5.58c-.54 2.16-4.18.99-5.36.7l.95-3.83c1.18.29 4.97.88 4.41 3.13zm.54-5.61c-.49 1.97-3.52.97-4.5.73l.86-3.47c.98.24 4.15.7 3.64 2.74z"
          />
        </svg>
      </div>
    );
  }

  // SOL — solana purple→green linear with stylised three bars
  if (s === "SOL") {
    return (
      <div className={className} style={wrap(size, "linear-gradient(135deg,#9945ff 0%,#14f195 100%)")}>
        <svg viewBox="0 0 32 32" width={size * 0.78} height={size * 0.78}>
          <g fill="#fff">
            <path d="M9.93 21.6c.18-.18.43-.28.69-.28h13.7c.43 0 .65.52.34.83l-2.7 2.7c-.18.18-.43.28-.69.28H7.57c-.43 0-.65-.52-.34-.83l2.7-2.7z" />
            <path d="M9.93 11.55c.19-.18.44-.28.69-.28h13.7c.43 0 .65.52.34.83l-2.7 2.7c-.18.18-.43.28-.69.28H7.57c-.43 0-.65-.52-.34-.83l2.7-2.7z" />
            <path d="M22.07 16.55c-.18-.18-.43-.28-.69-.28H7.68c-.43 0-.65.52-.34.83l2.7 2.7c.18.18.43.28.69.28h13.7c.43 0 .65-.52.34-.83l-2.7-2.7z" />
          </g>
        </svg>
      </div>
    );
  }

  // ARB — arbitrum blue
  if (s === "ARB") {
    return (
      <div className={className} style={wrap(size, "#28a0f0")}>
        <svg viewBox="0 0 32 32" width={size * 0.85} height={size * 0.85}>
          <path fill="#fff" d="M16 5l-9 16h4l5-9 5 9h4L16 5z" />
        </svg>
      </div>
    );
  }

  // OP — optimism red
  if (s === "OP") {
    return (
      <div className={className} style={wrap(size, "#ff0420")}>
        <svg viewBox="0 0 32 32" width={size * 0.85} height={size * 0.85}>
          <text
            x="16"
            y="22"
            textAnchor="middle"
            fontFamily="ui-sans-serif, system-ui"
            fontSize="14"
            fontWeight="700"
            fill="#fff"
          >
            OP
          </text>
        </svg>
      </div>
    );
  }

  // MATIC / POL — polygon purple
  if (s === "MATIC" || s === "POL") {
    return (
      <div className={className} style={wrap(size, "#8247e5")}>
        <svg viewBox="0 0 32 32" width={size * 0.85} height={size * 0.85}>
          <path
            fill="#fff"
            d="M21.4 12.9c-.4-.2-.9-.2-1.3 0L18.1 14l-1.3.7-2 1.1c-.4.2-.9.2-1.3 0L11.9 15c-.4-.2-.7-.7-.7-1.2v-1.7c0-.5.2-.9.7-1.2l1.6-.9c.4-.2.9-.2 1.3 0l1.6.9c.4.2.7.7.7 1.2v1L18.1 14V13c0-.5-.2-.9-.7-1.2l-3-1.7c-.4-.2-.9-.2-1.3 0l-3 1.7c-.4.2-.7.7-.7 1.2v3.4c0 .5.2.9.7 1.2l3 1.7c.4.2.9.2 1.3 0l2-1.1 1.3-.7 2-1.1c.4-.2.9-.2 1.3 0l1.6.9c.4.2.7.7.7 1.2v1.7c0 .5-.2.9-.7 1.2l-1.6.9c-.4.2-.9.2-1.3 0l-1.6-.9c-.4-.2-.7-.7-.7-1.2v-1l-1.8 1.1v1c0 .5.2.9.7 1.2l3 1.7c.4.2.9.2 1.3 0l3-1.7c.4-.2.7-.7.7-1.2v-3.4c0-.5-.2-.9-.7-1.2l-3-1.7z"
          />
        </svg>
      </div>
    );
  }

  // AVAX — avalanche red
  if (s === "AVAX") {
    return (
      <div className={className} style={wrap(size, "#e84142")}>
        <svg viewBox="0 0 32 32" width={size * 0.85} height={size * 0.85}>
          <path fill="#fff" d="M16 6L7 23h5l4-7 4 7h5L16 6z" />
        </svg>
      </div>
    );
  }

  // BNB — binance amber with B
  if (s === "BNB") {
    return (
      <div className={className} style={wrap(size, "#f3ba2f")}>
        <svg viewBox="0 0 32 32" width={size * 0.85} height={size * 0.85}>
          <path
            fill="#fff"
            d="M12.116 14.404L16 10.52l3.886 3.886 2.26-2.26L16 6l-6.144 6.144 2.26 2.26zM6 16l2.26-2.26L10.52 16l-2.26 2.26L6 16zm6.116 1.596L16 21.48l3.886-3.886 2.26 2.259L16 26l-6.144-6.144-.003-.003 2.263-2.257zM21.48 16l2.26-2.26L26 16l-2.26 2.26L21.48 16zm-3.188-.002h.002V16L16 18.294 13.708 16.002l-.004-.004.004-.003.401-.402.195-.195L16 13.706l2.293 2.293z"
          />
        </svg>
      </div>
    );
  }

  // Generic fallback: gradient circle with first 3 letters of symbol
  return (
    <div
      className={`tok-fallback grid place-items-center rounded-full font-bold text-white ${className}`}
      style={{
        width: size,
        height: size,
        fontSize: size < 26 ? 9 : 11,
        flexShrink: 0,
      }}
    >
      {sym ? sym.slice(0, Math.min(3, sym.length)).toUpperCase() : "?"}
    </div>
  );
}
