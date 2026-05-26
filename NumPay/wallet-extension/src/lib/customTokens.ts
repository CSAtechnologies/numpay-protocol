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

export async function removeCustomToken(id: string): Promise<void> {
  const list = await getCustomTokens();
  await setItem(KEY, JSON.stringify(list.filter((t) => t.id !== id)));
}
