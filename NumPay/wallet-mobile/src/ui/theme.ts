// NumPay design tokens, extracted from the extension popup's index.css
// (the :root/[data-theme] blocks + component classes). ONE source of visual
// truth for every mobile screen: use these, never ad-hoc hex values, so the
// phone app and the extension read as the same product.
//
// Both themes are defined; `activeTheme` picks the one the app ships with.
// Every screen reads `colors`, so switching themes is this one line and no
// screen edits. It is NOT a live in-app toggle: the 17 StyleSheet.create
// calls run once at module load, so a runtime switch would need all of them
// rebuilt per render. There is no theme toggle in mobile Settings today, so
// that refactor is deliberately not done here.

export type ThemeName = "light" | "dark";

export interface Palette {
  bg: string;
  bg2: string;
  surface1: string;
  surface2: string;
  surface3: string;
  surface4: string;
  card: string;
  card2: string;
  border: string;
  borderLight: string;
  muted: string;
  muted2: string;
  textPrimary: string;
  textSecondary: string;
  brand: string;
  brand2: string;
  brandDark: string;
  brandGlow: string;
  brandTint: string;
  success: string;
  successTint: string;
  danger: string;
  dangerTint: string;
  amber: string;
  amberTint: string;
  coinDisc: string;
  /** Hairline between rows (.token-row / .m-act-row border-bottom). */
  divider: string;
  /** Floating bottom nav fill and hairline (.floating-nav). */
  navBg: string;
  navBorder: string;
  /** Translucent border over a surface, where a flat border would vanish. */
  overlayBorder: string;
  /** Destructive button fill. Carries white label text in both themes. */
  dangerBtn: string;
  /** Ring around a coin disc whose artwork may match the backing. */
  coinRing: string;
  /** Text on top of a brand-gradient fill. White in both themes. */
  onBrand: string;
  /** Full-screen scrim behind a modal or result overlay. */
  scrim: string;
}

const dark: Palette = {
  bg: "#0a0912",
  bg2: "#110f1e",
  surface1: "#110f1e",
  surface2: "#181530",
  surface3: "#201b3d",
  surface4: "#2a2450",
  card: "#181530",
  card2: "#201b3d",
  border: "#2a2450",
  borderLight: "#3a3268",
  muted: "#8a83b8",
  muted2: "#6b6590",
  textPrimary: "#f2f0ff",
  textSecondary: "#a9a3d4",
  brand: "#7c6df0",
  brand2: "#a394ff",
  brandDark: "#5b4cdb",
  brandGlow: "rgba(124, 109, 240, 0.35)",
  brandTint: "rgba(124, 109, 240, 0.15)", // .m-action .ic / pill-brand family
  success: "#34d399",
  successTint: "rgba(52, 211, 153, 0.12)",
  danger: "#f87171",
  dangerTint: "rgba(248, 113, 113, 0.12)",
  amber: "#fbbf24",
  amberTint: "rgba(251, 191, 36, 0.12)",
  coinDisc: "#1b1830", // .coin house disc backing
  divider: "rgba(42, 36, 80, 0.7)",
  navBg: "rgba(17, 15, 30, 0.96)",
  navBorder: "rgba(139, 92, 246, 0.1)",
  overlayBorder: "rgba(255, 255, 255, 0.13)",
  dangerBtn: "#5b1f2b",
  coinRing: "rgba(255, 255, 255, 0.18)",
  onBrand: "#ffffff",
  scrim: "rgba(0, 0, 0, 0.6)",
};

// Values taken from the extension's [data-theme="light"] block and its
// component overrides (.m-number, .token-row, .floating-nav, .glass-card),
// so the two products stay the same product in light too.
const light: Palette = {
  bg: "#faf9ff",
  bg2: "#f4f2ff",
  surface1: "#f4f2ff",
  surface2: "#ebe8ff",
  surface3: "#e0daff",
  surface4: "#d2c9ff",
  card: "#ffffff",
  card2: "#f4f2ff",
  border: "#e3deff",
  borderLight: "#cfc6ff",
  muted: "#6e6a9a",
  muted2: "#8b86b8",
  textPrimary: "#12101e",
  textSecondary: "#4a466e",
  brand: "#7c6df0",
  // Darker than dark-theme's brand2: this is accent TEXT, and #a394ff on a
  // near-white background fails contrast.
  brand2: "#5b4cdb",
  brandDark: "#4a3cc4",
  brandGlow: "rgba(124, 109, 240, 0.25)",
  brandTint: "rgba(124, 109, 240, 0.10)",
  success: "#10b981",
  successTint: "rgba(16, 185, 129, 0.12)",
  danger: "#ef4444",
  dangerTint: "rgba(239, 68, 68, 0.10)",
  amber: "#f59e0b",
  amberTint: "rgba(245, 158, 11, 0.12)",
  coinDisc: "#f4f2ff",
  divider: "rgba(124, 109, 240, 0.12)",
  navBg: "rgba(255, 255, 255, 0.96)",
  navBorder: "rgba(124, 109, 240, 0.14)",
  overlayBorder: "rgba(18, 16, 30, 0.10)",
  // Dark theme's maroon reads as mud on white, so light uses the full danger
  // red. White label text clears contrast on both.
  dangerBtn: "#dc2626",
  coinRing: "rgba(18, 16, 30, 0.10)",
  onBrand: "#ffffff",
  scrim: "rgba(0, 0, 0, 0.45)",
};

export const palettes: Record<ThemeName, Palette> = { light, dark };

/** The theme the app ships with. */
export const activeTheme: ThemeName = "light";

export const colors: Palette = palettes[activeTheme];

// Border radii from the component classes: glass-card 16, buttons/inputs 14,
// m-hero 20, icon-btn 10, pills fully round.
export const radius = {
  card: 16,
  button: 14,
  input: 14,
  hero: 20,
  tile: 12,
  iconBtn: 10,
  pill: 999,
} as const;

// Type scale as used across the popup (px values map 1:1 to RN dp).
export const type = {
  hero: 26, // .m-number
  h1: 22,
  h2: 18,
  body: 14,
  row: 13, // token/activity rows
  sub: 11.5, // .number-sub / .pill
  small: 11,
  label: 10, // .section-label / .nh-label
} as const;

export const spacing = {
  screen: 20,
  cardPad: 18, // .m-hero padding
  gap: 8,
} as const;

// Gradient stops from the extension's premium classes, verbatim:
// .logo-mark / .btn-primary-premium share the brand ramp; .m-number is the
// gradient text ramp; the ambient wash mirrors body::before's radials.
export interface Gradients {
  /** 135deg on the logo mark, 180deg on primary buttons. */
  brand: readonly [string, string, string];
  brandLocations: readonly [number, number, number];
  /** .m-number gradient text. */
  number: readonly [string, string];
  /** body::before ambient radial washes, as SVG stop colour + opacity. */
  ambientA: { color: string; opacity: number };
  ambientB: { color: string; opacity: number };
}

const darkGradients: Gradients = {
  brand: ["#a394ff", "#7c6df0", "#5b4cdb"],
  brandLocations: [0, 0.55, 1],
  number: ["#ffffff", "#b8acff"],
  ambientA: { color: "#7c6df0", opacity: 0.14 },
  ambientB: { color: "#a394ff", opacity: 0.08 },
};

const lightGradients: Gradients = {
  // The brand ramp is a FILL behind white text, so it stays identical: it
  // must keep its contrast in both themes.
  brand: ["#a394ff", "#7c6df0", "#5b4cdb"],
  brandLocations: [0, 0.55, 1],
  // The single most theme-sensitive value in the app. This ramp paints the
  // portfolio total AS TEXT, so dark theme's white->lilac renders invisible
  // on a near-white background. Matches the extension's light .m-number:
  // linear-gradient(180deg, #12101e 0%, #5b4cdb 100%).
  number: ["#12101e", "#5b4cdb"],
  ambientA: { color: "#7c6df0", opacity: 0.10 },
  ambientB: { color: "#a394ff", opacity: 0.06 },
};

export const gradients: Gradients =
  activeTheme === "light" ? lightGradients : darkGradients;
