// Platform-free dApp-request types shared by the decoders. Kept dependency-free
// (no ethers/chrome/RN) so any client — the browser extension's approval window
// or the mobile WalletConnect signing sheet — decodes a request the same way.
//
// The extension's transport constants and chrome.storage approval records stay
// in wallet-extension/src/lib/dapp/types.ts; only the request SHAPES a decoder
// needs live here.

// EIP-1193 transaction object as dApps send it (hex quantities, optional fields).
export interface DappTxRequest {
  from?: string;
  to?: string;
  value?: string;
  data?: string;
  gas?: string;
  gasPrice?: string;
  maxFeePerGas?: string;
  maxPriorityFeePerGas?: string;
  nonce?: string;
}
