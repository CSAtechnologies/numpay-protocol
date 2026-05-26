import Image from "next/image";

export function PulseBadge({ size = 96 }: { size?: number }) {
  const core = Math.round(size * 0.58);
  return (
    <div className="pulse-wrap" style={{ width: size, height: size }}>
      <span className="ring" />
      <span className="ring r2" />
      <div className="core overflow-hidden" style={{ width: core, height: core }}>
        <Image
          src="/logo.png"
          alt="NumPay"
          width={core}
          height={core}
          priority
          style={{ width: "100%", height: "100%", objectFit: "cover" }}
        />
      </div>
    </div>
  );
}
