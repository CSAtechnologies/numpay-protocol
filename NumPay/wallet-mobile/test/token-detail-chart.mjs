import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src/screens/TokenDetailScreen.tsx"), "utf8");
let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

check("an empty remote chart is surfaced as a load failure", /p\.length >= 2[\s\S]*?setChartLoadFailed\(true\)/.test(source));
check("chart request failures leave the screen recoverable", /catch \{[\s\S]*?setChartLoadFailed\(true\)/.test(source));
check("failed charts provide an explicit retry", source.includes('label="Retry chart"'));
check("retry triggers a fresh chart effect", /setChartRevision[\s\S]*?\[src, rangeIdx, chartRevision\]/.test(source));
check("range changes do not leave the previous chart on screen", /else \{[\s\S]*?setChartPrices\(\[\]\);[\s\S]*?setChartLoading\(true\)/.test(source));
check("unsupported assets are distinct from failed requests", source.includes("Price history is unavailable for this asset"));

console.log(`token-detail-chart: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
