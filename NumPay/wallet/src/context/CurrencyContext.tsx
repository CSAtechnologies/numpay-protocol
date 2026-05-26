"use client";

import { createContext, useCallback, useContext, useEffect, useState, ReactNode } from "react";

export type CurrencyCode = "USD" | "EUR" | "GBP" | "NGN" | "JPY" | "BTC" | "ETH";

export interface Currency {
  code: CurrencyCode;
  symbol: string;
  /** Stub rate vs USD. Real implementation would fetch live FX. */
  perUsd: number;
  name: string;
}

export const CURRENCIES: Record<CurrencyCode, Currency> = {
  USD: { code: "USD", symbol: "$",   perUsd: 1,        name: "US Dollar" },
  EUR: { code: "EUR", symbol: "€",   perUsd: 0.92,     name: "Euro" },
  GBP: { code: "GBP", symbol: "£",   perUsd: 0.79,     name: "British Pound" },
  NGN: { code: "NGN", symbol: "₦",   perUsd: 1500,     name: "Nigerian Naira" },
  JPY: { code: "JPY", symbol: "¥",   perUsd: 152,      name: "Japanese Yen" },
  BTC: { code: "BTC", symbol: "₿",   perUsd: 0.0000167, name: "Bitcoin" },
  ETH: { code: "ETH", symbol: "Ξ",   perUsd: 0.000312, name: "Ether" },
};

interface CurrencyCtx {
  code: CurrencyCode;
  currency: Currency;
  setCode: (c: CurrencyCode) => void;
  format: (usd: number) => string;
}

const Ctx = createContext<CurrencyCtx | null>(null);
const STORAGE_KEY = "numpay:currency:v1";

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [code, setCodeState] = useState<CurrencyCode>("USD");

  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY) as CurrencyCode | null;
      if (saved && CURRENCIES[saved]) setCodeState(saved);
    } catch {}
  }, []);

  const setCode = useCallback((c: CurrencyCode) => {
    setCodeState(c);
    try {
      localStorage.setItem(STORAGE_KEY, c);
    } catch {}
  }, []);

  const currency = CURRENCIES[code];

  const format = useCallback(
    (usd: number) => {
      const v = usd * currency.perUsd;
      const opts: Intl.NumberFormatOptions =
        code === "BTC" || code === "ETH"
          ? { minimumFractionDigits: 4, maximumFractionDigits: 6 }
          : code === "JPY" || code === "NGN"
          ? { minimumFractionDigits: 0, maximumFractionDigits: 0 }
          : { minimumFractionDigits: 2, maximumFractionDigits: 2 };
      return `${currency.symbol}${v.toLocaleString("en", opts)}`;
    },
    [code, currency.perUsd, currency.symbol],
  );

  return <Ctx.Provider value={{ code, currency, setCode, format }}>{children}</Ctx.Provider>;
}

export function useCurrency() {
  const v = useContext(Ctx);
  if (!v) throw new Error("useCurrency must be inside <CurrencyProvider>");
  return v;
}
