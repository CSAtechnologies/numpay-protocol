// EVM-ONLY page-world entry. Same provider as index.ts, without the Solana
// surface.
//
// This exists for the NumPay mobile in-app browser, whose router speaks EIP-1193
// only. Injecting the full index.ts there would also install window.solana and
// register NumPay through the Wallet Standard, so a Solana dApp would pick
// NumPay from its wallet list and then fail every single call — strictly worse
// than NumPay not appearing at all. When the mobile Solana surface lands, this
// entry goes away and mobile injects index.ts like the extension does.
import "./provider"; // EVM: window.ethereum + EIP-6963
