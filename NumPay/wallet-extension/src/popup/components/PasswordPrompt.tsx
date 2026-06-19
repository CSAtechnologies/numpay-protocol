import { useState } from "react";

/**
 * Small modal that collects the wallet password for an action that needs to
 * decrypt a vault on demand (e.g. switching to another wallet under the
 * decrypt-only-active model). `onSubmit` should throw on an incorrect password;
 * the error is shown inline and the prompt stays open. On success the parent
 * closes it.
 */
export default function PasswordPrompt({
  title,
  subtitle,
  actionLabel,
  onCancel,
  onSubmit,
}: {
  title: string;
  subtitle?: string;
  actionLabel: string;
  onCancel: () => void;
  onSubmit: (password: string) => Promise<void>;
}) {
  const [pw, setPw] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    if (!pw || busy) return;
    setBusy(true);
    setErr("");
    try {
      await onSubmit(pw);
    } catch (e: any) {
      setErr(e?.message || "Incorrect password");
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-5 bg-black/50 animate-fade-in"
      onClick={onCancel}
    >
      <div className="premium-card w-full max-w-[300px] p-4" onClick={(e) => e.stopPropagation()}>
        <p className="text-[14px] font-semibold text-text-primary mb-0.5">{title}</p>
        {subtitle && <p className="text-[11px] text-muted mb-3">{subtitle}</p>}
        <input
          type="password"
          value={pw}
          onChange={(e) => { setPw(e.target.value); setErr(""); }}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="Password"
          className="input-field mb-2"
          autoFocus
        />
        {err && <p className="text-[12px] mb-2" style={{ color: "var(--danger)" }}>{err}</p>}
        <div className="flex gap-2 mt-1">
          <button
            onClick={onCancel}
            className="flex-1 py-2 rounded-xl bg-surface-2 text-text-secondary text-[13px] font-medium border border-border hover:bg-surface-3 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={busy || !pw}
            className="flex-1 btn-primary-premium text-[13px] disabled:opacity-40"
          >
            {busy ? "..." : actionLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
