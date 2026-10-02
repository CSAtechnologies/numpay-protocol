// Executes an approved in-app-browser signing request. The EIP-1193 counterpart
// of walletconnect/signRequests.ts, and deliberately built the same way: the
// platform-free @numpay/core/dapp engine does the signing, this module only
// resolves the chain's RPC, builds the signer from the unlocked vault through
// the SAME gated getUnlockedMnemonic path Send and WalletConnect use, and
// records the result.
//
// Nothing here runs without a tap. router.ts produces a pending approval, the
// sheet shows it, and only the sheet's confirm reaches this file.

import { ethers } from "ethers";
import { signDappRequest } from "@numpay/core/dapp";
import { NETWORKS } from "@numpay/core/networks";
import { importFromMnemonic, getSigner } from "@numpay/core/wallet";
import { logTx, updateTx, explorerTxUrl } from "@numpay/core/txLog";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import { rpcUrlFor } from "./session";
import type { BrowserPending } from "./router";

/** What the sheet shows after a browser request broadcast a transaction. */
export interface BrowserBroadcastResult {
  txHash: string;
  explorerUrl: string;
}

/**
 * Sign (and, for eth_sendTransaction, broadcast) an approved request.
 *
 * Re-checks the vault lock before touching a key — the H-06 parity rule the
 * Send and WalletConnect paths follow: a session that expired while the sheet
 * was open must sign nothing and push the user back to re-auth.
 *
 * Returns the raw JSON-RPC result for the dApp, plus broadcast details when a
 * transaction actually went out (so the caller can show the result overlay).
 */
export async function executeBrowserSign(
  pending: Extract<BrowserPending, { type: "sign" }>,
  onSessionExpired?: () => void,
): Promise<{ result: string; broadcast?: BrowserBroadcastResult }> {
  const mnemonic = await getUnlockedMnemonic();
  if (!mnemonic) {
    onSessionExpired?.();
    throw new Error("Vault locked");
  }

  const rpc = (await rpcUrlFor(pending.internalChainId)) ?? NETWORKS.ethereum.rpcUrl;
  const wd = importFromMnemonic(mnemonic);
  const signer = getSigner(wd.privateKey, rpc);

  const result = await signDappRequest(
    { method: pending.method, params: pending.params },
    signer,
  );

  if (pending.method !== "eth_sendTransaction") return { result };

  const net = NETWORKS[pending.internalChainId];
  // A dApp-initiated broadcast is still one of this wallet's sends, so it has
  // to appear in Activity — the history-consistency rule. A closed sheet
  // otherwise leaves no visible trace anywhere in the app.
  //
  // Only built-in networks are logged: the Activity feed keys off the NETWORKS
  // table for symbol, logo and explorer, and a dApp-added custom chain has no
  // entry there. The transaction still broadcasts and still returns its hash.
  if (net && pending.preview.detail.kind === "send_tx") {
    const dtx = pending.preview.detail.tx;
    let valueWei: bigint | undefined;
    try {
      valueWei = BigInt(dtx.value ?? "0x0");
    } catch {
      valueWei = undefined; // hostile hex already survived preview; log without it
    }
    void logTx({
      owner: pending.preview.account,
      hash: result,
      chainId: net.id,
      kind: "send",
      timestamp: Date.now(),
      symbol: net.symbol,
      value: valueWei !== undefined ? ethers.formatUnits(valueWei, net.decimals) : "0",
      logo: net.logo,
      counterparty: dtx.to ?? undefined,
      status: "pending",
      from: pending.preview.account,
      to: dtx.to ?? undefined,
      valueWei: valueWei?.toString(),
      data: dtx.data,
    });
    void signer.provider
      ?.waitForTransaction(result)
      .then((rc) => {
        void updateTx(net.id, result, {
          status: rc && rc.status === 0 ? "failed" : "confirmed",
        });
      })
      .catch(() => {
        /* replaced/dropped — the Activity reconciler settles it */
      });

    return {
      result,
      broadcast: { txHash: result, explorerUrl: explorerTxUrl(net.id, result) },
    };
  }

  return { result };
}
