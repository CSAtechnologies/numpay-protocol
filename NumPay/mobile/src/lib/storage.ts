// Persistence for ENCRYPTED data only (AsyncStorage holds ciphertext, same
// trust model as the extension's chrome.storage.local). Decrypted material
// lives in module memory only and dies with the app process.
import AsyncStorage from "@react-native-async-storage/async-storage";

export async function getItem(key: string): Promise<string | null> {
  return AsyncStorage.getItem(key);
}

export async function setItem(key: string, value: string): Promise<void> {
  await AsyncStorage.setItem(key, value);
}

export async function removeItem(key: string): Promise<void> {
  await AsyncStorage.removeItem(key);
}

// In-memory session (never persisted).
const session = new Map<string, string>();

export function getSession(key: string): string | null {
  return session.get(key) ?? null;
}

export function setSession(key: string, value: string): void {
  session.set(key, value);
}

export function removeSession(key: string): void {
  session.delete(key);
}
