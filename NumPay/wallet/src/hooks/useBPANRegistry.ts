"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { parseEventLogs } from "viem";
import { publicClient, useWallet } from "@/context/WalletContext";
import { BANP_REGISTRY_ABI, BANP_REGISTRY_ADDRESS } from "@/config/contracts";

// ── Reads ──────────────────────────────────────────

export function useIsRegistered(number: bigint | undefined) {
  return useQuery({
    queryKey: ["isRegistered", number?.toString()],
    enabled: !!number,
    queryFn: async () =>
      publicClient.readContract({
        address: BANP_REGISTRY_ADDRESS,
        abi: BANP_REGISTRY_ABI,
        functionName: "isRegistered",
        args: [number!],
      }) as Promise<boolean>,
  });
}

export function useGetAllMappings(number: bigint | undefined) {
  return useQuery({
    queryKey: ["getAllMappings", number?.toString()],
    enabled: !!number,
    queryFn: async () =>
      publicClient.readContract({
        address: BANP_REGISTRY_ADDRESS,
        abi: BANP_REGISTRY_ABI,
        functionName: "getAllMappings",
        args: [number!],
      }) as Promise<readonly [readonly string[], readonly string[]]>,
  });
}

export function useGetWalletMapping(number: bigint | undefined, chain: string) {
  return useQuery({
    queryKey: ["getWalletMapping", number?.toString(), chain],
    enabled: !!number && !!chain,
    queryFn: async () =>
      publicClient.readContract({
        address: BANP_REGISTRY_ADDRESS,
        abi: BANP_REGISTRY_ABI,
        functionName: "getWalletMapping",
        args: [number!, chain],
      }) as Promise<string>,
  });
}

export function useOwnerOf(number: bigint | undefined) {
  return useQuery({
    queryKey: ["ownerOf", number?.toString()],
    enabled: !!number,
    queryFn: async () =>
      publicClient.readContract({
        address: BANP_REGISTRY_ADDRESS,
        abi: BANP_REGISTRY_ABI,
        functionName: "ownerOf",
        args: [number!],
      }) as Promise<`0x${string}`>,
  });
}

export function useRegistrationFee() {
  return useQuery({
    queryKey: ["registrationFee"],
    queryFn: async () =>
      publicClient.readContract({
        address: BANP_REGISTRY_ADDRESS,
        abi: BANP_REGISTRY_ABI,
        functionName: "registrationFee",
      }) as Promise<bigint>,
  });
}

export function useTotalRegistered() {
  return useQuery({
    queryKey: ["totalRegistered"],
    queryFn: async () =>
      publicClient.readContract({
        address: BANP_REGISTRY_ADDRESS,
        abi: BANP_REGISTRY_ABI,
        functionName: "totalRegistered",
      }) as Promise<bigint>,
  });
}

export function useBalance(address: `0x${string}` | undefined) {
  return useQuery({
    queryKey: ["balance", address],
    enabled: !!address,
    queryFn: async () => publicClient.getBalance({ address: address! }),
    refetchInterval: 10_000,
  });
}

// ── Writes ─────────────────────────────────────────

export function useRegisterNumber() {
  const { walletClient, account } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ number, fee }: { number: bigint; fee: bigint }) => {
      if (!walletClient || !account) throw new Error("Wallet locked");
      const hash = await walletClient.writeContract({
        account,
        chain: walletClient.chain,
        address: BANP_REGISTRY_ADDRESS,
        abi: BANP_REGISTRY_ABI,
        functionName: "registerNumber",
        args: [number],
        value: fee,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["isRegistered", v.number.toString()] });
      qc.invalidateQueries({ queryKey: ["ownerOf", v.number.toString()] });
      qc.invalidateQueries({ queryKey: ["totalRegistered"] });
    },
  });
}

export function useSetWalletMapping() {
  const { walletClient, account } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({
      number,
      chain,
      wallet,
    }: {
      number: bigint;
      chain: string;
      wallet: string;
    }) => {
      if (!walletClient || !account) throw new Error("Wallet locked");
      const hash = await walletClient.writeContract({
        account,
        chain: walletClient.chain,
        address: BANP_REGISTRY_ADDRESS,
        abi: BANP_REGISTRY_ABI,
        functionName: "setWalletMapping",
        args: [number, chain, wallet],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["getAllMappings", v.number.toString()] });
      qc.invalidateQueries({ queryKey: ["getWalletMapping", v.number.toString(), v.chain] });
    },
  });
}

export function useRemoveWalletMapping() {
  const { walletClient, account } = useWallet();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async ({ number, chain }: { number: bigint; chain: string }) => {
      if (!walletClient || !account) throw new Error("Wallet locked");
      const hash = await walletClient.writeContract({
        account,
        chain: walletClient.chain,
        address: BANP_REGISTRY_ADDRESS,
        abi: BANP_REGISTRY_ABI,
        functionName: "removeWalletMapping",
        args: [number, chain],
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    },
    onSuccess: (_r, v) => {
      qc.invalidateQueries({ queryKey: ["getAllMappings", v.number.toString()] });
    },
  });
}

export function useSendEth() {
  const { walletClient, account } = useWallet();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ to, value }: { to: `0x${string}`; value: bigint }) => {
      if (!walletClient || !account) throw new Error("Wallet locked");
      const hash = await walletClient.sendTransaction({
        account,
        chain: walletClient.chain,
        to,
        value,
      });
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      return { hash, receipt };
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["balance"] });
    },
  });
}

// ── Helpers ────────────────────────────────────────

export function isValidBANPNumber(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  const n = BigInt(value);
  return n >= 10_000_000_000n && n <= 99_999_999_999n;
}
