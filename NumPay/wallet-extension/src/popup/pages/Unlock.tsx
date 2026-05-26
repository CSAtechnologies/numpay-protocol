import { useState } from "react";
import { decryptAllVaults, getActiveId } from "@/lib/wallet";
import { cacheAllWalletSessions } from "../hooks/useWallet";

interface Props {
  onUnlock: () => void;
}

export default function Unlock({ onUnlock }: Props) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleUnlock() {
    if (!password) return;
    setLoading(true);
    setError("");
    try {
      const all = await decryptAllVaults(password);
      const savedId = await getActiveId();
      const activeId = all.find((w) => w.id === savedId)?.id ?? all[0].id;
      await cacheAllWalletSessions(all, activeId);
      onUnlock();
    } catch {
      setError("Incorrect password — try again");
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

      {/* Logo area */}
      <div className="flex-1 flex flex-col items-center justify-center relative z-10">
        {/* Pulsing logo */}
        <div
          className="relative flex items-center justify-center mb-7 animate-float"
          style={{ width: 120, height: 120 }}
        >
          <div className="logo-ring" style={{ animationDelay: "0s" }} />
          <div className="logo-ring" style={{ animationDelay: "1.2s" }} />

          <div className="absolute inset-0 flex items-center justify-center">
            <div className="logo-bevel">
              <img
                src="/logo.png"
                alt="NumPay"
                className="w-[76px] h-[76px] object-contain"
              />
            </div>
          </div>
        </div>

        <h1
          className="font-bold mb-1.5 tracking-tight"
          style={{
            fontSize: 24,
            background: "linear-gradient(160deg, #f0efff 20%, rgba(196,181,253,0.8) 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          Welcome back
        </h1>
        <p className="text-text-secondary text-[13px]">Enter your password to unlock</p>
      </div>

      {/* Form */}
      <div className="px-5 pb-7 relative z-10">
        <div className="auth-card">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleUnlock()}
            placeholder="Password"
            className="input-field mb-3"
            autoFocus
          />

          {error && (
            <p className="text-[12px] mb-3 animate-fade-in" style={{ color: "#ef4444" }}>
              {error}
            </p>
          )}

          <button
            onClick={handleUnlock}
            disabled={loading}
            className="btn-primary-premium"
          >
            {loading ? (
              <>
                <span
                  className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin"
                  style={{ display: "inline-block" }}
                />
                Unlocking…
              </>
            ) : (
              "Unlock Wallet"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
