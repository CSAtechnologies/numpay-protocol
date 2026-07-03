// Packaged logo asset resolution. The wallet ships its chain/token logos inside
// the extension (public/chain-logos, public/token-logos) so icons paint with the
// first frame instead of racing a CDN. This helper turns a packaged path into a
// chrome-extension:// URL; outside an extension context (tests, dapp-test page)
// it returns the path unchanged, and absolute http(s) URLs pass through.
export function assetUrl(p: string): string {
  if (/^https?:/.test(p)) return p;
  try {
    if (typeof chrome !== "undefined" && chrome.runtime?.getURL) return chrome.runtime.getURL(p);
  } catch { /* not in an extension context */ }
  return p;
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
