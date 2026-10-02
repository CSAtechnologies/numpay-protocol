// Render the real BPAN ownership states. RPC effects never run during SSR.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Module, createRequire } from "node:module";
import { build } from "esbuild";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const here = dirname(fileURLToPath(import.meta.url));
const source = resolve(here, "../src/popup/pages/BPANPage.tsx");
async function loadPage(deployed) {
const result = await build({
  entryPoints: [source], bundle: true, platform: "node", format: "cjs",
  write: false, jsx: "automatic", external: ["react", "react/jsx-runtime"],
  define: { "import.meta.env.DEV": "false" },
  plugins: [{ name: "ui-fixture", setup(b) {
    b.onLoad({ filter: /bpanDeployment\.ts$/ }, args => ({
      contents: readFileSync(args.path, "utf8").replace(
        /export const BPAN_DEPLOYMENT = createBPANDeployment\([\s\S]*?\n\);/,
        deployed ? 'export const BPAN_DEPLOYMENT = createBPANDeployment("0x1111111111111111111111111111111111111111", 100);'
          : 'export const BPAN_DEPLOYMENT = createBPANDeployment(null, 0);'
      ), loader: "ts", resolveDir: dirname(args.path),
    }));
    b.onLoad({ filter: /BPANPage\.tsx$/ }, () => ({
      contents: readFileSync(source, "utf8") + "\nexport { MyBPANSection };",
      loader: "tsx", resolveDir: dirname(source),
    }));
    b.onResolve({ filter: /\/hooks\/useWallet$|\/components\/Layout$/ }, (args) => ({ path: args.path, namespace: "fixture" }));
    b.onLoad({ filter: /.*/, namespace: "fixture" }, (args) => ({
      contents: args.path.endsWith("Layout")
        ? "export default function Layout({children}) { return children; }"
        : 'export function useWallet() { return {wallet:{address:"0x1111111111111111111111111111111111111111"},network:{id:"ethereum"},switchNetwork(){}}; }',
      loader: "js",
    }));
  } }],
});
const mod = new Module(resolve(here, "bpan-ui-fixture.cjs"));
mod.filename = resolve(here, "bpan-ui-fixture.cjs");
mod.paths = Module._nodeModulePaths(here);
mod.require = createRequire(import.meta.url);
mod._compile(result.outputFiles[0].text, mod.filename);
return mod.exports;
}
const { default: Page, MyBPANSection } = await loadPage(false);
const props = { wallet: { address: "0x1111111111111111111111111111111111111111" },
  ownedBPANs: [], loading: false, error: false, onRetry() {}, onRemove() {}, onGoRegister() {}, onGoMapping() {} };
const render = (overrides) => renderToStaticMarkup(React.createElement(MyBPANSection, { ...props, ...overrides }));

const loading = render({ loading: true });
assert.match(loading, /role="status"/);
assert.match(loading, /aria-hidden="true"/);
assert.doesNotMatch(loading, /No BPANs yet|Register BPAN/);
const failed = render({ error: true });
assert.match(failed, /role="alert"/);
assert.match(failed, />Retry</);
assert.doesNotMatch(failed, /No BPANs yet|Register BPAN/);
assert.match(render({}), /No BPANs yet/);
const cached = render({ ownedBPANs: ["12345678901"], error: true });
assert.match(cached, /Showing saved numbers/);
assert.match(cached, /aria-label="Copy BPAN /);
assert.match(cached, /aria-expanded="false"/);
const refreshing = render({ ownedBPANs: ["12345678901"], loading: true });
assert.match(refreshing, /Refreshing your BPANs/);
assert.match(refreshing, /aria-label="Copy BPAN /);
const page = renderToStaticMarkup(React.createElement(Page));
assert.match(page, /Coming to Base/);
assert.match(page, /BPAN on Base is not available yet/);
assert.doesNotMatch(page, /role="tab"|Register BPAN|No BPANs yet/);
const { default: ActivePage } = await loadPage(true);
const activePage = renderToStaticMarkup(React.createElement(ActivePage));
assert.equal((activePage.match(/role="tab"/g) ?? []).length, 4);
assert.equal((activePage.match(/aria-selected="true"/g) ?? []).length, 1);
assert.match(activePage, /Base mainnet/);
assert.doesNotMatch(activePage, /Coming to Base/);
console.log("BPAN UI: loading, failure/retry, empty, cached refresh, labels, active and undeployed Base states passed");
