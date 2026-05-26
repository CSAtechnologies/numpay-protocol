import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createWallet, encryptAndSave } from "@/lib/wallet";
import { cacheWalletSession } from "../hooks/useWallet";
import { ArrowLeftIcon, ShieldIcon } from "../components/Icons";

interface Props {
  onComplete: () => void;
}

export default function CreateWallet({ onComplete }: Props) {
  const navigate = useNavigate();
  const [step, setStep] = useState<"password" | "mnemonic">("password");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [mnemonic, setMnemonic] = useState("");
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleSetPassword() {
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPw) {
      setError("Passwords do not match");
      return;
    }
    setError("");
    const wallet = createWallet();
    setMnemonic(wallet.mnemonic);

    setLoading(true);
    try {
      const id = await encryptAndSave(wallet, password, "Wallet 1");
      await cacheWalletSession(wallet, id);
      setStep("mnemonic");
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const words = mnemonic.split(" ");

  return (
    <div className="flex flex-col h-full bg-surface-0 px-5 py-4 animate-fade-in">
      <button onClick={() => navigate(-1)} className="text-muted hover:text-text-primary mb-5 self-start transition-colors">
        <ArrowLeftIcon size={18} />
      </button>

      {step === "password" && (
        <div className="animate-slide-up">
          <h2 className="text-lg font-bold text-text-primary mb-1">Create Password</h2>
          <p className="text-muted text-[13px] mb-6">This password encrypts your wallet on this device.</p>

          <label className="text-xs text-text-secondary mb-1.5 block font-medium">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            className="input-field mb-3"
          />

          <label className="text-xs text-text-secondary mb-1.5 block font-medium">Confirm Password</label>
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => setConfirmPw(e.target.value)}
            placeholder="Re-enter password"
            className="input-field mb-4"
          />

          {error && <p className="text-accent-red text-xs mb-3 animate-fade-in">{error}</p>}

          <button onClick={handleSetPassword} disabled={loading} className="btn-primary mt-auto">
            {loading ? "Creating..." : "Create Wallet"}
          </button>
        </div>
      )}

      {step === "mnemonic" && (
        <div className="animate-slide-up">
          <div className="flex items-center gap-2 mb-1">
            <ShieldIcon size={18} className="text-accent-amber" />
            <h2 className="text-lg font-bold text-text-primary">Recovery Phrase</h2>
          </div>
          <p className="text-muted text-[13px] mb-5">
            Write down these 12 words and store them safely. This is the only way to recover your wallet.
          </p>

          <div className="grid grid-cols-3 gap-1.5 mb-5">
            {words.map((word, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 px-2.5 py-2 rounded-lg bg-surface-1 border border-border text-sm"
              >
                <span className="text-muted text-[10px] font-mono w-4 text-right">{i + 1}</span>
                <span className="text-text-primary font-medium">{word}</span>
              </div>
            ))}
          </div>

          <label className="flex items-center gap-2.5 text-[13px] text-muted mb-5 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={saved}
              onChange={(e) => setSaved(e.target.checked)}
              className="w-4 h-4 rounded accent-brand-500"
            />
            I have saved my recovery phrase
          </label>

          <button onClick={onComplete} disabled={!saved} className="btn-primary mt-auto">
            Continue to Wallet
          </button>
        </div>
      )}
    </div>
  );
}
