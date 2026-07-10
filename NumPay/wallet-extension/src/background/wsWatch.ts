// Incoming-funds watcher.
//
// The alarm refresher bounds staleness at ~1-2 minutes; this closes the last
// gap to "funds appear in seconds". WebSocket subscriptions on the watched
// public addresses turn an on-chain deposit into an immediate cache refresh:
//
//  - EVM (Alchemy WSS, per enabled chain):
//      alchemy_minedTransactions filtered to:address  → native deposits
//      eth_subscribe("logs", Transfer(*, us))         → ERC-20 deposits
//  - Solana (Helius WSS, Alchemy fallback):
//      accountSubscribe(owner)                        → SOL balance changes
//
// Event handling is deliberately truth-preserving: WS payloads are treated as
// a WAKE SIGNAL, never as balance truth. A native/SOL event force-runs the
// existing sweep (bypassing its age gate); an ERC-20 event does one targeted
// balanceOf against our own RPC and patches that token into the auto-token
// cache (so even a first-ever token shows without waiting for the 12-min
// indexer sweep gate). Afterwards a runtime broadcast tells an open popup to
// re-read. Same security posture as the refresher: public addresses only.
//
// MV3 lifetime: WS traffic resets the service-worker idle timer (Chrome 116+),
// so a 20s JSON-RPC ping keeps the worker and its sockets resident. If the
// worker is killed anyway, the 1-min ensure alarm reconnects everything.
// Chains whose socket keeps failing (e.g. networks not enabled in our Alchemy
// app) go into a 15-min cooldown instead of hammering reconnects.

import { ethers } from "ethers";
import { NETWORKS } from "@numpay/core/networks";
import { ALCHEMY_KEY, HELIUS_KEY } from "@numpay/core/env";
import { ALCHEMY_CHAINS, AUTOTOK_CACHE_PFX, type AutoToken } from "@numpay/core/autoTokens";
import { getWatchAddresses, type WatchAddresses } from "@numpay/core/watchAddresses";
import { getItem, setItem } from "@numpay/core/storage";
import { forceRefreshEvm, forceRefreshNonEvm, hasPopupOpen } from "./balanceRefresher";

const WS_ALARM = "numpay-ws-ensure";
const WATCH_KEY = "numpay_watch_addrs";
export const FUNDS_EVENT_MSG = "NUMPAY_FUNDS_EVENT";

const PING_MS = 20_000;
const MAX_STRIKES = 3;
const COOLDOWN_MS = 15 * 60_000;
const NATIVE_DEBOUNCE_MS = 3_000;
const TOKEN_DEBOUNCE_MS = 2_000;

// keccak256("Transfer(address,address,uint256)")
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Chains with no Alchemy app coverage: public WSS endpoints, ERC-20 Transfer
// logs only. Native deposits on these chains ride the existing 50s native
// sweep, because vanilla eth_subscribe has no per-address transaction filter
// (alchemy_minedTransactions is Alchemy-specific). Endpoints verified to
// accept eth_subscribe("logs"); the list rotates on reconnect strikes.
const PUBLIC_WS_CHAINS: Record<string, string[]> = {
  bsc: ["wss://bsc-rpc.publicnode.com", "wss://bsc.publicnode.com", "wss://bsc.drpc.org"],
};

// SPL token programs. programSubscribe filtered on the owner field (offset 32
// of the token-account layout) fires for ANY token account owned by the
// watched wallet - including a brand-new ATA on a first-ever deposit, which
// accountSubscribe on the owner never sees. Classic accounts are exactly 165
// bytes; Token-2022 accounts carry extensions, so that one filters on owner
// only (a false positive just costs one refresh).
const SPL_TOKEN_PROGRAM  = "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
const SPL_TOKEN22_PROGRAM = "TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb";

const ERC20_META_ABI = [
  "function balanceOf(address) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function name() view returns (string)",
];

// Socket key: EVM networkId, or "solana".
const sockets = new Map<string, WebSocket>();
const strikes = new Map<string, number>();
const cooldownUntil = new Map<string, number>();
let watch: WatchAddresses | null = null;
let pingTimer: ReturnType<typeof setInterval> | null = null;

function closeAll(): void {
  for (const ws of sockets.values()) {
    try { ws.close(); } catch {}
  }
  sockets.clear();
  strikes.clear();
  cooldownUntil.clear();
}

/** (Re)connect every socket that should be up for the current watch registry. */
async function ensure(): Promise<void> {
  const w = await getWatchAddresses();
  if (!w?.evm) return;
  // Active wallet changed: drop the old wallet's subscriptions wholesale.
  if (watch && watch.evm !== w.evm) closeAll();
  watch = w;

  if (ALCHEMY_KEY) {
    for (const [chainId, sub] of Object.entries(ALCHEMY_CHAINS)) {
      openEvm(chainId, w.evm, `wss://${sub}.g.alchemy.com/v2/${ALCHEMY_KEY}`, true);
    }
  }
  for (const [chainId, urls] of Object.entries(PUBLIC_WS_CHAINS)) {
    // Rotate through the endpoint list as strikes accumulate.
    const url = urls[(strikes.get(chainId) ?? 0) % urls.length];
    openEvm(chainId, w.evm, url, false);
  }
  if (w.solana) openSolana(w.solana);

  if (!pingTimer) pingTimer = setInterval(pingAll, PING_MS);
}

function canOpen(key: string): boolean {
  const cur = sockets.get(key);
  if (cur && (cur.readyState === WebSocket.OPEN || cur.readyState === WebSocket.CONNECTING)) return false;
  if ((cooldownUntil.get(key) ?? 0) > Date.now()) return false;
  return true;
}

function noteClosed(key: string): void {
  sockets.delete(key);
  const n = (strikes.get(key) ?? 0) + 1;
  if (n >= MAX_STRIKES) {
    strikes.set(key, 0);
    cooldownUntil.set(key, Date.now() + COOLDOWN_MS);
  } else {
    strikes.set(key, n);
  }
  // Reconnection happens on the next ensure tick (1-min alarm).
}

function openEvm(chainId: string, address: string, url: string, alchemyNativeSub: boolean): void {
  if (!canOpen(chainId)) return;

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    noteClosed(chainId);
    return;
  }
  sockets.set(chainId, ws);

  ws.onopen = () => {
    strikes.set(chainId, 0);
    // Native deposits: mined txs TO the watched address (hashes only — the
    // payload is a wake signal, the sweep fetches truth). Alchemy-only method.
    if (alchemyNativeSub) {
      ws.send(JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_subscribe",
        params: ["alchemy_minedTransactions", {
          addresses: [{ to: address }], includeRemoved: false, hashesOnly: true,
        }],
      }));
    }
    // ERC-20 deposits: any Transfer whose `to` topic is the watched address.
    ws.send(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "eth_subscribe",
      params: ["logs", { topics: [TRANSFER_TOPIC, null, ethers.zeroPadValue(address, 32)] }],
    }));
  };
  ws.onmessage = (ev) => handleEvmMessage(chainId, ev.data);
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onclose = () => noteClosed(chainId);
}

function openSolana(owner: string): void {
  if (!canOpen("solana")) return;
  const url = HELIUS_KEY
    ? `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_KEY}`
    : ALCHEMY_KEY
      ? `wss://solana-mainnet.g.alchemy.com/v2/${ALCHEMY_KEY}`
      : null;
  if (!url) return;

  let ws: WebSocket;
  try {
    ws = new WebSocket(url);
  } catch {
    noteClosed("solana");
    return;
  }
  sockets.set("solana", ws);

  ws.onopen = () => {
    strikes.set("solana", 0);
    // Native SOL: lamport changes on the owner account.
    ws.send(JSON.stringify({
      jsonrpc: "2.0", id: 1, method: "accountSubscribe",
      params: [owner, { commitment: "confirmed" }],
    }));
    // SPL deposits: any token account owned by us changes (covers brand-new
    // ATAs on first-ever deposits). Owner sits at offset 32 of the layout.
    ws.send(JSON.stringify({
      jsonrpc: "2.0", id: 2, method: "programSubscribe",
      params: [SPL_TOKEN_PROGRAM, {
        commitment: "confirmed", encoding: "base64",
        filters: [{ dataSize: 165 }, { memcmp: { offset: 32, bytes: owner } }],
      }],
    }));
    ws.send(JSON.stringify({
      jsonrpc: "2.0", id: 3, method: "programSubscribe",
      params: [SPL_TOKEN22_PROGRAM, {
        commitment: "confirmed", encoding: "base64",
        filters: [{ memcmp: { offset: 32, bytes: owner } }],
      }],
    }));
  };
  ws.onmessage = (ev) => {
    let msg: any;
    try { msg = JSON.parse(String(ev.data)); } catch { return; }
    if (msg?.method === "accountNotification" || msg?.method === "programNotification") {
      queueSolRefresh();
    }
  };
  ws.onerror = () => { try { ws.close(); } catch {} };
  ws.onclose = () => noteClosed("solana");
}

function pingAll(): void {
  for (const [key, ws] of sockets) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    try {
      ws.send(JSON.stringify({
        jsonrpc: "2.0", id: 0,
        method: key === "solana" ? "getHealth" : "eth_chainId",
      }));
    } catch {}
  }
}

function handleEvmMessage(chainId: string, raw: unknown): void {
  let msg: any;
  try { msg = JSON.parse(String(raw)); } catch { return; }
  if (msg?.method !== "eth_subscription") return; // subscribe acks, ping replies
  const result = msg.params?.result;
  if (!result) return;

  if (Array.isArray(result.topics)) {
    // ERC-20 Transfer log — result.address is the token contract.
    const token = typeof result.address === "string" ? result.address.toLowerCase() : "";
    if (/^0x[0-9a-f]{40}$/.test(token)) queueTokenPatch(chainId, token);
  } else {
    queueNativeRefresh();
  }
}

// ── Debounced reactions ──────────────────────────────────────────────────────
// A single swap/airdrop batch can emit many events at once; coalesce them so
// one deposit costs one refresh.

let nativeTimer: ReturnType<typeof setTimeout> | null = null;
function queueNativeRefresh(): void {
  if (nativeTimer) return;
  nativeTimer = setTimeout(() => {
    nativeTimer = null;
    void (async () => {
      const evm = watch?.evm;
      // With the popup open, its own poll engine does the fetching — just wake it.
      if (evm && !hasPopupOpen()) await forceRefreshEvm(evm).catch(() => {});
      broadcast();
    })();
  }, NATIVE_DEBOUNCE_MS);
}

let solTimer: ReturnType<typeof setTimeout> | null = null;
function queueSolRefresh(): void {
  if (solTimer) return;
  solTimer = setTimeout(() => {
    solTimer = null;
    void (async () => {
      const w = watch;
      if (w?.evm && !hasPopupOpen() &&
          w.solana && w.tron && w.sui && w.bitcoin && w.xrp && w.litecoin) {
        await forceRefreshNonEvm(w.evm, {
          solana: w.solana, tron: w.tron, sui: w.sui,
          bitcoin: w.bitcoin, xrp: w.xrp, litecoin: w.litecoin,
        }).catch(() => {});
      }
      broadcast();
    })();
  }, NATIVE_DEBOUNCE_MS);
}

const tokenTimers = new Map<string, ReturnType<typeof setTimeout>>();
function queueTokenPatch(chainId: string, tokenAddr: string): void {
  const key = `${chainId}|${tokenAddr}`;
  if (tokenTimers.has(key)) return;
  tokenTimers.set(key, setTimeout(() => {
    tokenTimers.delete(key);
    void (async () => {
      const evm = watch?.evm;
      if (evm) await applyIncomingErc20(chainId, tokenAddr, evm).catch(() => {});
      broadcast();
    })();
  }, TOKEN_DEBOUNCE_MS));
}

/**
 * Targeted auto-token cache patch for one incoming ERC-20: read the new
 * balance (+ metadata for a first-ever token) from our own RPC and merge it
 * into the cached chain list. The cache timestamp is deliberately NOT bumped —
 * this is a point patch, not a sweep, so the sweep gates stay honest. Prices
 * and spam verdicts for a new token arrive with the next full sweep.
 */
async function applyIncomingErc20(networkId: string, tokenAddr: string, owner: string): Promise<void> {
  const net = NETWORKS[networkId];
  if (!net) return;
  try {
    const provider = new ethers.JsonRpcProvider(net.rpcUrl, net.chainId, { staticNetwork: true });
    const c = new ethers.Contract(tokenAddr, ERC20_META_ABI, provider);
    const [bal, dec, sym, name] = await Promise.all([
      c.balanceOf(owner),
      c.decimals().catch(() => 18),
      c.symbol().catch(() => ""),
      c.name().catch(() => ""),
    ]);
    const decimals = Number(dec);
    const balance = ethers.formatUnits(bal, decimals);
    if (!(parseFloat(balance) > 0)) return;

    const cacheKey = AUTOTOK_CACHE_PFX + owner.toLowerCase();
    let parsed: { ts: number; data: Record<string, AutoToken[]> };
    try {
      const raw = await getItem(cacheKey);
      parsed = raw ? JSON.parse(raw) : { ts: 0, data: {} };
    } catch {
      parsed = { ts: 0, data: {} };
    }
    if (!parsed.data || typeof parsed.data !== "object") parsed.data = {};

    const list: AutoToken[] = Array.isArray(parsed.data[networkId]) ? parsed.data[networkId] : [];
    const i = list.findIndex((t) => t.address?.toLowerCase() === tokenAddr);
    if (i >= 0) {
      list[i] = { ...list[i], balance };
    } else {
      const symbol = String(sym).trim() || tokenAddr.slice(0, 8);
      list.push({ symbol, name: String(name).trim() || symbol, address: tokenAddr, decimals, balance });
    }
    parsed.data[networkId] = list;
    await setItem(cacheKey, JSON.stringify(parsed));
  } catch (e) {
    console.warn(`[NumPay] ws token patch ${networkId} failed`, e);
  }
}

/** Tell an open popup to re-read now. No receiver (popup closed) is fine. */
function broadcast(): void {
  try {
    void chrome.runtime.sendMessage({ type: FUNDS_EVENT_MSG }).catch(() => {});
  } catch {}
}

// Harness inspection hook (see ext-test verify-ws-watch.mjs): readyState per
// socket key. Exposes connection states only — no addresses, no payloads.
(globalThis as { __numpayWsStatus?: () => Record<string, number> }).__numpayWsStatus = () => {
  const out: Record<string, number> = {};
  for (const [key, ws] of sockets) out[key] = ws.readyState;
  return out;
};

export function initWsWatch(): void {
  // 1-min ensure tick: reconnects sockets after a worker restart or a dropped
  // connection. Idempotent when everything is already up.
  chrome.alarms.create(WS_ALARM, { periodInMinutes: 1 });
  chrome.alarms.onAlarm.addListener((alarm) => {
    if (alarm.name === WS_ALARM) void ensure();
  });
  // Wallet switch rewrites the watch registry → resubscribe immediately.
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[WATCH_KEY]) void ensure();
  });
  void ensure();
}
