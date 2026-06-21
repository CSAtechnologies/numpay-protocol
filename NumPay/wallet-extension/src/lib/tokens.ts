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
  // Optional risk signals (from Moralis). Surfaced on the token detail page.
  possibleSpam?: boolean;
  securityScore?: number;     // 0-100; lower = riskier (Moralis security_score)
  verifiedContract?: boolean;
  // Optional market data (e.g. DexScreener), used for spam classification.
  liquidityUsd?: number;
  marketCapUsd?: number;
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
    // Popular ERC-20 (addresses + decimals verified on-chain via ETH RPC).
    { symbol: "WETH",   name: "Wrapped Ether",     address: "0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2", decimals: 18, logo: `${TW}/ethereum/assets/0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2/logo.png` },
    { symbol: "stETH",  name: "Lido Staked ETH",   address: "0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84", decimals: 18, logo: `${TW}/ethereum/assets/0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84/logo.png` },
    { symbol: "wstETH", name: "Wrapped stETH",     address: "0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0", decimals: 18, logo: `${TW}/ethereum/assets/0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0/logo.png` },
    { symbol: "SHIB",   name: "Shiba Inu",         address: "0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE", decimals: 18, logo: `${TW}/ethereum/assets/0x95aD61b0a150d79219dCF64E1E6Cc01f0B64C4cE/logo.png` },
    { symbol: "PEPE",   name: "Pepe",              address: "0x6982508145454Ce325dDbE47a25d4ec3d2311933", decimals: 18, logo: `${TW}/ethereum/assets/0x6982508145454Ce325dDbE47a25d4ec3d2311933/logo.png` },
    { symbol: "LDO",    name: "Lido DAO",          address: "0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32", decimals: 18, logo: `${TW}/ethereum/assets/0x5A98FcBEA516Cf06857215779Fd812CA3beF1B32/logo.png` },
    { symbol: "CRV",    name: "Curve DAO",         address: "0xD533a949740bb3306d119CC777fa900bA034cd52", decimals: 18, logo: `${TW}/ethereum/assets/0xD533a949740bb3306d119CC777fa900bA034cd52/logo.png` },
    { symbol: "MKR",    name: "Maker",             address: "0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2", decimals: 18, logo: `${TW}/ethereum/assets/0x9f8F72aA9304c8B593d555F12eF6589cC3A579A2/logo.png` },
    { symbol: "FRAX",   name: "Frax",              address: "0x853d955aCEf822Db058eb8505911ED77F175b99e", decimals: 18, logo: `${TW}/ethereum/assets/0x853d955aCEf822Db058eb8505911ED77F175b99e/logo.png` },
    { symbol: "TUSD",   name: "TrueUSD",           address: "0x0000000000085d4780B73119b644AE5ecd22b376", decimals: 18, logo: `${TW}/ethereum/assets/0x0000000000085d4780B73119b644AE5ecd22b376/logo.png` },
    { symbol: "USDP",   name: "Pax Dollar",        address: "0x8E870D67F660D95d5be530380D0eC0bd388289E1", decimals: 18, logo: `${TW}/ethereum/assets/0x8E870D67F660D95d5be530380D0eC0bd388289E1/logo.png` },
    { symbol: "GRT",    name: "The Graph",         address: "0xc944E90C64B2c07662A292be6244BDf05Cda44a7", decimals: 18, logo: `${TW}/ethereum/assets/0xc944E90C64B2c07662A292be6244BDf05Cda44a7/logo.png` },
    { symbol: "SNX",    name: "Synthetix",         address: "0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F", decimals: 18, logo: `${TW}/ethereum/assets/0xC011a73ee8576Fb46F5E1c5751cA3B9Fe0af2a6F/logo.png` },
    { symbol: "COMP",   name: "Compound",          address: "0xc00e94Cb662C3520282E6f5717214004A7f26888", decimals: 18, logo: `${TW}/ethereum/assets/0xc00e94Cb662C3520282E6f5717214004A7f26888/logo.png` },
    { symbol: "1INCH",  name: "1inch",             address: "0x111111111117dC0aa78b770fA6A738034120C302", decimals: 18, logo: `${TW}/ethereum/assets/0x111111111117dC0aa78b770fA6A738034120C302/logo.png` },
    { symbol: "SAND",   name: "The Sandbox",       address: "0x3845badAde8e6dFF049820680d1F14bD3903a5d0", decimals: 18, logo: `${TW}/ethereum/assets/0x3845badAde8e6dFF049820680d1F14bD3903a5d0/logo.png` },
    { symbol: "MANA",   name: "Decentraland",      address: "0x0F5D2fB29fb7d3CFeE444a200298f468908cC942", decimals: 18, logo: `${TW}/ethereum/assets/0x0F5D2fB29fb7d3CFeE444a200298f468908cC942/logo.png` },
    { symbol: "APE",    name: "ApeCoin",           address: "0x4d224452801ACEd8B2F0aebE155379bb5D594381", decimals: 18, logo: `${TW}/ethereum/assets/0x4d224452801ACEd8B2F0aebE155379bb5D594381/logo.png` },
    { symbol: "RNDR",   name: "Render Token",      address: "0x6De037ef9aD2725EB40118Bb1702EBb27e4Aeb24", decimals: 18, logo: `${TW}/ethereum/assets/0x6De037ef9aD2725EB40118Bb1702EBb27e4Aeb24/logo.png` },
    { symbol: "GALA",   name: "Gala",              address: "0xd1d2Eb1B1e90B638588728b4130137D262C87cae", decimals: 8,  logo: `${TW}/ethereum/assets/0xd1d2Eb1B1e90B638588728b4130137D262C87cae/logo.png` },
    { symbol: "LRC",    name: "Loopring",          address: "0xBBbbCA6A901c926F240b89EacB641d8Aec7AEafD", decimals: 18, logo: `${TW}/ethereum/assets/0xBBbbCA6A901c926F240b89EacB641d8Aec7AEafD/logo.png` },
    { symbol: "PAXG",   name: "PAX Gold",          address: "0x45804880De22913dAFE09f4980848ECE6EcbAf78", decimals: 18, logo: `${TW}/ethereum/assets/0x45804880De22913dAFE09f4980848ECE6EcbAf78/logo.png` },
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
    // Popular BEP-20 tokens (all addresses + decimals verified on-chain via BSC RPC).
    { symbol: "BUSD",     name: "Binance USD",        address: "0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56", decimals: 18, logo: `${TW}/smartchain/assets/0xe9e7CEA3DedcA5984780Bafc599bD69ADd087D56/logo.png` },
    { symbol: "TUSD",     name: "TrueUSD",            address: "0x14016E85a25aeb13065688cAFB43044C2ef86784", decimals: 18, logo: `${TW}/smartchain/assets/0x14016E85a25aeb13065688cAFB43044C2ef86784/logo.png` },
    { symbol: "FDUSD",    name: "First Digital USD",  address: "0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409", decimals: 18, logo: `${TW}/smartchain/assets/0xc5f0f7b66764F6ec8C8Dff7BA683102295E16409/logo.png` },
    { symbol: "TWT",      name: "Trust Wallet Token", address: "0x4B0F1812e5Df2A09796481Ff14017e6005508003", decimals: 18, logo: `${TW}/smartchain/assets/0x4B0F1812e5Df2A09796481Ff14017e6005508003/logo.png` },
    { symbol: "LINK",     name: "Chainlink",          address: "0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD", decimals: 18, logo: `${TW}/smartchain/assets/0xF8A0BF9cF54Bb92F17374d9e9A321E6a111a51bD/logo.png` },
    { symbol: "DOT",      name: "Polkadot",           address: "0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402", decimals: 18, logo: `${TW}/smartchain/assets/0x7083609fCE4d1d8Dc0C979AAb8c869Ea2C873402/logo.png` },
    { symbol: "LTC",      name: "Litecoin",           address: "0x4338665CBB7B2485A8855A139b75D5e34AB0DB94", decimals: 18, logo: `${TW}/smartchain/assets/0x4338665CBB7B2485A8855A139b75D5e34AB0DB94/logo.png` },
    { symbol: "UNI",      name: "Uniswap",            address: "0xBf5140A22578168FD562DCcF235E5D43A02ce9B1", decimals: 18, logo: `${TW}/smartchain/assets/0xBf5140A22578168FD562DCcF235E5D43A02ce9B1/logo.png` },
    { symbol: "MATIC",    name: "Polygon",            address: "0xCC42724C6683B7E57334c4E856f4c9965ED682bD", decimals: 18, logo: `${TW}/smartchain/assets/0xCC42724C6683B7E57334c4E856f4c9965ED682bD/logo.png` },
    { symbol: "AVAX",     name: "Avalanche",          address: "0x1CE0c2827e2eF14D5C4f29a091d735A204794041", decimals: 18, logo: `${TW}/smartchain/assets/0x1CE0c2827e2eF14D5C4f29a091d735A204794041/logo.png` },
    { symbol: "ATOM",     name: "Cosmos",             address: "0x0Eb3a705fc54725037CC9e008bDede697f62F335", decimals: 18, logo: `${TW}/smartchain/assets/0x0Eb3a705fc54725037CC9e008bDede697f62F335/logo.png` },
    { symbol: "NEAR",     name: "NEAR Protocol",      address: "0x1Fa4a73a3F0133f0025378af00236f3aBDEE5D63", decimals: 18, logo: `${TW}/smartchain/assets/0x1Fa4a73a3F0133f0025378af00236f3aBDEE5D63/logo.png` },
    { symbol: "FIL",      name: "Filecoin",           address: "0x0D8Ce2A99Bb6e3B7Db580eD848240e4a0F9aE153", decimals: 18, logo: `${TW}/smartchain/assets/0x0D8Ce2A99Bb6e3B7Db580eD848240e4a0F9aE153/logo.png` },
    { symbol: "INJ",      name: "Injective",          address: "0xa2B726B1145A4773F68593CF171187d8EBe4d495", decimals: 18, logo: `${TW}/smartchain/assets/0xa2B726B1145A4773F68593CF171187d8EBe4d495/logo.png` },
    { symbol: "SHIB",     name: "Shiba Inu",          address: "0x2859e4544C4bB03966803b044A93563Bd2D0DD4D", decimals: 18, logo: `${TW}/smartchain/assets/0x2859e4544C4bB03966803b044A93563Bd2D0DD4D/logo.png` },
    { symbol: "TRX",      name: "TRON",               address: "0xCE7de646e7208a4Ef112cb6ed5038FA6cC6b12e3", decimals: 6,  logo: `${TW}/smartchain/assets/0xCE7de646e7208a4Ef112cb6ed5038FA6cC6b12e3/logo.png` },
    { symbol: "XVS",      name: "Venus",              address: "0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63", decimals: 18, logo: `${TW}/smartchain/assets/0xcF6BB5389c92Bdda8a3747Ddb454cB7a64626C63/logo.png` },
    { symbol: "BabyDoge", name: "Baby Doge Coin",     address: "0xc748673057861a797275CD8A068AbB95A902e8de", decimals: 9,  logo: `${TW}/smartchain/assets/0xc748673057861a797275CD8A068AbB95A902e8de/logo.png` },
    { symbol: "FLOKI",    name: "FLOKI",              address: "0xfb5B838b6cfEEdC2873aB27866079AC55363D37E", decimals: 9,  logo: `${TW}/smartchain/assets/0xfb5B838b6cfEEdC2873aB27866079AC55363D37E/logo.png` },
    { symbol: "ALPACA",   name: "Alpaca Finance",     address: "0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F", decimals: 18, logo: `${TW}/smartchain/assets/0x8F0528cE5eF7B51152A59745bEfDD91D97091d2F/logo.png` },
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
