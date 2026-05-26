"use client";

import { useState } from "react";
import { NumberHero } from "./NumberHero";
import { BalanceCard } from "./BalanceCard";
import { ActionGrid } from "./ActionGrid";
import { HoldingsTable } from "./HoldingsTable";
import { ActivityFeed } from "./ActivityFeed";
import { QRReceive } from "./QRReceive";
import { FrequentContacts } from "./FrequentContacts";
import { TipCard } from "./TipCard";
import { QRModal } from "./QRModal";

interface Props {
  onSend: (prefill?: string) => void;
}

export function Home({ onSend }: Props) {
  const [qrOpen, setQrOpen] = useState(false);

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_340px]">
      <section className="min-w-0 space-y-6">
        <div>
          <div className="text-[13px]" style={{ color: "var(--muted)" }}>
            Welcome back
          </div>
          <h1 className="mt-1 text-[22px] font-semibold tracking-tight">Your money, anywhere.</h1>
        </div>

        <NumberHero onShowQR={() => setQrOpen(true)} />

        <div className="grid gap-4 sm:grid-cols-2">
          <BalanceCard />
          <ActionGrid
            onSend={() => onSend()}
            onRequest={() => setQrOpen(true)}
            onLookup={() => setQrOpen(true)}
          />
        </div>

        <HoldingsTable />

        <ActivityFeed />
      </section>

      <aside className="hidden flex-col gap-4 lg:flex">
        <QRReceive />
        <FrequentContacts onSend={(num) => onSend(num)} />
        <TipCard />
      </aside>

      <QRModal open={qrOpen} onClose={() => setQrOpen(false)} />
    </div>
  );
}
