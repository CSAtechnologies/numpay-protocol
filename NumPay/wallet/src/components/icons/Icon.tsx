"use client";

import { SVGProps } from "react";

type IconProps = SVGProps<SVGSVGElement> & { size?: number };

const base = (size = 18) => ({
  width: size,
  height: size,
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
});

export const HomeIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M3 12l9-9 9 9" /><path d="M5 10v10h14V10" /></svg>
);
export const SendIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M12 19V5" /><path d="M5 12l7-7 7 7" /></svg>
);
export const SearchIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></svg>
);
export const ActivityIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 10h18" /></svg>
);
export const UserIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="8" r="4" /><path d="M4 21a8 8 0 0116 0" /></svg>
);
export const SettingsIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09a1.65 1.65 0 00-1-1.51 1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.6 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.6a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09A1.65 1.65 0 0015 4.6a1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z" /></svg>
);
export const BellIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10 21a2 2 0 004 0" /></svg>
);
export const CopyIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M5 15V5a2 2 0 012-2h10" /></svg>
);
export const QRIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><path d="M14 14h3v3" /><path d="M21 14v3" /><path d="M14 21h3" /><path d="M21 17v4" /></svg>
);
export const ShareIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M4 12v8a2 2 0 002 2h12a2 2 0 002-2v-8" /><path d="M16 6l-4-4-4 4" /><path d="M12 2v13" /></svg>
);
export const SwapIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M7 7h13l-4-4" /><path d="M17 17H4l4 4" /></svg>
);
export const CloseIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M6 6l12 12" /><path d="M18 6L6 18" /></svg>
);
export const CheckIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M5 13l4 4L19 7" /></svg>
);
export const ArrowUpRight = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M7 17l10-10" /><path d="M17 7H8v9" /></svg>
);
export const ChevronDown = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M6 9l6 6 6-6" /></svg>
);
export const ChevronLeft = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M15 18l-6-6 6-6" /></svg>
);
export const PlusIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
);
export const TrashIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M3 6h18" /><path d="M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2" /><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6" /></svg>
);
export const HashIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M4 9h16" /><path d="M4 15h16" /><path d="M10 3 8 21" /><path d="m16 3-2 18" /></svg>
);
export const LayersIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 17 9 5 9-5" /><path d="m3 12 9 5 9-5" /></svg>
);
export const SparklesIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="m12 3 1.9 5.4L19 10l-5.1 1.6L12 17l-1.9-5.4L5 10l5.1-1.6Z" /><path d="M19 17v4" /><path d="M17 19h4" /></svg>
);
export const InfoIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="10" /><path d="M12 16v-4" /><path d="M12 8h.01" /></svg>
);
export const ChevronRight = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="m9 18 6-6-6-6" /></svg>
);
export const ArrowDownLeft = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M17 7 7 17" /><path d="M17 17H7V7" /></svg>
);
export const SunIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="4" /><path d="M12 2v2" /><path d="M12 20v2" /><path d="m4.9 4.9 1.4 1.4" /><path d="m17.7 17.7 1.4 1.4" /><path d="M2 12h2" /><path d="M20 12h2" /><path d="m4.9 19.1 1.4-1.4" /><path d="m17.7 6.3 1.4-1.4" /></svg>
);
export const MoonIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" /></svg>
);
export const KeyIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="8" cy="15" r="4" /><path d="m10.5 12 8.5-8.5" /><path d="m16 8 3-3" /></svg>
);
export const LockIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
);
export const ShieldIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M20 13a8 8 0 0 1-8 8 8 8 0 0 1-8-8V5l8-3 8 3Z" /></svg>
);
export const GlobeIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><circle cx="12" cy="12" r="10" /><path d="M2 12h20" /><path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10Z" /></svg>
);
export const LinkIcon = ({ size, ...p }: IconProps) => (
  <svg {...base(size)} {...p}><path d="M10 13a5 5 0 0 0 7 0l3-3a5 5 0 1 0-7-7l-1 1" /><path d="M14 11a5 5 0 0 0-7 0l-3 3a5 5 0 1 0 7 7l1-1" /></svg>
);
