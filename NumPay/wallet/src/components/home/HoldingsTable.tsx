"use client";

import { formatEther } from "viem";
import { useWallet } from "@/context/WalletContext";
import { useBalance } from "@/hooks/useBPANRegistry";
import { useCurrency } from "@/context/CurrencyContext";
import { ChevronRight } from "../icons/Icon";
import { TokenIcon } from "../primitives/TokenIcon";
import { ChainChip, CHAINS } from "../primitives/Chain";
import { Pill } from "../primitives/Pill";
import { Sparkline } from "../primitives/Sparkline";

interface Row {
  sym: string;
  name: string;
  chain: string;
  bal: string;
  fiat: string;
  spark: boolean;
  change: string;
}

export function HoldingsTable() {
  const { address } = useWallet();
  const { data: balance } = useBalance(address);
  const { format } = useCurrency();
  const eth = balance ? parseFloat(formatEther(balance)) : 0;
  const ethUsd = eth * 3200;

  const rows: Row[] = [
    {
      sym: "ETH",
      name: "Ethereum",
      chain: "eth",
      bal: eth.toFixed(4),
      fiat: format(ethUsd),
      spark: true,
      change: "Live",
    },
  ];

  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-base font-semibold">Holdings</h3>
        <div className="flex gap-1.5">
          <Pill kind="brand">All chains</Pill>
          <Pill>Tokens</Pill>
          <Pill>NFTs</Pill>
        </div>
      </div>

      <div className="card overflow-hidden p-0">
        {rows.map((r, i) => (
          <div
            key={r.sym}
            className="grid items-center gap-3.5 px-4 py-3.5 sm:px-5"
            style={{
              gridTemplateColumns: "32px 1fr auto auto",
              borderBottom: i < rows.length - 1 ? "1px solid var(--border)" : undefined,
            }}
          >
            <TokenIcon sym={r.sym} size={32} />
            <div className="min-w-0">
              <div className="text-sm font-semibold">{r.name}</div>
              <div
                className="mt-0.5 flex items-center gap-1.5 text-[11px]"
                style={{ color: "var(--muted)" }}
              >
                <ChainChip id={r.chain} size={14} />
                {CHAINS.find((c) => c.id === r.chain)?.name}
              </div>
            </div>
            <div className="hidden items-center gap-3 sm:flex">
              <div className="mono text-[13px]" style={{ color: "var(--muted)" }}>
                {r.bal} {r.sym}
              </div>
              <Sparkline up={r.spark} w={70} h={20} />
            </div>
            <div className="flex items-center gap-2 text-right">
              <div>
                <div className="mono text-sm font-semibold">{r.fiat}</div>
                <div className="mono text-[11px]" style={{ color: "var(--success)" }}>
                  {r.change}
                </div>
              </div>
              <ChevronRight size={14} style={{ color: "var(--muted-2)" }} />
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
