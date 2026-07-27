// Per-origin dApp connection permissions, shared by the extension's injected
// provider and the mobile in-app browser. A connection records only the exposed
// account (the active wallet at connect time) and the EVM chain.
//
// No silent reconnect: an origin with no entry here gets an empty eth_accounts
// and must go through the approval flow. That rule is the whole point of this
// module, so `getPermission` returning null must always mean "ask the user".

import { getItem, setItem } from "../storage";

const PERMS_KEY = "numpay_dapp_perms";

export interface OriginPermission {
  account: string; // exposed EVM address
  chainId: number; // decimal EVM chain id at connect time
  connectedAt: number;
}

type PermMap = Record<string, OriginPermission>;

// Tolerates BOTH storage shapes on read. The extension previously wrote this
// key with chrome.storage.local.set({key: map}), which stores a live object,
// whereas core's KVStore contract is string-valued. Parsing only the string
// form would drop every existing grant on upgrade (silently: the catch would
// hand back {} and every connected site would look disconnected). So accept an
// object as-is; the next save() rewrites it as JSON and the legacy shape is
// gone for good.
async function load(): Promise<PermMap> {
  try {
    const raw = (await getItem(PERMS_KEY)) as unknown;
    if (!raw) return {};
    if (typeof raw === "object") return raw as PermMap;
    const v = JSON.parse(raw as string);
    return v && typeof v === "object" ? (v as PermMap) : {};
  } catch {
    return {};
  }
}

async function save(map: PermMap): Promise<void> {
  await setItem(PERMS_KEY, JSON.stringify(map));
}

export async function getPermission(origin: string): Promise<OriginPermission | null> {
  const map = await load();
  return map[origin] ?? null;
}

export async function isConnected(origin: string): Promise<boolean> {
  return (await getPermission(origin)) !== null;
}

export async function grant(origin: string, account: string, chainId: number): Promise<void> {
  const map = await load();
  map[origin] = { account, chainId, connectedAt: Date.now() };
  await save(map);
}

export async function revoke(origin: string): Promise<void> {
  const map = await load();
  if (map[origin]) {
    delete map[origin];
    await save(map);
  }
}

export async function listOrigins(): Promise<Array<{ origin: string } & OriginPermission>> {
  const map = await load();
  return Object.entries(map).map(([origin, p]) => ({ origin, ...p }));
}

// Update the exposed account/chain on every connected origin after the user
// switches the active wallet or EVM network, so the caller can emit the
// matching accountsChanged / chainChanged events.
export async function updateAllConnected(account: string, chainId: number): Promise<string[]> {
  const map = await load();
  const origins = Object.keys(map);
  for (const o of origins) {
    map[o].account = account;
    map[o].chainId = chainId;
  }
  if (origins.length) await save(map);
  return origins;
}

// Set the exposed chain for ONE origin. Mobile needs this and the extension
// does not: the extension has a wallet-wide active chain (numpay_active_chain)
// that a dApp's wallet_switchEthereumChain mutates for the whole wallet, while
// mobile is chain-agnostic and has no such setting. On mobile the browser
// session owns its chain per origin, so a dApp can never repoint the rest of
// the app.
export async function setOriginChain(origin: string, chainId: number): Promise<void> {
  const map = await load();
  const cur = map[origin];
  if (!cur) return;
  cur.chainId = chainId;
  await save(map);
}
