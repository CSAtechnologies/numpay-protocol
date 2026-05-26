import { useNavigate } from "react-router-dom";

export default function Welcome() {
  const navigate = useNavigate();

  return (
    <div className="auth-bg h-full flex flex-col animate-fade-in">
      {/* Animated gradient orbs */}
      <div className="auth-orb auth-orb-top" />
      <div className="auth-orb auth-orb-right" />
      <div className="auth-orb auth-orb-left" />

      {/* Logo + branding */}
      <div className="flex-1 flex flex-col items-center justify-center pt-6 pb-4 relative z-10">
        {/* Pulsing logo */}
        <div
          className="relative flex items-center justify-center mb-8 animate-float"
          style={{ width: 140, height: 140 }}
        >
          {/* Three staggered pulse rings */}
          <div className="logo-ring" style={{ animationDelay: "0s" }} />
          <div className="logo-ring" style={{ animationDelay: "1s" }} />
          <div className="logo-ring" style={{ animationDelay: "2s" }} />

          {/* Logo centred inside rings */}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="logo-bevel">
              <img
                src="/logo.png"
                alt="NumPay"
                className="w-[88px] h-[88px] object-contain"
              />
            </div>
          </div>
        </div>

        {/* Wordmark */}
        <h1
          className="font-bold tracking-tight mb-2"
          style={{
            fontSize: 28,
            background: "linear-gradient(160deg, #f0efff 20%, rgba(196,181,253,0.85) 100%)",
            WebkitBackgroundClip: "text",
            backgroundClip: "text",
            WebkitTextFillColor: "transparent",
          }}
        >
          NumPay
        </h1>

        <p className="text-text-secondary text-[13px] text-center leading-relaxed max-w-[210px]">
          Multi-chain wallet with BPAN support. Send crypto using simple account numbers.
        </p>
      </div>

      {/* Bottom action card */}
      <div className="px-5 pb-7 relative z-10">
        <div className="auth-card">
          <button
            onClick={() => navigate("/create")}
            className="btn-primary-premium mb-3"
          >
            Create New Wallet
          </button>
          <button
            onClick={() => navigate("/import")}
            className="btn-secondary"
          >
            Import Existing Wallet
          </button>
        </div>

        <p
          className="text-center mt-5"
          style={{ fontSize: 10, color: "rgba(107,105,138,0.55)" }}
        >
          Powered by BPAN Protocol
        </p>
      </div>
    </div>
  );
}
