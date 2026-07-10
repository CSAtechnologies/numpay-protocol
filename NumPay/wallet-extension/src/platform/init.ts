// Extension platform wiring for @numpay/core. Import this FIRST in every
// bundle entry that uses core (popup main, approval main, background index).
// "./env" must be the first import here: it sets the API-key global that core
// modules read at evaluation time.

import "./env";
import { initCorePlatform, type KVStore } from "@numpay/core";

const local: KVStore = {
  async get(key) {
    const r = await chrome.storage.local.get(key);
    return (r[key] as string | undefined) ?? null;
  },
  async set(key, value) {
    await chrome.storage.local.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.local.remove(key);
  },
};

// RAM-only by contract (decrypted wallet material while unlocked): backed by
// chrome.storage.session, which is cleared on browser restart.
const session: KVStore = {
  async get(key) {
    const r = await chrome.storage.session.get(key);
    return (r[key] as string | undefined) ?? null;
  },
  async set(key, value) {
    await chrome.storage.session.set({ [key]: value });
  },
  async remove(key) {
    await chrome.storage.session.remove(key);
  },
};

initCorePlatform({
  storage: local,
  session,
  assetUrl: (p) => chrome.runtime.getURL(p),
});
