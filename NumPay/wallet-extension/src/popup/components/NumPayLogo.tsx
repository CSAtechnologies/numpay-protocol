// The NumPay mark, recreated as four separate SVG "sticks" (left bar, diagonal,
// right bar, underline) so they can animate independently. Geometry traced from
// the brand PNG (viewBox 0 0 100 90).
//
//   variant="outline" → white edges only (background stripped), the look used
//     for the open splash.
//   variant="filled"  → solid white strokes (matches the classic icon).
//   animate → plays the assemble animation (sticks fly in + edges draw).

interface NumPayLogoProps {
  size?: number;
  animate?: boolean;
  variant?: "outline" | "filled";
  /** show the purple squircle behind the mark */
  square?: boolean;
  className?: string;
}

export default function NumPayLogo({
  size = 64,
  animate = false,
  variant = "outline",
  square = true,
  className = "",
}: NumPayLogoProps) {
  const outline = variant === "outline";
  const shape = outline
    ? { className: "np-edge", fill: "none", stroke: "#fff", strokeWidth: 3, strokeLinejoin: "round" as const }
    : { fill: "#fff" };

  return (
    <svg
      className={`np-logo ${animate ? "np-animate" : ""} ${className}`}
      width={size}
      height={size * 0.9}
      viewBox="0 0 100 90"
      role="img"
      aria-label="NumPay"
    >
      {square && <rect className="np-sq" x="1" y="1" width="98" height="88" rx="30" fill="#7c6df0" />}
      <g className="np-stick np-gL"><rect {...shape} x="20" y="13" width="11" height="48" rx="1.5" /></g>
      <g className="np-stick np-gD"><polygon {...shape} points="31,13 41,13 66,61 56,61" /></g>
      <g className="np-stick np-gR"><rect {...shape} x="66" y="13" width="11" height="48" rx="1.5" /></g>
      <g className="np-stick np-gU"><rect {...shape} x="20" y="66" width="57" height="9" rx="1.5" /></g>
    </svg>
  );
}
