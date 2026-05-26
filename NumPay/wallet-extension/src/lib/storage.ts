const IS_EXTENSION = typeof chrome !== "undefined" && chrome.storage;

export async function getItem(key: string): Promise<string | null> {
  if (IS_EXTENSION) {
    const result = await chrome.storage.local.get(key);
    return result[key] ?? null;
  }
  return localStorage.getItem(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  if (IS_EXTENSION) {
    await chrome.storage.local.set({ [key]: value });
  } else {
    localStorage.setItem(key, value);
  }
}

export async function removeItem(key: string): Promise<void> {
  if (IS_EXTENSION) {
    await chrome.storage.local.remove(key);
  } else {
    localStorage.removeItem(key);
  }
}
