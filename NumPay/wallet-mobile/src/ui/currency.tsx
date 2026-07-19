// Display-currency preference, shared app-wide via context. The selected code
// persists through core (getSavedCurrency/saveCurrency, same storage key as the
// extension). All fiat on the dashboard / token detail / send / swap / bridge
// flows through this so changing the currency updates everything at once.
//
// The formatters themselves live in core (formatFiat / formatFiatLine /
// formatFeeTail) and are re-exported here: the extension popup renders the
// same figures, and a second implementation would drift from it.
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  getSavedCurrency, saveCurrency, getCurrency,
  DEFAULT_CURRENCY, type Currency,
} from "@numpay/core/currency";

export { formatFiat, formatFiatLine, formatFeeTail } from "@numpay/core/currency";

interface CurrencyCtx {
  code: string;
  currency: Currency | undefined;
  setCode: (code: string) => void;
}

const Ctx = createContext<CurrencyCtx>({
  code: DEFAULT_CURRENCY,
  currency: undefined,
  setCode: () => {},
});

export function CurrencyProvider({ children }: { children: ReactNode }) {
  const [code, setCodeState] = useState(DEFAULT_CURRENCY);

  useEffect(() => { getSavedCurrency().then(setCodeState).catch(() => {}); }, []);

  const setCode = useCallback((next: string) => {
    setCodeState(next);
    void saveCurrency(next);
  }, []);

  const value = useMemo<CurrencyCtx>(
    () => ({ code, currency: getCurrency(code), setCode }),
    [code, setCode],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useCurrencyPref(): CurrencyCtx {
  return useContext(Ctx);
}
