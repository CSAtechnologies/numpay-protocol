import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { importFromMnemonic, importFromPrivateKey, encryptAndSave } from "@/lib/wallet";
import { cacheWalletSession } from "../hooks/useWallet";
import { ArrowLeftIcon } from "../components/Icons";
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

export default function ImportWallet({ onComplete }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"mnemonic" | "privateKey">("mnemonic");
  const [input, setInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleImport() {
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPw) {
      setError("Passwords do not match");
      return;
    }
    if (!input.trim()) {
      setError(tab === "mnemonic" ? "Enter your recovery phrase" : "Enter your private key");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const wallet =
        tab === "mnemonic"
          ? importFromMnemonic(input)
          : importFromPrivateKey(input.trim());
      const id = await encryptAndSave(wallet, password, "Wallet 1");
      await cacheWalletSession(wallet, id);
      onComplete();
    } catch (e: any) {
      setError(e.message || "Invalid input");
    } finally {
      setLoading(false);
    }
  }

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

      <div className="flex-1 flex flex-col px-5 pt-10 pb-7 relative z-10 animate-slide-up">
        {/* Compact animated header */}
        <div className="flex flex-col items-center mb-4">
          <div
            className="relative flex items-center justify-center mb-3 animate-float"
            style={{ width: 76, height: 76 }}
          >
            <div className="logo-ring" style={{ animationDelay: "0s" }} />
            <div className="logo-ring" style={{ animationDelay: "1.2s" }} />
            <div className="absolute inset-0 flex items-center justify-center">
              <AnimatedLogo size={48} />
            </div>
          </div>
          <h1 className="font-bold tracking-tight mb-1" style={{ fontSize: 22, ...titleGradient }}>
            Import Wallet
          </h1>
          <p className="text-text-secondary text-[13px] text-center max-w-[230px]">
            Restore an existing wallet with your recovery phrase or private key.
          </p>
        </div>

        {/* Form card */}
        <div className="auth-card mt-auto">
          {/* Tabs */}
          <div className="flex bg-surface-1 rounded-xl p-1 mb-4 border border-border">
            <button
              onClick={() => { setTab("mnemonic"); setError(""); }}
              className={`flex-1 py-2 text-[13px] rounded-lg font-medium transition-all duration-150 ${
                tab === "mnemonic" ? "bg-brand-500 text-white" : "text-muted hover:text-text-secondary"
              }`}
            >
              Recovery Phrase
            </button>
            <button
              onClick={() => { setTab("privateKey"); setError(""); }}
              className={`flex-1 py-2 text-[13px] rounded-lg font-medium transition-all duration-150 ${
                tab === "privateKey" ? "bg-brand-500 text-white" : "text-muted hover:text-text-secondary"
              }`}
            >
              Private Key
            </button>
          </div>

          {tab === "mnemonic" ? (
            <textarea
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(""); }}
              placeholder="Enter your 12-word recovery phrase..."
              rows={3}
              className="input-field mb-3 resize-none"
            />
          ) : (
            <input
              type="password"
              value={input}
              onChange={(e) => { setInput(e.target.value); setError(""); }}
              placeholder="Enter your private key (0x...)"
              className="input-field mb-3"
            />
          )}

          <input
            type="password"
            value={password}
            onChange={(e) => { setPassword(e.target.value); setError(""); }}
            placeholder="Password (at least 8 characters)"
            className="input-field mb-3"
          />
          <input
            type="password"
            value={confirmPw}
            onChange={(e) => { setConfirmPw(e.target.value); setError(""); }}
            onKeyDown={(e) => e.key === "Enter" && handleImport()}
            placeholder="Confirm password"
            className="input-field mb-3"
          />

          {error && (
            <p className="text-[12px] mb-3 animate-fade-in" style={{ color: "#ef4444" }}>
              {error}
            </p>
          )}

          <button onClick={handleImport} disabled={loading} className="btn-primary-premium">
            {loading ? (
              <>
                <span
                  className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                  style={{ display: "inline-block" }}
                />
                Importing…
              </>
            ) : (
              "Import Wallet"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
