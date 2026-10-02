import { AlertIcon, CheckIcon } from "./Icons";

export type NoticeTone = "danger" | "amber" | "success" | "info";

export interface AlertCardProps {
  title: string;
  body: string;
  hint?: string;
  tone?: NoticeTone;
  figures?: { required: string; available: string; unit: string };
  /** Announce immediately even when the visual tone is non-dangerous. */
  urgent?: boolean;
  action?: { label: string; onClick: () => void };
  className?: string;
}

/**
 * One restrained status surface for blocking errors and important warnings.
 * Severity lives in the rail and icon, while the copy stays neutral and easy
 * to scan. This avoids the oversized, fully tinted alert boxes used before.
 */
export default function AlertCard({
  title, body, hint, tone = "danger", figures, urgent = tone === "danger", action, className = "mb-4",
}: AlertCardProps) {
  return (
    <section
      className={`notice-card notice-card--${tone} ${className}`}
      role={urgent ? "alert" : "status"}
      aria-live={urgent ? "assertive" : "polite"}
    >
      <div className="notice-card__icon" aria-hidden="true">
        {tone === "success" ? <CheckIcon size={14} /> : <AlertIcon size={14} />}
      </div>
      <div className="notice-card__content">
        <p className="notice-card__title">{title}</p>
        <p className="notice-card__body">{body}</p>

        {figures && (
          <dl className="notice-card__figures">
            <div>
              <dt>Required</dt>
              <dd>~{figures.required} <span>{figures.unit}</span></dd>
            </div>
            <div>
              <dt>Available</dt>
              <dd>{figures.available} <span>{figures.unit}</span></dd>
            </div>
          </dl>
        )}

        {hint && <p className="notice-card__hint">{hint}</p>}

        {action && (
          <div className="notice-card__footer">
            <button type="button" className="notice-card__action" onClick={action.onClick}>
              {action.label}
            </button>
          </div>
        )}
      </div>
    </section>
  );
}

/** Compact feedback for a single field or local action. */
export function InlineNotice({
  message, tone = "danger", className = "",
}: { message: string; tone?: NoticeTone; className?: string }) {
  return (
    <div
      className={`inline-notice inline-notice--${tone} ${className}`}
      role={tone === "danger" ? "alert" : "status"}
    >
      <span className="inline-notice__icon" aria-hidden="true">
        {tone === "success" ? <CheckIcon size={12} /> : <AlertIcon size={12} />}
      </span>
      <p>{message}</p>
    </div>
  );
}
