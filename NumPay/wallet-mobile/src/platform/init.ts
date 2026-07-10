// Mobile platform wiring for @numpay/core (mirror of the extension's
// src/platform/init.ts). Import this AFTER polyfills.ts (which sets
// __NUMPAY_ENV__) and BEFORE anything that uses core storage.
//
// - Persistent KVStore: MMKV. Non-sensitive data and encrypted vault material
//   only — the vault data key lives in expo-secure-store (Android Keystore),
//   never here.
// - Session KVStore: plain in-memory Map, so decrypted wallet material never
//   touches disk and vanishes when the process dies (the RAM-only contract
//   from core/platform.ts).

import { createMMKV } from "react-native-mmkv";
import { initCorePlatform, type KVStore } from "@numpay/core";

const mmkv = createMMKV({ id: "numpay" });

const storage: KVStore = {
  async get(key) { return mmkv.getString(key) ?? null; },
  async set(key, value) { mmkv.set(key, value); },
  async remove(key) { mmkv.remove(key); },
};

const sessionMap = new Map<string, string>();
const session: KVStore = {
  async get(key) { return sessionMap.get(key) ?? null; },
  async set(key, value) { sessionMap.set(key, value); },
  async remove(key) { sessionMap.delete(key); },
};

initCorePlatform({ storage, session });
