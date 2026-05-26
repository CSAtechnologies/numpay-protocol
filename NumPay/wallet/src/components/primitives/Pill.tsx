import { ReactNode } from "react";

type Kind = "default" | "brand" | "success" | "amber" | "danger" | "dashed";

export function Pill({
  kind = "default",
  children,
  className = "",
}: {
  kind?: Kind;
  children: ReactNode;
  className?: string;
}) {
  const k = kind === "default" ? "" : `pill-${kind}`;
  return <span className={`pill ${k} ${className}`.trim()}>{children}</span>;
}
