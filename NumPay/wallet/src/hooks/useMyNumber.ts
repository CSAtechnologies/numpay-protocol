"use client";

import { useWallet } from "@/context/WalletContext";
import { useIsRegistered, useOwnerOf } from "./useBPANRegistry";

export function useMyNumber() {
  const { number, setNumber, address } = useWallet();
  const parsed = /^\d{11}$/.test(number) ? BigInt(number) : undefined;

  const { data: isRegistered } = useIsRegistered(parsed);
  const { data: owner } = useOwnerOf(parsed);

  const isOwnedByMe = !!(
    address && owner && owner.toLowerCase() === address.toLowerCase()
  );

  return {
    number,
    parsed,
    isRegistered: !!isRegistered,
    isOwnedByMe,
    setNumber,
    clear: () => setNumber(""),
  };
}

export function formatBPAN(n: string | bigint | undefined): string {
  if (!n) return "";
  const s = typeof n === "bigint" ? n.toString() : n;
  if (s.length !== 11) return s;
  return `${s.slice(0, 3)} ${s.slice(3, 6)} ${s.slice(6, 9)} ${s.slice(9)}`;
}
