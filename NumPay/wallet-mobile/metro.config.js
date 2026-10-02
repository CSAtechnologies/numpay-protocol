// Monorepo Metro config: watch the workspace root so @numpay/core (TS source)
// and shared test fixtures (wallet-extension/test/address-vectors.json)
// resolve, and let module resolution fall back to the hoisted root
// node_modules.
const { getDefaultConfig } = require("expo/metro-config");
const path = require("path");

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, "..");

const config = getDefaultConfig(projectRoot);
config.watchFolders = [workspaceRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, "node_modules"),
  path.resolve(workspaceRoot, "node_modules"),
];

// The wallet shell imports every shipped surface, including WalletConnect,
// WebView, charts and chain SDKs. Evaluating that entire graph before React can
// paint the PIN screen makes a debug cold launch look frozen and also wastes
// release-startup CPU. Keep the bundle deterministic, but defer each module's
// evaluation until the screen that uses it is actually reached.
config.transformer.getTransformOptions = async () => ({
  transform: {
    experimentalImportSupport: true,
    inlineRequires: true,
  },
});

module.exports = config;
