import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { createWallet, encryptAndSave } from "@/lib/wallet";
import { cacheWalletSession } from "../hooks/useWallet";
import { ArrowLeftIcon, ShieldIcon } from "../components/Icons";
import AnimatedLogo from "../components/AnimatedLogo";

interface Props {
  onComplete: () => void;
}

// Same gradient wordmark treatment as Welcome / Unlock.
const titleGradient: React.CSSProperties = {
  background: "linear-gradient(160deg, #f0efff 20%, rgba(196,181,253,0.85) 100%)",
  WebkitBackgroundClip: "text",
  backgroundClip: "text",
  WebkitTextFillColor: "transparent",
};

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
    <div className="auth-bg h-full flex flex-col animate-fade-in">
      {/* Animated gradient orbs */}
      <div className="auth-orb auth-orb-top" />
      <div className="auth-orb auth-orb-right" />
      <div className="auth-orb auth-orb-left" />

      {/* Back */}
      <button
        onClick={() => navigate(-1)}
        className="absolute top-4 left-4 z-20 text-text-secondary hover:text-text-primary transition-colors"
        aria-label="Back"
      >
        <ArrowLeftIcon size={18} />
      </button>

      {step === "password" && (
        <div className="flex-1 flex flex-col px-5 pt-12 pb-7 relative z-10 animate-slide-up">
          {/* Compact animated header */}
          <div className="flex flex-col items-center mb-6">
            <div
              className="relative flex items-center justify-center mb-5 animate-float"
              style={{ width: 92, height: 92 }}
            >
              <div className="logo-ring" style={{ animationDelay: "0s" }} />
              <div className="logo-ring" style={{ animationDelay: "1.2s" }} />
              <div className="absolute inset-0 flex items-center justify-center">
                <AnimatedLogo size={58} />
              </div>
            </div>
            <h1 className="font-bold tracking-tight mb-1.5" style={{ fontSize: 22, ...titleGradient }}>
              Create Password
            </h1>
            <p className="text-text-secondary text-[13px] text-center max-w-[230px]">
              This password encrypts your wallet on this device.
            </p>
          </div>

          {/* Form card */}
          <div className="auth-card mt-auto">
            <input
              type="password"
              value={password}
              onChange={(e) => { setPassword(e.target.value); setError(""); }}
              placeholder="Password (at least 8 characters)"
              className="input-field mb-3"
              autoFocus
            />
            <input
              type="password"
              value={confirmPw}
              onChange={(e) => { setConfirmPw(e.target.value); setError(""); }}
              onKeyDown={(e) => e.key === "Enter" && handleSetPassword()}
              placeholder="Confirm password"
              className="input-field mb-3"
            />

            {error && (
              <p className="text-[12px] mb-3 animate-fade-in" style={{ color: "#ef4444" }}>
                {error}
              </p>
            )}

            <button onClick={handleSetPassword} disabled={loading} className="btn-primary-premium">
              {loading ? (
                <>
                  <span
                    className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                    style={{ display: "inline-block" }}
                  />
                  Creating…
                </>
              ) : (
                "Create Wallet"
              )}
            </button>
          </div>
        </div>
      )}

      {step === "mnemonic" && (
        <div className="flex-1 flex flex-col px-5 pt-12 pb-7 relative z-10 animate-slide-up">
          <div className="flex flex-col items-center mb-5">
            <div className="flex items-center gap-2 mb-1.5">
              <ShieldIcon size={18} className="text-accent-amber" />
              <h1 className="font-bold tracking-tight" style={{ fontSize: 22, ...titleGradient }}>
                Recovery Phrase
              </h1>
            </div>
            <p className="text-text-secondary text-[13px] text-center max-w-[250px]">
              Write down these 12 words and store them safely. This is the only way to recover your wallet.
            </p>
          </div>

          <div className="auth-card mt-auto">
            <div className="grid grid-cols-3 gap-1.5 mb-4">
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

            <label className="flex items-center gap-2.5 text-[13px] text-muted mb-4 cursor-pointer select-none">
              <input
                type="checkbox"
                checked={saved}
                onChange={(e) => setSaved(e.target.checked)}
                className="w-4 h-4 rounded accent-brand-500"
              />
              I have saved my recovery phrase
            </label>

            <button onClick={onComplete} disabled={!saved} className="btn-primary-premium">
              Continue to Wallet
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
