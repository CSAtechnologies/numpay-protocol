import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

// Only sign on live networks when a real deployer key is provided. Do NOT fall
// back to a zero key, which silently produces a bogus signer; instead leave the
// accounts list empty so a live deploy without a key fails fast and clearly.
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || "";
const liveAccounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];
const ETHERSCAN_API_KEY = process.env.ETHERSCAN_API_KEY || "";
const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL || "";
const MAINNET_RPC_URL = process.env.MAINNET_RPC_URL || "";
const AMOY_RPC_URL = process.env.AMOY_RPC_URL || "";

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.27",
    settings: {
      evmVersion: "cancun",
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    hardhat: {},
    mainnet: {
      url: MAINNET_RPC_URL,
      accounts: liveAccounts,
    },
    sepolia: {
      url: SEPOLIA_RPC_URL,
      accounts: liveAccounts,
    },
    amoy: {
      url: AMOY_RPC_URL,
      accounts: liveAccounts,
    },
  },
  etherscan: {
    apiKey: ETHERSCAN_API_KEY,
  },
  paths: {
    sources: "./core",
    tests: "./test",
    cache: "./cache",
    artifacts: "./artifacts",
  },
};

export default config;
