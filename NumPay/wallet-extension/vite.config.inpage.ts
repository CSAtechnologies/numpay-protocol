import { defineConfig } from "vite";
import { resolve } from "path";

// The injected page-world provider must be a single self-contained classic
// script (no ESM imports), so it is built separately in IIFE lib mode and
// appended to the main dist output (emptyOutDir: false). Output: dist/inpage.js
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/inpage/provider.ts"),
      formats: ["iife"],
      name: "NumPayInpage",
      fileName: () => "inpage.js",
    },
  },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  define: { global: "globalThis" },
});
