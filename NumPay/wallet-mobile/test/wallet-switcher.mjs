import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const app = fs.readFileSync(path.join(root, "App.tsx"), "utf8");
const sheet = fs.readFileSync(path.join(root, "src/ui/WalletSwitcherSheet.tsx"), "utf8");
const wallet = fs.readFileSync(path.join(root, "src/wallet/useMobileWallet.ts"), "utf8");
let passed = 0, failed = 0;
const check = (name, condition) => {
  if (condition) passed++;
  else { failed++; console.error(`FAIL ${name}`); }
};

check("dashboard account control opens the wallet switcher",
  app.includes("onAccounts={openWalletSwitcher}"));
check("switcher loads every wallet's saved balance without switching",
  app.includes("loadWalletPortfolioSummary(wallet.id)"));
check("active wallet uses its live balance",
  sheet.includes("active ? liveBalanceUsd : balances[wallet.id]"));
check("switcher shows wallet identity and balance",
  sheet.includes("<WalletAvatar") && sheet.includes("{balance}"));
check("switcher exposes active selection to accessibility",
  sheet.includes("accessibilityState={{ selected: active }}"));
check("wallet data is scoped before rendering a switched account",
  wallet.includes("dataWalletId.current === walletScope"));
check("switcher includes a route to full wallet management",
  sheet.includes('label="Manage wallets"'));

console.log(`wallet-switcher: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
