// Generates the Open Graph / Twitter card image (1200x630) used when the site
// is shared as a link. Committed output, so this only needs rerunning when the
// brand mark or the tagline changes.
//
// Run from site/numpay/:  node build-og-image.js
//
// The card is the brand mark on the brand gradient, with no type in it.
// jimp-compact ships without the bitmap fonts jimp uses for print(), and
// adding a font dependency to typeset one image was not worth it: every
// platform renders og:title and og:description as text beside the image, so
// words baked into the picture would only be duplicated. If a typeset card is
// ever wanted, render it in a headless browser and replace this.
const path = require("path");
const fs = require("fs");

const DEFAULT_SRC = path.resolve(
  __dirname, "../../../NumPay Project/NumPay/wallet-extension/public"
);
const SRC = process.argv[2] || DEFAULT_SRC;
const Jimp = require(path.join(SRC, "../../node_modules/jimp-compact"));

const W = 1200;
const H = 630;

// Matches --brand-grad in site.css.
const A = { r: 0xa3, g: 0x94, b: 0xff };  // #a394ff
const B = { r: 0x7c, g: 0x6d, b: 0xf0 };  // #7c6df0
const C = { r: 0x5b, g: 0x4c, b: 0xdb };  // #5b4cdb

function mix(x, y, t) { return Math.round(x + (y - x) * t); }

// Three-stop ramp with the middle stop at 55%, same as the CSS gradient.
function ramp(t) {
  if (t < 0.55) {
    const u = t / 0.55;
    return { r: mix(A.r, B.r, u), g: mix(A.g, B.g, u), b: mix(A.b, B.b, u) };
  }
  const u = (t - 0.55) / 0.45;
  return { r: mix(B.r, C.r, u), g: mix(B.g, C.g, u), b: mix(B.b, C.b, u) };
}

(async () => {
  const img = new Jimp(W, H, 0x000000ff);

  // 135deg gradient: constant along the anti-diagonal, so use (x + y).
  img.scan(0, 0, W, H, function (x, y, idx) {
    const c = ramp((x + y) / (W + H));
    this.bitmap.data[idx] = c.r;
    this.bitmap.data[idx + 1] = c.g;
    this.bitmap.data[idx + 2] = c.b;
    this.bitmap.data[idx + 3] = 255;
  });

  // Soft vignette so the mark lifts off the flat gradient.
  const cx = W / 2;
  const cy = H / 2;
  const maxD = Math.sqrt(cx * cx + cy * cy);
  img.scan(0, 0, W, H, function (x, y, idx) {
    const d = Math.sqrt((x - cx) * (x - cx) + (y - cy) * (y - cy)) / maxD;
    const k = 1 - 0.28 * d * d;
    this.bitmap.data[idx] = Math.round(this.bitmap.data[idx] * k);
    this.bitmap.data[idx + 1] = Math.round(this.bitmap.data[idx + 1] * k);
    this.bitmap.data[idx + 2] = Math.round(this.bitmap.data[idx + 2] * k);
  });

  const MARK = 280;
  const logo = await Jimp.read(path.join(__dirname, "numpay-logo.png"));
  logo.contain(MARK, MARK);
  img.composite(logo, Math.round((W - MARK) / 2), Math.round((H - MARK) / 2));

  const out = path.join(__dirname, "og-image.png");
  await img.writeAsync(out);
  console.log("wrote " + out + "  " + Math.round(fs.statSync(out).size / 1024) + " KB  " + W + "x" + H);
})().catch((e) => { console.error(e); process.exit(1); });
