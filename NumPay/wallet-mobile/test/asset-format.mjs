import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, extname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const assets = join(root, "assets");
const PNG_SIGNATURE = "89504e470d0a1a0a";
const invalidFiles = [];
let checked = 0;
let failed = 0;

function walk(dir) {
  for (const entry of readdirSync(dir)) {
    const file = join(dir, entry);
    if (statSync(file).isDirectory()) {
      walk(file);
      continue;
    }
    if (extname(file).toLowerCase() !== ".png") continue;
    checked++;
    const signature = readFileSync(file).subarray(0, 8).toString("hex");
    if (signature !== PNG_SIGNATURE) {
      invalidFiles.push(relative(root, file).replace(/\\/g, "/"));
    }
  }
}

walk(assets);

if (checked < 20) {
  console.error(`FAIL asset scan reached only ${checked} PNG files`);
  failed++;
}
for (const file of invalidFiles) {
  console.error(`FAIL ${file} is not a valid PNG`);
  failed++;
}
console.log(`asset-format: ${checked - invalidFiles.length} passed, ${failed} failed`);
if (failed) process.exit(1);
