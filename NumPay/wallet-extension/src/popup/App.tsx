import { Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { isLocked, touchActivity, lockWallet } from "@numpay/core/wallet";
import { bootData } from "./boot";
import { CurrencyProvider } from "./contexts/CurrencyContext";
import { WalletProvider } from "./hooks/useWallet";

import Welcome from "./pages/Welcome";
import CreateWallet from "./pages/CreateWallet";
import ImportWallet from "./pages/ImportWallet";
import Unlock from "./pages/Unlock";
import Dashboard from "./pages/Dashboard";
import Send from "./pages/Send";
import Receive from "./pages/Receive";
import History from "./pages/History";
import BPANPage from "./pages/BPANPage";
import Swap from "./pages/Swap";
import DeFi from "./pages/DeFi";
import Settings from "./pages/Settings";
import ManageAssets from "./pages/ManageAssets";
import TokenDetail from "./pages/TokenDetail";

type AppState = "loading" | "onboarding" | "locked" | "unlocked";

export default function App() {
  const [state, setState] = useState<AppState>("loading");

  // hasWallet/isLocked were already read in parallel by the boot preload, so
  // this resolves ~immediately instead of issuing two serial storage reads.
  useEffect(() => {
    bootData.then((b) => {
      if (!b.walletExists) setState("onboarding");
      else setState(b.locked ? "locked" : "unlocked");
    });
  }, []);

  // Auto-lock plumbing: open a port so the background worker arms its timer,
  // record user activity (throttled), and re-lock on inactivity even while the
  // popup stays open.
  useEffect(() => {
    if (state !== "unlocked") return;

    let port: chrome.runtime.Port | undefined;
    try { port = chrome.runtime?.connect?.({ name: "popup" }); } catch {}

    let lastTouch = 0;
    const onActivity = () => {
      const now = Date.now();
      if (now - lastTouch < 30_000) return; // throttle storage writes
      lastTouch = now;
      void touchActivity();
      try { chrome.runtime?.sendMessage?.({ type: "ACTIVITY" }); } catch {}
    };
    window.addEventListener("pointerdown", onActivity);
    window.addEventListener("keydown", onActivity);

    const interval = setInterval(async () => {
      if (await isLocked()) {
        await lockWallet();
        setState("locked");
      }
    }, 60_000);

    return () => {
      window.removeEventListener("pointerdown", onActivity);
      window.removeEventListener("keydown", onActivity);
      clearInterval(interval);
      try { port?.disconnect(); } catch {}
    };
  }, [state]);

  const content = (() => {
    if (state === "loading") {
      // Neutral dashboard-shaped skeleton instead of a spinner: the frame is on
      // screen with the first paint, and boot resolves within a few ms, so this
      // reads as the app appearing instantly rather than "loading".
      return (
        <div className="h-full bg-surface-0 px-4 pt-4 animate-pulse" aria-hidden="true">
          <div className="flex items-center justify-between mb-6">
            <div className="w-8 h-8 rounded-full bg-surface-2" />
            <div className="w-24 h-4 rounded bg-surface-2" />
            <div className="w-8 h-8 rounded-full bg-surface-2" />
          </div>
          <div className="w-40 h-9 rounded-lg bg-surface-2 mb-2" />
          <div className="w-24 h-4 rounded bg-surface-2 mb-6" />
          <div className="flex gap-3 mb-6">
            {[0, 1, 2, 3].map((i) => <div key={i} className="flex-1 h-14 rounded-2xl bg-surface-2" />)}
          </div>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex items-center gap-3 py-3">
              <div className="w-9 h-9 rounded-full bg-surface-2" />
              <div className="flex-1 space-y-1.5">
                <div className="w-20 h-3.5 rounded bg-surface-2" />
                <div className="w-14 h-3 rounded bg-surface-2" />
              </div>
              <div className="w-16 h-3.5 rounded bg-surface-2" />
            </div>
          ))}
        </div>
      );
    }

    if (state === "onboarding") {
      return (
        <Routes>
          <Route path="/" element={<Welcome />} />
          <Route path="/create" element={<CreateWallet onComplete={() => setState("unlocked")} />} />
          <Route path="/import" element={<ImportWallet onComplete={() => setState("unlocked")} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      );
    }

    if (state === "locked") {
      return <Unlock onUnlock={() => setState("unlocked")} />;
    }

    return (
      <CurrencyProvider>
        <WalletProvider>
          <Routes>
            <Route path="/" element={<Dashboard onLock={() => setState("locked")} />} />
            <Route path="/send" element={<Send />} />
            <Route path="/receive" element={<Receive />} />
            <Route path="/history" element={<History />} />
            <Route path="/bpan" element={<BPANPage />} />
            <Route path="/swap" element={<Swap />} />
            <Route path="/defi" element={<DeFi />} />
            <Route path="/settings" element={<Settings onLock={() => setState("locked")} onReset={() => setState("onboarding")} />} />
            <Route path="/manage-assets" element={<ManageAssets />} />
            <Route path="/token" element={<TokenDetail />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </WalletProvider>
      </CurrencyProvider>
    );
  })();

  return content;
}
