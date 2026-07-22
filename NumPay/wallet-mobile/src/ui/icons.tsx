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

export function TrendingUpIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Polyline points="22 7 13.5 15.5 8.5 10.5 2 17" />
      <Polyline points="16 7 22 7 22 13" />
    </Svg>
  );
}

export function ShieldIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Path d="M20 13c0 5-3.5 7.5-7.66 8.95a1 1 0 0 1-.67-.01C7.5 20.5 4 18 4 13V6a1 1 0 0 1 1-1c2 0 4.5-1.2 6.24-2.72a1.17 1.17 0 0 1 1.52 0C14.51 3.81 17 5 19 5a1 1 0 0 1 1 1z" />
    </Svg>
  );
}

export function ExternalLinkIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Path d="M15 3h6v6" />
      <Path d="M10 14 21 3" />
      <Path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
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

// DELIBERATE EXCEPTION to the "port, never invent" rule at the top of this
// file: the extension has no camera, so its Icons.tsx has no scan glyph to
// port. This is Lucide's `scan-line` — the same library the extension's set is
// drawn from — rather than new art, so it still sits in the same family.
export function ScanIcon({ size = 20, color = "#fff" }: IconProps) {
  return (
    <Svg {...frame(size)} stroke={color}>
      <Path d="M3 7V5a2 2 0 0 1 2-2h2" />
      <Path d="M17 3h2a2 2 0 0 1 2 2v2" />
      <Path d="M21 17v2a2 2 0 0 1-2 2h-2" />
      <Path d="M7 21H5a2 2 0 0 1-2-2v-2" />
      <Path d="M7 12h10" />
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

// ── Floating-nav icons (ext Nav*Icon ports: stroke 1.9 + a fill layer that
//    fades in at 0.16 opacity when the tab is active) ─────────────────────────

interface NavIconProps extends IconProps {
  active?: boolean;
}

function navFrame(size: number) {
  return { ...frame(size), strokeWidth: 1.9 };
}

const GEAR_D =
  "M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z";

export function NavWalletIcon({ size = 20, color = "#fff", active }: NavIconProps) {
  return (
    <Svg {...navFrame(size)} stroke={color}>
      <Rect x={3} y={6.2} width={18} height={13.2} rx={3.6} fill={color} fillOpacity={active ? 0.16 : 0} stroke="none" />
      <Rect x={3} y={6.2} width={18} height={13.2} rx={3.6} />
      <Path d="M21 11h-3.4a1.9 1.9 0 0 0 0 3.8H21" />
    </Svg>
  );
}

export function NavSendIcon({ size = 20, color = "#fff", active }: NavIconProps) {
  return (
    <Svg {...navFrame(size)} stroke={color}>
      <Path d="M21 3 15 21l-3.6-7.4L3.6 9.9Z" fill={color} fillOpacity={active ? 0.16 : 0} stroke="none" />
      <Path d="M21 3 3.6 9.9l7.8 3.7L15 21Z" />
      <Path d="M21 3l-9.6 10.6" />
    </Svg>
  );
}

export function NavReceiveIcon({ size = 20, color = "#fff", active }: NavIconProps) {
  return (
    <Svg {...navFrame(size)} stroke={color}>
      <Path d="M3.6 14v3.2a3.2 3.2 0 0 0 3.2 3.2h10.4a3.2 3.2 0 0 0 3.2-3.2V14Z" fill={color} fillOpacity={active ? 0.16 : 0} stroke="none" />
      <Path d="M12 3.6v9.8" />
      <Path d="m8.1 9.7 3.9 3.9 3.9-3.9" />
      <Path d="M3.6 14v3.2a3.2 3.2 0 0 0 3.2 3.2h10.4a3.2 3.2 0 0 0 3.2-3.2V14" />
    </Svg>
  );
}

export function NavBpanIcon({ size = 20, color = "#fff", active }: NavIconProps) {
  return (
    <Svg {...navFrame(size)} stroke={color}>
      <Rect x={3} y={4.6} width={18} height={14.8} rx={4.4} fill={color} fillOpacity={active ? 0.16 : 0} stroke="none" />
      <Rect x={3} y={4.6} width={18} height={14.8} rx={4.4} />
      <Path d="M10.4 8.7 9 15.3" />
      <Path d="M15.2 8.7 13.8 15.3" />
      <Path d="M8.2 11.1h7.6" />
      <Path d="M7.8 13.4h7.6" />
    </Svg>
  );
}

export function NavActivityIcon({ size = 20, color = "#fff", active }: NavIconProps) {
  return (
    <Svg {...navFrame(size)} stroke={color}>
      <Path d="M2.6 12.6H6l2.6-6.2 3.4 11.2 2.6-7.8 1.4 2.8h3.4V20.5H2.6Z" fill={color} fillOpacity={active ? 0.16 : 0} stroke="none" />
      <Path d="M2.6 12.6H6l2.6-6.2 3.4 11.2 2.6-7.8 1.4 2.8h3.4" />
    </Svg>
  );
}

export function NavSettingsIcon({ size = 20, color = "#fff", active }: NavIconProps) {
  return (
    <Svg {...navFrame(size)} stroke={color}>
      <Path d={GEAR_D} fill={color} fillOpacity={active ? 0.16 : 0} stroke="none" />
      <Path d={GEAR_D} />
      <Circle cx={12} cy={12} r={3} />
    </Svg>
  );
}
