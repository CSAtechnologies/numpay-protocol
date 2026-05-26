"use client";

import { useMyNumber, formatBPAN } from "@/hooks/useMyNumber";
import { CopyIcon, ShareIcon } from "../icons/Icon";
import { QR } from "../primitives/QR";
import { useState } from "react";

export function QRReceive() {
  const { number } = useMyNumber();
  const [copied, setCopied] = useState(false);
  if (!number) return null;

  const copy = async () => {
    await navigator.clipboard.writeText(number);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  const share = async () => {
    if (navigator.share) {
      await navigator.share({ title: "NumPay", text: `Pay me: ${number}` }).catch(() => {});
    } else {
      copy();
    }
  };

  return (
    <div className="card p-5 text-center">
      <div
        className="mb-2 text-[10px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: "var(--muted)" }}
      >
        Your BPAN
      </div>
      <div className="grid place-items-center">
        <QR size={170} />
      </div>
      <div
        className="mono gradient-text mt-3.5 text-base font-bold"
        style={{ letterSpacing: "0.03em" }}
      >
        {formatBPAN(number)}
      </div>
      <div className="mt-3 flex gap-1.5">
        <button onClick={copy} className="btn-secondary flex-1 px-2 py-2 text-xs">
          <CopyIcon size={13} /> {copied ? "Copied" : "Copy"}
        </button>
        <button onClick={share} className="btn-secondary flex-1 px-2 py-2 text-xs">
          <ShareIcon size={13} /> Share
        </button>
      </div>
    </div>
  );
}
