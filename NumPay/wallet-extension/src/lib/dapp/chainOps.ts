// Chain-management helpers for wallet_switchEthereumChain /
// wallet_addEthereumChain moved to @numpay/core/dapp so the mobile in-app
// browser reuses the same guardrails verbatim: https-only RPCs, built-in chains
// cannot be redefined, and rpcServesChain() confirms an endpoint actually
// serves the chain id it claims. Re-exported here so existing importers are
// unaffected.
export {
  type AddChainCandidate,
  parseChainId,
  resolveInternalChainId,
  validateHttpsRpc,
  rpcServesChain,
  buildAddChainCandidate,
} from "@numpay/core/dapp";
