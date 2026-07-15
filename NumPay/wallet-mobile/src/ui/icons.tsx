// SVG icon set: 1:1 ports of the extension popup's Icons.tsx stroke glyphs
// (24 viewBox, strokeWidth 1.8, round caps/joins) so both surfaces draw the
// same iconography. Only the icons mobile actually uses are ported; add more
// from the extension file as screens need them — never invent new art.
import Svg, { Path, Rect, Polyline, Circle } from "react-native-svg";

interface IconProps {
  size?: number;
  color?: string;
}

function frame(size: number) {
  return {
    width: size,
    height: size,
    viewBox: "0 0 24 24",
    fill: "none" as const,
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
}

export function SendIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Path d="M12 19V5" />
      <Path d="m5 12 7-7 7 7" />
    </Svg>
  );
}

export function ReceiveIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Path d="M12 5v14" />
      <Path d="m19 12-7 7-7-7" />
    </Svg>
  );
}

export function SwapIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Path d="m16 3 4 4-4 4" />
      <Path d="M20 7H4" />
      <Path d="m8 21-4-4 4-4" />
      <Path d="M4 17h16" />
    </Svg>
  );
}

export function LayersIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Path d="m12.83 2.18a2 2 0 0 0-1.66 0L2.6 6.08a1 1 0 0 0 0 1.83l8.58 3.91a2 2 0 0 0 1.66 0l8.58-3.9a1 1 0 0 0 0-1.83Z" />
      <Path d="m2 12 8.58 3.91a2 2 0 0 0 1.66 0L21 12" />
      <Path d="m2 17 8.58 3.91a2 2 0 0 0 1.66 0L21 17" />
    </Svg>
  );
}

export function ActivityIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
    </Svg>
  );
}

export function LockIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Rect width={18} height={11} x={3} y={11} rx={2} ry={2} />
      <Path d="M7 11V7a5 5 0 0 1 10 0v4" />
    </Svg>
  );
}

/** WalletConnect / dApps entry (lucide "link", same stroke language). */
export function LinkIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71" />
      <Path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71" />
    </Svg>
  );
}

export function ChevronLeftIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Path d="m15 18-6-6 6-6" />
    </Svg>
  );
}

export function GlobeIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Circle cx={12} cy={12} r={10} />
      <Path d="M12 2a14.5 14.5 0 0 0 0 20 14.5 14.5 0 0 0 0-20" />
      <Path d="M2 12h20" />
    </Svg>
  );
}
