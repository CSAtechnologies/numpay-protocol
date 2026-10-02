import { useState } from "react";
import { decryptAllVaults, getActiveId } from "@numpay/core/wallet";
import { cacheUnlockedWallets } from "../hooks/useWallet";
import AnimatedLogo from "../components/AnimatedLogo";
import { InlineNotice } from "../components/AlertCard";

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
      // Unlock-all: decrypt every wallet this password can open and cache them
      // together, so switching accounts afterwards is instant (no re-prompt).
      // The active vault must decrypt or this throws; wallets under a different
      // password are skipped and get prompted on demand when first switched to.
      const all = await decryptAllVaults(password);
      const activeId = (await getActiveId()) ?? undefined;
      await cacheUnlockedWallets(all.map((w) => ({ id: w.id, wallet: w.wallet })), activeId);
      onUnlock();
    } catch {
      setError("That password did not unlock this wallet. Try again.");
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
            <AnimatedLogo size={76} />
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

          {error && <InlineNotice message={error} className="mb-3" />}

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
