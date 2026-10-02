import { expect } from "chai";
import { ethers } from "hardhat";
import { createServer } from "http";
import { once } from "events";
import { readFileSync, mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import { dirname, join, resolve } from "path";
import type { BANPRegistryBase } from "../typechain-types";

// Uses the real shared wallet core and real Solidity contract on local Hardhat.
// The HTTP bridge only transports JSON-RPC to the in-process test chain.
describe("NumPay shared core with fresh Base registry", function () {
  this.timeout(30_000);
  it("registers for zero fee, displays ownership, maps, resolves and clears transfers", async function () {
    const [admin, alice, bob] = await ethers.getSigners();
    const registry = await (await ethers.getContractFactory("BANPRegistryBase")).deploy() as unknown as BANPRegistryBase;
    const receipt = await registry.deploymentTransaction()!.wait();
    const address = await registry.getAddress();
    const repo = resolve(__dirname, "../../..");
    const { build } = require(join(repo, "NumPay/node_modules/esbuild"));
    const out = mkdtempSync(join(tmpdir(), "numpay-bpan-contract-"));
    const server = createServer(async (req, res) => {
      let body = "";
      for await (const chunk of req) body += chunk;
      const requests = JSON.parse(body);
      async function rpc(q: any) {
        try { return { jsonrpc: "2.0", id: q.id, result: await ethers.provider.send(q.method, q.params) }; }
        catch (e: any) { return { jsonrpc: "2.0", id: q.id, error: { code: -32000, message: e.message } }; }
      }
      const result = Array.isArray(requests) ? await Promise.all(requests.map(rpc)) : await rpc(requests);
      res.setHeader("Content-Type", "application/json");
      res.end(JSON.stringify(result));
    });
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const endpoint = `http://127.0.0.1:${(server.address() as any).port}`;
    try {
      const file = join(out, "core.cjs");
      await build({
        entryPoints: [join(repo, "NumPay/packages/core/src/bpan.ts")],
        bundle: true, platform: "node", format: "cjs", outfile: file, logLevel: "error",
        plugins: [{ name: "local-deployment", setup(b: any) {
          b.onLoad({ filter: /bpanDeployment\.ts$/ }, (args: any) => ({
            contents: readFileSync(args.path, "utf8").replace(
              /export const BPAN_DEPLOYMENT = createBPANDeployment\([\s\S]*?\n\);/,
              `export const BPAN_DEPLOYMENT = { ...createBPANDeployment("${address}", ${receipt!.blockNumber}), chainId: 31337, rpc: "${endpoint}/0", readRpcs: ["${endpoint}/0", "${endpoint}/1", "${endpoint}/2"] };`
            ), loader: "ts", resolveDir: dirname(args.path),
          }));
        } }],
      });
      const core = require(file);
      const number = "12345678901";
      expect(await core.findOwnedBPANs(alice.address)).to.deep.equal([]);
      const registration = await core.registerBPAN(number, address, alice);
      const registered = await registration.wait();
      expect(registered.status).to.equal(1);
      expect(registration.value).to.equal(0n);
      console.log(`    First registration: ${registered.gasUsed} gas, zero protocol fee`);
      // HTTP ethers providers cache reads for 250 ms. Local blocks mine in a
      // few milliseconds, so let that cache expire between state transitions.
      await new Promise(r => setTimeout(r, 300));
      expect(await core.findOwnedBPANs(alice.address)).to.deep.equal([number]);
      expect(await core.isBPANRegistered(number)).to.equal(true);
      expect(await core.getBPANOwner(number)).to.equal(alice.address);
      await (await core.setWalletMapping(number, "evm", alice.address, address, alice)).wait();
      expect((await core.getAllBPANMappings(number)).wallets).to.deep.equal([alice.address]);
      expect((await core.resolveBPANChecked(number, "base")).address).to.equal(alice.address);
      expect((await core.resolveBPANChecked(number, "ethereum")).address).to.equal(alice.address);
      await registry.connect(alice).transferFrom(alice.address, bob.address, number);
      await new Promise(r => setTimeout(r, 300));
      expect(await core.findOwnedBPANs(alice.address)).to.deep.equal([]);
      expect(await core.findOwnedBPANs(bob.address)).to.deep.equal([number]);
      expect((await core.resolveBPANChecked(number, "base")).address).to.equal(null);
      await (await core.setWalletMapping(number, "evm", bob.address, address, bob)).wait();
      await new Promise(r => setTimeout(r, 300));
      const changed = await core.resolveBPANChecked(number, "base");
      expect(changed.address).to.equal(bob.address);
      expect(changed.changed).to.equal(true);
      expect(changed.pinnedBefore).to.equal(alice.address);
      expect(await registry.owner()).to.equal(admin.address);
    } finally {
      server.closeAllConnections();
      await new Promise<void>(resolve => server.close(() => resolve()));
      expect(dirname(out)).to.equal(resolve(tmpdir()));
      expect(out.startsWith(join(resolve(tmpdir()), "numpay-bpan-contract-"))).to.equal(true);
      rmSync(out, { recursive: true, force: true });
    }
  });
});
