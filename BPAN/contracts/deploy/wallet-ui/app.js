"use strict";
const expected = "0x616fb832c3208c5da5dc1575f87f537132152fcd";
const initCodeHash = "0x0f3574253996cb3039c026c090e61c5d7f2d1b720a8c787662168ebc51fe07a5";
const $ = (id) => document.getElementById(id);
const wallets = new Map();
let selected, quote, connected = false, busy = false, submitted = false;
const submissionKey = `bpan_deploy_base_${expected}_${initCodeHash}`;
function status(message) { $("status").textContent = message; }
function showHash(hash) {
  submitted = true; $("deploy").disabled = true; $("connect").disabled = true;
  $("result").hidden = false; $("hash").textContent = hash;
  status("Deployment transaction submitted. Do not deploy again while verification is pending.");
}
function reset() { connected = false; $("deploy").disabled = true; status("Account or network changed. Connect the specified wallet again."); }
function addWallet(id, name, provider) {
  if (!provider?.request || wallets.has(id)) return;
  wallets.set(id, provider);
  const option = document.createElement("option"); option.value = id; option.textContent = name;
  if (wallets.size === 1) $("wallet").replaceChildren();
  $("wallet").append(option);
  if (provider.isNumPay) $("wallet").value = id;
  $("connect").disabled = submitted;
}
window.addEventListener("eip6963:announceProvider", (event) => {
  const d = event.detail; if (d?.info?.uuid) addWallet(d.info.uuid, d.info.name, d.provider);
});
window.dispatchEvent(new Event("eip6963:requestProvider"));
setTimeout(() => {
  if (wallets.size === 0 && window.ethereum) addWallet("injected", "Browser wallet", window.ethereum);
  if (wallets.size === 0) status("Open this page in Chrome with your wallet extension enabled.");
}, 800);
$("wallet").addEventListener("change", reset);
async function readQuote() {
  const response = await fetch("/plan");
  const q = await response.json();
  if (!response.ok) throw new Error(q.error);
  if (q.sender.toLowerCase() !== expected || q.chainId !== 8453 || q.tx.chainId !== "0x2105"
      || q.initCodeHash !== initCodeHash || q.tx.to || q.tx.value !== "0x0" || q.registrationFeeWei !== "0") {
    throw new Error("Deployment plan does not match the prepared Base contract.");
  }
  $("balance").textContent = `${q.balanceETH} ETH`;
  $("fee").textContent = `${q.estimatedMaximumETH} ETH`;
  quote = q;
  if (!q.sufficientBalance) throw new Error("This wallet needs more ETH on Base for deployment gas.");
  return q;
}
async function checkWallet(provider) {
  const accounts = await provider.request({ method: "eth_accounts" });
  const chain = await provider.request({ method: "eth_chainId" });
  if (accounts[0]?.toLowerCase() !== expected) throw new Error("Select the specified deployer account in your wallet.");
  if (BigInt(chain) !== 8453n) throw new Error("Switch the wallet to Base mainnet.");
}
$("connect").addEventListener("click", async () => {
  if (busy || submitted) return; busy = true; $("connect").disabled = true;
  try {
    const provider = wallets.get($("wallet").value);
    if (!provider) throw new Error("Choose a wallet first.");
    if (selected?.removeListener) { selected.removeListener("accountsChanged", reset); selected.removeListener("chainChanged", reset); }
    selected = provider;
    await provider.request({ method: "eth_requestAccounts" });
    await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x2105" }] });
    await checkWallet(provider); await readQuote();
    provider.on?.("accountsChanged", reset); provider.on?.("chainChanged", reset);
    connected = true; $("deploy").disabled = false;
    status("Connected to the correct account on Base. Ready for wallet approval.");
  } catch (error) { connected = false; $("deploy").disabled = true; status(error.message || "Wallet connection failed."); }
  finally { busy = false; $("connect").disabled = submitted; }
});
$("deploy").addEventListener("click", async () => {
  if (busy || submitted || !connected) return;
  let signingRequested = false;
  busy = true; $("deploy").disabled = true; $("connect").disabled = true; $("wallet").disabled = true;
  try {
    await checkWallet(selected);
    const q = await readQuote();
    const nonce = await selected.request({ method: "eth_getTransactionCount", params: [expected, "pending"] });
    if (BigInt(nonce) !== BigInt(q.tx.nonce)) throw new Error("Wallet nonce changed. Retry to refresh the deployment plan.");
    status("Review and approve contract creation in your wallet.");
    try { localStorage.setItem(submissionKey, "pending"); } catch {}
    signingRequested = true;
    const hash = await selected.request({ method: "eth_sendTransaction", params: [q.tx] });
    if (!/^0x[0-9a-f]{64}$/i.test(hash)) throw new Error("Wallet returned an unexpected result. Check wallet activity before retrying.");
    try { localStorage.setItem(submissionKey, hash); } catch { /* The visible hash is still available to copy. */ }
    showHash(hash);
  } catch (error) {
    if (signingRequested && error.code !== 4001) {
      submitted = true;
      status("The wallet request may have been submitted. Check wallet activity and send the transaction hash to Codex before trying another deployment.");
    } else {
      if (signingRequested) { try { localStorage.removeItem(submissionKey); } catch {} }
      status(error.message || "Wallet request cancelled.");
    }
  } finally {
    busy = false; $("connect").disabled = submitted; $("wallet").disabled = submitted;
    $("deploy").disabled = true; connected = false;
  }
});
try {
  const hash = localStorage.getItem(submissionKey);
  if (/^0x[0-9a-f]{64}$/i.test(hash || "")) showHash(hash);
  else if (hash === "pending") {
    submitted = true; $("connect").disabled = true;
    status("A deployment request may still be pending. Check wallet activity and send its transaction hash to Codex before deploying again.");
  }
} catch {}
readQuote().then(() => { if (!submitted && wallets.size) status("Connect your wallet to review the deployment."); }).catch(error => status(error.message));
