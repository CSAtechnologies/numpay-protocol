import Image from "next/image";

/**
 * Brand logo mark — the official `/logo.png` rendered in a rounded tile.
 */
export function LogoMark({ size = 30 }: { size?: number }) {
  return (
    <div
      className="overflow-hidden rounded-[10px]"
      style={{
        width: size,
        height: size,
        boxShadow: "0 6px 16px var(--brand-glow)",
      }}
    >
      <Image
        src="/logo.png"
        alt="NumPay"
        width={size}
        height={size}
        priority
        style={{ width: "100%", height: "100%", objectFit: "cover" }}
      />
    </div>
  );
}

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <div className="flex items-center gap-2.5">
      <LogoMark size={size} />
      <span className="text-base font-bold tracking-tight">NumPay</span>
    </div>
  );
}
