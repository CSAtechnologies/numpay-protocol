interface Props {
  up?: boolean;
  w?: number;
  h?: number;
}

export function Sparkline({ up = true, w = 60, h = 22 }: Props) {
  const pts = up
    ? "0,18 10,14 20,16 30,10 40,12 50,5 60,7"
    : "0,5 10,8 20,6 30,12 40,10 50,15 60,18";
  return (
    <svg width={w} height={h} viewBox="0 0 60 22" fill="none">
      <polyline
        points={pts}
        stroke={up ? "var(--success)" : "var(--danger)"}
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      />
    </svg>
  );
}
