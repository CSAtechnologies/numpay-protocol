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
import { chainLogoAsset } from "../icons/assets";

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

/** Public receive addresses for every non-EVM chain — no key material. */
export type NonEvmAddressMap = {
  bitcoin: string; solana: string; sui: string; tron: string; xrp: string; litecoin: string;
};

/**
 * Fetch balances for all non-EVM chains from public addresses only. Used by
 * the popup (via fetchNonEvmBalances) and by the background refresher, which
 * has no unlocked wallet — just the watch-address registry.
 */
export async function fetchNonEvmBalancesByAddress(a: NonEvmAddressMap): Promise<NonEvmChain[]> {
  const timeout = (ms: number) =>
    new Promise<number>((_, r) => setTimeout(() => r(0), ms));

  const [btcBal, solBal, suiBal, trxBal, xrpBal, ltcBal] = await Promise.all([
    Promise.race([fetchBitcoinBalance(a.bitcoin),   timeout(5000)]).catch(() => 0),
    Promise.race([fetchSolanaBalance(a.solana),     timeout(5000)]).catch(() => 0),
    Promise.race([fetchSuiBalance(a.sui),           timeout(5000)]).catch(() => 0),
    Promise.race([fetchTronBalance(a.tron),         timeout(5000)]).catch(() => 0),
    Promise.race([fetchXrpBalance(a.xrp),           timeout(5000)]).catch(() => 0),
    Promise.race([fetchLitecoinBalance(a.litecoin), timeout(5000)]).catch(() => 0),
  ]);

  return [
    {
      id: "bitcoin",  name: "Bitcoin",    symbol: "BTC", decimals: 8,
      icon: "B", logo: chainLogoAsset("bitcoin"),
      address: a.bitcoin,  balance: btcBal as number,
      explorer: "https://blockstream.info",
    },
    {
      id: "solana",   name: "Solana",     symbol: "SOL", decimals: 9,
      icon: "S", logo: chainLogoAsset("solana"),
      address: a.solana,   balance: solBal as number,
      explorer: "https://solscan.io",
    },
    {
      id: "sui",      name: "Sui",        symbol: "SUI", decimals: 9,
      icon: "S", logo: chainLogoAsset("sui"),
      address: a.sui,      balance: suiBal as number,
      explorer: "https://suiscan.xyz",
    },
    {
      id: "tron",     name: "Tron",       symbol: "TRX", decimals: 6,
      icon: "T", logo: chainLogoAsset("tron"),
      address: a.tron,     balance: trxBal as number,
      explorer: "https://tronscan.org/#/transaction",
    },
    {
      id: "xrp",      name: "XRP Ledger", symbol: "XRP", decimals: 6,
      icon: "X", logo: chainLogoAsset("xrp"),
      address: a.xrp,      balance: xrpBal as number,
      explorer: "https://xrpscan.com/tx",
    },
    {
      id: "litecoin", name: "Litecoin",   symbol: "LTC", decimals: 8,
      icon: "L", logo: chainLogoAsset("litecoin"),
      address: a.litecoin, balance: ltcBal as number,
      explorer: "https://litecoinspace.org/tx",
    },
  ];
}

/** Fetch balances for all non-EVM chains. */
export async function fetchNonEvmBalances(wallet: NonEvmWallet): Promise<NonEvmChain[]> {
  return fetchNonEvmBalancesByAddress({
    bitcoin: wallet.bitcoin.address, solana: wallet.solana.address, sui: wallet.sui.address,
    tron: wallet.tron.address, xrp: wallet.xrp.address, litecoin: wallet.litecoin.address,
  });
}

export { deriveBitcoinAddress,  fetchBitcoinBalance  } from "./bitcoin";
export { deriveSolanaAddress,   fetchSolanaBalance, sendSolanaTransfer, sendSolanaTokenTransfer, fetchSolanaTokens } from "./solana";
export { deriveSuiAddress,      fetchSuiBalance, fetchSuiTokens, sendSuiTransfer, sendSuiTokenTransfer } from "./sui";
export { deriveTronAddress,     fetchTronBalance, fetchTronTokens, sendTronTransfer, sendTronTokenTransfer } from "./tron";
export { deriveXrpAddress,      fetchXrpBalance       } from "./xrp";
export { deriveLitecoinAddress, fetchLitecoinBalance  } from "./litecoin";
