"use client";

import { useState } from "react";
import { useMyNumber } from "@/hooks/useMyNumber";
import {
  useGetAllMappings,
  useRegistrationFee,
  isValidBANPNumber,
  useRegisterNumber,
} from "@/hooks/useBPANRegistry";
import { useWallet } from "@/context/WalletContext";
import { CopyIcon, QRIcon, ShareIcon, CheckIcon, ArrowUpRight, LinkIcon } from "../icons/Icon";
import { BPANDisplay } from "../primitives/BPANDisplay";
import { ChainStack } from "../primitives/Chain";
import { formatEther } from "viem";

export function NumberHero({ onShowQR }: { onShowQR: () => void }) {
  const { number, parsed, isRegistered, isOwnedByMe } = useMyNumber();
  const { address } = useWallet();
  const { data: mappingsData } = useGetAllMappings(parsed);
  const [copied, setCopied] = useState<"bpan" | "addr" | null>(null);

  const chains = (mappingsData?.[0] as readonly string[] | undefined) ?? [];

  // Show the claim/link card only when nothing is linked locally. If a number
  // is already linked on this device, always show the BPAN hero — the on-chain
  // `isRegistered` check may be loading, the RPC may be unavailable, or the
  // user may have linked a number registered on a different RPC.
  if (!number) return <ClaimNumberCard />;

  const statusLabel = isRegistered
    ? isOwnedByMe
      ? "Active"
      : "Tracked"
    : "Linked · unverified";
  const dotColor = isRegistered ? "var(--success)" : "var(--amber)";

  const copyBpan = async () => {
    if (!number) return;
    await navigator.clipboard.writeText(number);
    setCopied("bpan");
    setTimeout(() => setCopied(null), 1400);
  };

  const copyAddr = async () => {
    if (!address) return;
    await navigator.clipboard.writeText(address);
    setCopied("addr");
    setTimeout(() => setCopied(null), 1400);
  };

  const share = async () => {
    if (navigator.share) {
      await navigator.share({ title: "NumPay", text: `Pay me: ${number}` }).catch(() => {});
    } else {
      copyBpan();
    }
  };

  // Map chain count to a representative stack of chain ids (visual only)
  const chainIds = ["eth", "arb", "base", "opt", "poly", "sol", "btc", "avax"].slice(
    0,
    Math.min(8, Math.max(chains.length, 5)),
  );
  const extra = Math.max(0, chains.length - 5);

  return (
    <div className="bpan-hero p-7">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1">
          <div
            className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em]"
            style={{ color: "var(--brand-2)" }}
          >
            <span
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: dotColor, boxShadow: `0 0 8px ${dotColor}` }}
            />
            Your number · {statusLabel}
          </div>
          <div className="mt-4">
            <BPANDisplay digits={number} size={48} gap={18} />
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <ChainStack ids={chainIds} extra={extra} size={20} />
            <span className="text-[13px]" style={{ color: "var(--muted)" }}>
              Mapped to{" "}
              <b className="font-semibold" style={{ color: "var(--text)" }}>
                {chains.length} {chains.length === 1 ? "chain" : "chains"}
              </b>
            </span>
          </div>
        </div>
        <div className="flex flex-shrink-0 flex-wrap justify-end gap-1.5">
          <HeroBtn onClick={copyBpan} title="Copy BPAN">
            {copied === "bpan" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            <span className="hidden sm:inline">{copied === "bpan" ? "Copied" : "Copy BPAN"}</span>
          </HeroBtn>
          <HeroBtn onClick={copyAddr} title="Copy wallet address">
            {copied === "addr" ? <CheckIcon size={14} /> : <LinkIcon size={14} />}
            <span className="hidden sm:inline">
              {copied === "addr" ? "Copied" : "Copy address"}
            </span>
          </HeroBtn>
          <HeroBtn onClick={onShowQR} title="Show QR">
            <QRIcon size={14} />
            <span className="hidden sm:inline">QR</span>
          </HeroBtn>
          <HeroBtn onClick={share} title="Share BPAN">
            <ShareIcon size={14} />
            <span className="hidden sm:inline">Share</span>
          </HeroBtn>
        </div>
      </div>
    </div>
  );
}

function HeroBtn({
  children,
  onClick,
  title,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  title?: string;
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium transition-colors"
      style={{
        background: "rgba(42,36,80,.6)",
        border: "1px solid var(--border)",
        color: "var(--text)",
      }}
    >
      {children}
    </button>
  );
}

function ClaimNumberCard() {
  const { setNumber } = useMyNumber();
  const [input, setInput] = useState("");
  const [mode, setMode] = useState<"idle" | "link" | "claim">("idle");
  const { data: fee } = useRegistrationFee();
  const register = useRegisterNumber();

  const parsed = isValidBANPNumber(input) ? BigInt(input) : undefined;

  const handleLink = () => {
    if (!parsed) return;
    setNumber(parsed.toString());
  };

  const handleClaim = () => {
    if (!parsed || fee === undefined) return;
    register.mutate({ number: parsed, fee }, { onSuccess: () => setNumber(parsed.toString()) });
  };

  return (
    <div className="bpan-hero p-7">
      <div
        className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-[0.16em]"
        style={{ color: "var(--brand-2)" }}
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ background: "var(--amber)", boxShadow: "0 0 8px var(--amber)" }}
        />
        Get started
      </div>
      <h2 className="mt-3 text-2xl font-bold tracking-tight">Claim your BPAN</h2>
      <p className="mt-1 max-w-xl text-sm" style={{ color: "var(--muted)" }}>
        Pick an 11-digit number to receive crypto — no more long wallet addresses. Or link an
        existing number you already own.
      </p>

      <div className="mt-5 flex flex-col gap-3 sm:flex-row">
        <input
          className="input mono flex-1 text-center text-xl tracking-[0.15em]"
          type="text"
          inputMode="numeric"
          maxLength={11}
          placeholder="Enter 11-digit number"
          value={input}
          onChange={(e) => setInput(e.target.value.replace(/\D/g, ""))}
        />
        <button
          onClick={() => {
            setMode("link");
            handleLink();
          }}
          disabled={!parsed}
          className="btn-secondary sm:w-36"
        >
          Link existing
        </button>
        <button
          onClick={() => {
            setMode("claim");
            handleClaim();
          }}
          disabled={!parsed || fee === undefined || register.isPending}
          className="btn-primary sm:w-36"
        >
          {register.isPending ? "Claiming…" : "Claim new"}
          {!register.isPending && <ArrowUpRight size={14} />}
        </button>
      </div>

      {fee !== undefined && (
        <p className="mt-3 text-xs" style={{ color: "var(--muted-2)" }}>
          Registration fee:{" "}
          <span className="mono" style={{ color: "var(--muted)" }}>
            {formatEther(fee)} ETH
          </span>
        </p>
      )}
      {register.error && mode === "claim" && (
        <p className="mt-2 text-xs" style={{ color: "var(--danger)" }}>
          {(register.error as { shortMessage?: string }).shortMessage ?? register.error.message}
        </p>
      )}
    </div>
  );
}
