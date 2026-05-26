import { Routes, Route, Navigate } from "react-router-dom";
import { useState, useEffect } from "react";
import { hasWallet, isLocked } from "@/lib/wallet";
import { CurrencyProvider } from "./contexts/CurrencyContext";

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

  useEffect(() => {
    checkState();
  }, []);

  async function checkState() {
    const exists = await hasWallet();
    if (!exists) {
      setState("onboarding");
      return;
    }
    const locked = await isLocked();
    setState(locked ? "locked" : "unlocked");
  }

  if (state === "loading") {
    return (
      <div className="flex items-center justify-center h-full bg-surface-0">
        <div className="w-8 h-8 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
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
    </CurrencyProvider>
  );
}
