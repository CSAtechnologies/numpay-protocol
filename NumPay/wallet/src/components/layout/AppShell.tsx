"use client";

import { useState } from "react";
import { useWallet } from "@/context/WalletContext";
import { Sidebar } from "./Sidebar";
import { MobileTabBar } from "./MobileTabBar";
import { AccountPill } from "../connect/AccountPill";
import { BellIcon, SunIcon, MoonIcon } from "../icons/Icon";
import { LogoMark } from "../primitives/LogoMark";
import { useTheme } from "@/context/ThemeContext";
import { SendSheet } from "../send/SendSheet";
import { Home } from "../home/Home";
import { ProfileView } from "../views/ProfileView";
import { LookupView } from "../views/LookupView";
import { ActivityView } from "../views/ActivityView";
import { RequestView } from "../views/RequestView";
import { SettingsView } from "../views/SettingsView";
import { Onboarding } from "../onboarding/Onboarding";
import { Unlock } from "../onboarding/Unlock";

export type View =
  | "home"
  | "send"
  | "request"
  | "lookup"
  | "activity"
  | "profile"
  | "settings";

export function AppShell() {
  const { state } = useWallet();
  const { theme, toggle: toggleTheme } = useTheme();
  const [view, setView] = useState<View>("home");
  const [sendOpen, setSendOpen] = useState(false);
  const [sendPrefill, setSendPrefill] = useState<string | undefined>();

  const openSend = (prefill?: string) => {
    setSendPrefill(prefill);
    setSendOpen(true);
  };

  if (state === "loading") return <LoadingScreen />;
  if (state === "empty") return <Onboarding />;
  if (state === "locked") return <Unlock />;

  return (
    <div className="mx-auto flex min-h-screen max-w-[1480px]">
      <Sidebar view={view} onChange={setView} onSend={() => openSend()} />

      <main className="flex min-w-0 flex-1 flex-col">
        <header
          className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b px-4 py-3 backdrop-blur-md lg:px-8"
          style={{ borderColor: "var(--border)", background: "var(--glass-bg)" }}
        >
          <div className="flex items-center gap-2 lg:hidden">
            <LogoMark size={30} />
            <span className="text-base font-bold tracking-tight">NumPay</span>
          </div>
          <div className="hidden text-sm lg:block" style={{ color: "var(--muted)" }}>
            <span className="font-semibold" style={{ color: "var(--text)" }}>
              {titleFor(view)}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={toggleTheme}
              className="icon-btn"
              aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
              title={theme === "dark" ? "Light mode" : "Dark mode"}
            >
              {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
            </button>
            <button className="icon-btn" aria-label="Notifications">
              <BellIcon size={16} />
            </button>
            <AccountPill />
          </div>
        </header>

        <div className="flex-1 overflow-y-auto px-4 pb-28 pt-4 lg:px-8 lg:pb-10 lg:pt-6">
          {view === "home" && <Home onSend={openSend} />}
          {view === "profile" && <ProfileView />}
          {view === "lookup" && <LookupView onSend={openSend} />}
          {view === "activity" && <ActivityView />}
          {view === "request" && <RequestView />}
          {view === "settings" && <SettingsView />}
        </div>
      </main>

      <MobileTabBar view={view} onChange={setView} onSend={() => openSend()} />

      <SendSheet
        open={sendOpen}
        onClose={() => setSendOpen(false)}
        prefillNumber={sendPrefill}
      />
    </div>
  );
}

function LoadingScreen() {
  return (
    <div className="flex min-h-screen items-center justify-center">
      <div className="h-8 w-8 animate-spin rounded-full border-2 border-line border-t-brand-400" />
    </div>
  );
}

function titleFor(v: View) {
  switch (v) {
    case "home": return "Home";
    case "request": return "Request";
    case "lookup": return "Lookup";
    case "activity": return "Activity";
    case "profile": return "Profile";
    case "settings": return "Settings";
    default: return "";
  }
}
