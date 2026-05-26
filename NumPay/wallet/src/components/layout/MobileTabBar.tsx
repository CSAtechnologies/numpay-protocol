"use client";

import { ReactNode } from "react";
import { HomeIcon, ActivityIcon, SearchIcon, UserIcon, PlusIcon } from "../icons/Icon";
import type { View } from "./AppShell";

interface Props {
  view: View;
  onChange: (view: View) => void;
  onSend: () => void;
}

export function MobileTabBar({ view, onChange, onSend }: Props) {
  return (
    <div className="fixed inset-x-3 bottom-3 z-30 grid grid-cols-[1fr_1fr_64px_1fr_1fr] items-center gap-0.5 rounded-[22px] border border-line bg-bg-raised/80 p-2 backdrop-blur-lg lg:hidden">
      <Tab active={view === "home"} onClick={() => onChange("home")} icon={<HomeIcon size={18} />} label="Home" />
      <Tab active={view === "activity"} onClick={() => onChange("activity")} icon={<ActivityIcon size={18} />} label="Activity" />
      <FAB onClick={onSend} />
      <Tab active={view === "lookup"} onClick={() => onChange("lookup")} icon={<SearchIcon size={18} />} label="Lookup" />
      <Tab active={view === "profile"} onClick={() => onChange("profile")} icon={<UserIcon size={18} />} label="Profile" />
    </div>
  );
}

function Tab({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className={
        "flex flex-col items-center gap-1 py-2 text-[10px] font-medium transition-colors " +
        (active ? "text-brand-300" : "text-ink-mute2 hover:text-ink")
      }
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function FAB({ onClick }: { onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="mx-0.5 -mt-3.5 flex flex-col items-center gap-0.5 rounded-[18px] bg-gradient-to-br from-brand-400 via-brand-500 to-brand-600 px-0 py-3.5 text-white shadow-glow transition-transform active:scale-95"
    >
      <PlusIcon size={22} strokeWidth={2.5} />
      <span className="text-[10px] font-semibold">Send</span>
    </button>
  );
}
