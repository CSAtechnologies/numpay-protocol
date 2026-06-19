import { MSG_DAPP_STATE_CHANGED } from "./types";

// Tell the background router that the exposed account or EVM chain changed, so
// it can emit accountsChanged / chainChanged to connected dApps. Best-effort and
// safe to call outside an extension context.
export function notifyDappState(): void {
  try {
    chrome?.runtime?.sendMessage?.({ type: MSG_DAPP_STATE_CHANGED });
  } catch {
    /* not in an extension context, or no receiver */
  }
}
