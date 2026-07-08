import { getItem, setItem } from "./storage";

export interface CustomToken {
  id: string;
  chainId: string;
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logo?: string;
}

const KEY = "numpay_custom_tokens";

export async function getCustomTokens(): Promise<CustomToken[]> {
  try {
    const raw = await getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomToken[];
  } catch { return []; }
}

export async function addCustomToken(token: Omit<CustomToken, "id">): Promise<CustomToken> {
  const list = await getCustomTokens();
  const newToken: CustomToken = { ...token, id: `ct_${Date.now()}` };
  await setItem(KEY, JSON.stringify([...list, newToken]));
  return newToken;
}

/**
 * Add or replace (matched by chain + address, case-insensitive). The Swap
 * import flow uses this instead of writing the storage key directly, which
 * used to persist a different shape (SwapToken with a stale balance snapshot,
 * no id) into this list — two writers, two schemas, one key. Replacing by
 * chain+address also heals any legacy id-less entry when it is re-imported.
 */
export async function upsertCustomToken(token: Omit<CustomToken, "id">): Promise<CustomToken> {
  const list = await getCustomTokens();
  const rest = list.filter(
    (t) => !(t.chainId === token.chainId && t.address?.toLowerCase() === token.address.toLowerCase()),
  );
  const newToken: CustomToken = { ...token, id: `ct_${Date.now()}` };
  await setItem(KEY, JSON.stringify([...rest, newToken]));
  return newToken;
}

export async function removeCustomToken(id: string): Promise<void> {
  const list = await getCustomTokens();
  await setItem(KEY, JSON.stringify(list.filter((t) => t.id !== id)));
}
