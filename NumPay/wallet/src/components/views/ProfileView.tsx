"use client";

import { useMemo, useState } from "react";
import { useWallet } from "@/context/WalletContext";
import {
  useGetAllMappings,
  useOwnerOf,
  useSetWalletMapping,
  useRemoveWalletMapping,
} from "@/hooks/useBPANRegistry";
import { useMyNumber, formatBPAN } from "@/hooks/useMyNumber";
import { TrashIcon, PlusIcon } from "../icons/Icon";

const CHAINS = [
  "ethereum",
  "solana",
  "bitcoin",
  "tron",
  "xrp",
  "litecoin",
  "polygon",
  "arbitrum",
  "optimism",
  "base",
  "sui",
  "aptos",
  "avalanche",
];

export function ProfileView() {
  const { address } = useWallet();
  const { parsed: banp, number } = useMyNumber();
  const { data: owner } = useOwnerOf(banp);
  const { data: mappingsData } = useGetAllMappings(banp);

  const setMappingMut = useSetWalletMapping();
  const removeMappingMut = useRemoveWalletMapping();

  const [newChain, setNewChain] = useState("ethereum");
  const [newWallet, setNewWallet] = useState("");

  const chains = (mappingsData?.[0] as readonly string[] | undefined) ?? [];
  const wallets = (mappingsData?.[1] as readonly string[] | undefined) ?? [];
  const isOwner = useMemo(
    () => !!(address && owner && address.toLowerCase() === owner.toLowerCase()),
    [address, owner],
  );

  if (!banp) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">No number linked</h1>
        <p className="text-sm text-ink-muted">Go to Home and claim or link a NumPay number to manage its mappings.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div className="hero-bg relative overflow-hidden rounded-3xl border border-line-strong p-6">
        <div className="bg-grid pointer-events-none absolute inset-0" />
        <div className="relative flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="section-label text-brand-300">Your profile</div>
            <div className="num gradient-text mt-1 text-3xl font-bold sm:text-4xl">{formatBPAN(number)}</div>
            {owner && <div className="mono mt-1 text-xs text-ink-muted">{owner}</div>}
          </div>
          {isOwner && (
            <span className="rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs font-semibold text-success">
              Owner
            </span>
          )}
        </div>
      </div>

      <section className="card-raised">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <div className="section-label">Linked wallets</div>
            <h2 className="mt-0.5 text-lg font-semibold">Mappings</h2>
          </div>
          <span className="text-xs text-ink-muted">{chains.length} linked</span>
        </div>

        {chains.length > 0 ? (
          <ul className="space-y-2">
            {chains.map((c, i) => (
              <li key={c} className="flex items-center gap-3 rounded-xl border border-line bg-bg-raised p-3">
                <div className="grid h-9 w-9 place-items-center rounded-lg bg-brand-500/15 text-xs font-bold capitalize text-brand-300">
                  {c.slice(0, 2)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium capitalize">{c}</div>
                  <div className="mono truncate text-xs text-ink-muted">{wallets[i]}</div>
                </div>
                {isOwner && (
                  <button
                    onClick={() => removeMappingMut.mutate({ number: banp, chain: c })}
                    disabled={removeMappingMut.isPending}
                    className="icon-btn text-danger hover:border-danger/60 hover:text-danger"
                    aria-label={`Remove ${c}`}
                  >
                    <TrashIcon size={14} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <div className="rounded-xl border border-dashed border-line py-6 text-center text-sm text-ink-muted">
            No mappings yet.
          </div>
        )}

        {isOwner && (
          <div className="mt-4 grid gap-3 sm:grid-cols-[150px_1fr_auto]">
            <select
              className="input"
              value={newChain}
              onChange={(e) => setNewChain(e.target.value)}
            >
              {CHAINS.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
            <input
              className="input"
              placeholder="0x… or native address"
              value={newWallet}
              onChange={(e) => setNewWallet(e.target.value)}
            />
            <button
              onClick={() =>
                newChain &&
                newWallet &&
                setMappingMut.mutate(
                  { number: banp, chain: newChain, wallet: newWallet },
                  { onSuccess: () => setNewWallet("") },
                )
              }
              disabled={!newChain || !newWallet || setMappingMut.isPending}
              className="btn-primary inline-flex items-center justify-center gap-1.5"
            >
              <PlusIcon size={16} />
              Add
            </button>
          </div>
        )}
      </section>
    </div>
  );
}
