import { defineConfig } from "vite";
import { resolve } from "path";

// EVM-only build of the page-world provider, for the NumPay MOBILE in-app
// browser (see src/inpage/evm.ts for why Solana is excluded there). The
// extension keeps injecting the full dist/inpage.js; nothing here changes it.
//
// The mobile app cannot run a bundler at runtime, so wallet-mobile's
// scripts/gen-injected.mjs turns this output into a committed TS string
// constant that Metro can bundle. Output: dist/inpage-evm.js
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/inpage/evm.ts"),
      formats: ["iife"],
      name: "NumPayInpageEvm",
      fileName: () => "inpage-evm.js",
    },
  },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  define: { global: "globalThis" },
});
