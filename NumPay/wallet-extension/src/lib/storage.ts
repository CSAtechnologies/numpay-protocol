const IS_EXTENSION = typeof chrome !== "undefined" && !!chrome.storage;

// Persistent storage (chrome.storage.local / localStorage). Survives browser
// restarts and is written to disk. Use ONLY for non-sensitive data and
// encrypted vault material — never for decrypted keys or mnemonics.
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

// In-memory session storage (chrome.storage.session / window.sessionStorage).
// Held in RAM only, never written to disk, and cleared when the browser
// restarts. This is where decrypted wallet material lives while unlocked, so a
// dump of on-disk extension storage never exposes plaintext keys.
const HAS_SESSION = IS_EXTENSION && !!chrome.storage.session;

export async function getSession(key: string): Promise<string | null> {
  if (HAS_SESSION) {
    const result = await chrome.storage.session.get(key);
    return result[key] ?? null;
  }
  if (typeof sessionStorage !== "undefined") return sessionStorage.getItem(key);
  return null;
}

export async function setSession(key: string, value: string): Promise<void> {
  if (HAS_SESSION) {
    await chrome.storage.session.set({ [key]: value });
  } else if (typeof sessionStorage !== "undefined") {
    sessionStorage.setItem(key, value);
  }
}

export async function removeSession(key: string): Promise<void> {
  if (HAS_SESSION) {
    await chrome.storage.session.remove(key);
  } else if (typeof sessionStorage !== "undefined") {
    sessionStorage.removeItem(key);
  }
}
