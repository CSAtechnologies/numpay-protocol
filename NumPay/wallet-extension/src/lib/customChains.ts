import { getItem, setItem } from "./storage";

export interface CustomChain {
  id: string;
  name: string;
  chainId: number;
  rpcUrl: string;
  symbol: string;
  decimals: number;
  explorer: string;
  logo?: string;
}

const KEY = "numpay_custom_chains";

export async function getCustomChains(): Promise<CustomChain[]> {
  try {
    const raw = await getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as CustomChain[];
  } catch { return []; }
}

export async function saveCustomChain(chain: CustomChain): Promise<void> {
  const list = await getCustomChains();
  const idx = list.findIndex((c) => c.id === chain.id);
  if (idx >= 0) list[idx] = chain;
  else list.push(chain);
  await setItem(KEY, JSON.stringify(list));
}

export async function removeCustomChain(id: string): Promise<void> {
  const list = await getCustomChains();
  await setItem(KEY, JSON.stringify(list.filter((c) => c.id !== id)));
}
