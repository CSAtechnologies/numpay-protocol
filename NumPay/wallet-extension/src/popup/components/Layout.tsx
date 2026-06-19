import { useNavigate, useLocation } from "react-router-dom";
import {
  NavWalletIcon, NavSendIcon, NavReceiveIcon, NavBpanIcon,
  NavActivityIcon, NavSettingsIcon, ArrowLeftIcon,
} from "./Icons";

const NAV_ITEMS = [
  { path: "/", label: "Wallet", Icon: NavWalletIcon },
  { path: "/send", label: "Send", Icon: NavSendIcon },
  { path: "/receive", label: "Receive", Icon: NavReceiveIcon },
  { path: "/bpan", label: "BPAN", Icon: NavBpanIcon },
  { path: "/history", label: "Activity", Icon: NavActivityIcon },
  { path: "/settings", label: "Settings", Icon: NavSettingsIcon },
];

interface LayoutProps {
  children: React.ReactNode;
  title?: string;
  showBack?: boolean;
  showNav?: boolean;
}

export default function Layout({ children, title, showBack, showNav = true }: LayoutProps) {
  const navigate = useNavigate();
  const location = useLocation();

  return (
    <div className="h-full bg-surface-0 flex flex-col">
      {/* Header */}
      {title && (
        <div className="flex items-center gap-2.5 px-4 h-[50px] flex-shrink-0 relative">
          {/* Gradient separator */}
          <div
            className="absolute bottom-0 left-0 right-0 h-px"
            style={{ background: "linear-gradient(90deg, transparent, rgba(139,92,246,0.2), transparent)" }}
          />
          {showBack && (
            <button
              onClick={() => navigate(-1)}
              className="w-8 h-8 rounded-xl flex items-center justify-center text-muted hover:text-text-primary hover:bg-surface-2 transition-all flex-shrink-0"
            >
              <ArrowLeftIcon size={16} />
            </button>
          )}
          <h1 className="text-[15px] font-semibold text-text-primary tracking-tight">{title}</h1>
        </div>
      )}

      {/* Scrollable content — padded so last items clear the floating nav */}
      <div className={`flex-1 min-h-0 overflow-y-auto ${showNav ? "pb-[78px]" : ""}`}>
        {children}
      </div>

      {/* Floating pill nav */}
      {showNav && (
        <nav className="floating-nav">
          {NAV_ITEMS.map((item) => {
            const active = location.pathname === item.path;
            return (
              <button
                key={item.path}
                onClick={() => navigate(item.path)}
                className={`relative flex-1 flex flex-col items-center justify-center gap-[3px] h-full transition-all duration-200 ${
                  active
                    ? "text-brand-400"
                    : "text-muted hover:text-text-secondary"
                }`}
              >
                {/* Active background pill */}
                {active && (
                  <div
                    className="absolute inset-x-1.5 inset-y-1.5 rounded-2xl"
                    style={{
                      background: "rgba(139, 92, 246, 0.12)",
                      border: "1px solid rgba(139, 92, 246, 0.1)",
                    }}
                  />
                )}
                <item.Icon size={17} active={active} className="relative z-10" />
                <span
                  className="relative z-10 font-semibold tracking-wider"
                  style={{ fontSize: 9, letterSpacing: "0.06em" }}
                >
                  {item.label.toUpperCase()}
                </span>
              </button>
            );
          })}
        </nav>
      )}
    </div>
  );
}
