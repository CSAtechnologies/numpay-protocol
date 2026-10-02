// Exercise the real shared resolver against controlled JSON-RPC endpoints.
// No live transactions, provider keys, or wallet vaults are used.
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { once } from "node:events";
import { build } from "esbuild";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { Interface, JsonRpcProvider, Wallet } from "ethers";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const out = mkdtempSync(join(tmpdir(), "numpay-bpan-"));
const registry = "0x1111111111111111111111111111111111111111";
const recipient = "0x2222222222222222222222222222222222222222";
const changedRecipient = "0x3333333333333333333333333333333333333333";
const number = "12345678901";
const abi = new Interface([
  "function getWalletMapping(uint256,string) view returns (string)",
  "function registrationFee() view returns (uint256)",
  "function registerNumber(uint256) payable",
  "function setWalletMapping(uint256,string,string)",
  "function balanceOf(address) view returns (uint256)",
  "function ownerOf(uint256) view returns (address)",
  "function getOwnedNumbers(address,uint256,uint256) view returns (uint256[])",
  "event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)",
]);
let votes = [recipient, recipient, recipient];
let exact = true, pending = "", rpcChain = 8453, code = "0x6000";
let ownedCount = 1n, badPage = false;
const calls = [];
function respond(q, source) {
  calls.push(q);
  try {
    let result;
    if (q.method === "eth_chainId") result = `0x${rpcChain.toString(16)}`;
    else if (q.method === "eth_getCode") result = code;
    else if (q.method === "eth_blockNumber") result = "0x65";
    else if (q.method === "eth_call") {
      assert.equal(q.params[0].to.toLowerCase(), registry);
      const tx = abi.parseTransaction({ data: q.params[0].data });
      if (tx.name === "getWalletMapping") {
        if (votes[source] === null) throw new Error("provider unavailable");
        const value = q.params[1] === "latest" ? pending
          : (exact || tx.args[1] === "evm") ? votes[source] : "";
        result = abi.encodeFunctionResult(tx.name, [value]);
      } else if (tx.name === "registrationFee") result = abi.encodeFunctionResult(tx.name, [0n]);
      else if (tx.name === "balanceOf") result = abi.encodeFunctionResult(tx.name, [ownedCount]);
      else if (tx.name === "ownerOf") result = abi.encodeFunctionResult(tx.name, [recipient]);
      else if (tx.name === "getOwnedNumbers") {
        const offset = Number(tx.args[1]);
        const count = Math.min(Number(tx.args[2]), Number(ownedCount) - offset);
        result = abi.encodeFunctionResult(tx.name, [badPage ? [] : Array.from({ length: count }, (_, i) => BigInt(number) + BigInt(offset + i))]);
      }
      else throw new Error(`Unexpected call ${tx.name}`);
    } else throw new Error(`Unexpected RPC method ${q.method}`);
    return { jsonrpc: "2.0", id: q.id, result };
  } catch (e) { return { jsonrpc: "2.0", id: q.id, error: { code: -32000, message: e.message } }; }
}
const server = createServer(async (req, res) => {
  let body = "";
  for await (const chunk of req) body += chunk;
  const payload = JSON.parse(body);
  const source = Number(req.url.slice(1));
  res.setHeader("Content-Type", "application/json");
  res.end(JSON.stringify(Array.isArray(payload) ? payload.map(q => respond(q, source)) : respond(payload, source)));
});
server.listen(0, "127.0.0.1");
await once(server, "listening");
const urls = [0, 1, 2].map(i => `http://127.0.0.1:${server.address().port}/${i}`);
let signerProvider;
try {
  // An unconfigured registry must fail before any RPC/signing, even after release.
  const pendingEntry = join(out, "pending.cjs");
  await build({
    stdin: { contents: 'export * from "./packages/core/src/bpan"; export * from "./packages/core/src/bpanDeployment"; export * from "./packages/core/src/networks";', resolveDir: root },
    bundle: true, platform: "node", format: "cjs", outfile: pendingEntry, logLevel: "error",
    plugins: [{ name: "undeployed-fixture", setup(b) {
      b.onLoad({ filter: /bpanDeployment\.ts$/ }, args => ({
        contents: readFileSync(args.path, "utf8").replace(
          /export const BPAN_DEPLOYMENT = createBPANDeployment\([\s\S]*?\n\);/,
          "export const BPAN_DEPLOYMENT = createBPANDeployment(null, 0);"
        ), loader: "ts", resolveDir: dirname(args.path),
      }));
    } }],
  });
  const pendingCore = createRequire(import.meta.url)(pendingEntry);
  assert.equal(pendingCore.BPAN_DEPLOYMENT.deployed, false);
  assert.equal(pendingCore.BPAN_DEPLOYMENT.contract, "");
  assert.equal(pendingCore.NETWORKS.base.bpanContract, undefined);
  assert.equal(pendingCore.NETWORKS.ethereum.bpanContract, undefined);
  assert.equal(pendingCore.NETWORKS.sepolia.bpanContract, undefined);
  const unavailable = /BPAN on Base is not available yet/;
  await assert.rejects(pendingCore.findOwnedBPANs(recipient), unavailable);
  await assert.rejects(pendingCore.resolveBPANChecked(number, "base"), unavailable);
  await assert.rejects(pendingCore.getAllBPANMappings(number), unavailable);
  await assert.rejects(pendingCore.isBPANRegistered(number), unavailable);
  await assert.rejects(pendingCore.getBPANOwner(number), unavailable);
  await assert.rejects(pendingCore.getOwnedBPANCount(recipient), unavailable);
  await assert.rejects(pendingCore.registerBPAN(number, registry, {}), unavailable);
  await assert.rejects(pendingCore.setWalletMapping(number, "evm", recipient, registry, {}), unavailable);
  assert.equal(calls.length, 0);
  const entry = join(out, "bpan.cjs");
  await build({
    stdin: { contents: 'export * from "./packages/core/src/bpan"; export * from "./packages/core/src/bpanDeployment"; export * from "./packages/core/src/storage"; export * from "./packages/core/src/networks";', resolveDir: root },
    bundle: true, platform: "node", format: "cjs", outfile: entry, logLevel: "error",
    plugins: [{ name: "test-base-deployment", setup(b) {
      b.onLoad({ filter: /bpanDeployment\.ts$/ }, args => {
        let text = readFileSync(args.path, "utf8");
        text = text.replace(/export const BPAN_DEPLOYMENT = createBPANDeployment\([\s\S]*?\n\);/,
          `export const BPAN_DEPLOYMENT = { ...createBPANDeployment("${registry}", 100), rpc: ${JSON.stringify(urls[0])}, readRpcs: ${JSON.stringify(urls)} };`);
        return { contents: text, loader: "ts", resolveDir: dirname(args.path) };
      });
    } }],
  });
  const core = createRequire(import.meta.url)(entry);
  assert.equal(core.BPAN_DEPLOYMENT.chainId, 8453);
  assert.equal(core.NETWORKS.base.bpanContract, registry);
  assert.equal(core.NETWORKS.ethereum.bpanContract, undefined);
  assert.equal(core.NETWORKS.ethereum.chainId, 1);
  assert.notEqual(core.bpanOwnershipKey(recipient), `bpan_numbers_${recipient}`);
  assert.throws(() => core.createBPANDeployment(registry, 0), /deployment block/);
  assert.throws(() => core.createBPANDeployment("0x" + "0".repeat(40), 100), /address/);
  const prod = core.createBPANDeployment(registry, 100);
  assert.equal(new Set(prod.readRpcs.map(u => new URL(u).hostname)).size, 3);
  assert.equal(prod.networkId, "base");
  assert.equal(core.NETWORKS.sepolia.bpanContract, undefined);

  let result = await core.resolveBPANChecked(number, "ethereum");
  assert.equal(result.address, recipient);
  assert.equal(result.sourcesAgreed, 3);
  assert(calls.filter(q => q.method === "eth_call").every(q => q.params[1] === "finalized"));
  votes = [changedRecipient, changedRecipient, changedRecipient];
  result = await core.resolveBPANChecked(number, "ethereum");
  assert.equal(result.changed, true);
  assert.equal(result.pinnedBefore, recipient);
  assert.equal((await core.resolveBPANChecked(number, "ethereum")).changed, true);
  await core.acceptBPANChange(number, "ethereum", changedRecipient);
  assert.equal((await core.resolveBPANChecked(number, "ethereum")).changed, false);
  // Old registry pins must not carry into a fresh Base identity.
  await core.setItem(`bpan_pin_${number}_base`, recipient);
  assert.equal((await core.resolveBPANChecked(number, "base")).changed, false);
  votes = [recipient, changedRecipient, recipient];
  await assert.rejects(core.resolveBPANChecked(number, "ethereum"), core.BPANConsensusError);
  votes = [recipient, null, null];
  await assert.rejects(core.resolveBPANChecked(number, "ethereum"), core.BPANInsufficientConfirmationError);
  votes = [recipient, recipient, null];
  assert.equal((await core.resolveBPANChecked(number, "ethereum")).address, recipient);
  votes = [recipient, recipient, recipient]; exact = false;
  assert.equal((await core.resolveBPANChecked(number, "base")).address, recipient);
  assert.equal((await core.resolveBPANChecked(number, "solana")).address, null);
  votes = ["", "", ""]; pending = recipient;
  result = await core.resolveBPANChecked(number, "base");
  assert.equal(result.address, null);
  assert.equal(result.pendingFinality, true);

  assert.deepEqual(await core.findOwnedBPANs(recipient), [number]);
  assert(!calls.some(q => q.method === "eth_getLogs"));
  const indexedTarget = { contract: registry, rpc: urls[0], chainId: 8453 };
  ownedCount = 101n;
  await new Promise(r => setTimeout(r, 300));
  const callStart = calls.length;
  const ownedNumbers = await core.findOwnedBPANs(recipient, indexedTarget);
  assert.equal(ownedNumbers.length, 101);
  assert.equal(ownedNumbers[100], (BigInt(number) + 100n).toString());
  assert(!calls.slice(callStart).some(q => q.method === "eth_getLogs"));
  const pages = calls.slice(callStart).filter(q => q.method === "eth_call");
  assert.equal(new Set(pages.map(q => q.params[1])).size, 1);
  badPage = true;
  await new Promise(r => setTimeout(r, 300));
  await assert.rejects(core.findOwnedBPANs(recipient, indexedTarget), /Incomplete BPAN ownership page/);
  badPage = false; ownedCount = 1n;

  signerProvider = new JsonRpcProvider(urls[0], undefined, { cacheTimeout: -1 });
  const signer = new Wallet("0x" + "01".repeat(32), signerProvider);
  const sent = [];
  signer.sendTransaction = async tx => { sent.push(tx); return { hash: "0x" + "ef".repeat(32) }; };
  await core.registerBPAN(number, registry, signer);
  assert.equal(sent[0].value, 0n);
  assert.equal(abi.parseTransaction(sent[0]).name, "registerNumber");
  await core.setWalletMapping(number, "evm", recipient, registry, signer);
  assert.equal(abi.parseTransaction(sent[1]).name, "setWalletMapping");
  code = "0x";
  await assert.rejects(core.registerBPAN(number, registry, signer), /No BPAN registry/);
  code = "0x6000"; rpcChain = 1;
  await assert.rejects(core.registerBPAN(number, registry, signer));
  await assert.rejects(core.setWalletMapping(number, "evm", recipient, registry, signer));
  assert.equal(sent.length, 2);
  await assert.rejects(core.resolveBPANChecked(number, "base"));
  console.log("BPAN Base integration passed: quorum, finality, pins, EVM fallback, cache isolation, discovery bounds, registration, mapping, wrong-chain rejection.");
} finally {
  signerProvider?.destroy();
  server.closeAllConnections();
  await new Promise(resolve => server.close(resolve));
  assert.equal(dirname(out), resolve(tmpdir()));
  assert(out.startsWith(join(resolve(tmpdir()), "numpay-bpan-")));
  rmSync(out, { recursive: true, force: true });
}
