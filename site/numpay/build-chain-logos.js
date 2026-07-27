// Prepares the chain/token logos this site uses from the wallet's vendored set.
//
// The wallet ships its logos at full size (Ethereum is 3258x3258, 157 KB) because
// the extension loads them from disk. The site paints them at 24-40 px, so
// shipping the originals would cost ~653 KB for 13 images. This downscales them
// to 80 px (2x the largest placement) and drops the total to ~64 KB.
//
// Run from site/numpay/:
//
//   node build-chain-logos.js [path-to-wallet-extension/public]
//
// The source path defaults to the sibling worktree, because feat/marketing-site
// branches from a commit that predates the logo vendoring: the files are not in
// this worktree at all. Output under chains/ is committed, so this only needs
// rerunning when a logo changes or a chain is added.
//
// jimp-compact is used because it is already installed in the main worktree's
// node_modules (via Expo), so this needs no new dependency. It cannot decode
// WebP, which matters: several of the wallet's "chain-logos/*.png" are actually
// WebP with a .png extension. Browsers sniff content so the wallet renders them
// correctly, but they are copied through here under a truthful .webp extension
// rather than resized. They are only 5-11 KB already.
const path = require("path");
const fs = require("fs");

const DEFAULT_SRC =
  "C:/Users/HP OMEN/Desktop/NumPay Project/NumPay/wallet-extension/public";
const SRC = process.argv[2] || DEFAULT_SRC;
const OUT = path.join(__dirname, "chains");
const SIZE = 80;

const JOBS = [
  ["chain-logos", "ethereum"],
  ["chain-logos", "solana"],
  ["chain-logos", "bitcoin"],
  ["chain-logos", "bsc"],
  ["chain-logos", "polygon"],
  ["chain-logos", "arbitrum"],
  ["chain-logos", "optimism"],
  ["chain-logos", "avalanche"],
  ["chain-logos", "sui"],
  ["chain-logos", "xrp"],
  ["chain-logos", "tron"],
  ["token-logos", "usdc"],
];

function isWebp(file) {
  const head = Buffer.alloc(12);
  const fd = fs.openSync(file, "r");
  fs.readSync(fd, head, 0, 12, 0);
  fs.closeSync(fd);
  return head.slice(0, 4).toString("latin1") === "RIFF" &&
         head.slice(8, 12).toString("latin1") === "WEBP";
}

if (!fs.existsSync(SRC)) {
  console.error("Source not found: " + SRC);
  console.error("Pass the wallet-extension/public path as the first argument.");
  process.exit(1);
}

const Jimp = require(path.join(SRC, "../../node_modules/jimp-compact"));

fs.mkdirSync(OUT, { recursive: true });

(async () => {
  let before = 0;
  let after = 0;
  for (const [dir, name] of JOBS) {
    const from = path.join(SRC, dir, name + ".png");
    const srcBytes = fs.statSync(from).size;
    before += srcBytes;

    let to, note;
    if (isWebp(from)) {
      to = path.join(OUT, name + ".webp");
      fs.copyFileSync(from, to);
      note = "webp, copied";
    } else {
      to = path.join(OUT, name + ".png");
      const img = await Jimp.read(from);
      const w = img.getWidth();
      note = w + "x" + img.getHeight();
      if (w <= SIZE) {
        // Already at or below target. Upscaling would only add bytes and blur.
        fs.copyFileSync(from, to);
        note += " kept";
      } else {
        await img.contain(SIZE, SIZE).quality(90).writeAsync(to);
      }
    }

    const outBytes = fs.statSync(to).size;
    after += outBytes;
    console.log(
      name.padEnd(10), note.padEnd(14),
      String(Math.round(srcBytes / 1024) + " KB").padStart(7), "->",
      String(Math.round(outBytes / 1024) + " KB").padStart(6)
    );
  }

  // Base ships as SVG (the post-2025 Square mark), so it needs no processing.
  fs.copyFileSync(path.join(SRC, "chain-logos", "base.svg"), path.join(OUT, "base.svg"));
  console.log("base.svg   copied as-is");
  console.log("\ntotal " + Math.round(before / 1024) + " KB -> " + Math.round(after / 1024) + " KB");
})().catch((e) => { console.error(e); process.exit(1); });
