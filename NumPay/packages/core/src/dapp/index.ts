// @numpay/core/dapp — platform-free decoding + risk assessment of dApp signing
// requests (the "what am I signing" preview). Extracted from the extension's
// lib/dapp so the mobile WalletConnect signing sheet renders the identical
// preview and safety flags. No transport, no keys, no network — pure decode.
export type { DappTxRequest } from "./types";
export {
  type DecodedTxData,
  decodeTxData, formatNativeValue, normalizeTxForEthers,
} from "./txDecode";
export {
  type DecodedPersonalSign, type TypedDataDomain, type ParsedTypedData,
  type TypedDataError, type RiskFlag,
  decodePersonalSignMessage, parseTypedData, typesForEthers, assessTypedDataRisk,
} from "./signDecode";
export {
  type DecodedSolMessage,
  bytesToBase64, base64ToBytes, decodeSolSignMessage,
} from "./solDecode";
export {
  type EvmSignMethod, type DappRequestInput, type DappRequestPreview,
  type PreviewDetail,
  MAX_PAYLOAD_BYTES, SUPPORTED_EVM_METHODS, DAPP_ERR,
  isSupportedEvmMethod, previewDappRequest, signDappRequest,
} from "./signEngine";
// ── Transport layer (injected EIP-1193 provider) ─────────────────────────────
// Shared by the extension (content script -> background port) and the mobile
// in-app browser (WebView bridge -> RN router), so ONE provider implementation
// and ONE permission model serve both clients.
export {
  type RpcRequest, type RpcError, type RequestMessage, type ResponseMessage,
  type EventMessage, type ProviderEventName,
  TO_CONTENT, TO_INPAGE, RPC_ERR,
  READ_METHODS, SIGN_METHODS, DEFERRED_METHODS,
} from "./rpcTypes";
export {
  type OriginPermission,
  getPermission, isConnected, grant, revoke, listOrigins,
  updateAllConnected, setOriginChain,
} from "./permissions";
export {
  dappEvmChainId, evmChainIdHex, evmChainIdNumber, isReadMethod, proxyRead,
} from "./rpcProxy";
export {
  type AddChainCandidate,
  parseChainId, resolveInternalChainId, validateHttpsRpc, rpcServesChain,
  buildAddChainCandidate,
} from "./chainOps";
export {
  type SolWcMethod, type SolDappRequestInput, type SolDappRequestPreview,
  type SolPreviewDetail,
  SOL_MAINNET_CAIP2, SOL_MAINNET_CAIP2_LEGACY, SOL_MAINNET_CHAIN_IDS,
  SUPPORTED_SOL_METHODS, MAX_BATCH_TXS,
  isSolanaMainnetCaip2, isSupportedSolMethod,
  previewSolanaDappRequest, signSolanaDappRequest,
} from "./solEngine";
