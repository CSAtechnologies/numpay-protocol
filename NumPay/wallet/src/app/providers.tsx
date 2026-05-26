"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WalletProvider } from "@/context/WalletContext";
import { ThemeProvider } from "@/context/ThemeContext";
import { CurrencyProvider } from "@/context/CurrencyContext";
import { NetworkProvider } from "@/context/NetworkContext";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: false } },
});

export function Providers({ children }: { children: React.ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <NetworkProvider>
          <CurrencyProvider>
            <WalletProvider>{children}</WalletProvider>
          </CurrencyProvider>
        </NetworkProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
