// Must be imported before anything that touches crypto (ethers, vault).
// Hermes has no WebCrypto; expo-crypto provides a CSPRNG backed by the OS.
import { getRandomValues } from "expo-crypto";

// Deliberately loose types: we are patching a global that TS models strictly.
const g = globalThis as Record<string, any>;

if (!g.crypto) g.crypto = {};
if (typeof g.crypto.getRandomValues !== "function") {
  g.crypto.getRandomValues = getRandomValues;
}
