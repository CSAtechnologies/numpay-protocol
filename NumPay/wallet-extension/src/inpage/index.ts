// Single MAIN-world entry: injects both wallet surfaces from one IIFE bundle.
import "./provider"; // EVM: window.ethereum + EIP-6963
import "./solana"; // Solana: window.solana + Wallet Standard
