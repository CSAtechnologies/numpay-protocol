import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = fs.readFileSync(path.join(root, "src/screens/BPANScreen.tsx"), "utf8");
const walletSource = fs.readFileSync(path.join(root, "src/wallet/useMobileWallet.ts"), "utf8");
const txFxSource = fs.readFileSync(path.join(root, "src/ui/TxResultOverlay.tsx"), "utf8");
let passed = 0;
let failed = 0;

function check(name, condition) {
  if (condition) passed++;
  else {
    failed++;
    console.error(`FAIL ${name}`);
  }
}

check("registration opens a review instead of broadcasting from an available form", /availability === "owned" \? void completeRegistration\(number\) : void prepareRegistration\(\)/.test(source));
check("registration review has a deliberate Base confirmation", source.includes('confirmLabel="Register on Base"'));
check("registration rechecks availability before signing", /confirmRegistration[\s\S]*?contract\.isRegistered/.test(source));
check("registration reconciles an already-owned number as success", /contract\.ownerOf[\s\S]*?isCurrentOwner\(registeredOwner\)[\s\S]*?completeRegistration/.test(source));
check("registration reconciles chain state after a write error", /catch \(e: any\)[\s\S]*?readRegistrationOwner\(number\)[\s\S]*?completeRegistration/.test(source));
check("registration preflight checks the Base ETH balance", /prepareRegistration[\s\S]*?preview\.balanceWei < totalWei/.test(source));
check("mapping opens a review instead of broadcasting from the form", source.includes('onPress={() => void prepareMappings()}'));
check("mapping plan repairs stale exact EVM overrides", /chain\?\.isEVM[\s\S]*?writes\.push\(\{ key: chainId/.test(source));
check("mapping review shows the exact transaction count", source.includes('<SheetRow label="Transactions" value={String(review.writes.length)} />'));
check("mapping revalidates ownership before signing", /confirmMappings[\s\S]*?onChainOwner\.toLowerCase\(\) !== w\.evmAddress\.toLowerCase\(\)/.test(source));
check("mapping accepts an already-confirmed subset of the reviewed plan", /mappingPlanIsSubset\(freshWrites, review\.writes\)/.test(source));
check("mapping reconciles a fully confirmed plan as success", /freshWrites\.length === 0[\s\S]*?status: "success"[\s\S]*?kind: "bpan-map"/.test(source));
check("mapping verifies chain state again after writes", /const confirmed = await getAllBPANMappings\(number\)[\s\S]*?remaining\.length > 0/.test(source));
check("mapping batch uses one nonce-managed signer", /const batchSigner = new ethers\.NonceManager\(baseSigner\)/.test(source));
check("mapping batch validates Base once before its loop", /assertBPANWriteNetwork\(BPAN_MAINNET_CONTRACT, baseSigner\)[\s\S]*?for \(let index = 0; index < activeWrites\.length; index\+\+\)/.test(source));
check("mapping batch reuses one contract for every selected chain", /const batchContract = getBPANContract[\s\S]*?batchContract\.setWalletMapping/.test(source));
check("mapping broadcasts every selected chain before waiting for receipts", /for \(let index = 0; index < activeWrites\.length; index\+\+\)[\s\S]*?broadcasts\.push[\s\S]*?for \(let index = 0; index < broadcasts\.length; index\+\+\)[\s\S]*?await tx\.wait\(\)/.test(source));
check("mapping reconciles briefly after receipt RPC failures", source.includes("BPAN_CONFIRMATION_ATTEMPTS = 8") && /for \(let attempt = 0; attempt < BPAN_CONFIRMATION_ATTEMPTS; attempt\+\+\)/.test(source));
check("fee estimation includes a gas margin", source.includes("BPAN_GAS_MARGIN_NUMERATOR = 12n"));
check("temporary BPAN providers are disposed", /estimateBPANFees[\s\S]*?finally \{[\s\S]*?provider\.destroy\?\.\(\)/.test(source));
check("registration broadcasts through the shared BPAN primitive", /confirmRegistration[\s\S]*?registerBPAN\([\s\S]*?tx\.wait\(\)[\s\S]*?completeRegistration/.test(source));
check("BPAN uses the shared pending-success-error overlay", txFxSource.includes('"bpan-register"') && txFxSource.includes('"bpan-map"') && source.includes("<TxResultOverlay"));
check("transaction results use a native modal above elevated screen borders", /<Modal[\s\S]*?presentationStyle="overFullScreen"/.test(txFxSource));
check("transaction result action stretches symmetrically across the card", txFxSource.includes('action: { alignSelf: "stretch", marginTop: 20 }'));
check("BPAN failures return to inline recovery instead of a centered retry modal", /setError\(message\);[\s\S]{0,80}onTxFx\(null\)/.test(source));
check("mapping button owns the remaining-work recovery action", source.includes('`Review ${plannedTx} remaining mappings`'));
check("confirmed mapping rows cannot be selected again", /mapped=\{mapped\}[\s\S]*?disabled=\{mapped\}/.test(source));
check("mapped rows expose disabled checked accessibility state", source.includes('accessibilityState={{ checked, disabled }}'));
check("BPAN screen does not promote saved values to owned", !source.includes("setOwned(saved)"));
check("BPAN screen clears ownership when verification fails", /catch \{[\s\S]*?setOwned\(\[\]\);[\s\S]*?setScanError\(true\)/.test(source));
check("wallet dashboard cache is registry-and-owner scoped", walletSource.includes("bpanOwnershipKey(owner)"));
check("wallet dashboard keeps the last confirmed BPAN through temporary RPC failure",
  /findOwnedBPANs\(owner\)[\s\S]*?catch \{[\s\S]*?temporary Base\/RPC failure/.test(walletSource));
check("wallet dashboard gates BPAN rendering by active wallet and owner",
  /bpanRecord\.walletId === walletScope[\s\S]*?bpanRecord\.owner === evmAddress\.toLowerCase\(\)/.test(walletSource));
check("ordinary balance refresh does not blank or restart BPAN discovery",
  !/const refresh = useCallback[\s\S]*?refreshBPAN\(\)[\s\S]*?\}, \[unlocked/.test(walletSource));

console.log(`bpan-flow: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
