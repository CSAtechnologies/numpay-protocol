/**
 * Call-site check: a fill-tuned palette token must not paint TEXT.
 *
 *   node test/token-usage.mjs
 *
 * Why this is a separate file from palette-contrast.mjs. That one asserts the
 * palette's tones are safe against the surfaces they land on, and it deliberately
 * does NOT hold `danger`/`success`/`info`/`brand`/`amber` to the 4.5:1 text bar,
 * because those paint icons and badge discs. Holding a fill to a text threshold
 * would drag the whole palette darker for no reader's benefit.
 *
 * That leaves a gap it cannot see: a screen reaching for the FILL token when it
 * meant the TEXT one. The palette is innocent, the call site is wrong, and no
 * amount of asserting hex values catches it. On 2026-07-29 a sweep found 17 such
 * sites, every one of them passing in dark and failing AA in light:
 *
 *   success #10b981 on a white card   2.54:1   (needs 4.5)
 *   success #10b981 on the page       2.42:1
 *   danger  #ef4444 on the page       3.59:1
 *   danger  #ef4444 on a white card   3.76:1
 *
 * Switching each to `successText` / `dangerText` put them all in the 5.2-5.7:1
 * range. In dark the two tokens hold IDENTICAL values, so the whole class is
 * invisible there. This is the sixth time a colour picked in the dark-only era
 * has failed once light became the default theme, hence a gate rather than a
 * sixth fix.
 *
 * The rule keys on punctuation, which is what separates the two jobs in RN:
 *
 *   color: colors.success      a style object property  -> TEXT, flagged
 *   color={colors.success}     a JSX prop on an icon    -> GRAPHIC, allowed
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

/** Tuned as fills. Each has a *Text sibling, except `amber`, whose type tone is
 *  `caution` (a different hue by design: see the Palette doc comment). */
const FILL_TOKENS = ["danger", "success", "info", "brand", "amber"];

/** The type tone to reach for instead, for the failure message. */
const TEXT_SIBLING = {
  danger: "dangerText",
  success: "successText",
  info: "infoText",
  brand: "brand2",
  amber: "caution",
};

// `color:` with a colon is a style property. `color=` is a JSX prop, which on
// this codebase is always an icon or an ActivityIndicator, and those are graphics
// held to 3:1 rather than text. `brand2`/`dangerText` etc must not match, hence
// the trailing word boundary and the negative lookahead on a capital letter.
const RULE = new RegExp(
  String.raw`\bcolor:\s*colors\.(${FILL_TOKENS.join("|")})\b(?![A-Z])`,
);

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const p = join(dir, entry);
    if (statSync(p).isDirectory()) out.push(...walk(p));
    else if (/\.tsx?$/.test(p) && !p.endsWith(".generated.ts")) out.push(p);
  }
  return out;
}

const files = [...walk(join(root, "src")), join(root, "App.tsx")];

let pass = 0, fail = 0;
const hits = [];

// The other way this gate could pass while checking nothing: a walk that returns
// an empty (or tiny) list after a directory move. The app has ~30 source files,
// so anything under 20 means the sweep is not reaching them.
if (files.length >= 20) pass++;
else {
  console.error(`FAIL  the walk found only ${files.length} source files; expected 20+`);
  fail++;
}

for (const file of files) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, i) => {
    // theme.ts defines the palette itself, so `caution: "#95590a"` style lines
    // and the doc comments naming these tokens are not call sites.
    if (file.endsWith(join("ui", "theme.ts"))) return;
    const m = RULE.exec(line);
    if (!m) return;
    hits.push(
      `  ${relative(root, file).replace(/\\/g, "/")}:${i + 1}\n` +
      `      color: colors.${m[1]} paints text; use colors.${TEXT_SIBLING[m[1]]}\n` +
      `      ${line.trim().slice(0, 100)}`,
    );
  });
}

if (hits.length) {
  console.error(`FAIL  fill-tuned token used as a text colour:\n${hits.join("\n")}`);
  fail += hits.length;
} else pass++;

// A control on the rule itself. Without it, a regex that matched nothing would
// make the check above pass silently, which is the failure mode that makes a
// whole gate worthless. Four cases: the two that must be caught, and the two
// that must not.
{
  const cases = [
    ["  bad: { color: colors.success, fontSize: 12 },", true],
    ["<Text style={[st.x, { color: colors.danger }]}>hi</Text>", true],
    ["<CheckIcon size={12} color={colors.success} />", false],
    ["  ok: { color: colors.successText, fontSize: 12 },", false],
  ];
  for (const [line, shouldMatch] of cases) {
    if (RULE.test(line) === shouldMatch) pass++;
    else {
      console.error(
        `FAIL  the rule itself is wrong: ${shouldMatch ? "missed" : "false-positive on"} ${line.trim()}`,
      );
      fail++;
    }
  }
}

console.log(`\ntoken-usage: ${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
