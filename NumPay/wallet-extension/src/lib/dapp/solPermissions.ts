// Per-origin Solana dApp connection permissions. Kept separate from the EVM
// permission store (permissions.ts) because the account is a base58 Solana
// public key on a cluster, not an EVM address on a numeric chain, and a site may
// connect to both surfaces independently. Stored in chrome.storage.local so a
// grant survives restarts. No silent reconnect: an origin with no entry gets a
// null account and must go through the connect approval.

const SOL_PERMS_KEY = "numpay_dapp_sol_perms";

export interface SolOriginPermission {
  account: string; // base58 Solana public key exposed at connect time
  cluster: string; // e.g. "solana:mainnet"
  connectedAt: number;
}

type SolPermMap = Record<string, SolOriginPermission>;

async function load(): Promise<SolPermMap> {
  try {
    const r = await chrome.storage.local.get(SOL_PERMS_KEY);
    const v = r[SOL_PERMS_KEY];
    return v && typeof v === "object" ? (v as SolPermMap) : {};
  } catch {
    return {};
  }
}

async function save(map: SolPermMap): Promise<void> {
  await chrome.storage.local.set({ [SOL_PERMS_KEY]: map });
}

export async function getSolPermission(origin: string): Promise<SolOriginPermission | null> {
  const map = await load();
  return map[origin] ?? null;
}

export async function grantSol(origin: string, account: string, cluster: string): Promise<void> {
  const map = await load();
  map[origin] = { account, cluster, connectedAt: Date.now() };
  await save(map);
}

export async function revokeSol(origin: string): Promise<void> {
  const map = await load();
  if (map[origin]) {
    delete map[origin];
    await save(map);
  }
}

export async function listSolOrigins(): Promise<Array<{ origin: string } & SolOriginPermission>> {
  const map = await load();
  return Object.entries(map).map(([origin, p]) => ({ origin, ...p }));
}

// Re-point every connected origin at a new account after the user switches the
// active wallet, so we can emit the matching accountChanged event. Returns the
// affected origins.
export async function updateAllConnectedSol(account: string): Promise<string[]> {
  const map = await load();
  const origins = Object.keys(map);
  for (const o of origins) map[o].account = account;
  if (origins.length) await save(map);
  return origins;
}
