import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

const app = read("App.tsx");
const nav = read("src/ui/BottomNav.tsx");
const components = read("src/ui/components.tsx");
const sheet = read("src/ui/Sheet.tsx");
const pinPad = read("src/ui/PinPad.tsx");
const autoTokens = read("../packages/core/src/autoTokens.ts");
const balanceSweep = read("../packages/core/src/balanceSweep.ts");
const bpan = read("../packages/core/src/bpan.ts");
const mobileWallet = read("src/wallet/useMobileWallet.ts");

check("route transition avoids a fade-through-blank", app.includes("outputRange: [0.94, 1]"));
check("route transition starts before paint", app.includes("useLayoutEffect(() =>"));
check("route transition has directional travel", app.includes("direction.current = orderOf(mode)"));
check("tab indicator uses a measured transform", nav.includes("Animated.multiply(slide, slotWidth)"));
check("tab indicator runs on the native driver", /Animated\.spring\(slide,[\s\S]*?useNativeDriver: true/.test(nav));
check("tab indicator keeps one native animation graph", nav.includes("const indicatorTranslateX = useMemo"));
check("hidden navigation leaves the accessibility tree", nav.includes('importantForAccessibility={visible ? "auto" : "no-hide-descendants"}'));
check("lockout clock only ticks while a countdown is active", app.includes("if (!lockoutActive) return;"));
check("shared press feedback follows reduced motion", components.includes("const reduceMotion = useReducedMotion()"));
check("live gradient values animate", components.includes("shownRef.current = text"));
check("sheets use the shared motion spring", sheet.includes("...motion.spring"));
check("sheet actions use shared touch feedback", sheet.includes('<Tappable\n        onPress={onConfirm}'));
check("rapid PIN taps use an authoritative ref", pinPad.includes("pinRef.current + digit"));
check("token sweep providers use a static network", /JsonRpcProvider\(rpc, chainId, \{ staticNetwork: true \}\)/.test(autoTokens));
check("token sweep providers are disposed", /RPC sweep[\s\S]*?finally \{[\s\S]*?provider\.destroy\?\.\(\)/.test(autoTokens));
check("native balance providers are disposed", /sweepEvmNativeBalances[\s\S]*?finally \{[\s\S]*?provider\.destroy\?\.\(\)/.test(balanceSweep));
check("cached BPAN providers use a static network", !/JsonRpcProvider\([^\n]*BPAN_DEPLOYMENT\.chainId\);/.test(bpan));
check("custom-token providers are disposed", /fetchCustomEvmTokenBalances[\s\S]*?finally \{ provider\.destroy\?\.\(\); \}/.test(mobileWallet));

const interactionScreens = [
  "src/screens/BrowserScreen.tsx",
  "src/screens/DeFiScreen.tsx",
  "src/screens/ManageAssetsScreen.tsx",
  "src/screens/ReceiveScreen.tsx",
  "src/screens/SettingsScreen.tsx",
  "src/screens/TokenDetailScreen.tsx",
];
for (const file of interactionScreens) {
  check(`${file} uses no ad-hoc Pressable`, !read(file).includes("<Pressable"));
}

console.log(`motion-system: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
