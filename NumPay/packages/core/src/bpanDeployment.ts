import { getAddress, ZeroAddress } from "ethers";
import { ALCHEMY_KEY } from "./env";

/** One fresh Base registry for both wallets. Null means not deployed yet. */
export function createBPANDeployment(contract: string | null, startBlock: number) {
  const address = contract === null ? "" : getAddress(contract);
  if (contract !== null && (!address || address === ZeroAddress)) throw new Error("BPAN registry address is required");
  if (!Number.isSafeInteger(startBlock) || (contract === null ? startBlock !== 0 : startBlock <= 0)) {
    throw new Error("BPAN deployment block is required");
  }
  const publicRpc = "https://base-rpc.publicnode.com";
  const rpc = ALCHEMY_KEY ? `https://base-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}` : publicRpc;
  return {
    networkId: "base", chainId: 8453, name: "Base mainnet",
    contract: address, startBlock, deployed: contract !== null,
    explorer: "https://basescan.org", rpc,
    readRpcs: ALCHEMY_KEY ? [rpc, "https://base.drpc.org", publicRpc]
      : [publicRpc, "https://base.drpc.org", "https://mainnet.base.org"],
  } as const;
}

// Finalized Base deployment, independently verified 2026-09-07.
// Transaction: 0xdc9967606ed5dfb4a51a73c5c89168281afe19003a4c0de8a6e50ec0ed253696
export const BPAN_DEPLOYMENT = createBPANDeployment(
  "0x185a78Dd6bB8D2444B118BAc65Ac73816EBe4686", 50998047,
);

export const BPAN_UNAVAILABLE_MESSAGE = "BPAN on Base is not available yet. Registration and lookup will open after the registry is deployed.";

export function requireBPANDeployment(): void {
  if (!BPAN_DEPLOYMENT.deployed) throw new Error(BPAN_UNAVAILABLE_MESSAGE);
}

export function bpanOwnershipKey(owner: string): string {
  return `bpan_base_numbers_${BPAN_DEPLOYMENT.contract.toLowerCase()}_${owner.toLowerCase()}`;
}
