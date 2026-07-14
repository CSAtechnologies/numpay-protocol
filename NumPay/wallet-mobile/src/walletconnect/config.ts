// WalletConnect (Reown WalletKit) configuration for NumPay mobile.
//
// Slice 0 (transport): the only two things the SDK needs to come up are a
// Reown Cloud projectId (relays encrypted pairing traffic, keys never leave the
// device) and wallet metadata shown to dApps on the approval screen.
//
// The projectId is a PUBLIC client identifier (it appears in every relay URL of
// every WalletConnect wallet), not a provider/API secret, so it does not fall
// under the mobile "no keys ever" rule that governs Alchemy/Moralis/Helius
// keys. It is still a third-party service dependency and belongs in the privacy
// page's sub-processor list. It is read from the env block injected in
// polyfills.ts so it lives in exactly one place.

import type { WalletKitTypes } from "@reown/walletkit";

/* eslint-disable @typescript-eslint/no-explicit-any */
const ENV = (globalThis as any).__NUMPAY_ENV__ ?? {};

/** Reown Cloud projectId. Empty until the user drops theirs into polyfills.ts. */
export const WALLETCONNECT_PROJECT_ID: string =
  ENV.WALLETCONNECT_PROJECT_ID ?? "";

export function hasProjectId(): boolean {
  return typeof WALLETCONNECT_PROJECT_ID === "string" &&
    WALLETCONNECT_PROJECT_ID.length > 0;
}

// Metadata the dApp shows the user when proposing a session. `url` is used by
// some dApps for verify-context (domain matching), so set it to NumPay's real
// homepage before public launch. TODO(domain): confirm the canonical URL/icon;
// no numpay domain exists in the repo yet.
export const WC_METADATA: WalletKitTypes.Metadata = {
  name: "NumPay",
  description: "NumPay non-custodial multi-chain wallet",
  url: "https://numpay.app",
  icons: ["https://numpay.app/icon.png"],
  // Lets a dApp deep-link back into NumPay after signing (Slice 4 wires the
  // matching `scheme` in app.json). Harmless to declare now.
  redirect: { native: "numpay://" },
};
