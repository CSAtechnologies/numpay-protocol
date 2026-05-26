"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";

export type NetworkMode = "mainnet" | "testnet";

interface NetworkCtx {
  mode: NetworkMode;
  setMode: (m: NetworkMode) => void;
  toggle: () => void;
}

const Ctx = createContext<NetworkCtx | null>(null);
const STORAGE_KEY = "numpay:network:v1";

export function NetworkProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<NetworkMode>("mainnet");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as NetworkMode | null;
      if (saved === "mainnet" || saved === "testnet") setModeState(saved);
    } catch {}
  }, []);

  const setMode = useCallback((m: NetworkMode) => {
    setModeState(m);
    try {
      localStorage.setItem(STORAGE_KEY, m);
    } catch {}
  }, []);

  const toggle = useCallback(() => {
    setMode(mode === "mainnet" ? "testnet" : "mainnet");
  }, [mode, setMode]);

  return <Ctx.Provider value={{ mode, setMode, toggle }}>{children}</Ctx.Provider>;
}

export function useNetwork() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useNetwork must be inside <NetworkProvider>");
  return v;
}
