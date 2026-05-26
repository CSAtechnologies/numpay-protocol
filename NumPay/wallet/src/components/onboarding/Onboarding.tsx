"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import type { Hex } from "viem";
import { CheckIcon, CopyIcon, ChevronLeft } from "../icons/Icon";
import { PulseBadge } from "../primitives/PulseBadge";

type Step = "welcome" | "password" | "backup" | "import";

export function Onboarding() {
  const { createWallet, importWallet } = useWallet();
  const [step, setStep] = useState<Step>("welcome");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [importKey, setImportKey] = useState("");
  const [privateKey, setPrivateKey] = useState<Hex | undefined>();
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const passOk = password.length >= 8;
  const passMatches = password && password === confirm;

  const handleCreate = async () => {
    if (!passOk || !passMatches) return;
    setBusy(true);
    setError(null);
    try {
      const pk = await createWallet(password);
      setPrivateKey(pk);
      setStep("backup");
    } catch (e: any) {
      setError(e.message ?? "Failed to create wallet");
    } finally {
      setBusy(false);
    }
  };

  const handleImport = async () => {
    if (!passOk || !passMatches || !importKey) return;
    setBusy(true);
    setError(null);
    try {
      const pk = importKey.startsWith("0x") ? importKey : (`0x${importKey}` as Hex);
      await importWallet(pk as Hex, password);
    } catch (e: any) {
      setError(e.message ?? "Invalid private key");
    } finally {
      setBusy(false);
    }
  };

  const copyKey = async () => {
    if (!privateKey) return;
    await navigator.clipboard.writeText(privateKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 1400);
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center px-6 py-10">
      {step === "welcome" && (
        <div className="flex flex-col items-center text-center">
          <PulseBadge size={120} />
          <div
            className="mono mt-5 text-[11px] font-semibold uppercase tracking-[0.2em]"
            style={{ color: "var(--brand-2)" }}
          >
            Addresses, retired.
          </div>
          <h1 className="mt-4 text-[44px] font-bold leading-none tracking-tight sm:text-[52px]">
            Your crypto,
            <br />
            <span className="gradient-text">one number.</span>
          </h1>
          <p
            className="mt-4 max-w-md text-[15px] leading-relaxed"
            style={{ color: "var(--muted)" }}
          >
            NumPay gives you an 11-digit BPAN that works across every chain. Share it like a phone
            number.
          </p>

          <div className="mt-7 grid w-full gap-3 sm:w-auto sm:grid-cols-2 sm:gap-2.5">
            <button
              onClick={() => setStep("password")}
              className="btn-primary px-7 py-3.5 text-base"
            >
              Create new wallet
            </button>
            <button
              onClick={() => setStep("import")}
              className="btn-secondary px-7 py-3.5 text-base"
            >
              Import existing key
            </button>
          </div>

          <p className="mono mt-6 text-[11px]" style={{ color: "var(--muted-2)" }}>
            v1.0.0 · numpay.app
          </p>
        </div>
      )}

      {step === "password" && (
        <PasswordStep
          title="Choose a password"
          subtitle="Used to encrypt your key on this device. Minimum 8 characters."
          password={password}
          setPassword={setPassword}
          confirm={confirm}
          setConfirm={setConfirm}
          onBack={() => setStep("welcome")}
          onContinue={handleCreate}
          canContinue={!!passOk && !!passMatches && !busy}
          busy={busy}
          error={error}
          continueLabel="Create wallet"
        />
      )}

      {step === "import" && (
        <PasswordStep
          title="Import private key"
          subtitle="Paste your 0x-prefixed private key, then set a local password."
          password={password}
          setPassword={setPassword}
          confirm={confirm}
          setConfirm={setConfirm}
          onBack={() => setStep("welcome")}
          onContinue={handleImport}
          canContinue={!!passOk && !!passMatches && !!importKey && !busy}
          busy={busy}
          error={error}
          continueLabel="Import"
        >
          <label className="label">Private key</label>
          <input
            className="input mono"
            placeholder="0x…"
            value={importKey}
            onChange={(e) => setImportKey(e.target.value.trim())}
            type="password"
          />
        </PasswordStep>
      )}

      {step === "backup" && privateKey && (
        <>
          <button onClick={() => setStep("welcome")} className="icon-btn mb-6 self-start">
            <ChevronLeft size={16} />
          </button>
          <h1 className="text-3xl font-bold tracking-tight">Back up your key</h1>
          <p className="mt-2 max-w-md text-sm text-ink-muted">
            This is the only way to recover your account on another device.
            Store it somewhere safe — we can't show it to you again without your password.
          </p>

          <div className="mt-6 card-raised">
            <div className="section-label mb-2">Private key</div>
            <div className="mono break-all rounded-xl bg-bg-base p-3 text-sm">{privateKey}</div>
            <button onClick={copyKey} className="btn-secondary mt-3 w-full inline-flex items-center justify-center gap-2">
              {copied ? <CheckIcon size={16} /> : <CopyIcon size={16} />}
              {copied ? "Copied" : "Copy to clipboard"}
            </button>
          </div>

          <button className="btn-primary mt-6" onClick={() => { /* context already marked unlocked */ }}>
            I've saved it — continue
          </button>
        </>
      )}
    </div>
  );
}

function PasswordStep({
  title,
  subtitle,
  password,
  setPassword,
  confirm,
  setConfirm,
  onBack,
  onContinue,
  canContinue,
  busy,
  error,
  continueLabel,
  children,
}: {
  title: string;
  subtitle: string;
  password: string;
  setPassword: (v: string) => void;
  confirm: string;
  setConfirm: (v: string) => void;
  onBack: () => void;
  onContinue: () => void;
  canContinue: boolean;
  busy: boolean;
  error: string | null;
  continueLabel: string;
  children?: React.ReactNode;
}) {
  return (
    <>
      <button onClick={onBack} className="icon-btn mb-6 self-start">
        <ChevronLeft size={16} />
      </button>
      <h1 className="text-3xl font-bold tracking-tight">{title}</h1>
      <p className="mt-2 max-w-md text-sm text-ink-muted">{subtitle}</p>

      <div className="mt-6 space-y-3">
        {children}
        <div>
          <label className="label">Password</label>
          <input
            type="password"
            className="input"
            placeholder="At least 8 characters"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Confirm password</label>
          <input
            type="password"
            className="input"
            placeholder="Type it again"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
          {confirm && password !== confirm && (
            <p className="mt-1 text-xs text-danger">Passwords don't match</p>
          )}
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <button
        onClick={onContinue}
        disabled={!canContinue}
        className="btn-primary mt-6"
      >
        {busy ? "Working…" : continueLabel}
      </button>
    </>
  );
}
