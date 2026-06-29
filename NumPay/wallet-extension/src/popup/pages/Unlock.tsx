import { useState } from "react";
import { decryptAllVaults, getActiveId } from "@/lib/wallet";
import { cacheUnlockedWallets } from "../hooks/useWallet";

interface Props {
  onUnlock: () => void;
}

const NP_PURPLE = "#786EE9";

/**
 * Pure-vector NumPay mark that builds itself once on mount: the purple tile
 * forms in, the white "N" snake-draws along its single centerline (up the left
 * bar, down the diagonal, up the right bar), then the foot/dash bounces up into
 * place. Geometry traced from public/logo.png and normalized to a 100x100
 * viewBox; the tile fills the icon (6..94) so it reads as the real app-icon
 * mark, with a soft purple drop-shadow (see .npl-svg in index.css).
 *
 * No JS animation loop and no remote assets — all motion lives in CSS keyframes
 * (see src/popup/index.css, ".npl-*"). The reveal mask is stroked wide with
 * round caps so the final N is 100% solid (no mask seams). Under
 * prefers-reduced-motion the keyframes are skipped and the final static mark
 * renders as-is.
 */
function AnimatedLogo({ size = 76 }: { size?: number }) {
  return (
    <svg
      className="npl-svg"
      width={size}
      height={size}
      viewBox="0 0 100 100"
      role="img"
      aria-label="NumPay"
      style={{ display: "block", overflow: "visible" }}
    >
      <defs>
        {/* Snake centerline used as a reveal mask. White = visible; as the
            stroke draws (dashoffset 1000 -> 0) it uncovers the N body. Stroked
            wide with round caps so the final body polygon is 100% revealed
            (crisp, no mask seams). */}
        <mask id="npl-reveal" maskUnits="userSpaceOnUse">
          <path
            className="npl-snake"
            d="M28.33 62.3 L28.33 22.93 L71.48 62.68 L71.48 23.12"
            fill="none"
            stroke="#fff"
            strokeWidth={14}
            strokeLinecap="round"
            strokeLinejoin="round"
            pathLength={1000}
          />
        </mask>
      </defs>

      {/* Rounded-square brand tile (full-bleed app icon) */}
      <rect className="npl-tile" x="6" y="6" width="88" height="88" rx="13.2" ry="13.2" fill={NP_PURPLE} />

      {/* N body — left bar, diagonal and right bar as ONE crisp polygon (outline
          traced from logo.png). The two bars float above the foot. Revealed by
          the snake mask, so the final edges are exactly this polygon. */}
      <path
        mask="url(#npl-reveal)"
        fill="#fff"
        d="M23.22 22.93 L35.14 22.93 L66.37 53.79 L66.56 23.12 L76.4 23.12 L76.4 62.68 L60.88 62.68 L33.63 35.62 L33.44 62.3 L23.22 62.3 Z"
      />

      {/* Foot — the dash with the triangular bump that rises toward the
          diagonal. Bounces up into place after the N finishes drawing. */}
      <path
        className="npl-foot"
        fill="#fff"
        d="M41.39 53.3 L56.72 67.98 L76.4 67.98 L76.4 77.07 L23.22 77.07 L23.22 67.98 L41.39 67.98 Z"
      />
    </svg>
  );
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
      setError("Incorrect password, try again");
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
