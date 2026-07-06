import { ALCHEMY_KEY } from "./env";
// Chain logos ship inside the extension (public/chain-logos, keyed by network
// id) so every icon paints instantly with no CDN round-trip.
import { chainLogoAsset as logoOf } from "./icons/assets";

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
    logo: logoOf("ethereum"),
    bpanContract: BPAN_MAINNET_CONTRACT,
  },
  polygon: {
    id: "polygon", name: "Polygon", chainId: 137,
    rpcUrl: `https://polygon-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    symbol: "POL", decimals: 18,
    explorer: "https://polygonscan.com",
    logo: logoOf("polygon"),
  },
  arbitrum: {
    id: "arbitrum", name: "Arbitrum One", chainId: 42161,
    rpcUrl: "https://arbitrum.drpc.org",
    symbol: "ETH", decimals: 18,
    explorer: "https://arbiscan.io",
    logo: logoOf("arbitrum"),
  },
  optimism: {
    id: "optimism", name: "Optimism", chainId: 10,
    rpcUrl: "https://optimism.drpc.org",
    symbol: "ETH", decimals: 18,
    explorer: "https://optimistic.etherscan.io",
    logo: logoOf("optimism"),
  },
  base: {
    id: "base", name: "Base", chainId: 8453,
    rpcUrl: "https://mainnet.base.org",
    symbol: "ETH", decimals: 18,
    explorer: "https://basescan.org",
    logo: logoOf("base"),
  },
  avalanche: {
    id: "avalanche", name: "Avalanche", chainId: 43114,
    rpcUrl: "https://api.avax.network/ext/bc/C/rpc",
    symbol: "AVAX", decimals: 18,
    explorer: "https://snowtrace.io",
    logo: logoOf("avalanche"),
  },
  bsc: {
    id: "bsc", name: "BNB Chain", chainId: 56,
    // Official BNB dataseed, NOT bsc.drpc.org: drpc's free BSC endpoint
    // rate-limits bursts (measured 2026-07-06: 9 of 15 sequential calls
    // rejected), which stalled swap receipt polling for minutes.
    rpcUrl: "https://bsc-dataseed.bnbchain.org",
    symbol: "BNB", decimals: 18,
    explorer: "https://bscscan.com",
    logo: logoOf("bsc"),
  },
  zksync: {
    id: "zksync", name: "zkSync Era", chainId: 324,
    rpcUrl: "https://mainnet.era.zksync.io",
    symbol: "ETH", decimals: 18,
    explorer: "https://explorer.zksync.io",
    logo: logoOf("zksync"),
  },
  scroll: {
    id: "scroll", name: "Scroll", chainId: 534352,
    rpcUrl: "https://rpc.scroll.io",
    symbol: "ETH", decimals: 18,
    explorer: "https://scrollscan.com",
    logo: logoOf("scroll"),
  },
  linea: {
    id: "linea", name: "Linea", chainId: 59144,
    rpcUrl: "https://rpc.linea.build",
    symbol: "ETH", decimals: 18,
    explorer: "https://lineascan.build",
    logo: logoOf("linea"),
  },
  mantle: {
    id: "mantle", name: "Mantle", chainId: 5000,
    rpcUrl: "https://rpc.mantle.xyz",
    symbol: "MNT", decimals: 18,
    explorer: "https://mantlescan.xyz",
    logo: logoOf("mantle"),
  },
  blast: {
    id: "blast", name: "Blast", chainId: 81457,
    rpcUrl: "https://rpc.blast.io",
    symbol: "ETH", decimals: 18,
    explorer: "https://blastscan.io",
    logo: logoOf("blast"),
  },
  polygonzkevm: {
    id: "polygonzkevm", name: "Polygon zkEVM", chainId: 1101,
    rpcUrl: "https://zkevm-rpc.com",
    symbol: "ETH", decimals: 18,
    explorer: "https://zkevm.polygonscan.com",
    logo: logoOf("polygonzkevm"),
  },
  fantom: {
    id: "fantom", name: "Fantom", chainId: 250,
    rpcUrl: "https://rpc.fantom.network",
    symbol: "FTM", decimals: 18,
    explorer: "https://ftmscan.com",
    logo: logoOf("fantom"),
  },
  cronos: {
    id: "cronos", name: "Cronos", chainId: 25,
    rpcUrl: "https://cronos.drpc.org",
    symbol: "CRO", decimals: 18,
    explorer: "https://cronoscan.com",
    logo: logoOf("cronos"),
  },
  celo: {
    id: "celo", name: "Celo", chainId: 42220,
    rpcUrl: "https://forno.celo.org",
    symbol: "CELO", decimals: 18,
    explorer: "https://celoscan.io",
    logo: logoOf("celo"),
  },
  gnosis: {
    id: "gnosis", name: "Gnosis", chainId: 100,
    rpcUrl: "https://rpc.gnosischain.com",
    symbol: "xDAI", decimals: 18,
    explorer: "https://gnosisscan.io",
    logo: logoOf("gnosis"),
  },
  moonbeam: {
    id: "moonbeam", name: "Moonbeam", chainId: 1284,
    rpcUrl: "https://rpc.api.moonbeam.network",
    symbol: "GLMR", decimals: 18,
    explorer: "https://moonscan.io",
    logo: logoOf("moonbeam"),
  },
  aurora: {
    id: "aurora", name: "Aurora", chainId: 1313161554,
    rpcUrl: "https://mainnet.aurora.dev",
    symbol: "ETH", decimals: 18,
    explorer: "https://aurorascan.dev",
    logo: logoOf("aurora"),
  },
  sei: {
    id: "sei", name: "Sei", chainId: 1329,
    rpcUrl: "https://evm-rpc.sei-apis.com",
    symbol: "SEI", decimals: 18,
    explorer: "https://seitrace.com",
    logo: logoOf("sei"),
  },
  klaytn: {
    id: "klaytn", name: "Klaytn", chainId: 8217,
    // Klaytn rebranded to Kaia; public-en-cypress.klaytn.net is decommissioned
    // (dead 12/12 in the 2026-07-06 endpoint sweep). Kaia successor verified
    // 12/12 with chainId 0x2019. Display name/symbol rebrand handled separately.
    rpcUrl: "https://public-en.node.kaia.io",
    symbol: "KLAY", decimals: 18,
    explorer: "https://kaiascan.io",
    logo: logoOf("klaytn"),
  },
  metis: {
    id: "metis", name: "Metis", chainId: 1088,
    rpcUrl: "https://andromeda.metis.io/?owner=1088",
    symbol: "METIS", decimals: 18,
    explorer: "https://andromeda-explorer.metis.io",
    logo: logoOf("metis"),
  },
  // ── Testnet ──────────────────────────────────────────────────────────────────
  sepolia: {
    id: "sepolia", name: "Sepolia", chainId: 11155111,
    rpcUrl: `https://eth-sepolia.g.alchemy.com/v2/${ALCHEMY_KEY}`,
    symbol: "ETH", decimals: 18,
    explorer: "https://sepolia.etherscan.io",
    logo: logoOf("ethereum"),
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
// Ordered by how commonly the coins are used (popular L1s first), so the Send
// and BPAN chain pickers lead with the chains people actually reach for and the
// long tail of EVM L2s follows. `isEVM` is per-chain, not positional, so the
// order is free to interleave EVM and non-EVM.
export const BPAN_CHAINS = [
  // ── Commonly used ───────────────────────────────────────────────────────────
  { id: "solana",      name: "Solana",         logo: logoOf("solana"),      isEVM: false },
  { id: "bitcoin",     name: "Bitcoin",        logo: logoOf("bitcoin"),     isEVM: false },
  { id: "ethereum",    name: "Ethereum",       logo: logoOf("ethereum"),    isEVM: true  },
  { id: "tron",        name: "Tron",           logo: logoOf("tron"),        isEVM: false },
  { id: "bsc",         name: "BNB Chain",      logo: logoOf("bsc"),  isEVM: true  },
  { id: "sui",         name: "Sui",            logo: logoOf("sui"),         isEVM: false },
  { id: "xrp",         name: "XRP Ledger",     logo: logoOf("xrp"),      isEVM: false },
  { id: "base",        name: "Base",           logo: logoOf("base"),        isEVM: true  },
  { id: "arbitrum",    name: "Arbitrum One",   logo: logoOf("arbitrum"),    isEVM: true  },
  { id: "polygon",     name: "Polygon",        logo: logoOf("polygon"),     isEVM: true  },
  { id: "avalanche",   name: "Avalanche",      logo: logoOf("avalanche"),  isEVM: true  },
  { id: "optimism",    name: "Optimism",       logo: logoOf("optimism"),    isEVM: true  },
  { id: "litecoin",    name: "Litecoin",       logo: logoOf("litecoin"),    isEVM: false },
  // ── Long-tail EVM L2s / others ──────────────────────────────────────────────
  { id: "zksync",      name: "zkSync Era",     logo: logoOf("zksync"),      isEVM: true  },
  { id: "scroll",      name: "Scroll",         logo: logoOf("scroll"),      isEVM: true  },
  { id: "linea",       name: "Linea",          logo: logoOf("linea"),       isEVM: true  },
  { id: "mantle",      name: "Mantle",         logo: logoOf("mantle"),      isEVM: true  },
  { id: "blast",       name: "Blast",          logo: logoOf("blast"),       isEVM: true  },
  { id: "polygonzkevm",name: "Polygon zkEVM",  logo: logoOf("polygonzkevm"),isEVM: true  },
  { id: "fantom",      name: "Fantom",         logo: logoOf("fantom"),      isEVM: true  },
  { id: "cronos",      name: "Cronos",         logo: logoOf("cronos"),      isEVM: true  },
  { id: "celo",        name: "Celo",           logo: logoOf("celo"),        isEVM: true  },
  { id: "gnosis",      name: "Gnosis",         logo: logoOf("gnosis"),        isEVM: true  },
  { id: "moonbeam",    name: "Moonbeam",       logo: logoOf("moonbeam"),    isEVM: true  },
  { id: "aurora",      name: "Aurora",         logo: logoOf("aurora"),      isEVM: true  },
  { id: "sei",         name: "Sei",            logo: logoOf("sei"),         isEVM: true  },
  { id: "klaytn",      name: "Klaytn",         logo: logoOf("klaytn"),      isEVM: true  },
  { id: "metis",       name: "Metis",          logo: logoOf("metis"),       isEVM: true  },
] as const;

export type BPANChainId = typeof BPAN_CHAINS[number]["id"];
