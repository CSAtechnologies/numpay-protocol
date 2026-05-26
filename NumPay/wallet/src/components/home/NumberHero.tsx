"use client";

import { useState, useMemo } from "react";
import { useMyNumber } from "@/hooks/useMyNumber";
import {
  useGetAllMappings,
  useRegistrationFee,
  isValidBANPNumber,
  useRegisterNumber,
} from "@/hooks/useBPANRegistry";
import { CopyIcon, QRIcon, ShareIcon, CheckIcon, ArrowUpRight } from "../icons/Icon";
import { BPANDisplay } from "../primitives/BPANDisplay";
import { ChainChip } from "../primitives/Chain";
import { formatEther } from "viem";

// Maps BPAN chain name strings to ChainChip display IDs
function toChipId(name: string): string {
  const map: Record<string, string> = {
    ethereum: "eth", polygon: "poly", arbitrum: "arb",
    optimism: "opt", base: "base", avalanche: "avax",
    solana: "sol", bitcoin: "btc", sui: "sui",
    tron: "tron", xrp: "xrp", litecoin: "ltc",
    bnb: "bnb", "polygon-zkevm": "zkevm",
  };
  return map[name] ?? name;
}

export function NumberHero({ onShowQR }: { onShowQR: () => void }) {
  const { number, parsed, isRegistered, isOwnedByMe } = useMyNumber();
  const { data: mappingsData } = useGetAllMappings(parsed);
  const [copied, setCopied] = useState<"bpan" | "addr" | null>(null);
  const [selectedChain, setSelectedChain] = useState<string | "all">("all");

  const chains = (mappingsData?.[0] as readonly string[] | undefined) ?? [];
  const wallets = (mappingsData?.[1] as readonly string[] | undefined) ?? [];

  const chainWalletMap = useMemo(
    () => Object.fromEntries(chains.map((c, i) => [c, wallets[i] ?? ""])),
    [chains, wallets],
  );

  const selectedWallet = selectedChain !== "all" ? (chainWalletMap[selectedChain] ?? "") : "";

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
    if (!selectedWallet) return;
    await navigator.clipboard.writeText(selectedWallet);
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

          {/* Chain toggle — sits directly below the BPAN number */}
          <div className="mt-4">
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                onClick={() => setSelectedChain("all")}
                className="inline-flex items-center rounded-lg px-2.5 py-1 text-[11px] font-semibold transition-colors"
                style={{
                  background: selectedChain === "all" ? "var(--brand)" : "rgba(42,36,80,.5)",
                  color: selectedChain === "all" ? "white" : "var(--muted)",
                  border: "1px solid",
                  borderColor: selectedChain === "all" ? "var(--brand)" : "var(--border)",
                }}
              >
                All
              </button>
              {chains.map((chain) => (
                <button
                  key={chain}
                  onClick={() => setSelectedChain(chain)}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-[11px] font-medium transition-colors"
                  style={{
                    background: selectedChain === chain ? "var(--brand)" : "rgba(42,36,80,.5)",
                    color: selectedChain === chain ? "white" : "var(--muted)",
                    border: "1px solid",
                    borderColor: selectedChain === chain ? "var(--brand)" : "var(--border)",
                  }}
                >
                  <ChainChip id={toChipId(chain)} size={14} />
                  <span className="capitalize">{chain}</span>
                </button>
              ))}
            </div>

            {/* Address shown only when a specific chain is selected */}
            {selectedChain !== "all" && selectedWallet && (
              <div className="mt-2.5 flex items-center gap-2">
                <span className="mono text-[12px]" style={{ color: "var(--muted)" }}>
                  {selectedWallet.length > 16
                    ? `${selectedWallet.slice(0, 8)}…${selectedWallet.slice(-6)}`
                    : selectedWallet}
                </span>
                <button
                  onClick={copyAddr}
                  title="Copy address"
                  className="inline-flex items-center rounded px-1.5 py-0.5 text-[11px] transition-opacity hover:opacity-70"
                  style={{ color: "var(--muted-2)" }}
                >
                  {copied === "addr" ? <CheckIcon size={12} /> : <CopyIcon size={12} />}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className="flex flex-shrink-0 flex-wrap justify-end gap-1.5">
          <HeroBtn onClick={copyBpan} title="Copy BPAN">
            {copied === "bpan" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            <span className="hidden sm:inline">{copied === "bpan" ? "Copied" : "Copy BPAN"}</span>
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
