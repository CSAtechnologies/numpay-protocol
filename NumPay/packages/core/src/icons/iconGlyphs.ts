/**
 * NumPay drawn glyphs — companion to iconData.ts.
 *
 * Ported verbatim from the design handoff (`design_handoff_icons/icon-glyphs.js`).
 * Each entry returns the inner mark markup for the house grid (viewBox 0 0 128 128,
 * disc centred at 64,64 r=60), given a mark colour `m` (and disc colour `d` when a
 * two-tone cut is needed). Flat fills only — no gradients, shadows, or 3D. Marks
 * occupy ~62-68% of the disc. These are the FALLBACK marks; primary art is the
 * streamed brand logo (see Icons.tsx).
 */

export type GlyphFn = (m: string, d?: string) => string;

export const ICON_GLYPHS: Record<string, GlyphFn> = {
  // Ethereum — the classic faceted diamond, flat with opacity tiers
  eth: (m) =>
    '<g fill="' + m + '">' +
    '<path d="M64 19 L36.4 64.8 64 52.3 Z" opacity="0.6"/>' +
    '<path d="M64 19 L91.6 64.8 64 52.3 Z" opacity="0.45"/>' +
    '<path d="M36.4 64.8 L64 86.5 64 52.3 Z" opacity="1"/>' +
    '<path d="M91.6 64.8 L64 86.5 64 52.3 Z" opacity="0.8"/>' +
    '<path d="M36.4 70.1 L64 109 64 86.5 Z" opacity="0.6"/>' +
    '<path d="M91.6 70.1 L64 109 64 86.5 Z" opacity="0.45"/>' +
    "</g>",

  // BNB — centre square + four diamonds (stacked-diamond mark)
  bnb: (m) => {
    const dia = (cx: number, cy: number, h: number) =>
      '<path d="M' + cx + " " + (cy - h) + " L" + (cx + h) + " " + cy +
      " L" + cx + " " + (cy + h) + " L" + (cx - h) + " " + cy + ' Z"/>';
    return '<g fill="' + m + '">' +
      dia(64, 38, 11) + dia(64, 90, 11) + dia(38, 64, 11) + dia(90, 64, 11) +
      dia(64, 64, 15) + "</g>";
  },

  // Solana — three slanted bars
  sol: (m) =>
    '<g fill="' + m + '">' +
    '<path d="M41 42 L96 42 L87 52 L32 52 Z"/>' +
    '<path d="M32 59 L87 59 L96 69 L41 69 Z"/>' +
    '<path d="M41 76 L96 76 L87 86 L32 86 Z"/>' +
    "</g>",

  // XRP — crossing strokes
  xrp: (m) =>
    '<g fill="none" stroke="' + m + '" stroke-width="9" stroke-linecap="round">' +
    '<path d="M37 40 Q64 64 91 40"/>' +
    '<path d="M37 88 Q64 64 91 88"/>' +
    "</g>",

  // Polkadot — six dots ring
  dot: (m) => {
    let s = "";
    for (let i = 0; i < 6; i++) {
      const a = ((-90 + i * 60) * Math.PI) / 180;
      const x = (64 + 26 * Math.cos(a)).toFixed(2);
      const y = (64 + 26 * Math.sin(a)).toFixed(2);
      s += '<circle cx="' + x + '" cy="' + y + '" r="7.5" fill="' + m + '"/>';
    }
    return s;
  },

  // Chainlink — hexagon outline
  link: (m) => {
    const pts: string[] = [];
    for (let i = 0; i < 6; i++) {
      const a = ((-90 + i * 60) * Math.PI) / 180;
      pts.push((64 + 30 * Math.cos(a)).toFixed(2) + "," + (64 + 30 * Math.sin(a)).toFixed(2));
    }
    return '<path d="M' + pts.join(" L") + ' Z" fill="none" stroke="' + m +
      '" stroke-width="8" stroke-linejoin="round"/>';
  },

  // Avalanche — triangle ring (A)
  avax: (m, d) =>
    '<path d="M64 34 L95 90 L33 90 Z" fill="' + m + '"/>' +
    '<path d="M64 54 L82 86 L46 86 Z" fill="' + (d || "#000") + '"/>',

  // Cosmos — atom orbits + nucleus
  atom: (m) => {
    let s = '<circle cx="64" cy="64" r="6.5" fill="' + m + '"/>';
    for (let i = 0; i < 3; i++) {
      s += '<ellipse cx="64" cy="64" rx="30" ry="12" fill="none" stroke="' + m +
        '" stroke-width="3.5" transform="rotate(' + i * 60 + ' 64 64)"/>';
    }
    return s;
  },

  // TON — faceted gem
  ton: (m, d) =>
    '<path d="M42 46 L86 46 L64 92 Z" fill="' + m + '"/>' +
    '<g fill="none" stroke="' + (d || "#000") + '" stroke-width="3.5" stroke-linejoin="round">' +
    '<path d="M64 46 L64 92"/>' +
    '<path d="M42 46 L64 60 L86 46"/>' +
    "</g>",

  // Tether — T with double crossbar
  usdt: (m) =>
    '<g fill="' + m + '">' +
    '<rect x="36" y="40" width="56" height="12" rx="1.5"/>' +
    '<rect x="58" y="40" width="12" height="48" rx="1.5"/>' +
    '<rect x="45" y="59" width="38" height="8" rx="1.5"/>' +
    '<rect x="45" y="71" width="38" height="8" rx="1.5"/>' +
    "</g>",

  // USD Coin — ring + dollar
  usdc: (m) =>
    '<circle cx="64" cy="64" r="30" fill="none" stroke="' + m + '" stroke-width="7"/>' +
    '<text x="64" y="65.5" text-anchor="middle" dominant-baseline="central" ' +
    'font-family="Geist, Arial, sans-serif" font-weight="600" font-size="40" fill="' + m + '">$</text>',

  // DAI — diamond with double bar
  dai: (m, d) =>
    '<path d="M64 32 L94 64 L64 96 L34 64 Z" fill="' + m + '"/>' +
    '<g fill="' + (d || "#000") + '">' +
    '<rect x="46" y="58" width="36" height="5"/>' +
    '<rect x="46" y="67" width="36" height="5"/>' +
    "</g>",
};
