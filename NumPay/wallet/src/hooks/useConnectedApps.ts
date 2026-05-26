"use client";

import { useCallback, useEffect, useState } from "react";

export interface ConnectedApp {
  origin: string;
  name: string;
  connectedAt: number;
}

const STORAGE_KEY = "numpay:connectedApps:v1";

function load(): ConnectedApp[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as ConnectedApp[]) : [];
  } catch {
    return [];
  }
}

function save(apps: ConnectedApp[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(apps));
  } catch {}
}

export function useConnectedApps() {
  const [apps, setApps] = useState<ConnectedApp[]>([]);

  useEffect(() => {
    setApps(load());
  }, []);

  const disconnect = useCallback((origin: string) => {
    setApps((prev) => {
      const next = prev.filter((a) => a.origin !== origin);
      save(next);
      return next;
    });
  }, []);

  const disconnectAll = useCallback(() => {
    setApps([]);
    save([]);
  }, []);

  return { apps, disconnect, disconnectAll };
}
