import { ethers, Contract, JsonRpcProvider } from "ethers";
import { config } from "./config";

const BANPRegistryABI = [
  "function getWalletMapping(uint256 number, string chain) external view returns (string)",
  "function getChains(uint256 number) external view returns (string[])",
  "function getAllMappings(uint256 number) external view returns (string[] chains, string[] wallets)",
  "function isRegistered(uint256 number) external view returns (bool)",
  "function registrationFee() external view returns (uint256)",
  "function totalRegistered() external view returns (uint256)",
  "function ownerOf(uint256 tokenId) external view returns (address)",
  "function MIN_NUMBER() external view returns (uint256)",
  "function MAX_NUMBER() external view returns (uint256)",
];

let provider: JsonRpcProvider;
let contract: Contract;

export function getProvider(): JsonRpcProvider {
  if (!provider) {
    provider = new JsonRpcProvider(config.rpcUrl);
  }
  return provider;
}

export function getContract(): Contract {
  if (!contract) {
    contract = new Contract(
      config.contractAddress,
      BANPRegistryABI,
      getProvider()
    );
  }
  return contract;
}
