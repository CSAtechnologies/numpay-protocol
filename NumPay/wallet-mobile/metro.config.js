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

module.exports = config;
