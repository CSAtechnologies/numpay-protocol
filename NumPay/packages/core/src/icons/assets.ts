// Packaged logo asset resolution. The wallet ships its chain/token logos with
// the app (extension: public/chain-logos + public/token-logos; mobile: bundled
// assets) so icons paint with the first frame instead of racing a CDN. The
// platform injects a resolver that turns a packaged path into a loadable URL
// (chrome.runtime.getURL on the extension). Without injection (tests, the
// dapp-test page) paths pass through unchanged; absolute http(s) URLs always
// pass through.

let resolve: (packagedPath: string) => string = (p) => p;
let resolverSet = false;

/** Called once at app startup by the platform layer (see platform.ts). */
export function setAssetUrlResolver(fn: (packagedPath: string) => string): void {
  resolve = fn;
  resolverSet = true;
}

/**
 * Whether the platform packages logo assets (and injected a resolver for them).
 * Icon resolution uses this to skip vendored-local candidates on platforms that
 * don't bundle them (mobile), where the relative path would just 404.
 */
export function hasAssetResolver(): boolean {
  return resolverSet;
}

export function assetUrl(p: string): string {
  if (/^https?:/.test(p)) return p;
  return resolve(p);
}

// Vendored chain logo by our network id. Every chain in NETWORKS/BPAN_CHAINS has
// a file here (base ships as .svg — the post-2025 Square mark; CDNs still serve
// the old circle, which is why it isn't a downloaded .png like the rest).
export function chainLogoAsset(id: string): string {
  return assetUrl(id === "base" ? "chain-logos/base.svg" : `chain-logos/${id}.png`);
}

// Vendored token logo by canonical lowercased symbol slug.
export function tokenLogoAsset(slug: string): string {
  return assetUrl(`token-logos/${slug}.png`);
}
