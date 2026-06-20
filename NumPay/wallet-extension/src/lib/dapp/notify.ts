import { MSG_DAPP_STATE_CHANGED } from "./types";

// Tell the background router that the exposed account or EVM chain changed, so
// it can emit accountsChanged / chainChanged to connected dApps. Best-effort and
// safe to call outside an extension context.
//
// `solAddress` signals a WALLET change (vs. an EVM-chain-only change) so the
// router can thread the Solana accountChanged event too. The router is key-free
// and cannot derive a Solana address itself, so the caller (the popup, which
// holds the unlocked mnemonic) derives the new public address and passes it:
//   - undefined → chain-only change; leave Solana connections untouched.
//   - non-empty → the new active wallet's base58 Solana address.
//   - "" (empty) → wallet changed but the new wallet has no Solana account;
//     the router drops the Solana connections rather than expose a stale one.
export function notifyDappState(solAddress?: string): void {
  try {
    chrome?.runtime?.sendMessage?.({ type: MSG_DAPP_STATE_CHANGED, solAddress });
  } catch {
    /* not in an extension context, or no receiver */
  }
}
