// NumPay design tokens, extracted from the extension popup's index.css
// (:root/[data-theme="dark"] block + component classes). ONE source of visual
// truth for every mobile screen: use these, never ad-hoc hex values, so the
// phone app and the extension read as the same product. Dark theme only for
// now (the extension defaults dark; light arrives with a theme switch later).

export const colors = {
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
} as const;

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
