// The read-proxy moved to @numpay/core/dapp so the mobile in-app browser
// proxies dApp reads through the same allowlist and the same configured RPCs.
// Re-exported here so existing importers are unaffected.
export {
  dappEvmChainId,
  evmChainIdHex,
  evmChainIdNumber,
  isReadMethod,
  proxyRead,
} from "@numpay/core/dapp";
