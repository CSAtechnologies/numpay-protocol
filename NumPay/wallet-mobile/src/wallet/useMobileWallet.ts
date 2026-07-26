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
 *    dust rule (hide priced sub-$0.01 rows; unpriced balances stay visible,
 *    same semantics as the extension Dashboard).
 *
 * Slice 1 scope: EVM tokens only. SPL/TRC-20/Sui token rows follow with the
 * Send work (they share core fetchers already).
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { ethers } from "ethers";
import { importFromMnemonic } from "@numpay/core/wallet";
import { NETWORKS, type Network } from "@numpay/core/networks";
import { getTokenBalance } from "@numpay/core/tokens";
import { getCustomTokens, type CustomToken } from "@numpay/core/customTokens";
import { getCustomChains, type CustomChain } from "@numpay/core/customChains";
import {
  deriveNonEvmAddresses,
  fetchNonEvmBalancesByAddress,
  fetchSolanaTokens,
  fetchTronTokens,
  fetchSuiTokens,
  type NonEvmAddressMap,
  type NonEvmChain,
} from "@numpay/core/chains";
import { sweepEvmNativeBalances, type ChainBalance } from "@numpay/core/balanceSweep";
import { sweepAllChainTokens, type AutoToken } from "@numpay/core/autoTokens";
import { fetchRates, getAnyUsdPrice, getUsdPrice, type Rates } from "@numpay/core/currency";
import { loadHiddenTokens, setTokenHidden, tokenHideKey } from "@numpay/core/hiddenTokens";
import { classifyToken } from "@numpay/core/tokenSpam";
import { chainNameOf } from "@numpay/core/txLog";
import { getOwnedBPANCount, findOwnedBPANs } from "@numpay/core/bpan";
import { getItem, setItem } from "@numpay/core/storage";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import { savePublicAddresses } from "../notify/receiveWatch";

const DUST_USD = 0.01; // same cutoff as the extension dashboard (tokens only)

// Zero-balance display order for the natives list: the majors a wallet user
// expects to see first, then everything else in sweep order.
const MAJOR_ORDER = [
  "ethereum", "bitcoin", "solana", "bsc", "base", "polygon", "arbitrum",
  "optimism", "avalanche", "tron", "sui", "xrp", "litecoin",
];

// Hard ceiling on the busy-guarded refresh phase. Found on-device: a hung
// upstream (no per-call timeout) kept `busy` true for minutes, so the refresh
// fired by the next unlock bailed silently and the dashboard stayed empty.
const REFRESH_TIMEOUT_MS = 45_000;
const DISCOVERY_TIMEOUT_MS = 90_000;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out`)), ms)
    ),
  ]);
}

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
  /** Set on dust rows the USER hid by hand, as opposed to ones the dust/spam
   *  rules filtered out. Only these get an "Unhide" control (ext parity). */
  manualHidden?: boolean;
  // Risk signals carried through from discovery so TokenDetail can raise the
  // extension's caution banner. Undefined means "the indexer told us nothing",
  // which is NOT the same as a clean result — only explicit flags warn.
  possibleSpam?: boolean;
  securityScore?: number;
  verifiedContract?: boolean;
}

export interface MobileWalletState {
  evmAddress: string;
  nonEvmAddresses: NonEvmAddressMap | null;
  /** First owned BPAN (raw 11 digits), "" when none / not yet known. */
  bpan: string;
  rows: AssetRow[];
  /** Dust + user-hidden token rows, for the dashboard's collapsible "Hidden"
   *  section (extension parity). Never contains natives: majors always show. */
  dustRows: AssetRow[];
  /** Hide/unhide a token row by hand. No-op for natives. */
  setRowHidden: (row: AssetRow, hidden: boolean) => Promise<void>;
  chainIds: string[]; // chains with anything to show, dashboard filter chips
  /** Raw discovered tokens per chain (address/decimals intact) for pickers.
   *  Custom (user-added) tokens are merged in, so Send can pick them. */
  tokensByChain: Record<string, AutoToken[]>;
  /** User-added EVM networks (Manage assets), keyed by network id, in core
   *  Network shape so Send/fee code can treat them like built-ins. */
  customNets: Record<string, Network>;
  portfolioUsd: number;
  rates: Rates | null;
  loading: boolean;
  error: string;
  refresh: () => void;
  /** Re-read user-added tokens/networks from storage without a full sweep. */
  reloadCustom: () => Promise<void>;
}

// Non-EVM token fetchers return priceUsd only where the source provides it
// (Solana); everywhere else the shared symbol→rate table prices majors like
// USDT/USDC, and the dust rule keeps the rest off (same as the extension).
function tokenRows(
  byChain: Record<string, AutoToken[]>,
  hidden: Set<string>,
  rates: Rates | null
): { rows: AssetRow[]; dust: AssetRow[] } {
  const rows: AssetRow[] = [];
  // Dust + manually hidden tokens. The extension keeps these reachable behind
  // a "Hidden (n)" disclosure rather than dropping them, so a token hidden by
  // mistake (or auto-classified as spam) can always be brought back.
  const dust: AssetRow[] = [];
  for (const [chainId, tokens] of Object.entries(byChain)) {
    for (const t of tokens) {
      const bal = parseFloat(t.balance) || 0;
      // Indexer price first; otherwise the shared symbol tables. getAnyUsdPrice
      // covers ERC-20s (USDC/USDT/WETH/…) that getUsdPrice alone cannot —
      // without it a held stablecoin valued at $0 and vanished from the total.
      const price = t.priceUsd ?? (rates ? getAnyUsdPrice(t.symbol, rates) : 0);
      const mkRow = (manualHidden?: boolean): AssetRow => ({
        key: `${chainId}:${t.address.toLowerCase()}`,
        chainId,
        chainName: chainNameOf(chainId) ?? chainId,
        symbol: t.symbol,
        name: t.name,
        isNative: false,
        balanceNum: bal,
        usdValue: price * bal,
        logo: t.logo,
        manualHidden,
        possibleSpam: t.possibleSpam,
        securityScore: t.securityScore,
        verifiedContract: t.verifiedContract,
      });
      if (hidden.has(tokenHideKey(chainId, t.address))) {
        if (bal > 0) dust.push(mkRow(true));
        continue;
      }
      if (classifyToken(t).hidden) {
        if (bal > 0) dust.push(mkRow(false));
        continue;
      }
      if (bal <= 0) continue;
      const usd = price * bal;
      // Extension-parity dust rule: only a PRICED-but-negligible balance is
      // dust. An unpriced balance is money we can't value yet, not dust —
      // treating price-unknown as $0 made every received token the indexer
      // couldn't price (fresh memecoins, RWA, long-tail stables) invisible,
      // while the extension deliberately keeps them ("unknown price — never
      // treat as dust", Dashboard.tsx). Spam still filters via classifyToken.
      if (usd > 0 && usd < DUST_USD) { dust.push(mkRow(false)); continue; }
      rows.push(mkRow());
    }
  }
  return { rows, dust };
}

// User-added networks, in core Network shape (same mapping the extension's
// useWallet does) so the native sweep and Send treat them like built-ins.
function toNetMap(list: CustomChain[]): Record<string, Network> {
  const netMap: Record<string, Network> = {};
  for (const cc of list) {
    netMap[cc.id] = {
      id: cc.id, name: cc.name, chainId: cc.chainId,
      rpcUrl: cc.rpcUrl, symbol: cc.symbol, decimals: cc.decimals,
      explorer: cc.explorer, logo: cc.logo || "",
    };
  }
  return netMap;
}

// Custom (user-added) EVM token balances, read straight from the chain RPC —
// custom tokens exist precisely because no indexer reports them, so the
// discovery sweep cannot cover them. Solana customs skip this: held mints
// arrive priced via fetchSolanaTokens, and an unheld one just shows 0.
async function fetchCustomEvmTokenBalances(
  owner: string,
  tokens: CustomToken[],
  customNets: Record<string, Network>,
): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  await Promise.all(tokens.map(async (ct) => {
    const net = NETWORKS[ct.chainId] ?? customNets[ct.chainId];
    if (!net) return; // solana / unknown chain: no RPC read here
    try {
      const provider = new ethers.JsonRpcProvider(net.rpcUrl, net.chainId, { staticNetwork: true });
      const bal = await withTimeout(
        getTokenBalance(ct.address, owner, provider), 8_000, `${ct.symbol} balance`,
      );
      out[`${ct.chainId}:${ct.address.toLowerCase()}`] = bal;
    } catch { /* failed read: the state merge keeps the last-known balance */ }
  }));
  return out;
}

// ── Own-BPAN lookup (auto-display rule): cached per wallet, then a count-gated
// on-chain ownership scan, mirroring the extension's BPAN page bootstrap. ────
function bpanCacheKey(owner: string): string {
  return `bpan_numbers_${owner.toLowerCase()}`;
}

async function loadOwnBPAN(owner: string): Promise<string> {
  try {
    const raw = await getItem(bpanCacheKey(owner));
    const cached: string[] = raw ? JSON.parse(raw) : [];
    if (cached.length > 0) return cached[0];
  } catch { /* cache is best-effort */ }
  try {
    const count = await getOwnedBPANCount(owner);
    if (count === 0) return "";
    const found = await findOwnedBPANs(owner);
    if (found.length > 0) {
      await setItem(bpanCacheKey(owner), JSON.stringify(found)).catch(() => {});
      return found[0];
    }
  } catch { /* non-fatal: the dashboard just shows the address */ }
  return "";
}

export function useMobileWallet(unlocked: boolean, activeWalletId?: string | null): MobileWalletState {
  const [evmAddress, setEvmAddress] = useState("");
  const [bpan, setBpan] = useState("");
  const [nonEvmAddresses, setNonEvmAddresses] = useState<NonEvmAddressMap | null>(null);
  const [natives, setNatives] = useState<AssetRow[]>([]);
  const [tokensByChain, setTokensByChain] = useState<Record<string, AutoToken[]>>({});
  // Manage-assets state: re-read from core storage on every refresh, so adds/
  // removes made on the ManageAssets screen land on the next sweep.
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [customNets, setCustomNets] = useState<Record<string, Network>>({});
  const [customBal, setCustomBal] = useState<Record<string, string>>({});
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [rates, setRates] = useState<Rates | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const busy = useRef(false);
  const discoveryBusy = useRef(false);
  // Address cache, filled on the first refresh after an unlock. Deriving all
  // seven chains from the mnemonic is JS-thread CPU (measured ~10 s for the
  // EVM account alone on a dev-mode emulator) — doing it once per unlock
  // instead of every refresh is what makes refreshes paint promptly. Only
  // PUBLIC addresses are cached; keys are re-derived per send.
  const addrCache = useRef<{ evm: string; addrs: NonEvmAddressMap } | null>(null);
  // Last successful balance rows. Core's sweep/fetch retention ("a failed
  // read never zeroes a row") only engages when the caller passes the
  // previous results back in — without these, one network blip painted every
  // real balance as 0 (observed on-device 2026-07-13).
  const prevEvmByChain = useRef(new Map<string, ChainBalance>());
  const prevNonEvm = useRef<NonEvmChain[] | undefined>(undefined);

  const refresh = useCallback(() => {
    if (!unlocked || busy.current) return;
    busy.current = true;
    setLoading(true);
    setError("");
    (async () => {
      // Macrotask yield: everything below runs in microtask continuations,
      // which Hermes executes BEFORE the pending "loading" state can paint —
      // without this the dashboard looks dead during the first derivation.
      await new Promise((r) => setTimeout(r, 0));

      let cached = addrCache.current;
      if (!cached) {
        const mnemonic = await getUnlockedMnemonic();
        if (!mnemonic) throw new Error("locked");
        const evm = importFromMnemonic(mnemonic).address;
        setEvmAddress(evm);
        const derived = await deriveNonEvmAddresses(mnemonic);
        // Addresses only from here on; the secret keys in `derived` go out of
        // scope now and are never stored in hook state.
        cached = {
          evm,
          addrs: {
            bitcoin: derived.bitcoin.address,
            solana: derived.solana.address,
            sui: derived.sui.address,
            tron: derived.tron.address,
            xrp: derived.xrp.address,
            litecoin: derived.litecoin.address,
          },
        };
        addrCache.current = cached;
        // Public addresses only: lets the background receive watcher sweep
        // while the vault is locked (notify/receiveWatch.ts).
        void savePublicAddresses(cached.evm, cached.addrs);
      }
      const { evm, addrs } = cached;
      setEvmAddress(evm);
      setNonEvmAddresses(addrs);

      const [liveRates, hiddenSet, ccList, ctList] = await withTimeout(Promise.all([
        fetchRates(),
        loadHiddenTokens(evm.toLowerCase()),
        getCustomChains().catch(() => []),
        getCustomTokens().catch(() => []),
      ]), REFRESH_TIMEOUT_MS, "Rates fetch");
      setRates(liveRates);
      setHidden(hiddenSet);

      const netMap = toNetMap(ccList);
      setCustomNets(netMap);
      setCustomTokens(ctList);

      // Own-BPAN display is independent of balances; let it land whenever the
      // quorum read finishes (cached after the first success).
      void loadOwnBPAN(evm).then(setBpan);

      const [evmSweep, nonEvm] = await withTimeout(Promise.all([
        sweepEvmNativeBalances(evm, netMap, prevEvmByChain.current),
        fetchNonEvmBalancesByAddress(addrs, prevNonEvm.current),
      ]), REFRESH_TIMEOUT_MS, "Balance sweep");
      prevEvmByChain.current = new Map(evmSweep.results.map((c) => [c.networkId, c]));
      prevNonEvm.current = nonEvm;

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

      // Custom-token balances ride outside the busy phase like discovery:
      // per-token 8 s timeouts, and a failed read keeps the previous value
      // (prev-merge below) instead of zeroing the row.
      if (ctList.length > 0) {
        void fetchCustomEvmTokenBalances(evm, ctList, netMap).then((bals) => {
          setCustomBal((prev) => ({ ...prev, ...bals }));
        });
      }

      // Token discovery paints as it lands but runs OUTSIDE the busy-guarded
      // phase, with its own single-flight guard: a slow or hung endpoint here
      // must never block the next refresh (the on-device failure mode was
      // exactly that — busy stayed true for minutes and the unlock-triggered
      // refresh bailed silently, leaving the dashboard empty).
      if (!discoveryBusy.current) {
        discoveryBusy.current = true;
        const discovery = Promise.all([
          sweepAllChainTokens(evm, (chainId, tokens) => {
            setTokensByChain((prev) => ({ ...prev, [chainId]: tokens }));
          }),
          // Non-EVM lists query their public endpoints directly. null =
          // provider unreachable → keep the last-known list; [] =
          // authoritative empty.
          (async () => {
            const [spl, trc, sui] = await Promise.all([
              fetchSolanaTokens(addrs.solana).catch(() => null),
              fetchTronTokens(addrs.tron).catch(() => null),
              fetchSuiTokens(addrs.sui).catch(() => null),
            ]);
            setTokensByChain((prev) => {
              const next = { ...prev };
              if (spl) next.solana = spl as AutoToken[];
              if (trc) next.tron = trc as AutoToken[];
              if (sui) next.sui = sui as AutoToken[];
              return next;
            });
          })(),
        ]);
        void withTimeout(discovery, DISCOVERY_TIMEOUT_MS, "Token discovery")
          .catch(() => { /* partial lists already painted; next refresh retries */ })
          .finally(() => { discoveryBusy.current = false; });
      }
    })()
      .catch((e) => setError(String(e)))
      .finally(() => {
        busy.current = false;
        setLoading(false);
      });
  }, [unlocked]);

  /**
   * Re-read the user's custom tokens and networks from storage, and fetch
   * balances for them.
   *
   * Adding a token in Manage assets is a purely LOCAL change, so surfacing it
   * must not depend on the full refresh() network sweep: that is slow, it can
   * be in-flight already (busy guard), and it made a freshly added token look
   * like it had not been saved. Cheap enough to call on every exit from
   * Manage assets.
   */
  const reloadCustom = useCallback(async () => {
    const [ccList, ctList] = await Promise.all([
      getCustomChains().catch(() => []),
      getCustomTokens().catch(() => []),
    ]);
    const netMap = toNetMap(ccList);
    setCustomNets(netMap);
    setCustomTokens(ctList);
    if (ctList.length > 0 && addrCache.current?.evm) {
      void fetchCustomEvmTokenBalances(addrCache.current.evm, ctList, netMap)
        .then((bals) => setCustomBal((prev) => ({ ...prev, ...bals })))
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    if (unlocked) refresh();
    else {
      // Lock: cached addresses die with the session, and so does balance
      // retention — a wipe→import could unlock a DIFFERENT wallet next, which
      // must not inherit this one's last-known rows.
      addrCache.current = null;
      prevEvmByChain.current = new Map();
      prevNonEvm.current = undefined;
      setCustomBal({});
    }
  }, [unlocked, refresh]);

  // Active wallet switched (multi-wallet): the mnemonic behind
  // getUnlockedMnemonic now differs, so drop the derived addresses + last-known
  // balances (they belong to the previous wallet) and re-derive. Only a genuine
  // id CHANGE while unlocked triggers this; the initial null→id at unlock is
  // already handled by the main refresh effect above (no double-refresh).
  const prevWalletId = useRef(activeWalletId);
  useEffect(() => {
    const prev = prevWalletId.current;
    prevWalletId.current = activeWalletId;
    if (!unlocked || prev == null || prev === activeWalletId) return;
    addrCache.current = null;
    prevEvmByChain.current = new Map();
    prevNonEvm.current = undefined;
    setNatives([]); setTokensByChain({}); setBpan(""); setEvmAddress("");
    setNonEvmAddresses(null); setCustomBal({});
    refresh();
  }, [activeWalletId, unlocked, refresh]);

  // Hide / unhide a token by hand — the manual backstop for spam the classifier
  // misses, and the way back for anything hidden by mistake. Natives are exempt
  // (majors must never disappear). Optimistic: the set updates in state right
  // away so the row moves between sections on the next render, not the next
  // sweep.
  const setRowHidden = useCallback(async (row: AssetRow, hide: boolean) => {
    if (row.isNative || !evmAddress) return;
    const addr = row.key.split(":")[1];
    const key = tokenHideKey(row.chainId, addr);
    setHidden((prev) => {
      const next = new Set(prev);
      if (hide) next.add(key); else next.delete(key);
      return next;
    });
    try {
      await setTokenHidden(evmAddress.toLowerCase(), key, hide);
    } catch {
      // Persist failed: put the in-memory set back so the UI keeps telling the
      // truth about what will survive a reload.
      setHidden((prev) => {
        const next = new Set(prev);
        if (hide) next.delete(key); else next.add(key);
        return next;
      });
    }
  }, [evmAddress]);

  const { rows: tokens, dust: tokenDust } = tokenRows(tokensByChain, hidden, rates);
  // Custom (user-added) token rows. Deliberately EXEMPT from the dust rule and
  // spam classification: the user explicitly asked for this token, so an
  // unpriced balance must not vanish (that reads as "add token is broken").
  // A token discovery also found is skipped — the discovered row carries the
  // indexer's price/logo metadata and would otherwise duplicate.
  const customRows: AssetRow[] = [];
  const customDust: AssetRow[] = [];
  for (const ct of customTokens) {
    const addrLc = ct.address.toLowerCase();
    if ((tokensByChain[ct.chainId] ?? []).some((t) => t.address.toLowerCase() === addrLc)) continue;
    const bal = parseFloat(customBal[`${ct.chainId}:${addrLc}`] ?? "0") || 0;
    const price = rates ? getAnyUsdPrice(ct.symbol, rates) : 0;
    const row: AssetRow = {
      key: `${ct.chainId}:${addrLc}`,
      chainId: ct.chainId,
      chainName: NETWORKS[ct.chainId]?.name ?? customNets[ct.chainId]?.name ?? (chainNameOf(ct.chainId) ?? ct.chainId),
      symbol: ct.symbol,
      name: ct.name,
      isNative: false,
      balanceNum: bal,
      usdValue: price * bal,
      logo: ct.logo,
    };
    // A hidden custom token still belongs in the Hidden section, not gone: the
    // user added it deliberately, so unhiding must stay one tap away.
    if (hidden.has(tokenHideKey(ct.chainId, ct.address))) customDust.push({ ...row, manualHidden: true });
    else customRows.push(row);
  }
  // Every native the sweeps return stays VISIBLE, zero balance included —
  // matching the extension dashboard (user directive 2026-07-15: majors must
  // never be hidden). Holders sort to the top by USD value; the zero-balance
  // tail follows a fixed major-chain order instead of alphabet soup.
  const rows = [...natives, ...tokens, ...customRows].sort((a, b) => {
    if (b.usdValue !== a.usdValue) return b.usdValue - a.usdValue;
    const aHolds = a.balanceNum > 0 ? 0 : 1;
    const bHolds = b.balanceNum > 0 ? 0 : 1;
    if (aHolds !== bHolds) return aHolds - bHolds;
    const ai = MAJOR_ORDER.indexOf(a.chainId);
    const bi = MAJOR_ORDER.indexOf(b.chainId);
    return (ai === -1 ? MAJOR_ORDER.length : ai) - (bi === -1 ? MAJOR_ORDER.length : bi);
  });
  const portfolioUsd = rows.reduce((s, r) => s + r.usdValue, 0);
  const chainIds = [...new Set(rows.map((r) => r.chainId))];
  // Hidden section: biggest first, so anything worth recovering is at the top.
  const dustRows = [...tokenDust, ...customDust].sort((a, b) => b.usdValue - a.usdValue);

  // Merge customs into the picker lists so Send/TokenDetail can select them.
  // Derived here (not in setTokensByChain) so the discovery sweep's per-chain
  // list replacement can never race the merge away.
  const mergedTokensByChain: Record<string, AutoToken[]> = { ...tokensByChain };
  for (const ct of customTokens) {
    const list = mergedTokensByChain[ct.chainId] ?? [];
    if (list.some((t) => t.address.toLowerCase() === ct.address.toLowerCase())) continue;
    mergedTokensByChain[ct.chainId] = [...list, {
      symbol: ct.symbol, name: ct.name, address: ct.address, decimals: ct.decimals,
      balance: customBal[`${ct.chainId}:${ct.address.toLowerCase()}`] ?? "0", logo: ct.logo,
    }];
  }

  return {
    evmAddress,
    bpan,
    nonEvmAddresses,
    rows,
    dustRows,
    setRowHidden,
    chainIds,
    tokensByChain: mergedTokensByChain,
    customNets,
    portfolioUsd,
    rates,
    loading,
    error,
    refresh,
    reloadCustom,
  };
}
