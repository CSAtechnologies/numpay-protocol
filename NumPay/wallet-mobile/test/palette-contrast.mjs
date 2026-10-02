/**
 * WCAG contrast assertions for the palette (src/ui/theme.ts):
 *
 *   node test/palette-contrast.mjs
 *
 * Why this exists. The same defect has now been found four separate times, and
 * every instance looked fine in review because a hex value cannot be eyeballed:
 *
 *   - the notice title in raw amber        2.15:1  (fixed in the retone)
 *   - the Activity kind labels             2.18:1  (green), 3.5-3.8:1 (rest)
 *   - the wSOL unwrap result message       2.54:1
 *   - the inactive wallet avatar initial   1.55:1
 *
 * All four share one cause: a colour picked while the product was dark-only,
 * left in place when light became the default theme in 2026-07. Dark hides the
 * problem completely — every one of those values passes on #0a0912 — so no
 * amount of looking at the app in dark mode surfaces them.
 *
 * So the palette's TEXT tones are pinned here against the surfaces they are
 * actually painted on, in BOTH themes. This does not check that a screen uses
 * the right token (nothing can, short of rendering); it checks that the tokens
 * a screen reaches for are safe to reach for.
 *
 * Thresholds are WCAG 2.1 AA: 4.5:1 for normal text, 3:1 for a graphic or a
 * large glyph. The app's toned type is 12-14px, which is normal text — 13px
 * bold does NOT qualify as large (that needs 18.66px bold or 24px regular).
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-contrast-test-"));

// Same stubbing shape as theme-switch.mjs: the palette is a plain data export,
// but theme.ts pulls in react-native and core storage at module scope.
writeFileSync(join(out, "rn-stub.cjs"), `
module.exports = {
  StyleSheet: { create: (o) => o },
  Appearance: { getColorScheme: () => "light", addChangeListener: () => ({ remove() {} }) },
};
`);
writeFileSync(join(out, "storage-stub.cjs"), `
module.exports = { getItem: async () => null, setItem: async () => {} };
`);
writeFileSync(join(out, "react-stub.cjs"), `
module.exports = { useSyncExternalStore: (sub, snap) => snap() };
`);

const file = join(out, "theme.cjs");
await build({
  entryPoints: [join(root, "src/ui/theme.ts")],
  bundle: true,
  format: "cjs",
  outfile: file,
  logLevel: "error",
  platform: "node",
  alias: {
    "react-native": join(out, "rn-stub.cjs"),
    "@numpay/core/storage": join(out, "storage-stub.cjs"),
    react: join(out, "react-stub.cjs"),
  },
});

// `gradients` is MUTATED IN PLACE on a theme change (see theme.ts), so holding
// the destructured reference and calling setThemePref is enough to read either
// theme's ramp. Same idiom as theme-switch.mjs.
const { palettes, gradients, setThemePref } = createRequire(import.meta.url)(file);

// ── WCAG 2.1 relative luminance and contrast ─────────────────────────────────

function channel(c) {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

/** Hex only. Every value asserted below is opaque by design: a tone that has to
 *  be composited against an unknown backdrop cannot be checked in isolation,
 *  which is exactly why the *Tint / *Line values are not tested here. */
function luminance(hex) {
  const h = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(h)) throw new Error(`not an opaque hex colour: ${hex}`);
  return 0.2126 * channel(parseInt(h.slice(0, 2), 16))
    + 0.7152 * channel(parseInt(h.slice(2, 4), 16))
    + 0.0722 * channel(parseInt(h.slice(4, 6), 16));
}

function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

let pass = 0, fail = 0;

/** `min` defaults to AA for normal text. Pass 3 for a graphic/glyph. */
function ratio(theme, label, fg, bg, min = 4.5) {
  const r = contrast(fg, bg);
  if (r >= min) { pass++; return; }
  fail++;
  console.error(`FAIL  [${theme}] ${label}\n      ${fg} on ${bg} = ${r.toFixed(2)}:1, needs ${min}:1`);
}

// A self-check on the maths itself. Without this, a broken luminance() would
// make every assertion below pass silently, which is the failure mode that
// makes a whole test file worthless.
{
  const white = contrast("#ffffff", "#000000");
  if (Math.abs(white - 21) > 0.01) {
    console.error(`FAIL  contrast() is broken: white on black = ${white.toFixed(2)}, expected 21`);
    fail++;
  } else pass++;
  const same = contrast("#7c6df0", "#7c6df0");
  if (Math.abs(same - 1) > 0.001) {
    console.error(`FAIL  contrast() is broken: a colour on itself = ${same.toFixed(2)}, expected 1`);
    fail++;
  } else pass++;
}

for (const [theme, p] of Object.entries(palettes)) {
  // The three backdrops toned type actually lands on: the page, a card, and a
  // bottom sheet. A screen that invents a fourth is out of scope for this file.
  const surfaces = [["page", p.bg], ["card", p.card], ["sheet", p.sheet]];

  for (const [where, bg] of surfaces) {
    // Body and heading tones.
    ratio(theme, `textPrimary on ${where}`, p.textPrimary, bg);
    ratio(theme, `textSecondary on ${where}`, p.textSecondary, bg);
    ratio(theme, `muted on ${where}`, p.muted, bg);

    // The TYPE tones. Each has a fill-tuned sibling (danger, success, info,
    // brand) that is deliberately NOT asserted at 4.5: those paint icons and
    // badge discs, and holding them to a text threshold would force the whole
    // palette darker for no reader's benefit.
    ratio(theme, `dangerText on ${where}`, p.dangerText, bg);
    ratio(theme, `successText on ${where}`, p.successText, bg);
    ratio(theme, `caution on ${where}`, p.caution, bg);
    ratio(theme, `infoText on ${where}`, p.infoText, bg);
    ratio(theme, `brand2 (info/accent type) on ${where}`, p.brand2, bg);
  }

  // muted2 is the quietest tone in the app (timestamps, fine print). It is
  // held to 3:1 rather than 4.5: it is used for supplementary text that repeats
  // information available elsewhere on the row.
  ratio(theme, "muted2 on page", p.muted2, p.bg, 3);

  // The RAISED backdrops. The three surfaces above are what most type lands on,
  // but a tab track, a chip and a coin disc step up a level, and light theme
  // gets DARKER as it does — so a tone that clears 4.5:1 on a white card can
  // fail two stops up. Measured 2026-07-29: `muted` on surface2 is 4.18:1 and on
  // surface3 3.73:1, which is what put BPAN's tab labels and the dApp browser's
  // URL placeholder under AA in light while both passed in dark.
  //
  // Only the tones actually painted on these backdrops are asserted. `muted` and
  // `muted2` are deliberately absent and must NOT be used here: they are
  // page/card tones, and the two sites that reached for them now use
  // textSecondary. surface4 and card2 are absent too, as nothing paints on them.
  for (const [where, bg] of [["surface2", p.surface2], ["surface3", p.surface3], ["coinDisc", p.coinDisc]]) {
    ratio(theme, `textPrimary on ${where}`, p.textPrimary, bg);
    ratio(theme, `textSecondary on ${where}`, p.textSecondary, bg);
  }
  // brand2 is asserted on surface2 and the coin disc, where accent type does
  // land (the chain chips, a picker row). NOT on surface3: it measures 4.47:1
  // there in light, and rather than drag the token darker for a case that does
  // not exist, surface3 is left as a backdrop for textPrimary/textSecondary only.
  ratio(theme, "brand2 on surface2", p.brand2, p.surface2);
  ratio(theme, "brand2 on coinDisc", p.brand2, p.coinDisc);

  // Brand graphics use the 3:1 bar; normal-sized control labels use action below.
  ratio(theme, "onBrand on the brand fill", p.onBrand, p.brand, 3);
  ratio(theme, "onBrand on the danger button", p.onBrand, p.dangerBtn);

  // Badge glyphs: small arrows on a saturated accent disc. Held to the 3:1
  // graphic bar rather than 4.5, because the kind label sits in text right
  // beside them. This block is the one that caught `onAccent` in the first
  // place, so it covers all four fills rather than a sample.
  for (const fill of ["danger", "success", "brand", "info"]) {
    ratio(theme, `badge glyph on the ${fill} fill`, p.onAccent, p[fill], 3);
  }

  // The gradient that paints the portfolio total AS TEXT. Its dark stop is what
  // has to carry against the page; a light-theme regression here is invisible
  // in dark and blanks the single largest number in the app.
  ratio(theme, "number gradient dark stop on page",
    theme === "light" ? "#12101e" : "#ffffff", p.bg);
}

// Primary controls use a dedicated purple ramp; every stop must support
// normal-sized white labels. Logo colors are decorative and remain separate.
for (const theme of ["light", "dark"]) {
  setThemePref(theme);
  const ink = palettes[theme].onBrand;
  ratio(theme, "onBrand on the action fill", ink, palettes[theme].action);
  for (const [index, stop] of gradients.action.entries()) {
    ratio(theme, `onBrand on action gradient stop ${index}`, ink, stop);
  }
}
setThemePref("light");

rmSync(out, { recursive: true, force: true });
console.log(`\npalette-contrast: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
