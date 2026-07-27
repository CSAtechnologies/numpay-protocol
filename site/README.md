# NumPay marketing site

The public site for NumPay, a non-custodial multi-chain wallet where an
11-digit NumPay ID stands in for a long blockchain address.

Static, single page, no build step. Open `index.html` or serve the folder:

```
python -m http.server 8000
```

## Layout

```
index.html              the whole page
numpay/site.css         styles, light-first with a dark theme
numpay/site.js          chain grid, marquee, FAQ, mobile menu, theme toggle
numpay/theme-init.js    sets the theme before first paint, loaded in <head>
numpay/fonts/           self-hosted Geist, Geist Mono, Instrument Serif
numpay/icons/           Phosphor subset, only the 34 glyphs the page uses
numpay/chains/          chain and token logos
```

The page makes no third-party requests. Fonts and icons are self-hosted, so
there is nothing to block and nothing tracking visitors.

## Editing content

The chain list, the FAQ and the marquee are all rendered from arrays at the
top of `numpay/site.js`, not written into the HTML.

The `CHAINS` array must only ever list networks the wallet actually supports.
Advertising a chain that does not ship is a real problem on a financial
product, not a copy detail.

## Regenerating logos

`numpay/build-chain-logos.js` pulls the chain and token art from the wallet's
vendored set and downscales it for web use. Only needed when a logo changes
or a chain is added. See the header of that file for how to run it.

## Deploying

Live at <https://numpay-site.pages.dev> on Cloudflare Pages:

```
wrangler pages deploy site --project-name=numpay-site --branch=main
```

Cloudflare rather than GitHub Pages because GitHub's Pages addresses turned
out to be unreachable from Nigerian mobile networks, which is a launch market.
Cloudflare has an edge node in Lagos.

This repo is generated from the `site/` directory of the main NumPay repo via
`git subtree`, so changes should be made there and pushed out, not committed
here directly. The GitHub Pages copy is left running as a mirror; both serve
the same files, and every page names the Cloudflare URL as its canonical.
