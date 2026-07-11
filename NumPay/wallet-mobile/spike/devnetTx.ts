/**
 * Phase 0 exit gate, half 1 (NUMPAY_MOBILE_PLAN_2026-07-10.md §6): a REAL
 * signed transaction from this device, broadcast to a public test network
 * and confirmed on-chain.
 *
 * Solana devnet because its faucet is a plain RPC call (no captcha, no
 * account), so the whole check runs unattended with zero real funds. The key
 * is derived from the vault mnemonic through core's real derivation path;
 * signing is @solana/web3.js (same as the dapp path the spike verifies).
 *
 * Deliberately raw JSON-RPC over fetch, mirroring core's own Solana sender:
 * web3.js Connection confirms via websockets (rpc-websockets), which is
 * exactly the module Metro flags as unresolved for android — not worth
 * dragging in for a dev check.
 */
import { Keypair, SystemProgram, Transaction } from "@solana/web3.js";
import { deriveNonEvmAddresses } from "@numpay/core/chains";

const DEVNET_RPC = "https://api.devnet.solana.com";

async function rpc(method: string, params: unknown[]): Promise<any> {
  const r = await fetch(DEVNET_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const j = await r.json();
  if (j.error) throw new Error(`${method}: ${j.error.message}`);
  return j.result;
}

async function waitConfirmed(
  sig: string,
  label: string,
  log: (s: string) => void
): Promise<void> {
  for (let i = 0; i < 30; i++) {
    const st = await rpc("getSignatureStatuses", [[sig]]);
    const s = st.value?.[0];
    if (s && (s.confirmationStatus === "confirmed" || s.confirmationStatus === "finalized")) {
      if (s.err) throw new Error(`${label} failed on-chain: ${JSON.stringify(s.err)}`);
      log(`${label}: ${s.confirmationStatus}`);
      return;
    }
    await new Promise((r) => setTimeout(r, 2000));
  }
  throw new Error(`${label}: not confirmed after 60 s`);
}

/** Runs the devnet round trip; resolves to the transfer signature. */
export async function runDevnetTx(
  mnemonic: string,
  log: (s: string) => void
): Promise<string> {
  const non = await deriveNonEvmAddresses(mnemonic);
  const kp = Keypair.fromSecretKey(non.solana.secretKey);
  const addr = kp.publicKey.toBase58();
  log(`devnet address: ${addr}`);

  const bal = await rpc("getBalance", [addr, { commitment: "confirmed" }]);
  log(`devnet balance: ${bal.value / 1e9} SOL`);

  if (bal.value < 10_000_000) {
    log("requesting 0.1 SOL airdrop…");
    const airdropSig = await rpc("requestAirdrop", [addr, 100_000_000]);
    await waitConfirmed(airdropSig, "airdrop", log);
  }

  const bh = await rpc("getLatestBlockhash", [{ commitment: "finalized" }]);
  const tx = new Transaction({
    recentBlockhash: bh.value.blockhash,
    feePayer: kp.publicKey,
  });
  tx.add(
    SystemProgram.transfer({
      fromPubkey: kp.publicKey,
      toPubkey: kp.publicKey,
      lamports: 1000,
    })
  );
  tx.sign(kp);

  const sig = await rpc("sendTransaction", [
    tx.serialize().toString("base64"),
    { encoding: "base64", preflightCommitment: "confirmed" },
  ]);
  log(`sent: ${sig}`);
  await waitConfirmed(sig, "transfer", log);
  return sig;
}
