// Platform-injected key-value storage.
//
// Core never touches a platform storage API directly. Each app injects its own
// backends at startup via initCorePlatform() (see platform.ts): the extension
// wires chrome.storage.local/session, mobile wires MMKV + Keystore-gated
// storage. Outside any injection (tests, the dapp-test page) the defaults fall
// back to localStorage/sessionStorage when present, else plain memory, which
// preserves the old non-extension behavior.

export interface KVStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

function webStore(area: Storage): KVStore {
  return {
    async get(key) { return area.getItem(key); },
    async set(key, value) { area.setItem(key, value); },
    async remove(key) { area.removeItem(key); },
  };
}

function memStore(): KVStore {
  const map = new Map<string, string>();
  return {
    async get(key) { return map.get(key) ?? null; },
    async set(key, value) { map.set(key, value); },
    async remove(key) { map.delete(key); },
  };
}

let persistent: KVStore =
  typeof localStorage !== "undefined" ? webStore(localStorage) : memStore();
let session: KVStore =
  typeof sessionStorage !== "undefined" ? webStore(sessionStorage) : memStore();

/** Called once at app startup by the platform layer. */
export function setStorageBackends(p: KVStore, s: KVStore): void {
  persistent = p;
  session = s;
}

// Persistent storage. Survives restarts and is written to disk. Use ONLY for
// non-sensitive data and encrypted vault material — never for decrypted keys
// or mnemonics.
export async function getItem(key: string): Promise<string | null> {
  return persistent.get(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  return persistent.set(key, value);
}

export async function removeItem(key: string): Promise<void> {
  return persistent.remove(key);
}

// Session storage. Held in RAM only, never written to disk, and cleared when
// the app/browser restarts. This is where decrypted wallet material lives
// while unlocked, so a dump of on-disk storage never exposes plaintext keys.
// The injected backend MUST honor that contract (chrome.storage.session on
// the extension; an in-memory store on mobile).
export async function getSession(key: string): Promise<string | null> {
  return session.get(key);
}

export async function setSession(key: string, value: string): Promise<void> {
  return session.set(key, value);
}

export async function removeSession(key: string): Promise<void> {
  return session.remove(key);
}
