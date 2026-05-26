"use client";

import { ReactNode, useEffect, useRef, useState } from "react";
import {
  HomeIcon,
  ArrowUpRight,
  ArrowDownLeft,
  SwapIcon,
  SearchIcon,
  ActivityIcon,
  HashIcon,
  LayersIcon,
  SparklesIcon,
  UserIcon,
  SettingsIcon,
  ChevronDown,
  CopyIcon,
  CheckIcon,
  LinkIcon,
} from "../icons/Icon";
import { Logo } from "../primitives/LogoMark";
import { useWallet } from "@/context/WalletContext";
import { useMyNumber, formatBPAN } from "@/hooks/useMyNumber";
import type { View } from "./AppShell";

interface Props {
  view: View;
  onChange: (view: View) => void;
  onSend: () => void;
}

interface Item {
  id: View | string;
  label: string;
  icon: ReactNode;
  badge?: number;
  external?: boolean;
}

export function Sidebar({ view, onChange, onSend }: Props) {
  const { address } = useWallet();
  const { number } = useMyNumber();

  const wallet: Item[] = [
    { id: "home", label: "Home", icon: <HomeIcon size={17} /> },
    { id: "send", label: "Send", icon: <ArrowUpRight size={17} /> },
    { id: "request", label: "Request", icon: <ArrowDownLeft size={17} /> },
    { id: "lookup", label: "Lookup", icon: <SearchIcon size={17} /> },
    { id: "activity", label: "Activity", icon: <ActivityIcon size={17} /> },
  ];
  const bpan: Item[] = [
    { id: "profile", label: "My number", icon: <HashIcon size={17} /> },
    { id: "portfolio", label: "Portfolio", icon: <LayersIcon size={17} />, external: true },
    { id: "register", label: "Register", icon: <SparklesIcon size={17} />, external: true },
  ];
  const account: Item[] = [
    { id: "profile", label: "Profile", icon: <UserIcon size={17} /> },
    { id: "settings", label: "Settings", icon: <SettingsIcon size={17} /> },
  ];

  const handleClick = (id: string, external?: boolean) => {
    if (external) return;
    if (id === "send") {
      onSend();
      return;
    }
    onChange(id as View);
  };

  const initial = address ? address.slice(2, 3).toUpperCase() : "—";
  const sub = number ? formatBPAN(number) : address ? `${address.slice(0, 6)}…${address.slice(-4)}` : "";

  return (
    <aside
      className="hidden w-60 shrink-0 flex-col border-r px-3 py-5 lg:flex"
      style={{ borderColor: "var(--border)" }}
    >
      <div className="px-2 pb-4">
        <Logo size={30} />
      </div>

      <SectionLabel>Wallet</SectionLabel>
      <nav className="flex flex-col gap-1">
        {wallet.map((it) => (
          <NavItem
            key={it.id}
            active={view === it.id}
            onClick={() => handleClick(it.id as string)}
            icon={it.icon}
            label={it.label}
            badge={it.badge}
          />
        ))}
      </nav>

      <SectionLabel>BPAN</SectionLabel>
      <nav className="flex flex-col gap-1">
        {bpan.map((it) => (
          <NavItem
            key={`bpan-${it.id}`}
            active={false}
            onClick={() => handleClick(it.id as string, it.external)}
            icon={it.icon}
            label={it.label}
            disabled={it.external}
          />
        ))}
      </nav>

      <SectionLabel>Account</SectionLabel>
      <nav className="flex flex-col gap-1">
        {account.map((it) => (
          <NavItem
            key={it.id}
            active={view === it.id}
            onClick={() => handleClick(it.id as string)}
            icon={it.icon}
            label={it.label}
          />
        ))}
      </nav>

      <div className="mt-auto" />

      {address && (
        <AccountBar
          initial={initial}
          name={number ? "You" : "Wallet"}
          sub={sub}
          address={address}
          onProfile={() => onChange("profile")}
          onSettings={() => onChange("settings")}
        />
      )}
    </aside>
  );
}

function AccountBar({
  initial,
  name,
  sub,
  address,
  onProfile,
  onSettings,
}: {
  initial: string;
  name: string;
  sub: string;
  address: string;
  onProfile: () => void;
  onSettings: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<"addr" | "bpan" | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const click = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", click);
    return () => document.removeEventListener("mousedown", click);
  }, []);

  const copy = async (kind: "addr" | "bpan", value: string) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1400);
  };

  return (
    <div ref={ref} className="relative mt-3">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors hover:opacity-90"
        style={{ background: "var(--card-2)", borderColor: "var(--border)" }}
      >
        <span
          className="grid h-8 w-8 flex-shrink-0 place-items-center rounded-full text-xs font-bold text-white"
          style={{ background: "linear-gradient(135deg,#ff8fb4,#7c6df0)" }}
        >
          {initial}
        </span>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px] font-semibold">{name}</div>
          <div className="mono truncate text-[11px]" style={{ color: "var(--muted)" }}>
            {sub}
          </div>
        </div>
        <ChevronDown
          size={14}
          style={{
            color: "var(--muted)",
            transform: open ? "rotate(180deg)" : undefined,
            transition: "transform 0.15s",
          }}
        />
      </button>

      {open && (
        <div
          className="absolute bottom-full left-0 right-0 z-30 mb-2 overflow-hidden rounded-xl border shadow-2xl"
          style={{ background: "var(--card)", borderColor: "var(--border)" }}
        >
          <div className="px-3 py-2.5">
            <div
              className="text-[10px] font-semibold uppercase tracking-[0.14em]"
              style={{ color: "var(--muted-2)" }}
            >
              Wallet address
            </div>
            <div
              className="mono mt-1 break-all text-[11px]"
              style={{ color: "var(--muted)" }}
            >
              {address}
            </div>
          </div>
          <PopButton
            onClick={() => copy("addr", address)}
            icon={copied === "addr" ? <CheckIcon size={14} /> : <LinkIcon size={14} />}
            label={copied === "addr" ? "Copied" : "Copy address"}
          />
          <PopButton
            onClick={() => sub && copy("bpan", sub.replace(/\s/g, ""))}
            icon={copied === "bpan" ? <CheckIcon size={14} /> : <CopyIcon size={14} />}
            label={copied === "bpan" ? "Copied" : "Copy BPAN"}
          />
          <div style={{ borderTop: "1px solid var(--border)" }} />
          <PopButton
            onClick={() => {
              setOpen(false);
              onProfile();
            }}
            icon={<UserIcon size={14} />}
            label="View profile"
          />
          <PopButton
            onClick={() => {
              setOpen(false);
              onSettings();
            }}
            icon={<SettingsIcon size={14} />}
            label="Settings"
          />
        </div>
      )}
    </div>
  );
}

function PopButton({
  onClick,
  icon,
  label,
}: {
  onClick: () => void;
  icon: ReactNode;
  label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2 text-left text-[13px] transition-colors"
      style={{ color: "var(--muted)" }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "var(--card-2)";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLButtonElement).style.background = "transparent";
        (e.currentTarget as HTMLButtonElement).style.color = "var(--muted)";
      }}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div
      className="px-3 pb-1.5 pt-3.5 text-[10px] font-semibold uppercase tracking-[0.16em]"
      style={{ color: "var(--muted-2)" }}
    >
      {children}
    </div>
  );
}

function NavItem({
  active,
  onClick,
  icon,
  label,
  badge,
  disabled,
}: {
  active: boolean;
  onClick: () => void;
  icon: ReactNode;
  label: string;
  badge?: number;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-3 rounded-[10px] px-3 py-2 text-[13px] font-medium transition-all"
      style={{
        color: active ? "var(--text)" : disabled ? "var(--muted-2)" : "var(--muted)",
        background: active
          ? "linear-gradient(90deg, rgba(124,109,240,.2), rgba(124,109,240,.04))"
          : "transparent",
        boxShadow: active ? "inset 2px 0 0 var(--brand)" : undefined,
        opacity: disabled ? 0.55 : 1,
        cursor: disabled ? "default" : "pointer",
      }}
      onMouseEnter={(e) => {
        if (!active && !disabled) {
          (e.currentTarget as HTMLButtonElement).style.background = "var(--card-2)";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--text)";
        }
      }}
      onMouseLeave={(e) => {
        if (!active && !disabled) {
          (e.currentTarget as HTMLButtonElement).style.background = "transparent";
          (e.currentTarget as HTMLButtonElement).style.color = "var(--muted)";
        }
      }}
    >
      <span className="opacity-90">{icon}</span>
      <span className="flex-1">{label}</span>
      {badge !== undefined && (
        <span
          className="rounded-full px-1.5 text-[10px] font-bold"
          style={{ background: "var(--brand)", color: "white" }}
        >
          {badge}
        </span>
      )}
    </button>
  );
}
