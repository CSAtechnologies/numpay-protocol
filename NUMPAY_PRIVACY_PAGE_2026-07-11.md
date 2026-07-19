# NumPay Privacy Page (draft for publication)

**Status:** draft, 2026-07-11. Publish before public launch; required by the
compliance posture (Section 6.1) because the wallet API already serves real
address queries. Chrome Web Store also requires a privacy policy URL at listing
time. Review by counsel together with the rest of
`NUMPAY_COMPLIANCE_POSTURE_2026-07-01.md`.

Everything below the line is the public text. Plain language on purpose: the
audience is users, not lawyers. Keep claims exactly as strong as the
implementation and no stronger.

---

# Privacy at NumPay

NumPay is a non-custodial wallet. Your keys are generated on your device,
encrypted on your device, and never leave it. We cannot access your funds, and
we built the rest of NumPay to know as little about you as the product allows.

## What we never have

- Your seed phrase, private keys, or PIN. They exist only on your device.
- An account. There is no signup, no email, no phone number.
- Trackers. The wallet contains no analytics SDKs, no advertising identifiers,
  and no third-party scripts.

## What our servers see, and for how long

When the wallet shows your balances and token prices, it asks our API
(`numpay-wallet-api`) instead of calling data providers directly. That server
relays the query and forgets it:

- **Wallet addresses.** A balance query naturally contains the address being
  queried. The answer is cached for a few minutes so repeated queries are
  fast, then it expires. We keep no database of addresses and no log that pairs
  an address with who asked.
- **IP addresses.** Any server you connect to sees your IP. We do not log it
  alongside your queries. It is used only in the moment, to protect the service
  from abuse (rate limiting).
- **A random install ID.** The wallet generates a random identifier on your
  device, used only to rate-limit requests fairly. It is not derived from your
  addresses and we never store it together with them. Reinstalling the wallet
  generates a new one.

In short: our API relays balance and price queries and does not retain them.

## What stays on your device

- Your encrypted vault (keys and settings).
- Your transaction activity view, token preferences, address book, and hidden
  tokens. These are wallet features, not server records.

## Third parties the wallet talks to

To show balances and send transactions, the wallet communicates with public
blockchain infrastructure (RPC nodes) and, through our API, with market data
providers. These services see the queries needed to answer (an address, a
transaction). They do not receive your name, because we do not have it.

Swaps and bridges are executed by third-party protocols you choose in the
moment. Their processing is governed by their terms, shown before you confirm.

## The BPAN directory

If you register a NumPay ID (BPAN), you are asking us to publish a mapping from
that ID to wallet addresses so others can pay you by number. That mapping is
personal data and is covered by its own section of the full privacy policy,
including how to remove it. [To be completed together with the BPAN policy
section before BPAN registration opens publicly.]

## Your rights

Under the Nigeria Data Protection Act and the GDPR you have rights over
personal data we process. For the wallet API there is nothing at rest to
disclose or erase: queries expire from cache within minutes and no profile of
you exists. For the BPAN directory, removal and correction work as described in
that section. Questions or requests: [contact email].

## Changes

We will update this page when data flows change, and the wallet's release notes
will say so. Material changes will never be silent.

---

**Publication notes (not part of the public text):**

- [contact email] must be a monitored address before publishing (NDPA breach
  and data-subject request handling both route through it).
- The BPAN placeholder paragraph must be replaced before BPAN registration is
  public; see compliance doc Section 6 checklist.
- Keep the "a few minutes" cache claim in sync with the worker's
  `FRESH_SECONDS` (300 s for tokens since 2026-07-11; prices use 5-minute KV
  entries). Revisit the wording if any TTL grows past roughly ten minutes.
- No em-dash or separator en-dash anywhere in the published text (house output
  rule); verified for this draft.
