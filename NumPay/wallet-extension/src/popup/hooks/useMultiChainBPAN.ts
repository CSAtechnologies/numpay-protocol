import { useState, useCallback } from "react";
import { ethers } from "ethers";
import { getMainnetBPANContract } from "@numpay/core/bpan";
import { NETWORKS, type Network } from "@numpay/core/networks";

export interface BPANChainBalance {
  chainId: string;
  chainName: string;
  logo: string;
  symbol: string;
  walletAddress: string;
  balance: string;
  balanceNum: number;
}

export interface BPANPortfolio {
  bpanNumber: string;
  owner: string;
  chains: BPANChainBalance[];
  totalChains: number;       // includes non-EVM
  evmChains: number;
  nonEvmMappings: { chain: string; wallet: string }[];
}

// EVM chains we can query balances for
const EVM_CHAIN_IDS = new Set(Object.keys(NETWORKS));

export function useMultiChainBPAN() {
  const [portfolio, setPortfolio] = useState<BPANPortfolio | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const fetchPortfolio = useCallback(async (bpanNumber: string) => {
    setLoading(true);
    setError("");
    setPortfolio(null);

    try {
      const contract = getMainnetBPANContract();

      // Check registration
      const registered = await contract.isRegistered(BigInt(bpanNumber));
      if (!registered) {
        setError("This BPAN is not registered");
        setLoading(false);
        return;
      }

      // Get owner + all mappings
      const [owner, [chains, wallets]] = await Promise.all([
        contract.ownerOf(BigInt(bpanNumber)),
        contract.getAllMappings(BigInt(bpanNumber)),
      ]);

      const chainArr: string[] = [...chains];
      const walletArr: string[] = [...wallets];

      // Separate EVM from non-EVM
      const evmMappings: { chainId: string; wallet: string }[] = [];
      const nonEvmMappings: { chain: string; wallet: string }[] = [];

      for (let i = 0; i < chainArr.length; i++) {
        const cid = chainArr[i];
        const addr = walletArr[i];
        if (!addr) continue;
        if (EVM_CHAIN_IDS.has(cid) && cid !== "sepolia") {
          evmMappings.push({ chainId: cid, wallet: addr });
        } else {
          nonEvmMappings.push({ chain: cid, wallet: addr });
        }
      }

      // Fetch native balances for all EVM chains in parallel
      const balancePromises = evmMappings.map(async ({ chainId, wallet }) => {
        const net = NETWORKS[chainId] as Network;
        try {
          const chainProvider = new ethers.JsonRpcProvider(net.rpcUrl);
          const bal = await Promise.race([
            chainProvider.getBalance(wallet),
            new Promise<never>((_, rej) => setTimeout(() => rej(new Error("timeout")), 5000)),
          ]);
          const formatted = ethers.formatUnits(bal, net.decimals);
          return {
            chainId,
            chainName: net.name,
            logo: net.logo,
            symbol: net.symbol,
            walletAddress: wallet,
            balance: formatted,
            balanceNum: parseFloat(formatted),
          } as BPANChainBalance;
        } catch {
          return {
            chainId,
            chainName: net.name,
            logo: net.logo,
            symbol: net.symbol,
            walletAddress: wallet,
            balance: "0",
            balanceNum: 0,
          } as BPANChainBalance;
        }
      });

      const chainBalances = await Promise.all(balancePromises);

      // Sort by balance descending
      chainBalances.sort((a, b) => b.balanceNum - a.balanceNum);

      setPortfolio({
        bpanNumber,
        owner,
        chains: chainBalances,
        totalChains: chainArr.length,
        evmChains: evmMappings.length,
        nonEvmMappings,
      });
    } catch (e: any) {
      setError(e.reason || e.message || "Failed to fetch portfolio");
    } finally {
      setLoading(false);
    }
  }, []);

  return { portfolio, loading, error, fetchPortfolio };
}
