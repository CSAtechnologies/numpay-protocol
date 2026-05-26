interface Props {
  digits: string;
  size?: number;
  gap?: number;
  className?: string;
}

export function formatBPANGroups(digits: string): string[] {
  const s = String(digits).padStart(11, "0").slice(0, 11);
  return [s.slice(0, 3), s.slice(3, 6), s.slice(6, 9), s.slice(9, 11)];
}

export function BPANDisplay({ digits, size = 36, gap = 10, className = "" }: Props) {
  const parts = formatBPANGroups(digits);
  return (
    <div
      className={`mono gradient-text inline-flex items-baseline whitespace-nowrap font-bold ${className}`}
      style={{ fontSize: size, gap, letterSpacing: "0.02em" }}
    >
      {parts.map((p, i) => (
        <span key={i}>{p}</span>
      ))}
    </div>
  );
}
