"use client";

import { useState, useRef, useEffect } from "react";
import { useWallet } from "@/context/WalletContext";
import { useMyNumber, formatBPAN } from "@/hooks/useMyNumber";
import { ChevronDown, CopyIcon, CheckIcon } from "../icons/Icon";

export function AccountPill() {
  const { address, lock, exportPrivateKey } = useWallet();
  const { number } = useMyNumber();
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"addr" | "key" | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, []);

  if (!address) return null;

  const copy = async (kind: "addr" | "key") => {
    const value = kind === "addr" ? address : exportPrivateKey();
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1400);
  };

  return (
    <div className="relative" ref={menuRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-2 rounded-full border border-line bg-bg-card py-1 pl-1 pr-3 text-sm transition-colors hover:border-line-strong"
      >
        <span
          className="grid h-6 w-6 place-items-center rounded-full text-[10px] font-bold text-white"
          style={{ background: "linear-gradient(135deg, #a394ff, #7c6df0)" }}
        >
          {address.slice(2, 3).toUpperCase()}
        </span>
        <span className="mono text-xs text-ink-muted">
          {number ? formatBPAN(number) : `${address.slice(0, 6)}…${address.slice(-4)}`}
        </span>
        <ChevronDown size={14} className="text-ink-mute2" />
      </button>

      {open && (
        <div className="absolute right-0 top-11 z-30 w-64 rounded-2xl border border-line bg-bg-raised p-2 shadow-2xl">
          <div className="px-3 py-2">
            <div className="section-label">Address</div>
            <div className="mono mt-0.5 break-all text-xs text-ink-muted">{address}</div>
          </div>
          <button
            onClick={() => copy("addr")}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-muted hover:bg-line/40 hover:text-ink"
          >
            {copied === "addr" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            {copied === "addr" ? "Copied" : "Copy address"}
          </button>
          <button
            onClick={() => copy("key")}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-muted hover:bg-line/40 hover:text-ink"
          >
            {copied === "key" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            {copied === "key" ? "Copied" : "Export private key"}
          </button>
          <div className="my-1 border-t border-line/60" />
          <button
            onClick={() => { lock(); setOpen(false); }}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-sm text-ink-muted hover:bg-line/40 hover:text-ink"
          >
            Lock wallet
          </button>
        </div>
      )}
    </div>
  );
}
