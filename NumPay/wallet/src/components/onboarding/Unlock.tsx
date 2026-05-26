"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { PulseBadge } from "../primitives/PulseBadge";

export function Unlock() {
  const { unlock, reset } = useWallet();
  const [password, setPassword] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await unlock(password);
    } catch (e: any) {
      setErr(e.message ?? "Wrong password");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mx-auto flex min-h-screen max-w-sm flex-col items-center justify-center px-6 text-center">
      <div className="mb-6">
        <PulseBadge size={88} />
      </div>
      <h1 className="text-2xl font-bold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm" style={{ color: "var(--muted)" }}>
        Unlock NumPay to continue.
      </p>

      <form onSubmit={submit} className="mt-6 w-full space-y-3 text-left">
        <div>
          <label className="label">Password</label>
          <input
            type="password"
            autoFocus
            className="input"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>
        {err && <p className="text-sm text-danger">{err}</p>}
        <button type="submit" disabled={!password || busy} className="btn-primary w-full">
          {busy ? "Unlocking…" : "Unlock"}
        </button>
      </form>

      <button
        onClick={() => {
          if (confirm("This deletes the wallet on this device. Without your private key backup, funds will be lost. Continue?")) {
            reset();
          }
        }}
        className="mt-6 text-xs text-ink-mute2 underline hover:text-ink-muted"
      >
        Forgot password — reset this device
      </button>
    </div>
  );
}
