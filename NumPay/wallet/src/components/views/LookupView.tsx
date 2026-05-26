"use client";

import { useState } from "react";
import { useIsRegistered, useGetAllMappings, useOwnerOf, isValidBANPNumber } from "@/hooks/useBPANRegistry";
import { formatBPAN } from "@/hooks/useMyNumber";
import { SendIcon } from "../icons/Icon";

export function LookupView({ onSend }: { onSend: (prefill?: string) => void }) {
  const [input, setInput] = useState("");
  const parsed = isValidBANPNumber(input) ? BigInt(input) : undefined;

  const { data: isRegistered } = useIsRegistered(parsed);
  const { data: owner } = useOwnerOf(isRegistered ? parsed : undefined);
  const { data: mappingsData } = useGetAllMappings(isRegistered ? parsed : undefined);

  const chains = (mappingsData?.[0] as readonly string[] | undefined) ?? [];
  const wallets = (mappingsData?.[1] as readonly string[] | undefined) ?? [];

  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Lookup a number</h1>
      <p className="mb-6 text-sm text-ink-muted">Check owner and linked wallets for any NumPay number.</p>

      <div className="card-raised">
        <label className="label">NumPay number</label>
        <input
          className="num input text-center text-xl tracking-[0.15em]"
          type="text"
          inputMode="numeric"
          maxLength={11}
          placeholder="000 000 000 00"
          value={formatBPAN(input) || input}
          onChange={(e) => setInput(e.target.value.replace(/\D/g, ""))}
        />

        {parsed && !isRegistered && (
          <div className="mt-4 rounded-xl border border-dashed border-line py-6 text-center text-sm text-ink-muted">
            Not registered yet
          </div>
        )}

        {parsed && isRegistered && owner && (
          <div className="mt-4 space-y-3">
            <Row k="Owner" v={<span className="mono break-all text-xs">{owner}</span>} />
            <div>
              <div className="section-label mb-2">Linked wallets</div>
              {chains.length > 0 ? (
                <div className="space-y-2">
                  {chains.map((c, i) => (
                    <div key={c} className="rounded-xl border border-line bg-bg-raised px-3.5 py-2.5">
                      <div className="text-xs font-semibold capitalize text-brand-300">{c}</div>
                      <div className="mono mt-0.5 break-all text-xs text-ink-muted">{wallets[i]}</div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-sm text-ink-muted">No wallets linked yet.</p>
              )}
            </div>

            <button onClick={() => onSend(input)} className="btn-primary w-full">
              <span className="inline-flex items-center justify-center gap-2">
                <SendIcon size={16} />
                Send to this number
              </span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-line bg-bg-raised px-3.5 py-2.5">
      <div className="section-label">{k}</div>
      <div className="mt-1 text-sm">{v}</div>
    </div>
  );
}
