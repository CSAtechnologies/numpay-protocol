// Local, read-only deployment helper. Signing stays inside the user's wallet.
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const { ethers } = require("ethers");

const sender = ethers.getAddress("0x616fb832c3208c5da5dc1575f87f537132152fcd");
const port = 4178;
const origin = `http://127.0.0.1:${port}`;
const provider = new ethers.JsonRpcProvider("https://mainnet.base.org", 8453);
const artifact = JSON.parse(fs.readFileSync(path.join(__dirname, "../artifacts/core/BANPRegistryBase.sol/BANPRegistryBase.json"), "utf8"));
const data = artifact.bytecode;

async function plan() {
  const [network, balance, nonce, estimate, fees] = await Promise.all([
    provider.getNetwork(), provider.getBalance(sender), provider.getTransactionCount(sender, "pending"),
    provider.estimateGas({ from: sender, data, value: 0n }), provider.getFeeData(),
  ]);
  if (network.chainId !== 8453n) throw new Error("RPC is not Base mainnet");
  if (fees.maxFeePerGas == null || fees.maxPriorityFeePerGas == null) throw new Error("Fee quote unavailable");
  const gasLimit = (estimate * 120n + 99n) / 100n;
  const tx = { chainId: "0x2105", from: sender, data, value: "0x0", nonce: ethers.toQuantity(nonce),
    gas: ethers.toQuantity(gasLimit), maxFeePerGas: ethers.toQuantity(fees.maxFeePerGas),
    maxPriorityFeePerGas: ethers.toQuantity(fees.maxPriorityFeePerGas) };
  const unsigned = ethers.Transaction.from({ data, value: 0n, chainId: 8453, nonce, gasLimit, type: 2,
    maxFeePerGas: fees.maxFeePerGas, maxPriorityFeePerGas: fees.maxPriorityFeePerGas });
  const oracle = new ethers.Contract("0x420000000000000000000000000000000000000F", [
    "function getL1FeeUpperBound(uint256) view returns(uint256)",
    "function getOperatorFee(uint256) view returns(uint256)",
  ], provider);
  const [l1, operator] = await Promise.all([
    oracle.getL1FeeUpperBound(ethers.getBytes(unsigned.unsignedSerialized).length + 65), oracle.getOperatorFee(gasLimit),
  ]);
  const maximum = gasLimit * fees.maxFeePerGas + l1 + operator;
  return { sender, tx, chainId: 8453, contractName: "BANPRegistryBase", registrationFeeWei: "0",
    expectedContract: ethers.getCreateAddress({ from: sender, nonce }), initCodeHash: ethers.keccak256(data),
    balanceETH: ethers.formatEther(balance), estimatedMaximumETH: ethers.formatEther(maximum),
    sufficientBalance: balance >= maximum, generatedAt: Date.now() };
}

const server = http.createServer(async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Content-Security-Policy", "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  if (req.headers.host !== `127.0.0.1:${port}` || (req.headers.origin && req.headers.origin !== origin)) {
    res.writeHead(403); res.end("Local access only"); return;
  }
  if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
  try {
    if (req.url === "/plan") {
      res.setHeader("Content-Type", "application/json"); res.end(JSON.stringify(await plan())); return;
    }
    const files = { "/": ["index.html", "text/html"], "/app.js": ["app.js", "text/javascript"], "/style.css": ["style.css", "text/css"] };
    const file = files[req.url];
    if (!file) { res.writeHead(404); res.end(); return; }
    res.setHeader("Content-Type", file[1]); res.end(fs.readFileSync(path.join(__dirname, "wallet-ui", file[0])));
  } catch {
    res.writeHead(503, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Base RPC could not prepare the deployment. Retry in a moment." }));
  }
});
server.listen(port, "127.0.0.1", () => console.log(`Base wallet deployment helper: ${origin}`));
