import { defineConfig } from "vite";
import { resolve } from "path";

// The content bridge is a classic content script (no ESM imports), built
// separately in IIFE lib mode and appended to dist (emptyOutDir: false).
// Output: dist/content.js
export default defineConfig({
  build: {
    outDir: "dist",
    emptyOutDir: false,
    lib: {
      entry: resolve(__dirname, "src/content/bridge.ts"),
      formats: ["iife"],
      name: "NumPayContent",
      fileName: () => "content.js",
    },
  },
  resolve: { alias: { "@": resolve(__dirname, "src") } },
  define: { global: "globalThis" },
});
