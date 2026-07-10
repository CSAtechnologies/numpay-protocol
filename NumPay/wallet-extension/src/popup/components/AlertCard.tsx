import { AlertIcon, ShieldIcon } from "./Icons";

// Shared inline error/notice card used by the Send and Swap/Bridge pages so
// every failure reads the same way: a toned hairline + icon tile, a bold
// title, a plain-language body, an optional hint row, optional
// required/available figure tiles, and an optional "funds are safe"
// reassurance line. Pages own their message parsing; this owns the look.
export interface AlertCardProps {
  title: string;
  body: string;
  hint?: string;
  tone?: "danger" | "amber";
  /** Optional Required/Available tiles (e.g. a SOL fee shortfall). */
  figures?: { required: string; available: string; unit: string };
  /** Show the "Nothing was sent" reassurance line. */
  safe?: boolean;
  className?: string;
}

export default function AlertCard({
  title, body, hint, tone = "danger", figures, safe, className = "mb-4",
}: AlertCardProps) {
  const color = tone === "danger" ? "var(--danger)" : "var(--amber)";
  const iconBg = tone === "danger" ? "rgba(239,68,68,0.12)" : "rgba(245,158,11,0.12)";
  return (
    <div className={`premium-card overflow-hidden animate-slide-up ${className}`}>
      <div className="h-[2px] w-full" style={{ background: `linear-gradient(90deg, transparent, ${color}, transparent)`, opacity: 0.7 }} />
      <div className="p-3.5">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-xl flex items-center justify-center flex-shrink-0" style={{ background: iconBg }}>
            <AlertIcon size={16} style={{ color }} />
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-bold mb-0.5" style={{ color }}>{title}</p>
            <p className="text-[11px] text-text-secondary leading-relaxed break-words">{body}</p>
          </div>
        </div>
        {figures && (
          <div className="flex gap-2 mt-3">
            <div className="flex-1 rounded-xl bg-surface-2 px-3 py-2">
              <p className="text-[9px] uppercase tracking-wider text-muted mb-0.5">Required</p>
              <p className="text-[13px] font-bold text-text-primary tabular-nums">
                ~{figures.required} <span className="text-[10px] text-muted font-semibold">{figures.unit}</span>
              </p>
            </div>
            <div className="flex-1 rounded-xl bg-surface-2 px-3 py-2">
              <p className="text-[9px] uppercase tracking-wider text-muted mb-0.5">Available</p>
              <p className="text-[13px] font-bold tabular-nums" style={{ color }}>
                {figures.available} <span className="text-[10px] text-muted font-semibold">{figures.unit}</span>
              </p>
            </div>
          </div>
        )}
        {hint && (
          <div className="mt-3 px-3 py-2 rounded-xl bg-surface-1 border border-border">
            <p className="text-[10.5px] text-muted leading-relaxed">{hint}</p>
          </div>
        )}
        {safe && (
          <div className="flex items-center gap-1.5 mt-3">
            <ShieldIcon size={11} className="text-accent-green flex-shrink-0" />
            <p className="text-[10px] text-accent-green font-medium">Nothing was sent. Your funds are safe.</p>
          </div>
        )}
      </div>
    </div>
  );
}
