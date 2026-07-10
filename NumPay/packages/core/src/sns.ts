// Solana Name Service (.sol) resolution. This module pulls in @solana/web3.js +
// @bonfida/spl-name-service, which are heavy and which the rest of the wallet
// deliberately avoids (it uses raw JSON-RPC). It is therefore ONLY ever reached
// via a dynamic import() (from Send when a .sol name is typed), so Vite splits it
// into a lazy chunk that never loads on the popup boot path.
//
// Resolution is fully on-chain (trustless, no third-party resolver API), so it
// meets the same safety bar as the BPAN flow: the returned address is what the
// domain's owner has published on-chain as its receive address.

import { Connection } from "@solana/web3.js";
import { resolve } from "@bonfida/spl-name-service";
import { SOL_RPC } from "./chains/solana";

/**
 * Resolve a `.sol` domain to its receive address (base58), or null if it does
 * not exist / has no resolved address. `resolve` prefers a published SOL record
 * and falls back to the domain owner, matching how Solana wallets resolve names.
 */
export async function resolveSns(domain: string): Promise<string | null> {
  const name = domain.trim().toLowerCase().replace(/\.sol$/, "");
  if (!name) return null;
  const connection = new Connection(SOL_RPC, "confirmed");
  const owner = await resolve(connection, name);
  return owner ? owner.toBase58() : null;
}
