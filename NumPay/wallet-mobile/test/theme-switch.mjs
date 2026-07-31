/**
 * Unit tests for the live theme switch (src/ui/theme.ts):
 *
 *   node test/theme-switch.mjs
 *
 * Switching themes at runtime is not a normal feature here: the app resolved
 * every colour at module load, so the whole mechanism is two pieces of
 * indirection that are easy to break silently and impossible to unit-test from
 * the UI. Both pieces are pinned below.
 *
 *   1. The exported token objects (colors, gradients, elevation, press) are
 *      MUTATED IN PLACE. Every screen holds the same reference from import
 *      time, so if a change ever swaps the binding instead, ~540 call sites
 *      keep rendering the old theme with no error anywhere.
 *   2. `themedStyles` hands back a proxy over one cached StyleSheet per theme.
 *      It has to resolve at READ time, keep the sheets separate, and build each
 *      one at most once (the factory runs on the render path).
 *
 * Plus the preference rules that decide what a cold start paints: "system"
 * follows the OS, an explicit choice ignores it, and the saved value survives.
 *
 * react-native and core storage are stubbed: this is the store's logic, not
 * RN's. StyleSheet.create is identity in RN for plain objects, which is exactly
 * what the stub does.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");
const out = mkdtempSync(join(tmpdir(), "numpay-theme-test-"));

// ── Stubs ────────────────────────────────────────────────────────────────────
// State lives on globalThis rather than in a shared module: esbuild inlines
// every module it can reach, so a required helper would become a SECOND copy
// inside the bundle and the test would be driving stubs nobody reads.
const state = {
  scheme: "light",
  stored: null,
  listener: null,
  sheetsBuilt: 0,
};
globalThis.__numpayThemeTest = state;

/** Flip the OS appearance the way the platform would, listener included. */
function setScheme(s) {
  state.scheme = s;
  state.listener?.({ colorScheme: s });
}

writeFileSync(join(out, "rn-stub.cjs"), `
const s = globalThis.__numpayThemeTest;
module.exports = {
  // RN's create() is identity for plain style objects; the counter is what the
  // caching assertions read.
  StyleSheet: { create: (o) => { s.sheetsBuilt++; return o; } },
  Appearance: {
    getColorScheme: () => s.scheme,
    addChangeListener: (fn) => { s.listener = fn; return { remove() {} }; },
  },
};
`);

writeFileSync(join(out, "storage-stub.cjs"), `
const s = globalThis.__numpayThemeTest;
module.exports = {
  getItem: async () => s.stored,
  setItem: async (_k, v) => { s.stored = v; },
};
`);

writeFileSync(join(out, "react-stub.cjs"), `
// The store's only React dependency is useSyncExternalStore, and the hook is
// not what these tests are about.
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

const T = createRequire(import.meta.url)(file);

let pass = 0, fail = 0;
function check(name, cond, detail) {
  if (cond) { pass++; return; }
  fail++;
  console.error(`FAIL  ${name}${detail ? `\n      ${detail}` : ""}`);
}
function is(name, actual, expected) {
  check(name, actual === expected, `expected ${expected}\n      actual   ${actual}`);
}

await T.themeReady;

// ── 1. Tokens are mutated in place, never rebound ────────────────────────────
const colorsRef = T.colors;
const gradientsRef = T.gradients;
const elevationRef = T.elevation;
const pressRef = T.press;

is("starts light", T.getTheme(), "light");
is("light bg", T.colors.bg, T.palettes.light.bg);

T.setThemePref("dark");
is("switches to dark", T.getTheme(), "dark");
is("dark bg", T.colors.bg, T.palettes.dark.bg);
check("colors is the SAME object after the switch", T.colors === colorsRef,
  "the binding moved: every screen still holds the old reference");
check("gradients is the same object", T.gradients === gradientsRef);
check("elevation is the same object", T.elevation === elevationRef);
check("press is the same object", T.press === pressRef);

// The four levels of elevation are theme-tuned, so a switch has to reach them.
check("elevation repaints for dark",
  T.elevation.card.shadowOpacity > 0.05,
  `dark needs a heavier shadow, got ${T.elevation.card.shadowOpacity}`);
check("press repaints for dark", T.press.rowTint.startsWith("rgba(255"),
  `got ${T.press.rowTint}`);
check("gradients repaint for dark", T.gradients.number[0] === "#ffffff",
  `got ${T.gradients.number[0]}`);

T.setThemePref("light");
is("switches back to light", T.colors.bg, T.palettes.light.bg);
is("elevation returns to the light value", T.elevation.card.shadowOpacity, 0.05);

// ── 2. themedStyles resolves at read time, one sheet per theme ───────────────
const before = state.sheetsBuilt;
const st = T.themedStyles((c) => ({ card: { backgroundColor: c.card } }));
is("factory is lazy: nothing built until a style is read", state.sheetsBuilt, before);

is("reads the light sheet", st.card.backgroundColor, T.palettes.light.card);
is("built one sheet", state.sheetsBuilt, before + 1);
st.card; st.card;
is("light sheet is cached, not rebuilt", state.sheetsBuilt, before + 1);

T.setThemePref("dark");
is("same handle now reads the dark sheet", st.card.backgroundColor, T.palettes.dark.card);
is("built the second sheet", state.sheetsBuilt, before + 2);

T.setThemePref("light");
is("back to the light sheet", st.card.backgroundColor, T.palettes.light.card);
is("light sheet came from cache", state.sheetsBuilt, before + 2);

// The factory's second argument is the theme NAME, for the handful of styles
// that key off the theme rather than off a palette value.
const named = T.themedStyles((_c, theme) => ({ x: { opacity: theme === "light" ? 1 : 0.5 } }));
is("factory receives the theme name (light)", named.x.opacity, 1);
T.setThemePref("dark");
is("factory receives the theme name (dark)", named.x.opacity, 0.5);
T.setThemePref("light");

// Proxy invariants: the spread in `[st.a, {...st.b}]` and Object.keys both
// have to work or a style silently becomes {}.
check("spread works through the proxy",
  { ...st.card }.backgroundColor === T.palettes.light.card);
check("Object.keys works through the proxy", Object.keys(st).join(",") === "card",
  `got ${Object.keys(st).join(",")}`);
check("`in` works through the proxy", "card" in st);

// ── 3. Preference resolution ─────────────────────────────────────────────────
setScheme("dark");
T.setThemePref("system");
is("system follows a dark OS", T.getTheme(), "dark");
setScheme("light");
is("system follows the OS changing under it", T.getTheme(), "light");

T.setThemePref("dark");
setScheme("light");
is("an explicit choice ignores the OS", T.getTheme(), "dark");
setScheme("dark");
T.setThemePref("light");
is("...in both directions", T.getTheme(), "light");

is("the choice is persisted", state.stored, "light");
T.setThemePref("system");
is("system is persisted as itself, not as what it resolved to", state.stored, "system");

// ── 4. Subscribers ───────────────────────────────────────────────────────────
// Settle the OS scheme BEFORE subscribing: while the pref is "system" an OS
// flip is itself a notifying event, which is the next assertion's job.
setScheme("light");
T.setThemePref("light");

let notified = 0;
const off = T.subscribeTheme(() => { notified++; });

T.setThemePref("dark");
is("a real switch notifies", notified, 1);
T.setThemePref("dark");
is("re-picking the same preference does not", notified, 1);

// Going dark -> system on a dark phone paints nothing, but Settings still has
// to move its checkmark, so this MUST notify.
setScheme("dark");
is("an OS flip while pinned to dark is ignored", notified, 1);
T.setThemePref("system");
is("a pref-only change still notifies", notified, 2);
is("...and paints nothing", T.getTheme(), "dark");

// Now on "system", the OS is the input again.
setScheme("light");
is("an OS flip on system notifies", notified, 3);
is("...and repaints", T.getTheme(), "light");

off();
T.setThemePref("dark");
is("unsubscribe stops delivery", notified, 3);

rmSync(out, { recursive: true, force: true });
console.log(`\ntheme-switch: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
