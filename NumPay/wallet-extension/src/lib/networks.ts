import { ALCHEMY_KEY } from "./env";

// TrustWallet CDN base - higher quality logos than CoinGecko
const TW = "https://raw.githubusercontent.com/trustwallet/assets/master/blockchains";
const twLogo = (chain: string) => `${TW}/${chain}/info/logo.png`;

// ── BPAN Registry (Ethereum mainnet ONLY) ─────────────────────────────────────
// All chain mappings are stored here. Always query mainnet, regardless of
// which network the user is currently on.
export const BPAN_MAINNET_CONTRACT = "0xdB5206e06a7509b9181F0594752CD42cbD7eD371"; // V2
export const BPAN_SEPOLIA_CONTRACT  = "0xF2C65Bc0e54b5694c13d7c5E5Accf6DD93d7267a"; // V2
export const BPAN_MAINNET_RPC      = `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`;

// Independent Ethereum-mainnet read endpoints used to cross-check a BPAN
// resolution before it becomes a payment destination (TRUST-1). A single
// compromised or malicious RPC must not be able to silently redirect funds, so
// a funds-determining mapping is only trusted at "high" confidence when at
// least two of these independent providers return the same address. The primary
// is the configured Alchemy endpoint; the others are public full nodes verified
// to serve the `finalized` block tag from an extension origin (eth.drpc.org is
// covered by the existing *.drpc.org host permission; rpc.flashbots.net is
// added explicitly to the manifest).
export const BPAN_MAINNET_READ_RPCS: string[] = [
  BPAN_MAINNET_RPC,
  "https://eth.drpc.org",
  "https://rpc.flashbots.net",
];

export interface Network {
  id: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  symbol: string;
  decimals: number;
  explorer: string;
  logo: string;
  // bpanContract only set on Ethereum + Sepolia for direct contract interaction
  bpanContract?: string;
}

export const NETWORKS: Record<string, Network> = {
  // ── Mainnets ─────────────────────────────────────────────────────────────────
  ethereum: {
    id: "ethereum", name: "Ethereum", chainId: 1,
    rpcUrl: `https://eth-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    symbol: "ETH", decimals: 18,
    explorer: "https://etherscan.io",
    logo: twLogo("ethereum"),
    bpanContract: BPAN_MAINNET_CONTRACT,
  },
  polygon: {
    id: "polygon", name: "Polygon", chainId: 137,
    rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    symbol: "POL", decimals: 18,
    explorer: "https://polygonscan.com",
    logo: twLogo("polygon"),
  },
  arbitrum: {
    id: "arbitrum", name: "Arbitrum One", chainId: 42161,
    rpcUrl: "https://arbitrum.drpc.org",
    symbol: "ETH", decimals: 18,
    explorer: "https://arbiscan.io",
    logo: twLogo("arbitrum"),
  },
  optimism: {
    id: "optimism", name: "Optimism", chainId: 10,
    rpcUrl: "https://optimism.drpc.org",
    symbol: "ETH", decimals: 18,
    explorer: "https://optimistic.etherscan.io",
    logo: twLogo("optimism"),
  },
  base: {
    id: "base", name: "Base", chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    symbol: "ETH", decimals: 18,
    explorer: "https://basescan.org",
    logo: twLogo("base"),
  },
  avalanche: {
    id: "avalanche", name: "Avalanche", chainId: 43114,
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    symbol: "AVAX", decimals: 18,
    explorer: "https://snowtrace.io",
    logo: twLogo("avalanchec"),
  },
  bsc: {
    id: "bsc", name: "BNB Chain", chainId: 56,
    rpcUrl: "https://bsc.drpc.org",
    symbol: "BNB", decimals: 18,
    explorer: "https://bscscan.com",
    logo: twLogo("smartchain"),
  },
  zksync: {
    id: "zksync", name: "zkSync Era", chainId: 324,
    rpcUrl: "https://mainnet.era.zksync.io",
    symbol: "ETH", decimals: 18,
    explorer: "https://explorer.zksync.io",
    logo: twLogo("zksync"),
  },
  scroll: {
    id: "scroll", name: "Scroll", chainId: 534352,
    rpcUrl: "https://rpc.scroll.io",
    symbol: "ETH", decimals: 18,
    explorer: "https://scrollscan.com",
    logo: twLogo("scroll"),
  },
  linea: {
    id: "linea", name: "Linea", chainId: 59144,
    rpcUrl: "https://rpc.linea.build",
    symbol: "ETH", decimals: 18,
    explorer: "https://lineascan.build",
    logo: twLogo("linea"),
  },
  mantle: {
    id: "mantle", name: "Mantle", chainId: 5000,
    rpcUrl: "https://rpc.mantle.xyz",
    symbol: "MNT", decimals: 18,
    explorer: "https://mantlescan.xyz",
    logo: twLogo("mantle"),
  },
  blast: {
    id: "blast", name: "Blast", chainId: 81457,
    rpcUrl: "https://rpc.blast.io",
    symbol: "ETH", decimals: 18,
    explorer: "https://blastscan.io",
    logo: twLogo("blast"),
  },
  polygonzkevm: {
    id: "polygonzkevm", name: "Polygon zkEVM", chainId: 1101,
    rpcUrl: "https://zkevm-rpc.com",
    symbol: "ETH", decimals: 18,
    explorer: "https://zkevm.polygonscan.com",
    logo: twLogo("polygonzkevm"),
  },
  fantom: {
    id: "fantom", name: "Fantom", chainId: 250,
    rpcUrl: "https://rpc.fantom.network",
    symbol: "FTM", decimals: 18,
    explorer: "https://ftmscan.com",
    logo: twLogo("fantom"),
  },
  cronos: {
    id: "cronos", name: "Cronos", chainId: 25,
    rpcUrl: "https://cronos.drpc.org",
    symbol: "CRO", decimals: 18,
    explorer: "https://cronoscan.com",
    logo: twLogo("cronos"),
  },
  celo: {
    id: "celo", name: "Celo", chainId: 42220,
    rpcUrl: "https://forno.celo.org",
    symbol: "CELO", decimals: 18,
    explorer: "https://celoscan.io",
    logo: twLogo("celo"),
  },
  gnosis: {
    id: "gnosis", name: "Gnosis", chainId: 100,
    rpcUrl: "https://rpc.gnosischain.com",
    symbol: "xDAI", decimals: 18,
    explorer: "https://gnosisscan.io",
    logo: twLogo("xdai"),
  },
  moonbeam: {
    id: "moonbeam", name: "Moonbeam", chainId: 1284,
    rpcUrl: "https://rpc.api.moonbeam.network",
    symbol: "GLMR", decimals: 18,
    explorer: "https://moonscan.io",
    logo: twLogo("moonbeam"),
  },
  aurora: {
    id: "aurora", name: "Aurora", chainId: 1313161554,
    rpcUrl: "https://mainnet.aurora.dev",
    symbol: "ETH", decimals: 18,
    explorer: "https://aurorascan.dev",
    logo: twLogo("aurora"),
  },
  sei: {
    id: "sei", name: "Sei", chainId: 1329,
    rpcUrl: "https://evm-rpc.sei-apis.com",
    symbol: "SEI", decimals: 18,
    explorer: "https://seitrace.com",
    logo: twLogo("sei"),
  },
  klaytn: {
    id: "klaytn", name: "Klaytn", chainId: 8217,
    rpcUrl: "https://public-en-cypress.klaytn.net",
    symbol: "KLAY", decimals: 18,
    explorer: "https://scope.klaytn.com",
    logo: twLogo("klaytn"),
  },
  metis: {
    id: "metis", name: "Metis", chainId: 1088,
    rpcUrl: "https://andromeda.metis.io/?owner=1088",
    symbol: "METIS", decimals: 18,
    explorer: "https://andromeda-explorer.metis.io",
    logo: twLogo("metis"),
  },
  // ── Testnet ──────────────────────────────────────────────────────────────────
  sepolia: {
    id: "sepolia", name: "Sepolia", chainId: 11155111,
    rpcUrl: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    symbol: "ETH", decimals: 18,
    explorer: "https://sepolia.etherscan.io",
    logo: twLogo("ethereum"),
    bpanContract: BPAN_SEPOLIA_CONTRACT,
  },
};

export const DEFAULT_NETWORK = "ethereum";

// Maps a network ID to the BPAN chain name used in the registry.
// Testnets → mainnet chain name. Most networks keep their own ID.
export function bpanChainName(networkId: string): string {
  const overrides: Record<string, string> = {
    sepolia: "ethereum",
    avalanche: "avalanche",
    bsc: "bsc",
    polygonzkevm: "polygonzkevm",
    cronos: "cronos",
    gnosis: "gnosis",
    moonbeam: "moonbeam",
    aurora: "aurora",
    klaytn: "klaytn",
    metis: "metis",
  };
  return overrides[networkId] ?? networkId;
}

// All chains supported for BPAN wallet mappings stored on Ethereum mainnet.
// EVM chains use the network ID as chain name. Non-EVM use their own IDs.
export const BPAN_CHAINS = [
  // ── EVM chains ──────────────────────────────────────────────────────────────
  { id: "ethereum",    name: "Ethereum",       logo: twLogo("ethereum"),    isEVM: true  },
  { id: "polygon",     name: "Polygon",        logo: twLogo("polygon"),     isEVM: true  },
  { id: "arbitrum",    name: "Arbitrum One",   logo: twLogo("arbitrum"),    isEVM: true  },
  { id: "optimism",    name: "Optimism",       logo: twLogo("optimism"),    isEVM: true  },
  { id: "base",        name: "Base",           logo: twLogo("base"),        isEVM: true  },
  { id: "avalanche",   name: "Avalanche",      logo: twLogo("avalanchec"),  isEVM: true  },
  { id: "bsc",         name: "BNB Chain",      logo: twLogo("smartchain"),  isEVM: true  },
  { id: "zksync",      name: "zkSync Era",     logo: twLogo("zksync"),      isEVM: true  },
  { id: "scroll",      name: "Scroll",         logo: twLogo("scroll"),      isEVM: true  },
  { id: "linea",       name: "Linea",          logo: twLogo("linea"),       isEVM: true  },
  { id: "mantle",      name: "Mantle",         logo: twLogo("mantle"),      isEVM: true  },
  { id: "blast",       name: "Blast",          logo: twLogo("blast"),       isEVM: true  },
  { id: "polygonzkevm",name: "Polygon zkEVM",  logo: twLogo("polygonzkevm"),isEVM: true  },
  { id: "fantom",      name: "Fantom",         logo: twLogo("fantom"),      isEVM: true  },
  { id: "cronos",      name: "Cronos",         logo: twLogo("cronos"),      isEVM: true  },
  { id: "celo",        name: "Celo",           logo: twLogo("celo"),        isEVM: true  },
  { id: "gnosis",      name: "Gnosis",         logo: twLogo("xdai"),        isEVM: true  },
  { id: "moonbeam",    name: "Moonbeam",       logo: twLogo("moonbeam"),    isEVM: true  },
  { id: "aurora",      name: "Aurora",         logo: twLogo("aurora"),      isEVM: true  },
  { id: "sei",         name: "Sei",            logo: twLogo("sei"),         isEVM: true  },
  { id: "klaytn",      name: "Klaytn",         logo: twLogo("klaytn"),      isEVM: true  },
  { id: "metis",       name: "Metis",          logo: twLogo("metis"),       isEVM: true  },
  // ── Non-EVM chains ──────────────────────────────────────────────────────────
  { id: "solana",      name: "Solana",         logo: twLogo("solana"),      isEVM: false },
  { id: "bitcoin",     name: "Bitcoin",        logo: twLogo("bitcoin"),     isEVM: false },
  { id: "tron",        name: "Tron",           logo: twLogo("tron"),        isEVM: false },
  { id: "xrp",         name: "XRP Ledger",     logo: twLogo("ripple"),      isEVM: false },
  { id: "sui",         name: "Sui",            logo: twLogo("sui"),         isEVM: false },
  { id: "litecoin",    name: "Litecoin",       logo: twLogo("litecoin"),    isEVM: false },
] as const;

export type BPANChainId = typeof BPAN_CHAINS[number]["id"];
