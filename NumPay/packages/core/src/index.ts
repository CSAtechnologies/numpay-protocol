// @numpay/core — shared wallet core consumed by the extension and mobile.
// Apps import feature modules by subpath ("@numpay/core/networks",
// "@numpay/core/chains", ...); this root entry only exposes the platform
// injection surface every app needs at boot.

export { initCorePlatform, type CorePlatform } from "./platform";
export { type KVStore } from "./storage";
export { type NumpayEnv } from "./env";
