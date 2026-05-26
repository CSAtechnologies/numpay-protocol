"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { parseEther, formatEther } from "viem";
import { useWallet } from "@/context/WalletContext";
import {
  useBalance,
  useGetWalletMapping,
  useIsRegistered,
  useOwnerOf,
  useSendEth,
  isValidBANPNumber,
} from "@/hooks/useBPANRegistry";
import { formatBPAN } from "@/hooks/useMyNumber";
import { CheckIcon, ChevronLeft, CloseIcon } from "../icons/Icon";

type Step = 1 | 2 | 3;

const SEND_CHAINS = [
  { id: "ethereum", label: "Ethereum", ticker: "ETH", sym: "Ξ", isEvm: true  },
  { id: "tron",     label: "Tron",     ticker: "TRX", sym: "T", isEvm: false },
  { id: "xrp",      label: "XRP",      ticker: "XRP", sym: "X", isEvm: false },
  { id: "litecoin", label: "Litecoin", ticker: "LTC", sym: "Ł", isEvm: false },
] as const;

type SendChainId = (typeof SEND_CHAINS)[number]["id"];
type SendChainInfo = (typeof SEND_CHAINS)[number];

interface Props {
  open: boolean;
  onClose: () => void;
  prefillNumber?: string;
}

export function SendSheet({ open, onClose, prefillNumber }: Props) {
  const [step, setStep] = useState<Step>(1);
  const [recipientNumber, setRecipientNumber] = useState("");
  const [amount, setAmount] = useState("");
  const [selectedChain, setSelectedChain] = useState<SendChainId>("ethereum");
  const [holdProgress, setHoldProgress] = useState(0);
  const holdTimer = useRef<number | null>(null);

  const { address } = useWallet();
  const { data: balance } = useBalance(address);

  const parsedNumber = isValidBANPNumber(recipientNumber) ? BigInt(recipientNumber) : undefined;
  const { data: isRegistered } = useIsRegistered(parsedNumber);
  const { data: owner } = useOwnerOf(isRegistered ? parsedNumber : undefined);
  const { data: mappedWallet } = useGetWalletMapping(
    isRegistered ? parsedNumber : undefined,
    selectedChain,
  );

  const chainInfo = SEND_CHAINS.find((c) => c.id === selectedChain)!;
  const isEvmChain = chainInfo.isEvm;

  const send = useSendEth();
  const hash = send.data?.hash;
  const isPending = send.isPending;
  const isConfirming = false;
  const isSuccess = send.isSuccess;
  const error = send.error;
  const reset = send.reset;

  const isEvmAddress = (v: unknown): v is `0x${string}` =>
    typeof v === "string" && /^0x[a-fA-F0-9]{40}$/.test(v);
  const ZERO = "0x0000000000000000000000000000000000000000";

  // EVM: prefer explicit mapping, fall back to NFT owner address.
  // Non-EVM: only use explicit mapping — the NFT owner is always an EVM address.
  const resolvedWallet = isEvmChain
    ? (isEvmAddress(mappedWallet) && mappedWallet !== ZERO
        ? mappedWallet
        : isEvmAddress(owner) && owner !== ZERO
          ? owner
          : undefined)
    : (typeof mappedWallet === "string" && mappedWallet && mappedWallet !== ZERO
        ? mappedWallet
        : undefined);

  const resolvedViaOwner =
    isEvmChain &&
    !!resolvedWallet &&
    resolvedWallet === owner &&
    !(isEvmAddress(mappedWallet) && mappedWallet !== ZERO);

  const resolvedValid = !!isRegistered && !!resolvedWallet;
  const parsedAmount = amount && /^\d*(\.\d+)?$/.test(amount) ? amount : "";
  const canSendAmount = parsedAmount && parseFloat(parsedAmount) > 0;

  useEffect(() => {
    if (!open) {
      setStep(1);
      setRecipientNumber("");
      setAmount("");
      setSelectedChain("ethereum");
      setHoldProgress(0);
      reset();
    }
  }, [open, reset]);

  useEffect(() => {
    if (prefillNumber) setRecipientNumber(prefillNumber);
  }, [prefillNumber]);

  const startHold = () => {
    if (!resolvedValid || !canSendAmount || !isEvmChain) return;
    const start = Date.now();
    const tick = () => {
      const p = Math.min(1, (Date.now() - start) / 1000);
      setHoldProgress(p);
      if (p >= 1) {
        send.mutate({
          to: resolvedWallet as `0x${string}`,
          value: parseEther(parsedAmount),
        });
        return;
      }
      holdTimer.current = window.requestAnimationFrame(tick);
    };
    holdTimer.current = window.requestAnimationFrame(tick);
  };

  const cancelHold = () => {
    if (holdTimer.current) cancelAnimationFrame(holdTimer.current);
    holdTimer.current = null;
    setHoldProgress(0);
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/70 p-0 backdrop-blur-sm sm:items-center sm:p-4" onClick={onClose}>
      <div
        className="w-full max-w-2xl overflow-hidden rounded-t-3xl border border-line bg-bg-raised shadow-2xl sm:rounded-3xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="flex items-center justify-between border-b border-line/60 px-5 py-4">
          <div className="flex items-center gap-2">
            {step > 1 && !isSuccess && (
              <button onClick={() => setStep((s) => (s - 1) as Step)} className="icon-btn">
                <ChevronLeft size={16} />
              </button>
            )}
            <h2 className="text-base font-semibold">
              {isSuccess ? "Sent" : "Send payment"}
            </h2>
          </div>
          <div className="flex items-center gap-2">
            <Steps step={isSuccess ? 4 : step} />
            <button onClick={onClose} className="icon-btn">
              <CloseIcon size={16} />
            </button>
          </div>
        </header>

        <div className="max-h-[85vh] overflow-y-auto p-5 sm:p-6">
          {isSuccess ? (
            <Success hash={hash} onClose={onClose} />
          ) : (
            <>
              {step === 1 && (
                <StepRecipient
                  value={recipientNumber}
                  onChange={setRecipientNumber}
                  parsed={parsedNumber}
                  isRegistered={!!isRegistered}
                  resolvedWallet={resolvedWallet}
                  resolvedViaOwner={resolvedViaOwner}
                  owner={owner as string | undefined}
                  selectedChain={selectedChain}
                  onChainChange={setSelectedChain}
                  onNext={() => setStep(2)}
                  canNext={!!resolvedValid}
                />
              )}
              {step === 2 && (
                <StepAmount
                  value={amount}
                  onChange={setAmount}
                  balance={balance}
                  recipient={recipientNumber}
                  resolvedWallet={resolvedWallet as string}
                  chainInfo={chainInfo}
                  onNext={() => setStep(3)}
                  canNext={!!canSendAmount}
                />
              )}
              {step === 3 && (
                <StepReview
                  recipient={recipientNumber}
                  resolvedWallet={resolvedWallet as string}
                  amount={parsedAmount}
                  chainInfo={chainInfo}
                  holdProgress={holdProgress}
                  startHold={startHold}
                  cancelHold={cancelHold}
                  isPending={isPending}
                  isConfirming={isConfirming}
                  error={error}
                />
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

function Steps({ step }: { step: number }) {
  return (
    <div className="flex gap-1.5">
      {[1, 2, 3].map((i) => (
        <span
          key={i}
          className={
            "h-1 w-5 rounded-full " +
            (step > i ? "bg-success" : step === i ? "bg-brand-500" : "bg-line")
          }
        />
      ))}
    </div>
  );
}

function StepRecipient({
  value,
  onChange,
  parsed,
  isRegistered,
  resolvedWallet,
  resolvedViaOwner,
  owner,
  selectedChain,
  onChainChange,
  onNext,
  canNext,
}: {
  value: string;
  onChange: (v: string) => void;
  parsed?: bigint;
  isRegistered: boolean;
  resolvedWallet?: string;
  resolvedViaOwner?: boolean;
  owner?: string;
  selectedChain: SendChainId;
  onChainChange: (c: SendChainId) => void;
  onNext: () => void;
  canNext: boolean;
}) {
  const initial = resolvedWallet
    ? resolvedWallet.replace(/^0x/, "").slice(0, 1).toUpperCase()
    : owner
      ? owner.slice(2, 3).toUpperCase()
      : "?";

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div>
        <div className="mb-4">
          <label className="label">Network</label>
          <div className="mt-2 flex gap-2 overflow-x-auto pb-1">
            {SEND_CHAINS.map((chain) => (
              <button
                key={chain.id}
                onClick={() => onChainChange(chain.id)}
                className={
                  "flex-shrink-0 rounded-xl border px-3 py-2 text-sm font-medium transition-colors " +
                  (selectedChain === chain.id
                    ? "border-brand-500 bg-brand-500/15 text-brand-300"
                    : "border-line bg-bg-raised text-ink-muted hover:border-brand-500/40")
                }
              >
                {chain.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card-raised">
          <label className="label">Recipient number</label>
          <input
            className="num w-full bg-transparent text-[28px] font-bold tracking-[0.04em] outline-none placeholder:text-ink-mute2 sm:text-[32px]"
            type="text"
            inputMode="numeric"
            maxLength={11}
            placeholder="000 000 000 00"
            autoFocus
            value={formatBPAN(value) || value}
            onChange={(e) => onChange(e.target.value.replace(/\D/g, ""))}
          />
          {value.length > 0 && value.length < 11 && (
            <p className="mt-2 text-xs text-ink-mute2">
              Keep typing — {11 - value.length} more digit{11 - value.length === 1 ? "" : "s"}
            </p>
          )}
          {parsed && isRegistered === false && (
            <p className="mt-2 text-xs text-danger">That number isn't registered.</p>
          )}
          {parsed && isRegistered && !resolvedWallet && (
            <p className="mt-2 text-xs text-amber">
              Registered, but no {SEND_CHAINS.find((c) => c.id === selectedChain)?.label} address mapped.
            </p>
          )}
          {resolvedWallet && (
            <div className="mt-3 flex items-center gap-3 rounded-xl border border-success/30 bg-success/10 p-3">
              <div className="grid h-10 w-10 place-items-center rounded-full bg-gradient-to-br from-success to-[#0ea5e9] text-sm font-bold text-white">
                {initial}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-sm font-semibold">Resolved</div>
                <div className="mono truncate text-xs text-ink-muted">{resolvedWallet}</div>
                {resolvedViaOwner && (
                  <div className="text-[11px] text-ink-mute2">via registry owner · Ethereum</div>
                )}
              </div>
              <CheckIcon className="text-success" size={20} />
            </div>
          )}
        </div>
        <button onClick={onNext} disabled={!canNext} className="btn-primary mt-4 w-full">
          Continue
        </button>
      </div>

      <div className="hidden lg:block">
        <div className="section-label mb-2">How it works</div>
        <ul className="space-y-3 text-sm text-ink-muted">
          <li>① Pick network and enter the 11-digit NumPay number.</li>
          <li>② Set the amount.</li>
          <li>③ Review, then hold to confirm.</li>
        </ul>
      </div>
    </div>
  );
}

function StepAmount({
  value,
  onChange,
  balance,
  recipient,
  resolvedWallet,
  chainInfo,
  onNext,
  canNext,
}: {
  value: string;
  onChange: (v: string) => void;
  balance?: bigint;
  recipient: string;
  resolvedWallet: string;
  chainInfo: SendChainInfo;
  onNext: () => void;
  canNext: boolean;
}) {
  const balanceEth = balance ? parseFloat(formatEther(balance)) : 0;
  const amountNum = parseFloat(value || "0");
  const overBalance = chainInfo.isEvm && amountNum > balanceEth;

  return (
    <div className="grid gap-5">
      <div className="card-raised text-center">
        <label className="label">Amount ({chainInfo.ticker})</label>
        <div className="relative mt-2 flex items-baseline justify-center gap-1">
          <span className="text-3xl font-bold text-ink-muted">{chainInfo.sym}</span>
          <input
            className="num min-w-[2ch] max-w-full bg-transparent text-center text-5xl font-bold tracking-tight text-ink outline-none placeholder:text-ink-mute2 sm:text-6xl"
            style={{ width: `${Math.max(2, (value || "0").length)}ch` }}
            inputMode="decimal"
            placeholder="0"
            autoFocus
            value={value}
            onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))}
          />
        </div>
        {chainInfo.isEvm && (
          <>
            <div className="mt-2 text-xs text-ink-muted">
              Balance <span className="mono font-medium text-ink">{balanceEth.toFixed(4)} ETH</span>
            </div>
            <div className="mt-4 flex justify-center gap-2">
              {["25", "50", "75", "100"].map((pct) => (
                <button
                  key={pct}
                  className="chip"
                  onClick={() =>
                    onChange(((balanceEth * Number(pct)) / 100).toFixed(6).replace(/\.?0+$/, ""))
                  }
                >
                  {pct}%
                </button>
              ))}
            </div>
          </>
        )}
        {!chainInfo.isEvm && (
          <p className="mt-3 text-xs text-ink-muted">
            Enter the amount you plan to send from your {chainInfo.label} wallet.
          </p>
        )}
        {overBalance && (
          <p className="mt-2 text-xs text-danger">Amount exceeds balance</p>
        )}
      </div>

      <div className="card flex items-center gap-3">
        <div className="grid h-8 w-8 place-items-center rounded-full bg-gradient-to-br from-[#627eea] to-[#3c5bd4] text-xs font-bold text-white">
          {chainInfo.sym}
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-sm font-semibold">{chainInfo.ticker} on {chainInfo.label}</div>
          <div className="text-xs text-ink-muted">
            To <span className="mono text-ink-muted">{formatBPAN(recipient)}</span>
          </div>
        </div>
      </div>

      <button onClick={onNext} disabled={!canNext || overBalance} className="btn-primary w-full">
        Review
      </button>
    </div>
  );
}

function StepReview({
  recipient,
  resolvedWallet,
  amount,
  chainInfo,
  holdProgress,
  startHold,
  cancelHold,
  isPending,
  isConfirming,
  error,
}: {
  recipient: string;
  resolvedWallet: string;
  amount: string;
  chainInfo: SendChainInfo;
  holdProgress: number;
  startHold: () => void;
  cancelHold: () => void;
  isPending: boolean;
  isConfirming: boolean;
  error: Error | null;
}) {
  const busy = isPending || isConfirming || holdProgress > 0;

  return (
    <div className="space-y-4">
      <div className="card-raised">
        <div className="section-label mb-3">Transaction summary</div>
        <Row k="To" v={<span className="mono">{formatBPAN(recipient)}</span>} />
        <Row k="Resolved" v={<span className="mono text-xs text-ink-muted">{resolvedWallet.slice(0, 10)}…{resolvedWallet.slice(-6)}</span>} />
        <Row k="Network" v={chainInfo.label} />
        <Row k="Amount" v={<span className="mono">{amount} {chainInfo.ticker}</span>} />
        {chainInfo.isEvm && (
          <>
            <Row k="Network fee" v={<span className="mono text-ink-muted">~0.00004 ETH</span>} />
            <Row k="Time" v="~12 sec" />
          </>
        )}
        <div className="mt-2 border-t border-line pt-3">
          <Row k={<b className="text-ink">You send</b>} v={<b className="mono text-ink">{amount} {chainInfo.ticker}</b>} />
        </div>
      </div>

      {chainInfo.isEvm ? (
        <button
          onMouseDown={startHold}
          onMouseUp={cancelHold}
          onMouseLeave={cancelHold}
          onTouchStart={startHold}
          onTouchEnd={cancelHold}
          disabled={busy && holdProgress >= 1}
          className="btn-primary relative w-full overflow-hidden py-4 text-base"
        >
          <span
            className="absolute inset-y-0 left-0 bg-white/20 transition-[width] duration-75"
            style={{ width: `${holdProgress * 100}%` }}
          />
          <span className="relative">
            {isPending ? "Confirm in wallet…" : isConfirming ? "Sending…" : "Hold to send"}
          </span>
          <span className="relative block text-xs font-normal opacity-80">
            {isPending || isConfirming ? " " : "Press and hold for 1 second to confirm"}
          </span>
        </button>
      ) : (
        <div className="rounded-xl border border-amber/30 bg-amber/10 p-4 text-sm">
          <p className="font-medium text-amber">Address resolved</p>
          <p className="mt-1 text-ink-muted">
            On-chain sending for {chainInfo.label} is coming soon. Copy the address below and send {amount} {chainInfo.ticker} from your own {chainInfo.label} wallet.
          </p>
          <button
            onClick={() => navigator.clipboard.writeText(resolvedWallet)}
            className="mt-3 w-full rounded-xl border border-line bg-bg-raised py-2.5 text-sm font-medium text-ink hover:border-brand-500/40"
          >
            Copy {chainInfo.label} address
          </button>
        </div>
      )}

      {error && (
        <p className="text-xs text-danger">{(error as any)?.shortMessage ?? error.message}</p>
      )}
    </div>
  );
}

function Row({ k, v }: { k: ReactNode; v: ReactNode }) {
  return (
    <div className="flex items-center justify-between py-1.5 text-sm">
      <span className="text-ink-muted">{k}</span>
      <span className="font-medium text-ink">{v}</span>
    </div>
  );
}

function Success({ hash, onClose }: { hash?: string; onClose: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 py-8 text-center">
      <div className="grid h-16 w-16 place-items-center rounded-full bg-success/15 text-success">
        <CheckIcon size={28} strokeWidth={2.5} />
      </div>
      <div>
        <div className="text-xl font-bold">Payment sent</div>
        <p className="mt-1 max-w-xs text-sm text-ink-muted">
          Your transaction has been confirmed on-chain.
        </p>
      </div>
      {hash && (
        <div className="mono break-all rounded-xl border border-line bg-bg-card px-3 py-2 text-xs text-ink-muted">
          {hash.slice(0, 14)}…{hash.slice(-10)}
        </div>
      )}
      <button onClick={onClose} className="btn-primary mt-2">Done</button>
    </div>
  );
}
