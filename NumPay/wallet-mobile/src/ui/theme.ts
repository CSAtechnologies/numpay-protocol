// NumPay design tokens, extracted from the extension popup's index.css
// (the :root/[data-theme] blocks + component classes). ONE source of visual
// truth for every mobile screen: use these, never ad-hoc hex values, so the
// phone app and the extension read as the same product.
//
// Both themes are defined and the switch between them is LIVE (Settings ->
// Theme). Two mechanisms carry that, and a screen has to use the right one:
//
//   1. Values read during render (`colors.brand` on an icon prop, `gradients`)
//      come from the exported `colors` / `gradients` objects, which are
//      MUTATED IN PLACE on a theme change. The binding never moves, so every
//      existing call site keeps working and just picks up new values on the
//      next render.
//   2. Values baked into a StyleSheet cannot be mutated after the fact, so
//      sheets are declared with `themedStyles((colors) => ({ ... }))` instead
//      of `StyleSheet.create({ ... })`. That builds and caches one real sheet
//      PER THEME, lazily, and hands back a proxy that resolves to whichever
//      one is active at the moment a style is read.
//
// The re-render itself comes from `useThemeState()` in App, which subscribes
// to the store below. Nothing else needs to subscribe: no component in the
// tree is memoised, so a root re-render reaches all of them.
import {
  Appearance, StyleSheet,
  type ImageStyle, type TextStyle, type ViewStyle,
} from "react-native";
import { useSyncExternalStore } from "react";
import { getItem, setItem } from "@numpay/core/storage";

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
  /** Filled controls carrying normal-sized white text. */
  action: string;
  brandGlow: string;
  brandTint: string;
  success: string;
  successTint: string;
  danger: string;
  dangerTint: string;
  amber: string;
  amberTint: string;
  /** ── Notice tones ────────────────────────────────────────────────────────
   *  Each tone is a TRIPLE: a text/icon colour, a panel fill and a hairline.
   *  Notices are soft tinted panels now, so a tone needs all three to stay
   *  legible; picking a fill without its matching line is what made the old
   *  amber card look pasted on.
   *
   *  `caution` is deliberately NOT `amber`. Raw #f59e0b next to the lilac
   *  palette read as a browser warning bar, and at 13px bold on white it
   *  cleared only ~2.2:1. This is the same hue pulled down in lightness until
   *  it belongs to the palette and passes AA. `amber` survives for the places
   *  that want a signal DOT or chip rather than a text colour (pending tx). */
  caution: string;
  cautionTint: string;
  cautionLine: string;
  /** Danger/success as TEXT. The base `danger`/`success` are tuned as icon and
   *  accent fills; on a white card they are too light for small bold type, so
   *  titles use these instead. */
  dangerText: string;
  dangerLine: string;
  successText: string;
  successLine: string;
  /** Informational blue. The palette had no blue at all, so the one thing that
   *  needs one (a bridge, as distinct from a swap) reached for a raw #3b82f6
   *  that measured 3.51:1 on the light page. `info` is the fill/badge tone,
   *  `infoText` the type tone, same split as danger/success above. */
  info: string;
  infoText: string;
  /** Brand-toned notice (the neutral "for your information" panel). */
  brandLine: string;
  /** Bottom-sheet fill and its grab handle. */
  sheet: string;
  sheetHandle: string;
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
  /**
   * Ink for a glyph sitting on a SATURATED ACCENT disc (the tx-kind badges),
   * as opposed to on the brand ramp, which `onBrand` covers.
   *
   * These were white, inherited from the extension's dark-only days. Measured
   * against the four accent fills the badges actually use, white is weak nearly
   * everywhere and fails outright on the greens:
   *
   *            light           dark
   *   danger   3.76:1          2.77:1
   *   success  2.54:1          1.92:1   <- a white arrow on a bright green disc
   *   brand    3.96:1          3.96:1
   *   info     5.17:1          3.68:1
   *
   * Dark ink clears 3:1 on all eight, and 4.7:1 on seven of them. A badge is
   * small, so its glyph needs more contrast than a large fill would, not less.
   */
  onAccent: string;
  /** Full-screen scrim behind a modal or result overlay. */
  scrim: string;
}

const dark: Palette = {
  bg: "#0e1015",
  bg2: "#13161d",
  surface1: "#151820",
  surface2: "#1b1f28",
  surface3: "#232832",
  surface4: "#2c323e",
  card: "#171a22",
  card2: "#1d212b",
  border: "#2b303b",
  borderLight: "#3b414e",
  muted: "#a3a8b5",
  muted2: "#858c9a",
  textPrimary: "#f4f5f8",
  textSecondary: "#c7cad2",
  brand: "#8c7cf2",
  action: "#6758dc",
  brand2: "#b2a8ff",
  brandDark: "#5144c0",
  brandGlow: "rgba(103, 88, 220, 0.28)",
  brandTint: "rgba(140, 124, 242, 0.14)",
  success: "#55b893",
  successTint: "rgba(85, 184, 147, 0.12)",
  danger: "#e76f7a",
  dangerTint: "rgba(231, 111, 122, 0.12)",
  amber: "#d99a42",
  amberTint: "rgba(217, 154, 66, 0.12)",
  // Dark theme reverses the problem: the text has to be LIGHTER than the
  // panel, so caution warms up rather than deepens.
  caution: "#e0a957",
  cautionTint: "rgba(224, 169, 87, 0.11)",
  cautionLine: "rgba(224, 169, 87, 0.24)",
  dangerText: "#f18a93",
  dangerLine: "rgba(231, 111, 122, 0.24)",
  successText: "#6dc9a7",
  successLine: "rgba(85, 184, 147, 0.24)",
  info: "#5e91d8",
  infoText: "#80afea",
  brandLine: "rgba(140, 124, 242, 0.25)",
  // A sheet sits ON the scrim, so it steps one surface above the page rather
  // than matching it — that edge is what separates it from the dimmed content.
  sheet: "#171a22",
  sheetHandle: "rgba(255, 255, 255, 0.22)",
  coinDisc: "#20242d",
  divider: "rgba(255, 255, 255, 0.075)",
  navBg: "rgba(23, 26, 34, 0.97)",
  navBorder: "rgba(255, 255, 255, 0.08)",
  overlayBorder: "rgba(255, 255, 255, 0.13)",
  dangerBtn: "#982f3b",
  coinRing: "rgba(255, 255, 255, 0.18)",
  onBrand: "#ffffff",
  // The page itself. Dark theme's accents are LIGHTENED, so the ink that reads
  // on them is the darkest thing in the palette.
  onAccent: "#0e1015",
  scrim: "rgba(0, 0, 0, 0.6)",
};

// Values taken from the extension's [data-theme="light"] block and its
// component overrides (.m-number, .token-row, .floating-nav, .glass-card),
// so the two products stay the same product in light too.
const light: Palette = {
  bg: "#f5f6f8",
  bg2: "#eceef2",
  surface1: "#f0f1f5",
  surface2: "#e9ebf0",
  surface3: "#e1e4ea",
  surface4: "#d5d8e0",
  card: "#ffffff",
  card2: "#f7f8fa",
  border: "#e1e3e9",
  borderLight: "#cdd1d9",
  muted: "#616775",
  muted2: "#7a818f",
  textPrimary: "#15161b",
  textSecondary: "#474d59",
  brand: "#6758dc",
  action: "#5b4cdb",
  // Darker than dark-theme's brand2: this is accent TEXT, and #a394ff on a
  // near-white background fails contrast.
  brand2: "#5b4cdb",
  brandDark: "#493daf",
  brandGlow: "rgba(103, 88, 220, 0.2)",
  brandTint: "rgba(103, 88, 220, 0.09)",
  success: "#16775a",
  successTint: "rgba(22, 119, 90, 0.09)",
  danger: "#bd3541",
  dangerTint: "rgba(189, 53, 65, 0.08)",
  amber: "#95590a",
  amberTint: "rgba(149, 89, 10, 0.08)",
  // Measured, not eyeballed. A notice title is 13px bold, which WCAG does NOT
  // count as large text, so it needs the full 4.5:1 against the surface it
  // actually sits on — the tinted panel, not the white card behind it.
  //   #f59e0b (the old amber): 2.15:1 on white. Worst contrast in the app.
  //   #a1620a: 4.92:1 on white but only 4.25:1 on the panel. Still short.
  //   #95590a: 4.89:1 on the panel, 5.66:1 on white. Passes on both.
  caution: "#87520a",
  cautionTint: "rgba(149, 89, 10, 0.08)",
  cautionLine: "rgba(149, 89, 10, 0.2)",
  // #ef4444 on white is ~3.8:1 — fine for an icon, short of AA for 13px bold.
  dangerText: "#a82531",
  dangerLine: "rgba(189, 53, 65, 0.2)",
  successText: "#0f7155",
  successLine: "rgba(22, 119, 90, 0.2)",
  // #3b82f6 is the badge FILL (it carries a white glyph, not type). As text on
  // the near-white page it measured 3.51:1, so type steps down two stops.
  info: "#356fbf",
  infoText: "#235fae",
  brandLine: "rgba(103, 88, 220, 0.2)",
  // Pure white against the off-white page (#faf9ff), so the sheet edge is
  // legible without a heavy border.
  sheet: "#ffffff",
  sheetHandle: "rgba(18, 16, 30, 0.16)",
  coinDisc: "#f0f1f5",
  divider: "rgba(21, 22, 27, 0.09)",
  navBg: "rgba(255, 255, 255, 0.96)",
  navBorder: "rgba(21, 22, 27, 0.09)",
  overlayBorder: "rgba(18, 16, 30, 0.10)",
  // Dark theme's maroon reads as mud on white, so light uses the full danger
  // red. White label text clears contrast on both.
  dangerBtn: "#b4232f",
  coinRing: "rgba(18, 16, 30, 0.10)",
  onBrand: "#ffffff",
  onAccent: "#15161b",
  scrim: "rgba(0, 0, 0, 0.45)",
};

export const palettes: Record<ThemeName, Palette> = { light, dark };

/**
 * The live palette. Deliberately a MUTABLE copy rather than a reference to
 * `palettes[x]`: a theme change rewrites this object's fields in place so the
 * ~540 existing `colors.foo` reads across the app keep working untouched.
 * Never re-export it as `palettes.light` or the mutation target moves.
 */
export const colors: Palette = { ...light };

// Border radii from the component classes: glass-card 16, buttons/inputs 14,
// m-hero 20, icon-btn 10, pills fully round.
export const radius = {
  card: 16,
  button: 12,
  input: 12,
  hero: 18,
  tile: 12,
  iconBtn: 12,
  pill: 999,
  /** Bottom sheet top corners. Deliberately larger than a card: the generous
   *  curve is most of what makes a sheet read as a sheet and not as a panel
   *  that happens to be stuck to the bottom of the screen. */
  sheet: 28,
} as const;

/** Bottom padding inside a sheet, clearing the gesture bar. The app ships no
 *  safe-area library (see BottomNav, which hardcodes its own offsets), so this
 *  is the one place the inset is defined instead of guessed per sheet. */
export const SHEET_BOTTOM_INSET = 28;

/**
 * Clearance the app leaves for the status bar. Android is edge-to-edge from
 * Expo 54 on, so content draws behind the system bars and something has to put
 * it back; with no safe-area library this is a measured-once guess rather than
 * a real inset.
 *
 * It belongs here because THREE surfaces need the same number and used to each
 * hardcode it: the screen shell, the full-screen dApp approval sheet, and the
 * re-lock overlay. A screen that opts out of the shell's padding (the dApp
 * browser, whose page owns the full width) applies it to its own top chrome.
 */
export const TOP_INSET = 56;

/** Clearance for the gesture/navigation bar, for chrome pinned to the bottom of
 *  a screen that runs flush to the display edge. Same guess as above. */
export const BOTTOM_INSET = 20;

/**
 * Type scale.
 *
 * These started as the popup's px values copied 1:1. That was right for brand
 * consistency and wrong for the device: the extension is a ~360x600 panel the
 * user reads at desk distance, so it packs type tight because it has no room.
 * A phone is held further away, has more room, and is read one-handed in worse
 * light. Shipping the popup's density on it is most of why the app read as
 * cramped and hard.
 *
 * So the scale is now tuned for the phone. Bumps are deliberately modest, one
 * step each: `small` carries 73 call sites and `row` 29, several of them on
 * dense screens (Swap) where a large jump would start wrapping labels that
 * currently fit. This is the conservative pass, not the ceiling. If a screen
 * still reads tight after on-device review, raise it there rather than pushing
 * these numbers until something overflows.
 *
 * `hero`/`h1`/`sub` have no call sites (the portfolio total and the token price
 * pass an explicit size to GradientNumber). They are kept as the named rungs of
 * the scale so a future screen reaches for a token instead of a literal.
 */
export const type = {
  hero: 32, // .m-number
  h1: 24,
  h2: 19,
  body: 15,
  row: 14, // token/activity rows
  sub: 12.5, // .number-sub / .pill
  small: 12,
  label: 10.5, // .section-label / .nh-label
} as const;

export const spacing = {
  screen: 20,
  cardPad: 18, // .m-hero padding
  gap: 8,
  /** Vertical rhythm between stacked rows. A touch row needs more air than the
   *  popup's list gave it, and a consistent value here stops each screen
   *  inventing its own margin. */
  row: 12,
} as const;

/**
 * Motion.
 *
 * One vocabulary for every animation in the app, so screens, sheets and press
 * states agree on how fast the product moves. Durations are short on purpose:
 * the difference between "responsive" and "sluggish" on a wallet is roughly the
 * 200ms mark, and anything the user triggers deliberately (a tap) must resolve
 * inside it.
 *
 * `spring` is the Sheet's hand-tuned curve, promoted here because it is the one
 * piece of motion in the app that already felt physical and everything else
 * should match it.
 */
export const motion = {
  /** Press-state feedback. Must be near-instant or it reads as lag. */
  press: 100,
  /** Screen enter, toast in, anything that carries content. */
  screen: 220,
  /** Screen/overlay exit. Always faster than the enter: leaving should not
   *  cost the user time. */
  exit: 100,
  /** Distance a screen travels on enter. Small: a long slide reads as a
   *  slideshow, a short one reads as depth. */
  slide: 14,
  /** Sheet spring, shared with anything else that should settle rather than
   *  stop. Damped enough not to bounce (a bouncy wallet reads as a toy). */
  spring: { damping: 28, stiffness: 300, mass: 0.9 },
} as const;

/**
 * Elevation.
 *
 * The popup had no depth because a browser panel IS the top layer, so nothing
 * inside it needed to float. On a phone the same flat treatment left every card
 * reading as a rectangle drawn on the page, which is the other half of the
 * "rigid" problem.
 *
 * Shadows are tuned per theme rather than shared. A dark theme hides a black
 * shadow, so it needs opacity to register; a light theme shows it as grey
 * smudge, so it needs far less. The light values follow the extension's own
 * light `.floating-nav` (0.08), which already solved this once.
 */
function makeElevation(isLight: boolean, p: Palette) {
  // A black shadow is nearly invisible on a dark surface, so the dark theme
  // needs several times the opacity to register at all. One multiplier keeps
  // the four levels below in proportion instead of hand-tuning eight numbers.
  const scale = isLight ? 1 : 5;
  return {
    /** Resting card. Barely there: enough to lift off the page, not enough to
     *  read as a popover. */
    card: {
      shadowColor: "#000",
      shadowOpacity: 0.05 * scale,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 3 },
      elevation: 2,
    },
    /** A card the user is pressing, or one that owns the screen's attention. */
    raised: {
      shadowColor: "#000",
      shadowOpacity: 0.08 * scale,
      shadowRadius: 16,
      shadowOffset: { width: 0, height: 6 },
      elevation: 6,
    },
    /** Floating chrome: the bottom nav, a toast. */
    floating: {
      shadowColor: "#000",
      shadowOpacity: 0.1 * scale,
      shadowRadius: 18,
      shadowOffset: { width: 0, height: 8 },
      elevation: 12,
    },
    /** Brand-tinted glow under a primary action, rather than a neutral drop. */
    brand: {
      shadowColor: p.brand,
      shadowOpacity: isLight ? 0.32 : 0.5,
      shadowRadius: 12,
      shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
  };
}

export type Elevation = ReturnType<typeof makeElevation>;

const elevationFor: Record<ThemeName, Elevation> = {
  light: makeElevation(true, light),
  dark: makeElevation(false, dark),
};

/** Live elevation, mutated in place on a theme change like `colors`. Its four
 *  levels are replaced as whole objects, so a style that spreads one picks the
 *  new values up on the next render. */
export const elevation: Elevation = { ...elevationFor.light };

/**
 * Press feedback values, so every tappable surface in the app dims and settles
 * by the same amount. Before this, 61 of 83 Pressables had no pressed style at
 * all: a tap produced nothing until the screen changed, which is the single
 * biggest reason the app felt unresponsive.
 */
function makePress(isLight: boolean) {
  return {
    /** Scale for a button or tile. Subtle: 0.98 reads as a press, 0.94 as a wobble. */
    scale: 0.985,
    /** Overlay wash for a row, which should tint rather than shrink. */
    rowTint: isLight
      ? "rgba(124, 109, 240, 0.07)"
      : "rgba(255, 255, 255, 0.05)",
    /** Android ripple, matched to the row tint. */
    ripple: isLight
      ? "rgba(124, 109, 240, 0.13)"
      : "rgba(255, 255, 255, 0.09)",
    /** Dim for a surface that cannot tint (an image, a gradient fill). */
    opacity: 0.82,
  };
}

export type Press = ReturnType<typeof makePress>;

const pressFor: Record<ThemeName, Press> = {
  light: makePress(true),
  dark: makePress(false),
};

/** Live press feedback, mutated in place on a theme change like `colors`. */
export const press: Press = { ...pressFor.light };

// Gradient stops from the extension's premium classes, verbatim:
// Logo and action fills have separate ramps; .m-number is the
// gradient text ramp; the ambient wash mirrors body::before's radials.
export interface Gradients {
  /** Decorative logo ramp. Use action for white button labels. */
  brand: readonly [string, string, string];
  brandLocations: readonly [number, number, number];
  action: readonly [string, string, string];
  /** .m-number gradient text. */
  number: readonly [string, string];
  /** body::before ambient radial washes, as SVG stop colour + opacity. */
  ambientA: { color: string; opacity: number };
  ambientB: { color: string; opacity: number };
}

const darkGradients: Gradients = {
  brand: ["#a394ff", "#7c6df0", "#5b4cdb"],
  brandLocations: [0, 0.55, 1],
  action: ["#6758dc", "#5b4cdb", "#5143bd"],
  number: ["#f4f5f8", "#b2a8ff"],
  ambientA: { color: "#6758dc", opacity: 0.035 },
  ambientB: { color: "#8c7cf2", opacity: 0.02 },
};

const lightGradients: Gradients = {
  // Decorative identity colors stay consistent across themes.
  brand: ["#a394ff", "#7c6df0", "#5b4cdb"],
  brandLocations: [0, 0.55, 1],
  action: ["#6758dc", "#5b4cdb", "#5143bd"],
  // The single most theme-sensitive value in the app. This ramp paints the
  // portfolio total AS TEXT, so dark theme's white->lilac renders invisible
  // on a near-white background. Matches the extension's light .m-number:
  // linear-gradient(180deg, #12101e 0%, #5b4cdb 100%).
  number: ["#15161b", "#5146b8"],
  ambientA: { color: "#6758dc", opacity: 0.025 },
  ambientB: { color: "#8c7cf2", opacity: 0.015 },
};

const gradientsFor: Record<ThemeName, Gradients> = {
  light: lightGradients,
  dark: darkGradients,
};

/** Live gradients. Mutated in place on a theme change, same as `colors`. */
export const gradients: Gradients = { ...lightGradients };

// ── Theme store ──────────────────────────────────────────────────────────────
// Small hand-rolled store rather than a context, because the values above are
// read from module scope (StyleSheet factories, plain helpers) as well as from
// components, and a context cannot reach the first kind.

/** What the user picked. "system" tracks the OS appearance as it changes. */
export type ThemePref = ThemeName | "system";

/** Same storage key the extension uses for its own light/dark choice. The two
 *  stores are separate (MMKV here, localStorage there), so the extra "system"
 *  value cannot leak into a build that does not understand it. */
const THEME_KEY = "numpay_theme";

/** Follow the phone out of the box. Requires `userInterfaceStyle: "automatic"`
 *  in app.json, otherwise Expo pins the OS scheme to light and this resolves to
 *  light forever. */
export const DEFAULT_THEME_PREF: ThemePref = "system";

let pref: ThemePref = DEFAULT_THEME_PREF;
let active: ThemeName = "light";

function resolvePref(p: ThemePref): ThemeName {
  if (p !== "system") return p;
  return Appearance.getColorScheme() === "dark" ? "dark" : "light";
}

const listeners = new Set<() => void>();

/** Copy of the set, so a listener that unsubscribes mid-notify cannot skip the
 *  next one in iteration order. */
function emit(): void {
  for (const fn of [...listeners]) fn();
}

/** Repaint the live token objects. Returns whether anything actually changed,
 *  so a no-op switch (dark -> system on a dark phone) skips the re-render. */
function applyTheme(next: ThemeName): boolean {
  if (next === active) return false;
  active = next;
  // Every live token object gets repainted here. Anything theme-dependent added
  // above must be added to this list too, or it silently keeps light values.
  Object.assign(colors, palettes[next]);
  Object.assign(gradients, gradientsFor[next]);
  Object.assign(elevation, elevationFor[next]);
  Object.assign(press, pressFor[next]);
  return true;
}

/** The theme currently painted. Use this, not the old `activeTheme` const, for
 *  anything read at RENDER time (a StyleSheet factory gets it as an argument). */
export function getTheme(): ThemeName {
  return active;
}

export function getThemePref(): ThemePref {
  return pref;
}

export function setThemePref(next: ThemePref): void {
  const prefChanged = next !== pref;
  pref = next;
  const painted = applyTheme(resolvePref(next));
  void setItem(THEME_KEY, next).catch(() => {});
  // Emit on a pref-only change too: Settings has to move its checkmark even
  // when the resolved theme is unchanged.
  if (prefChanged || painted) emit();
}

export function subscribeTheme(fn: () => void): () => void {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

// The OS flipped to night mode. Only relevant while the user is on "system".
Appearance.addChangeListener(() => {
  if (pref !== "system") return;
  if (applyTheme(resolvePref(pref))) emit();
});

/**
 * Resolves once the saved preference has been read and applied. App awaits this
 * before hiding the splash, so a dark-theme user never sees a light first paint.
 *
 * Kicked off at module load, which is safe because index.ts evaluates
 * platform/init (the MMKV backend) before it ever reaches App.
 */
export const themeReady: Promise<void> = (async () => {
  let saved: string | null = null;
  try {
    saved = await getItem(THEME_KEY);
  } catch { /* storage unavailable: keep the default */ }
  if (saved === "light" || saved === "dark" || saved === "system") pref = saved;
  if (applyTheme(resolvePref(pref))) emit();
})();

/** Snapshot for useSyncExternalStore. Encodes BOTH values so a pref-only change
 *  still counts as a change; a string compares by value, so no memo needed. */
function snapshot(): string {
  return `${pref}|${active}`;
}

export interface ThemeState {
  /** What the user picked, including "system". */
  pref: ThemePref;
  /** What that resolves to right now. */
  theme: ThemeName;
  setPref: (p: ThemePref) => void;
}

export function useThemeState(): ThemeState {
  const snap = useSyncExternalStore(subscribeTheme, snapshot, snapshot);
  const [p, t] = snap.split("|") as [ThemePref, ThemeName];
  return { pref: p, theme: t, setPref: setThemePref };
}

// ── Themed stylesheets ───────────────────────────────────────────────────────

// Mirrors react-native's own (unexported) StyleSheet.NamedStyles, so the
// constraint below behaves exactly like StyleSheet.create's.
type NamedStyles<T> = { [P in keyof T]: ViewStyle | TextStyle | ImageStyle };
/** Stand-in for the `any` in RN's constraint: an index signature over styles. */
interface AnyStyles { [name: string]: ViewStyle | TextStyle | ImageStyle }

/**
 * Drop-in replacement for `StyleSheet.create` that is theme-aware.
 *
 *   const st = themedStyles((colors) => ({ card: { backgroundColor: colors.card } }));
 *
 * The factory runs at most once per theme and its result goes through the real
 * `StyleSheet.create`, so the registered-sheet behaviour is unchanged. What
 * comes back is a proxy: reading `st.card` resolves against whichever theme is
 * active at that instant, which is render time.
 *
 * The factory's first parameter deliberately shadows the imported `colors`, so
 * an existing sheet body needs no edits beyond its first and last line.
 */
export function themedStyles<T extends NamedStyles<T> | NamedStyles<AnyStyles>>(
  // Plain `T`, not `T & NamedStyles<...>`: an intersection here is an inference
  // dead end (T collapses to unknown and every `st.foo` stops type-checking).
  // The intersection RN's own create() wants is applied at the call below.
  factory: (colors: Palette, theme: ThemeName) => T,
): T {
  const cache = {} as Record<ThemeName, T>;
  const sheet = (): T =>
    (cache[active] ??= StyleSheet.create(
      factory(palettes[active], active) as T & NamedStyles<AnyStyles>,
    ));
  return new Proxy({} as T, {
    get: (_t, key) => sheet()[key as keyof T],
    has: (_t, key) => key in (sheet() as object),
    ownKeys: () => Reflect.ownKeys(sheet() as object),
    getOwnPropertyDescriptor: (_t, key) => {
      const d = Object.getOwnPropertyDescriptor(sheet() as object, key);
      // Proxy invariant: a descriptor may only be reported for a key the TARGET
      // has, unless it is configurable. The target is always `{}`, so it never
      // does. Without this, `{...st}` throws.
      return d && { ...d, configurable: true };
    },
  }) as T;
}
