// Trims the three Phosphor stylesheets down to only the glyphs this site uses.
// Upstream ships 403 KB of CSS across duotone/bold/fill; the site uses 34 icons.
// Run from site/numpay/. The upstream stylesheets are not vendored, so fetch
// them first:
//
//   for s in duotone bold fill; do
//     curl -sS -o "icons/$s-src.css" \
//       "https://cdn.jsdelivr.net/npm/@phosphor-icons/web@2.1.2/src/$s/style.css"
//   done
//   node build-icons.js
//   rm icons/*-src.css
//
// Selector blocks are extracted by scanning to the matching brace rather than by
// regex, so no escaping is involved.
const fs = require('fs');

function block(src, selector) {
  const i = src.indexOf(selector);
  if (i < 0) return null;
  const open = src.indexOf('{', i);
  if (open < 0) return null;
  const close = src.indexOf('}', open);
  if (close < 0) return null;
  return src.slice(i, close + 1);
}

function collapse(rule) {
  return rule.replace(/\s+/g, ' ').trim();
}

// ---- which icons does the site actually reference? ----
const txt = fs.readFileSync('../index.html', 'utf8') + fs.readFileSync('site.js', 'utf8');
const USED = { duotone: [], bold: [], fill: [] };
const seen = new Set();

function record(style, name) {
  const key = style + ' ' + name;
  if (seen.has(key)) return;
  seen.add(key);
  USED[style].push(name);
}

for (const m of txt.matchAll(/class="([^"]*)"/g)) {
  const cls = m[1].split(/\s+/);
  const style = cls.find((c) => c === 'ph-bold' || c === 'ph-fill' || c === 'ph-duotone');
  if (!style) continue;
  const name = cls.find((c) => c.startsWith('ph-') && c !== style);
  if (name) record(style.slice(3), name);
}

// ---- emit the trimmed stylesheet ----
let out =
  '/* Phosphor Icons 2.1.2, self-hosted and trimmed to the glyphs this site uses.\n' +
  '   Upstream CSS is 403 KB across three files; this is the used subset.\n' +
  '   Regenerate with: node build-icons.js */\n\n';
let kept = 0;

for (const style of ['duotone', 'bold', 'fill']) {
  const src = fs.readFileSync('icons/' + style + '-src.css', 'utf8');
  const family = 'Phosphor-' + style[0].toUpperCase() + style.slice(1);

  // woff2 only, local path
  out +=
    '@font-face {\n  font-family: "' + family + '";\n' +
    '  src: url("' + family + '.woff2") format("woff2");\n' +
    '  font-weight: normal;\n  font-style: normal;\n  font-display: block;\n}\n\n';

  const base = block(src, '.ph-' + style + ' {');
  if (base) out += base.replace(/\n\s*\/\*[\s\S]*?\*\//g, '') + '\n\n';

  for (const icon of USED[style].slice().sort()) {
    for (const pseudo of [':before', ':after']) {
      const rule = block(src, '.ph-' + style + '.' + icon + pseudo + ' {');
      if (rule) {
        out += collapse(rule) + '\n';
        kept++;
      }
    }
  }
  out += '\n';
}

fs.writeFileSync('icons/icons.css', out);
const total = Object.values(USED).reduce((n, a) => n + a.length, 0);
console.log('icons referenced :', total);
console.log('glyph rules kept :', kept);
console.log('icons.css bytes  :', fs.statSync('icons/icons.css').size);
