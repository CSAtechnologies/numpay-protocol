"use client";

import { QRReceive } from "../home/QRReceive";
import { useMyNumber, formatBPAN } from "@/hooks/useMyNumber";
import { useState } from "react";
import { CopyIcon, CheckIcon, ShareIcon } from "../icons/Icon";

export function RequestView() {
  const { number } = useMyNumber();
  const [copied, setCopied] = useState(false);

  const copy = async () => {
    if (!number) return;
    await navigator.clipboard.writeText(number);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  if (!number) {
    return (
      <div className="mx-auto max-w-md text-center">
        <h1 className="mb-2 text-2xl font-bold tracking-tight">No number linked</h1>
        <p className="text-sm text-ink-muted">Claim a number on the Home screen to receive payments.</p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Request payment</h1>
      <p className="mb-6 text-sm text-ink-muted">Share your number or QR — that's it.</p>

      <QRReceive />

      <div className="mt-4 flex gap-2">
        <button onClick={copy} className="btn-secondary flex-1 inline-flex items-center justify-center gap-2">
          {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
          {copied ? "Copied" : `Copy ${formatBPAN(number)}`}
        </button>
        <button
          onClick={async () => {
            if (navigator.share) {
              await navigator.share({ title: "NumPay", text: `Pay me: ${formatBPAN(number)}` }).catch(() => {});
            } else copy();
          }}
          className="btn-primary inline-flex items-center justify-center gap-2"
        >
          <ShareIcon size={16} />
          Share
        </button>
      </div>
    </div>
  );
}
