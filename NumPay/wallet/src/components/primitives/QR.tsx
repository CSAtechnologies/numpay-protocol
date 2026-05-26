import Image from "next/image";

export function QR({ size = 180 }: { size?: number }) {
  const cells = 21;
  const cell = size / cells;
  const rng = (i: number, j: number) => ((i * 31 + j * 17 + i * j) % 7) > 3;

  const finder = (x: number, y: number) => (
    <g key={`f${x}${y}`}>
      <rect x={x * cell} y={y * cell} width={cell * 7} height={cell * 7} fill="black" />
      <rect x={(x + 1) * cell} y={(y + 1) * cell} width={cell * 5} height={cell * 5} fill="white" />
      <rect x={(x + 2) * cell} y={(y + 2) * cell} width={cell * 3} height={cell * 3} fill="black" />
    </g>
  );

  const dots = [];
  for (let i = 0; i < cells; i++) {
    for (let j = 0; j < cells; j++) {
      if ((i < 7 && j < 7) || (i < 7 && j > cells - 8) || (i > cells - 8 && j < 7)) continue;
      if (rng(i, j))
        dots.push(<rect key={`${i}-${j}`} x={j * cell} y={i * cell} width={cell} height={cell} fill="black" />);
    }
  }

  return (
    <div
      style={{
        width: size,
        height: size,
        background: "white",
        borderRadius: 14,
        padding: 8,
        boxShadow: "0 10px 30px rgba(0,0,0,.25)",
        position: "relative",
      }}
    >
      <svg width={size - 16} height={size - 16} viewBox={`0 0 ${size} ${size}`}>
        <rect width={size} height={size} fill="white" />
        {finder(0, 0)}
        {finder(cells - 7, 0)}
        {finder(0, cells - 7)}
        {dots}
      </svg>
      <div
        style={{
          position: "absolute",
          inset: "50% auto auto 50%",
          transform: "translate(-50%,-50%)",
          width: size * 0.22,
          height: size * 0.22,
          borderRadius: 10,
          overflow: "hidden",
          boxShadow: "0 0 0 4px white",
        }}
      >
        <Image
          src="/logo.png"
          alt="NumPay"
          width={Math.round(size * 0.22)}
          height={Math.round(size * 0.22)}
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    </div>
  );
}
