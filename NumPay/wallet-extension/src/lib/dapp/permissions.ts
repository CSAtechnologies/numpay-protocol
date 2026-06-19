// Per-origin dApp connection permissions. Stored in chrome.storage.local so they
// survive restarts. A connection records only the exposed account (the active
// wallet at connect time) and the EVM chain. No silent reconnect: an origin with
// no entry here gets an empty eth_accounts and must go through the approval flow.

const PERMS_KEY = "numpay_dapp_perms";

export interface OriginPermission {
  account: string; // exposed EVM address
  chainId: number; // decimal EVM chain id at connect time
  connectedAt: number;
}

type PermMap = Record<string, OriginPermission>;

async function load(): Promise<PermMap> {
  try {
    const r = await chrome.storage.local.get(PERMS_KEY);
    const v = r[PERMS_KEY];
    return v && typeof v === "object" ? (v as PermMap) : {};
  } catch {
    return {};
  }
}

async function save(map: PermMap): Promise<void> {
  await chrome.storage.local.set({ [PERMS_KEY]: map });
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
// switches the active wallet or EVM network in the popup, so we can emit the
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
