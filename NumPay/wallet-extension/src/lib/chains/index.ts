/**
 * Multi-chain wallet aggregator.
 * Derives addresses and fetches balances for all supported non-EVM chains.
 */
import { deriveBitcoinAddress,  fetchBitcoinBalance  } from "./bitcoin";
import { deriveSolanaAddress,   fetchSolanaBalance   } from "./solana";
import { deriveSuiAddress,      fetchSuiBalance      } from "./sui";
import { deriveTronAddress,     fetchTronBalance      } from "./tron";
import { deriveXrpAddress,      fetchXrpBalance       } from "./xrp";
import { deriveLitecoinAddress, fetchLitecoinBalance  } from "./litecoin";

export interface NonEvmChain {
  id: string;
  name: string;
  symbol: string;
  decimals: number;
  icon: string;
  logo: string;
  address: string;
  balance: number;
  explorer: string;
}

export interface NonEvmWallet {
  bitcoin:  { address: string; privateKey: string };
  solana:   { address: string; secretKey: Uint8Array };
  sui:      { address: string; secretKey: Uint8Array };
  tron:     { address: string; privateKey: string };
  xrp:      { address: string; privateKey: string };
  litecoin: { address: string; privateKey: string };
}

const CG = "https://assets.coingecko.com/coins/images";

/** Derive all non-EVM addresses from a mnemonic. */
export async function deriveNonEvmAddresses(mnemonic: string): Promise<NonEvmWallet> {
  const [btc, sol, sui, trx, xrp, ltc] = await Promise.all([
    Promise.resolve(deriveBitcoinAddress(mnemonic)),
    deriveSolanaAddress(mnemonic),
    deriveSuiAddress(mnemonic),
    Promise.resolve(deriveTronAddress(mnemonic)),
    Promise.resolve(deriveXrpAddress(mnemonic)),
    Promise.resolve(deriveLitecoinAddress(mnemonic)),
  ]);

  return {
    bitcoin:  { address: btc.address,  privateKey: btc.privateKey },
    solana:   { address: sol.address,  secretKey:  sol.secretKey  },
    sui:      { address: sui.address,  secretKey:  sui.secretKey  },
    tron:     { address: trx.address,  privateKey: trx.privateKey },
    xrp:      { address: xrp.address,  privateKey: xrp.privateKey },
    litecoin: { address: ltc.address,  privateKey: ltc.privateKey },
  };
}

/** Fetch balances for all non-EVM chains. */
export async function fetchNonEvmBalances(wallet: NonEvmWallet): Promise<NonEvmChain[]> {
  const timeout = (ms: number) =>
    new Promise<number>((_, r) => setTimeout(() => r(0), ms));

  const [btcBal, solBal, suiBal, trxBal, xrpBal, ltcBal] = await Promise.all([
    Promise.race([fetchBitcoinBalance(wallet.bitcoin.address),   timeout(5000)]).catch(() => 0),
    Promise.race([fetchSolanaBalance(wallet.solana.address),     timeout(5000)]).catch(() => 0),
    Promise.race([fetchSuiBalance(wallet.sui.address),           timeout(5000)]).catch(() => 0),
    Promise.race([fetchTronBalance(wallet.tron.address),         timeout(5000)]).catch(() => 0),
    Promise.race([fetchXrpBalance(wallet.xrp.address),           timeout(5000)]).catch(() => 0),
    Promise.race([fetchLitecoinBalance(wallet.litecoin.address), timeout(5000)]).catch(() => 0),
  ]);

  return [
    {
      id: "bitcoin",  name: "Bitcoin",    symbol: "BTC", decimals: 8,
      icon: "B", logo: `${CG}/1/small/bitcoin.png`,
      address: wallet.bitcoin.address,  balance: btcBal as number,
      explorer: "https://blockstream.info",
    },
    {
      id: "solana",   name: "Solana",     symbol: "SOL", decimals: 9,
      icon: "S", logo: `${CG}/4128/small/solana.png`,
      address: wallet.solana.address,   balance: solBal as number,
      explorer: "https://solscan.io",
    },
    {
      id: "sui",      name: "Sui",        symbol: "SUI", decimals: 9,
      icon: "S", logo: `${CG}/26375/small/sui-ocean-square.png`,
      address: wallet.sui.address,      balance: suiBal as number,
      explorer: "https://suiscan.xyz",
    },
    {
      id: "tron",     name: "Tron",       symbol: "TRX", decimals: 6,
      icon: "T", logo: `${CG}/1094/small/tron-logo.png`,
      address: wallet.tron.address,     balance: trxBal as number,
      explorer: "https://tronscan.org/#/transaction",
    },
    {
      id: "xrp",      name: "XRP Ledger", symbol: "XRP", decimals: 6,
      icon: "X", logo: `${CG}/44/small/xrp-symbol-white-128.png`,
      address: wallet.xrp.address,      balance: xrpBal as number,
      explorer: "https://xrpscan.com/tx",
    },
    {
      id: "litecoin", name: "Litecoin",   symbol: "LTC", decimals: 8,
      icon: "L", logo: `${CG}/2/small/litecoin.png`,
      address: wallet.litecoin.address, balance: ltcBal as number,
      explorer: "https://litecoinspace.org/tx",
    },
  ];
}

export { deriveBitcoinAddress,  fetchBitcoinBalance  } from "./bitcoin";
export { deriveSolanaAddress,   fetchSolanaBalance, sendSolanaTransfer, fetchSolanaTokens } from "./solana";
export { deriveSuiAddress,      fetchSuiBalance, fetchSuiTokens } from "./sui";
export { deriveTronAddress,     fetchTronBalance, fetchTronTokens } from "./tron";
export { deriveXrpAddress,      fetchXrpBalance       } from "./xrp";
export { deriveLitecoinAddress, fetchLitecoinBalance  } from "./litecoin";
