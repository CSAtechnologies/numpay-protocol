/**
 * Phase 1 dashboard data: a lean mobile counterpart of the extension's
 * useWallet, calling the same core primitives. Deliberately NOT a port of the
 * extension hook — no boot cache, no balance bus, no dapp notify, no
 * multi-wallet session yet. One unlocked wallet, one refresh path.
 *
 * Data sources (mobile is proxy-only, zero bundled provider keys):
 *  - EVM native balances: core balanceSweep over keyless public RPCs.
 *  - Non-EVM native balances: core chains/* public endpoints, addresses only
 *    (key material is dropped immediately after derivation).
 *  - ERC-20 discovery: core autoTokens -> wallet API proxy (/v1/tokens).
 *  - Fiat rates: core currency -> wallet API proxy (/v1/prices).
 *  - Visibility: core hiddenTokens (per-wallet) + tokenSpam + the dashboard
 *    dust rule (hide sub-$0.01 token rows, same cutoff as the extension).
 *
 * Slice 1 scope: EVM tokens only. SPL/TRC-20/Sui token rows follow with the
 * Send work (they share core fetchers already).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { importFromMnemonic } from "@numpay/core/wallet";
import {
  deriveNonEvmAddresses,
  fetchNonEvmBalancesByAddress,
  type NonEvmAddressMap,
  type NonEvmChain,
} from "@numpay/core/chains";
import { sweepEvmNativeBalances, type ChainBalance } from "@numpay/core/balanceSweep";
import { sweepAllChainTokens, type AutoToken } from "@numpay/core/autoTokens";
import { fetchRates, getUsdPrice, type Rates } from "@numpay/core/currency";
import { loadHiddenTokens, tokenHideKey } from "@numpay/core/hiddenTokens";
import { classifyToken } from "@numpay/core/tokenSpam";
import { getUnlockedMnemonic } from "../vault/mobileVault";

const DUST_USD = 0.01; // same cutoff as the extension dashboard

export interface AssetRow {
  key: string; // unique per row
  chainId: string;
  chainName: string;
  symbol: string;
  name: string;
  isNative: boolean;
  balanceNum: number;
  usdValue: number;
  logo?: string; // remote URL when the indexer provides one
}

export interface MobileWalletState {
  evmAddress: string;
  nonEvmAddresses: NonEvmAddressMap | null;
  rows: AssetRow[];
  chainIds: string[]; // chains with anything to show, dashboard filter chips
  portfolioUsd: number;
  rates: Rates | null;
  loading: boolean;
  error: string;
  refresh: () => void;
}

function tokenRows(
  byChain: Record<string, AutoToken[]>,
  hidden: Set<string>
): AssetRow[] {
  const rows: AssetRow[] = [];
  for (const [chainId, tokens] of Object.entries(byChain)) {
    for (const t of tokens) {
      if (hidden.has(tokenHideKey(chainId, t.address))) continue;
      if (classifyToken(t).hidden) continue;
      const bal = parseFloat(t.balance) || 0;
      const usd = (t.priceUsd ?? 0) * bal;
      if (usd < DUST_USD) continue; // dust rule: unpriced or near-zero rows stay off
      rows.push({
        key: `${chainId}:${t.address.toLowerCase()}`,
        chainId,
        chainName: chainId,
        symbol: t.symbol,
        name: t.name,
        isNative: false,
        balanceNum: bal,
        usdValue: usd,
        logo: t.logo,
      });
    }
  }
  return rows;
}

export function useMobileWallet(unlocked: boolean): MobileWalletState {
  const [evmAddress, setEvmAddress] = useState("");
  const [nonEvmAddresses, setNonEvmAddresses] = useState<NonEvmAddressMap | null>(null);
  const [natives, setNatives] = useState<AssetRow[]>([]);
  const [tokensByChain, setTokensByChain] = useState<Record<string, AutoToken[]>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [rates, setRates] = useState<Rates | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);

  const refresh = useCallback(() => {
    if (!unlocked || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError("");
    (async () => {
      const mnemonic = await getUnlockedMnemonic();
      if (!mnemonic) throw new Error("locked");

      const evm = importFromMnemonic(mnemonic).address;
      setEvmAddress(evm);
      const derived = await deriveNonEvmAddresses(mnemonic);
      // Addresses only from here on; the secret keys in `derived` go out of
      // scope now and are never stored in hook state.
      const addrs: NonEvmAddressMap = {
        bitcoin: derived.bitcoin.address,
        solana: derived.solana.address,
        sui: derived.sui.address,
        tron: derived.tron.address,
        xrp: derived.xrp.address,
        litecoin: derived.litecoin.address,
      };
      setNonEvmAddresses(addrs);

      const [liveRates, hiddenSet] = await Promise.all([
        fetchRates(),
        loadHiddenTokens(evm.toLowerCase()),
      ]);
      setRates(liveRates);
      setHidden(hiddenSet);

      const [evmSweep, nonEvm] = await Promise.all([
        sweepEvmNativeBalances(evm, {}, new Map<string, ChainBalance>()),
        fetchNonEvmBalancesByAddress(addrs),
      ]);

      const nativeRows: AssetRow[] = [
        ...evmSweep.results.map((c) => ({
          key: `native:${c.networkId}`,
          chainId: c.networkId,
          chainName: c.name,
          symbol: c.symbol,
          name: c.name,
          isNative: true,
          balanceNum: c.balanceNum,
          usdValue: c.usdValue,
        })),
        ...nonEvm.map((c: NonEvmChain) => ({
          key: `native:${c.id}`,
          chainId: c.id,
          chainName: c.name,
          symbol: c.symbol,
          name: c.name,
          isNative: true,
          balanceNum: c.balance,
          usdValue: c.balance * getUsdPrice(c.symbol, liveRates),
        })),
      ];
      setNatives(nativeRows);

      // Token discovery streams per chain through the proxy; paint as it lands.
      await sweepAllChainTokens(evm, (chainId, tokens) => {
        setTokensByChain((prev) => ({ ...prev, [chainId]: tokens }));
      });
    })()
      .catch((e) => setError(String(e)))
      .finally(() => {
        busy.current = false;
        setLoading(false);
      });
  }, [unlocked]);

  useEffect(() => {
    if (unlocked) refresh();
  }, [unlocked, refresh]);

  const tokens = tokenRows(tokensByChain, hidden);
  // Natives with a balance always show; zero-balance natives only clutter a
  // phone screen, but keep ETH so an empty wallet is not a blank page.
  const visibleNatives = natives.filter(
    (r) => r.balanceNum > 0 || r.chainId === "ethereum"
  );
  const rows = [...visibleNatives, ...tokens].sort((a, b) => b.usdValue - a.usdValue);
  const portfolioUsd = rows.reduce((s, r) => s + r.usdValue, 0);
  const chainIds = [...new Set(rows.map((r) => r.chainId))];

  return {
    evmAddress,
    nonEvmAddresses,
    rows,
    chainIds,
    portfolioUsd,
    rates,
    loading,
    error,
    refresh,
  };
}
