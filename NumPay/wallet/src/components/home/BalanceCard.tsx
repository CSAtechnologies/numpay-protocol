"use client";

import { formatEther } from "viem";
import { useWallet } from "@/context/WalletContext";
import { useBalance } from "@/hooks/useBPANRegistry";
import { useCurrency } from "@/context/CurrencyContext";
import { ArrowUpRight } from "../icons/Icon";
import { Sparkline } from "../primitives/Sparkline";

export function BalanceCard() {
  const { address } = useWallet();
  const { data: balance } = useBalance(address);
  const { format, code } = useCurrency();

  const eth = balance ? parseFloat(formatEther(balance)) : 0;
  // Stub ETH price — real pricing would come from an oracle / price feed
  const ethPriceUsd = 3200;
  const usd = eth * ethPriceUsd;

  return (
    <div className="card flex flex-col gap-3 p-6">
      <div
        className="text-[10px] font-semibold uppercase tracking-[0.14em]"
        style={{ color: "var(--muted-2)" }}
      >
        Total portfolio · {code}
      </div>
      <div className="mono gradient-text text-4xl font-bold leading-none tracking-tight sm:text-[40px]">
        {format(usd)}
      </div>
      <div
        className="flex items-center gap-2 text-[13px] font-medium"
        style={{ color: "var(--success)" }}
      >
        <ArrowUpRight size={13} strokeWidth={2.5} />
        <span>Live · ETH only</span>
        <span className="ml-auto">
          <Sparkline up w={90} h={26} />
        </span>
      </div>
    </div>
  );
}
