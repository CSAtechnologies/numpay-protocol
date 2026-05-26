import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import {
  getSavedCurrency,
  saveCurrency,
  getCurrency,
  fetchRates,
  convertBalance,
  getUsdPrice,
  type Currency,
  type Rates,
} from "@/lib/currency";

interface CurrencyCtx {
  currencyCode: string;
  currency: Currency | undefined;
  rates: Rates;
  ratesLoading: boolean;
  setCurrency: (code: string) => void;
  convert: (balance: string, networkSymbol: string) => { value: string; display: string };
  refreshRates: () => void;
}

const Context = createContext<CurrencyCtx | null>(null);

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [currencyCode, setCurrencyCode] = useState("usd");
  const [rates, setRates] = useState<Rates>({});
  const [ratesLoading, setRatesLoading] = useState(true);

  useEffect(() => {
    (async () => {
      const saved = await getSavedCurrency();
      setCurrencyCode(saved);
    })();
    loadRates();
  }, []);

  async function loadRates() {
    setRatesLoading(true);
    try {
      const r = await fetchRates();
      setRates(r);
    } catch (e) {
      console.error("Failed to fetch rates:", e);
    } finally {
      setRatesLoading(false);
    }
  }

  function handleSetCurrency(code: string) {
    setCurrencyCode(code);
    saveCurrency(code);
  }

  const convert = useCallback(
    (balance: string, networkSymbol: string) => {
      return convertBalance(balance, networkSymbol, currencyCode, rates);
    },
    [currencyCode, rates]
  );

  return (
    <Context.Provider
      value={{
        currencyCode,
        currency: getCurrency(currencyCode),
        rates,
        ratesLoading,
        setCurrency: handleSetCurrency,
        convert,
        refreshRates: loadRates,
      }}
    >
      {children}
    </Context.Provider>
  );
}

export function useCurrencyContext(): CurrencyCtx {
  const ctx = useContext(Context);
  if (!ctx) throw new Error("useCurrencyContext must be used within CurrencyProvider");
  return ctx;
}
