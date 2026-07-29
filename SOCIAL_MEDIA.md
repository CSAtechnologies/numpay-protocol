# NumPay: Social Media Handle Kit

Everything needed to register and run NumPay's social accounts, pulled from the
project docs (`NUMPAY_DEEP_RESEARCH_HANDOFF_2026-05-22.md`, the `docs/` set,
`CHANGELOG.md`). Copy follows the `CLAUDE.md` output rules: no em-dash, plain
language, no hype, no claims the product cannot back up yet.

A note on language and stage: copy here is in English because NumPay is a
multi-chain crypto product with a global audience and the entire project corpus
is in English. The product is a non-custodial, testnet-only proof of concept, so
nothing below promises returns, custody, fiat, or anything regulated. Keep it
that way until legal sign-off says otherwise.

---

## 1. The one-liner (what NumPay is)

NumPay is a non-custodial crypto wallet and payment-identity system. You receive
funds with a short 11-digit NumPay ID instead of pasting a long chain address.
Keys stay on your device. The backend resolves IDs to verified addresses, it
never holds your keys.

Keep this exact framing across every platform. It is accurate, it is the
positioning agreed in the handoff, and it avoids the traps (it is not a custodial
balance, not a seed phrase, not a password).

---

## 2. Handle

Primary handle to register everywhere, lowercase, no separators:

```
numpay
```

If `numpay` is taken on a platform, use these fallbacks in order. Pick one and
reuse it everywhere you cannot get the primary, so the brand stays consistent:

1. `numpayhq`
2. `getnumpay`
3. `numpayprotocol`
4. `numpay_app`

Display name on every platform: `NumPay`.

Do not register lookalikes that imply custody or yield (`numpaybank`,
`numpayfinance`, `numpayearn`). They invite regulatory and phishing problems and
contradict the non-custodial design.

---

## 3. Bios

### Short bio (X/Twitter, 160 chars, Instagram, TikTok)

```
Non-custodial crypto wallet. Send and receive with a short 11-digit NumPay ID, not a long address. Your keys stay on your device. Multi-chain. In testnet.
```

### Medium bio (LinkedIn tagline, YouTube about line)

```
NumPay is a non-custodial wallet and payment-identity layer. Receive crypto with an 11-digit NumPay ID instead of a long chain address. Keys never leave your device. Currently a testnet proof of concept across Ethereum and Solana, with more chains planned.
```

### Long bio (LinkedIn about, Discord welcome, link-in-bio page)

```
NumPay replaces long, error-prone crypto addresses with a short 11-digit NumPay
ID. Share your number, get paid, across chains.

How it works:
- Non-custodial by design. Your private keys are generated and stored on your
  device, never on our servers.
- The 11-digit ID is a public alias with a built-in checksum, not a seed, a
  password, or a secret.
- The backend resolves an ID to verified, signed address bindings. It cannot
  move your funds.
- Built multi-chain from day one. Ethereum and Solana first, Bitcoin, TRON, and
  XRP planned.

Status: testnet proof of concept. No mainnet, no custody, no fiat rails. Follow
along as we build in the open.
```

---

## 4. Taglines

Use one as a pinned tagline, rotate the rest in posts. All vetted against the
output rules.

- Your number is your wallet.
- Get paid with 11 digits, not 42 characters.
- Short to share. Yours to keep.
- A wallet address you can actually remember.
- Non-custodial. Multi-chain. Human-readable.

---

## 5. What to post and what to avoid

### Safe to post (true today)

- The core concept: 11-digit IDs instead of long addresses.
- Non-custodial architecture and why keys staying local matters.
- Build-in-public progress: testnet milestones, the chain support roadmap
  (ETH and SOL now, BTC, TRON, XRP later).
- Security thinking: checksummed IDs, signed address bindings, the threat model
  (alias poisoning, clipboard attacks, phishing) and how the design resists it.
- Plain explainers of wallet security concepts.

### Do not post (project guardrails)

- No price, yield, returns, or "investment" language. NumPay is a wallet, not a
  financial product.
- No custody, fiat on/off ramp, card, or swap claims. Those are explicitly out of
  scope for v1.
- No mainnet or "live with real funds" messaging while it is a testnet PoC.
- No jurisdiction or regulatory claims.
- Never imply the 11-digit ID is secret, a password, or a recovery method. It is
  a public alias only. This is a security message, repeat it often.
- No mnemonic, private key, or seed shown in any screenshot, ever.

---

## 6. Visual identity

- Profile picture: `Numpay Logo.png` (2000 x 2000 square, fits every avatar slot).
- Keep the logo on its own background. Do not stretch or recolor it.
- Banner copy suggestion: `Your number is your wallet.` over a clean background.

---

## 7. Links and contact

- Website: https://numpay.app (placeholder domain used across the project docs,
  confirm registration before publishing).
- Email handle to set up to match: `hello@numpay.app` or `support@numpay.app`.
- Use a single link-in-bio page that points to the site and the other socials so
  every profile cross-links.

---

## 8. Platform checklist

Register the same handle and identity on each, in priority order:

| Platform | Handle | Notes |
|---|---|---|
| X / Twitter | `numpay` | Primary channel for build-in-public crypto audience. Pin the one-liner. |
| Discord | `NumPay` server | Community and support. Add the long bio as the welcome. |
| Telegram | `numpay` | Announcement channel plus group. Common for crypto. |
| GitHub | `numpay` org | Mirrors the open build. Link from every profile. |
| LinkedIn | `NumPay` page | Use medium and long bios. Recruiting and partnerships. |
| YouTube | `@numpay` | Demos and explainers. |
| Instagram | `numpay` | Visual explainers, reels. |
| TikTok | `numpay` | Short security and how-it-works clips. |
| Farcaster | `numpay` | Native crypto audience. |
| Reddit | `r/numpay` | Community discussion. |

For each: set the avatar to the logo, the display name to `NumPay`, the bio to
the right-sized version above, and the link to https://numpay.app. Reserve the
fallback handle on any platform where `numpay` is taken, then note which platform
got which handle so the team keeps it straight.
