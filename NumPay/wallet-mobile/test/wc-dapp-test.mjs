// Minimal WalletConnect dApp for the NumPay mobile exit test. Acts as the
// dApp side: pairs with the wallet, then requests personal_sign and (with
// --tx) eth_sendTransaction, verifying the signature address locally.
// Usage: node wc-dapp-test.mjs <projectId> [--tx]
import dns from "node:dns";
// This machine's system DNS times out for relay.walletconnect.com (Chrome and
// the emulator each bring their own resolver, so only node is affected).
// Route lookups through public DNS without touching system settings.
dns.setServers(["8.8.8.8", "1.1.1.1"]);
const origLookup = dns.lookup.bind(dns);
dns.lookup = (hostname, options, callback) => {
  if (typeof options === "function") { callback = options; options = {}; }
  if (!hostname.includes(".") || hostname === "localhost") {
    return origLookup(hostname, options, callback);
  }
  dns.resolve4(hostname, (err, addrs) => {
    if (err || !addrs?.length) return origLookup(hostname, options, callback);
    if (options?.all) callback(null, addrs.map((a) => ({ address: a, family: 4 })));
    else callback(null, addrs[0], 4);
  });
};

import { SignClient } from "@walletconnect/sign-client";
import { ethers } from "ethers";
import bs58 from "bs58";
import nacl from "tweetnacl";
import { writeFileSync } from "node:fs";

const projectId = process.argv[2];
const doTx = process.argv.includes("--tx");
const doSol = process.argv.includes("--sol");
if (!projectId) { console.error("usage: node wc-dapp-test.mjs <projectId> [--tx]"); process.exit(2); }

const log = (...a) => console.log(new Date().toISOString().slice(11, 19), ...a);

const client = await SignClient.init({
  projectId,
  metadata: {
    name: "NumPay Exit Test",
    description: "Local WalletConnect exit-test dApp",
    url: "https://lab.reown.com",
    icons: ["https://walletconnect.com/walletconnect-logo.png"],
  },
});
log("sign-client ready");

const { uri, approval } = await client.connect({
  requiredNamespaces: {
    eip155: {
      methods: ["personal_sign", "eth_sendTransaction"],
      chains: ["eip155:8453"], // Base — the funded chain
      events: ["accountsChanged", "chainChanged"],
    },
  },
  optionalNamespaces: {
    solana: {
      methods: ["solana_signMessage"],
      chains: ["solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp"],
      events: [],
    },
  },
});

writeFileSync(process.env.WC_URI_FILE ?? "wc-uri.txt", uri);
log("PAIRING URI written:", uri.slice(0, 60) + "…");

log("waiting for wallet approval…");
const session = await approval();
const accounts = Object.values(session.namespaces).flatMap((n) => n.accounts);
log("SESSION APPROVED. accounts:", JSON.stringify(accounts));

const evmAccount = accounts.find((a) => a.startsWith("eip155:8453:"))?.split(":")[2];
if (!evmAccount) { console.error("no base account in session"); process.exit(1); }

// personal_sign
const msg = "NumPay WalletConnect exit test " + Date.now();
const msgHex = "0x" + Buffer.from(msg, "utf8").toString("hex");
log("requesting personal_sign…");
const sig = await client.request({
  topic: session.topic,
  chainId: "eip155:8453",
  request: { method: "personal_sign", params: [msgHex, evmAccount] },
});
const recovered = ethers.verifyMessage(msg, sig);
log("personal_sign result:", sig.slice(0, 24) + "…");
log(recovered.toLowerCase() === evmAccount.toLowerCase()
  ? "SIGNATURE VERIFIED: recovered address matches " + evmAccount
  : "SIGNATURE MISMATCH: recovered " + recovered + " expected " + evmAccount);

if (doSol) {
  const solCaip2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
  const solAccount = accounts.find((a) => a.startsWith(solCaip2 + ":"))?.split(":")[2];
  if (!solAccount) {
    log("SOLANA LEG SKIPPED: session has no solana account");
  } else {
    const solMsg = "NumPay solana exit test " + Date.now();
    const solMsgBytes = Buffer.from(solMsg, "utf8");
    log("requesting solana_signMessage…");
    const solRes = await client.request({
      topic: session.topic,
      chainId: solCaip2,
      request: {
        method: "solana_signMessage",
        params: { message: bs58.encode(solMsgBytes), pubkey: solAccount },
      },
    });
    const solSig = bs58.decode(solRes.signature);
    const solOk = nacl.sign.detached.verify(solMsgBytes, solSig, bs58.decode(solAccount));
    log("solana_signMessage result:", solRes.signature.slice(0, 24) + "…");
    log(solOk
      ? "SOLANA SIGNATURE VERIFIED against " + solAccount
      : "SOLANA SIGNATURE INVALID for " + solAccount);
  }
}

if (doTx) {
  log("requesting eth_sendTransaction (tiny Base self-send)…");
  const txHash = await client.request({
    topic: session.topic,
    chainId: "eip155:8453",
    request: {
      method: "eth_sendTransaction",
      params: [{ from: evmAccount, to: evmAccount, value: "0x2386f26fc10000" }],
    },
  });
  log("TX HASH:", txHash);
}

await client.disconnect({ topic: session.topic, reason: { code: 6000, message: "test done" } });
log("disconnected, test complete");
process.exit(0);
