import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const plugin = fs.readFileSync(path.join(root, "plugins/withAndroidRelease.js"), "utf8");
let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

check("network trust is generated through the Expo config plugin", plugin.includes("withDebugNetworkTrust"));
check("network trust is scoped to the Android debug source set", /path\.join\(androidRoot, "app", "src", "debug"\)/.test(plugin));
check("debug builds retain normal system roots", plugin.includes('<certificates src="system" />'));
check("debug builds may use workstation-installed roots", plugin.includes('<certificates src="user" />'));
check("the generated manifest references a debug-named config", plugin.includes('@xml/${DEBUG_NETWORK_CONFIG}'));
check("release security intent is documented", plugin.includes("release builds never reference it"));

console.log(`debug-network-trust: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
