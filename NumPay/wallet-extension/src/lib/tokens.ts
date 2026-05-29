import { ethers } from "ethers";

export interface Token {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  logo?: string;
  balance?: string;
  // Optional live USD price (set by fetchers that resolve it, e.g. Jupiter/DexScreener).
  priceUsd?: number;
}

const ERC20_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function transfer(address to, uint256 amount) returns (bool)",
];

const TW = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";

// Well-known tokens per chain (chainId → tokens).
// Logos use TrustWallet CDN for high quality icons.
export const DEFAULT_TOKENS: Record<number, Token[]> = {
  // ── Ethereum mainnet ───────────────────────────────────────────────────────
  1: [
    { symbol: "USDT", name: "Tether USD",  address: "0xdAC17F958D2ee523a2206206994597C13D831ec7", decimals: 6,  logo: `${TW}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png` },
    { symbol: "USDC", name: "USD Coin",    address: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
    { symbol: "DAI",  name: "Dai",         address: "0x6B175474E89094C44Da98b954EedeAC495271d0F", decimals: 18, logo: `${TW}/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png` },
    { symbol: "WBTC", name: "Wrapped BTC", address: "0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599", decimals: 8,  logo: `${TW}/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png` },
    { symbol: "LINK", name: "Chainlink",   address: "0x514910771AF9Ca656af840dff83E8264EcF986CA", decimals: 18, logo: `${TW}/ethereum/assets/0x514910771AF9Ca656af840dff83E8264EcF986CA/logo.png` },
    { symbol: "UNI",  name: "Uniswap",     address: "0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984", decimals: 18, logo: `${TW}/ethereum/assets/0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984/logo.png` },
    { symbol: "AAVE", name: "Aave",        address: "0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9", decimals: 18, logo: `${TW}/ethereum/assets/0x7Fc66500c84A76Ad7e9c93437bFc5Ac33E2DDaE9/logo.png` },
  ],
  // ── Sepolia ────────────────────────────────────────────────────────────────
  11155111: [],
  // ── Polygon ────────────────────────────────────────────────────────────────
  137: [
    { symbol: "USDT", name: "Tether USD", address: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F", decimals: 6,  logo: `${TW}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png` },
    { symbol: "USDC", name: "USD Coin",   address: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
    { symbol: "DAI",  name: "Dai",        address: "0x8f3Cf7ad23Cd3CaDbD9735AFf958023239c6A063", decimals: 18, logo: `${TW}/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png` },
    { symbol: "WBTC", name: "Wrapped BTC",address: "0x1BFD67037B42Cf73acF2047067bd4F2C47D9BfD6", decimals: 8,  logo: `${TW}/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png` },
  ],
  // ── Arbitrum One ───────────────────────────────────────────────────────────
  42161: [
    { symbol: "USDT", name: "Tether USD", address: "0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9", decimals: 6,  logo: `${TW}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png` },
    { symbol: "USDC", name: "USD Coin",   address: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
    { symbol: "ARB",  name: "Arbitrum",   address: "0x912CE59144191C1204E64559FE8253a0e49E6548", decimals: 18, logo: `${TW}/arbitrum/info/logo.png` },
    { symbol: "WBTC", name: "Wrapped BTC",address: "0x2f2a2543B76A4166549F7aaB2e75Bef0aefC5B0f", decimals: 8,  logo: `${TW}/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png` },
    { symbol: "LINK", name: "Chainlink",  address: "0xf97f4df75117a78c1A5a0DBb814Af92458539FB4", decimals: 18, logo: `${TW}/ethereum/assets/0x514910771AF9Ca656af840dff83E8264EcF986CA/logo.png` },
  ],
  // ── Optimism ───────────────────────────────────────────────────────────────
  10: [
    { symbol: "USDT", name: "Tether USD", address: "0x94b008aA00579c1307B0EF2c499aD98a8ce58e58", decimals: 6,  logo: `${TW}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png` },
    { symbol: "USDC", name: "USD Coin",   address: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
    { symbol: "OP",   name: "Optimism",   address: "0x4200000000000000000000000000000000000042", decimals: 18, logo: `${TW}/optimism/info/logo.png` },
    { symbol: "WBTC", name: "Wrapped BTC",address: "0x68f180fcCe6836688e9084f035309E29Bf0A2095", decimals: 8,  logo: `${TW}/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png` },
  ],
  // ── Base ───────────────────────────────────────────────────────────────────
  8453: [
    { symbol: "USDC", name: "USD Coin",   address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
    { symbol: "DAI",  name: "Dai",        address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", decimals: 18, logo: `${TW}/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png` },
  ],
  // ── Avalanche C-Chain ──────────────────────────────────────────────────────
  43114: [
    { symbol: "USDT",  name: "Tether USD",   address: "0x9702230A8Ea53601f5cD2dc00fDBc13d4dF4A8c7", decimals: 6,  logo: `${TW}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png` },
    { symbol: "USDC",  name: "USD Coin",      address: "0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
    { symbol: "WAVAX", name: "Wrapped AVAX",  address: "0xB31f66AA3C1e785363F0875A1B74E27b85FD66c7", decimals: 18, logo: `${TW}/avalanchec/info/logo.png` },
    { symbol: "WBTC",  name: "Wrapped BTC",   address: "0x50b7545627a5162F82A992c33b87aDc75187B218", decimals: 8,  logo: `${TW}/ethereum/assets/0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599/logo.png` },
    { symbol: "WETH",  name: "Wrapped ETH",   address: "0x49D5c2BdFfac6CE2BFdB6640F4F80f226bc10bAB", decimals: 18, logo: `${TW}/ethereum/info/logo.png` },
  ],
  // ── BNB Chain ─────────────────────────────────────────────────────────────
  56: [
    { symbol: "USDT", name: "Tether USD",      address: "0x55d398326f99059fF775485246999027B3197955", decimals: 18, logo: `${TW}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png` },
    { symbol: "USDC", name: "USD Coin",         address: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d", decimals: 18, logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
    { symbol: "DAI",  name: "Dai",              address: "0x1AF3F329e8BE154074D8769D1FFa4eE058B1DBc3", decimals: 18, logo: `${TW}/ethereum/assets/0x6B175474E89094C44Da98b954EedeAC495271d0F/logo.png` },
    { symbol: "CAKE", name: "PancakeSwap",      address: "0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82", decimals: 18, logo: `${TW}/smartchain/assets/0x0E09FaBB73Bd3Ade0a17ECC321fD13a19e81cE82/logo.png` },
    { symbol: "WBNB", name: "Wrapped BNB",      address: "0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c", decimals: 18, logo: `${TW}/smartchain/assets/0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c/logo.png` },
    { symbol: "ETH",  name: "Ethereum Token",   address: "0x2170Ed0880ac9A755fd29B2688956BD959F933F8", decimals: 18, logo: `${TW}/ethereum/info/logo.png` },
    { symbol: "BTCB", name: "Bitcoin BEP2",     address: "0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c", decimals: 18, logo: `${TW}/bitcoin/info/logo.png` },
    { symbol: "XRP",  name: "XRP Token",        address: "0x1D2F0da169ceB9fC7B3144628dB156f3F6c60dBE", decimals: 18, logo: `${TW}/ripple/info/logo.png` },
    { symbol: "ADA",  name: "Cardano Token",    address: "0x3EE2200Efb3400fAbB9AacF31297cBdD1d435D47", decimals: 18, logo: `${TW}/cardano/info/logo.png` },
    { symbol: "DOGE", name: "Dogecoin Token",   address: "0xbA2aE424d960c26247Dd6c32edC70B295c744C43",  decimals: 8,  logo: `${TW}/doge/info/logo.png` },
  ],
  // ── zkSync Era ─────────────────────────────────────────────────────────────
  324: [
    { symbol: "USDC", name: "USD Coin",   address: "0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
    { symbol: "USDT", name: "Tether USD", address: "0x493257fD37EDB34451f62EDf8D2a0C418852bA4C", decimals: 6,  logo: `${TW}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png` },
  ],
  // ── Scroll ─────────────────────────────────────────────────────────────────
  534352: [
    { symbol: "USDC", name: "USD Coin",   address: "0x06eFdBFf2a14a7c8E15944D1F4A48F9F95F663A4", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
  ],
  // ── Linea ─────────────────────────────────────────────────────────────────
  59144: [
    { symbol: "USDC", name: "USD Coin",   address: "0x176211869cA2b568f2A7D4EE941E073a821EE1ff", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
  ],
  // ── Fantom ─────────────────────────────────────────────────────────────────
  250: [
    { symbol: "USDC", name: "USD Coin",   address: "0x04068DA6C83AFCFA0e13ba15A6696662335D5B75", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
  ],
  // ── Cronos ─────────────────────────────────────────────────────────────────
  25: [
    { symbol: "USDC", name: "USD Coin",   address: "0xc21223249CA28397B4B6541dfFaEcC539BfF0c59", decimals: 6,  logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
    { symbol: "USDT", name: "Tether USD", address: "0x66e428c3f67a68878562e79A0234c1F83c208770", decimals: 6,  logo: `${TW}/ethereum/assets/0xdAC17F958D2ee523a2206206994597C13D831ec7/logo.png` },
  ],
  // ── Celo ───────────────────────────────────────────────────────────────────
  42220: [
    { symbol: "cUSD", name: "Celo Dollar", address: "0x765DE816845861e75A25fCA122bb6898B8B1282a", decimals: 18, logo: `${TW}/ethereum/assets/0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48/logo.png` },
  ],
};

export async function getTokenBalance(
  tokenAddress: string,
  walletAddress: string,
  provider: ethers.Provider
): Promise<string> {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, provider);
  const [balance, decimals] = await Promise.all([
    contract.balanceOf(walletAddress),
    contract.decimals(),
  ]);
  return ethers.formatUnits(balance, decimals);
}

export async function sendToken(
  tokenAddress: string,
  to: string,
  amount: string,
  decimals: number,
  signer: ethers.Signer
): Promise<ethers.TransactionResponse> {
  const contract = new ethers.Contract(tokenAddress, ERC20_ABI, signer);
  return contract.transfer(to, ethers.parseUnits(amount, decimals));
}
