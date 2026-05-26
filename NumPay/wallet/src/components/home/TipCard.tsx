"use client";

import { InfoIcon } from "../icons/Icon";

export function TipCard() {
  return (
    <div className="card p-4">
      <div
        className="mb-2 flex items-center gap-1.5 text-[11px] font-medium"
        style={{ color: "var(--muted)" }}
      >
        <InfoIcon size={12} /> Tip
      </div>
      <div className="text-xs leading-relaxed">
        Paste an 11-digit BPAN into any address field — NumPay resolves it for you.
      </div>
    </div>
  );
}
