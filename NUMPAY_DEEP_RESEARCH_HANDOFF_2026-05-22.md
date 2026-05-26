# NUMPAY Deep Research Handoff

Date: 2026-05-22
Mode: RESEARCH
Audience: Claude Web and Claude Code
Project codename: NUMPAY
Primary goal: Secure Phantom-inspired wallet and payment system using 11-digit numeric identifiers instead of long address-first UX.

## TLDR

1. NUMPAY should be designed as a non-custodial wallet first. The backend may route aliases and payment intents, but must never hold user private keys.
2. The 11-digit number must be a public alias, not a seed, password, private key, authentication factor, or source of entropy.
3. Phantom is best understood as a secure local key vault plus wallet provider interface, not just a UI. Phantom stores keys locally in an encrypted vault, uses recovery phrases and private keys, and exposes provider APIs for dApps.
4. Recommended v1 architecture: browser extension plus web payment app, TypeScript full stack, local encrypted key vault, Postgres alias registry, Redis rate limits, RPC abstraction, strict security headers, and signed alias binding proofs.
5. The first supported networks should be ETH, SOL, BTC, TRON, and XRP, but with a chain abstraction layer based on CAIP-2 and CAIP-10 so more networks can be added later.
6. The highest project risks are not UI or chain integration. They are key theft, alias poisoning, address substitution, phishing, clipboard attacks, malicious dApp signing, extension injection bugs, supply-chain compromise, and regulatory scope creep.
7. The PoC should prove only 5 things first: secure local vault, alias registration, address binding signatures, chain-specific send flow, and attack-resistant resolution.

## Research boundaries and assumptions

### Verified boundaries

- Phantom is not fully open source in a way that allows a complete internal architecture audit from source code.
- This document is therefore based on official Phantom user and developer documentation, wallet standards, browser extension platform docs, OWASP/CISA security guidance, chain documentation, and current academic research on wallet extension vulnerabilities.
- The design below is "Phantom-inspired", not a clone of Phantom.

### Key assumption for v1

NUMPAY is non-custodial.

That means:
- User keys are generated on the client.
- Private keys never touch the NUMPAY backend.
- The backend resolves NUMPAY numbers to verified receiving addresses and payment intents.
- Signing happens locally in the extension or app.
- The backend can be compromised without directly stealing wallet keys.

If the business later wants custodial balances, fiat on/off ramp, managed private keys, or card-style payment rails, this becomes a regulated financial product and needs a separate legal and compliance architecture.

## Imported working principles from attached file

The attached `CLAUDE_WORKING_PRINCIPLES.md` should be treated as a project constraint.

Apply these parts directly:
- TLDR at the top of every research or implementation report.
- Separate verified facts, opinions, assumptions, and unknowns.
- Prefer primary sources before blogs.
- Provide multiple options and rank them.
- Include PoC, rollback, impact analysis, and test plan.
- For critical security or money-handling code, use a final sanity check before delivery.
- Do not use em dash or separator en dash in customer-facing output.

## What Phantom teaches us

### Phantom user-side security model

Verified from official Phantom help documentation:
- Phantom wallet assets are on-chain, not stored inside the Phantom app.
- Phantom stores the keys and recovery data needed to access assets.
- Phantom private keys are stored locally on the user device.
- Phantom uses an encrypted vault that can be unlocked using password or biometrics.
- Phantom does not store recovery phrases or private keys for standard non-custodial wallets.
- Losing the recovery phrase or private key can make the wallet unrecoverable.
- Phantom uses a 12-word BIP-39 recovery phrase for standard recovery phrase wallets.
- Phantom supports multiple chains, including Solana, Ethereum, Base, Polygon, Sui, Monad, Bitcoin, and HyperEVM as of current public docs.
- For multi-chain setup, Phantom documents that Ethereum, Base, Polygon, and Monad share the same private key per account, while Solana, Bitcoin, and Sui use unique keys per account.

### Phantom developer-side model

Verified from Phantom developer documentation:
- Phantom provides browser SDKs and injected providers.
- For Solana, Phantom can be integrated through the injected provider under `window.phantom` or through the Solana Wallet Adapter.
- Phantom's Browser SDK is TypeScript-oriented and emphasizes that apps do not handle user private keys.
- Phantom Connect and SDK docs describe chain-specific wallet APIs for Solana and Ethereum.
- Phantom's integration model is wallet-controlled. The dApp sends a request. The wallet prompts the user. The wallet signs locally.

### Lessons for NUMPAY

NUMPAY should copy the security shape, not the exact product:
- Local encrypted vault.
- User-owned keys.
- Explicit transaction approval.
- Human-readable transaction review.
- dApp origin and domain display.
- Clear connected app permissions.
- No private key handling in the web app or backend.
- Extension isolation between web page, content script, background/service worker, and popup.

## NUMPAY core concept

### What NUMPAY is

NUMPAY is a wallet and payment identity system where a user can receive funds using an 11-digit number instead of exposing long chain addresses by default.

Example display:

```text
NUMPAY ID: 123 456 789 03
```

Internally, this should resolve to chain-specific address bindings:

```json
{
  "numpay_id": "12345678903",
  "display_name": "Thomas",
  "verified_profile_hash": "optional",
  "addresses": [
    {
      "chain_id": "eip155:1",
      "account_id": "eip155:1:0xabc...",
      "asset_support": ["ETH", "USDC-ERC20"],
      "binding_status": "verified"
    },
    {
      "chain_id": "solana:mainnet",
      "account_id": "solana:mainnet:9xQeWv...",
      "asset_support": ["SOL", "USDC-SPL"],
      "binding_status": "verified"
    }
  ]
}
```

### What NUMPAY is not

NUMPAY must not be:
- A way to derive private keys from 11 digits.
- A replacement for seed phrases.
- A password.
- A recovery code.
- A secret.
- A public endpoint that dumps all linked addresses without rate limits.
- A custodial ledger unless a separate regulated product is intentionally created.

## 11-digit number design

### Recommended format

Use exactly 11 digits:

```text
DDDDDDDDDDC
```

Where:
- `D` = 10 random numeric payload digits.
- `C` = 1 checksum digit using Verhoeff or Luhn mod 10.
- Display format: `123 456 789 03`.
- Storage format: `12345678903`.

### Why this works

- 11 digits are short enough for humans.
- Checksum catches many typing mistakes.
- 10 random payload digits provide 10,000,000,000 possible assignable IDs.
- The number is not secret, so the entropy is for uniqueness and enumeration resistance only, not authentication.

### Calculation

If using 10 payload digits plus 1 checksum digit:

```text
Assignable IDs = 10^10 = 10,000,000,000
If 1,000,000 users exist:
Assigned density = 1,000,000 / 10,000,000,000 = 0.0001 = 0.01%
```

This is acceptable for public alias allocation, but not acceptable for authentication.

### Collision handling

Use random allocation with database uniqueness:

```text
1. Generate 10 random digits using CSPRNG.
2. Compute checksum digit.
3. Insert into database with unique constraint.
4. On collision, retry.
```

Do not issue sequential numbers. Sequential numbers create easy enumeration and make the product feel like old banking infrastructure.

### Privacy warning

A public numeric identifier can be enumerated. Controls required:
- Rate limit resolution endpoints.
- Do not reveal whether an ID exists through timing differences.
- Use generic error messages.
- Require sender-side app interaction for high-volume lookups.
- Use signed payment intents instead of exposing all addresses by default.
- Offer one-time payment codes for privacy-sensitive users.
- Do not link NUMPAY IDs to phone numbers unless the user explicitly opts in.

## Core product flows

### Flow 1: Create wallet

1. User installs NUMPAY extension or opens app.
2. User creates a wallet.
3. App generates entropy client-side.
4. App creates BIP-39 mnemonic or chain-specific key material.
5. App encrypts key vault with a strong KDF.
6. User confirms recovery phrase or recovery method.
7. App derives addresses for enabled networks.
8. User registers a NUMPAY ID.
9. Each derived address signs a binding challenge proving ownership.
10. Backend stores only public bindings and signatures.

### Flow 2: Receive payment by number

1. Sender enters `12345678903`.
2. App validates checksum locally.
3. Sender chooses chain and asset.
4. App asks backend for a payment intent for that chain and asset.
5. Backend returns recipient display data, chain, address, amount if specified, expiry, and signature.
6. Sender wallet shows a clear review screen.
7. User approves.
8. Transaction is signed locally and broadcast.
9. Backend watches chain or sender reports tx hash.
10. Recipient gets notification after confirmation.

### Flow 3: Send to external address

1. User pastes a chain address.
2. App detects chain format where possible.
3. App warns if format is ambiguous.
4. App validates checksum or address rules.
5. User confirms network and asset.
6. Local wallet signs transaction.
7. App broadcasts via selected RPC provider.

### Flow 4: Connect to dApp

1. dApp detects NUMPAY provider.
2. NUMPAY announces provider using proper chain-specific standards.
3. User approves connection per origin and per chain.
4. dApp can request account address and transaction signing.
5. NUMPAY shows origin, domain, chain, method, amount, destination, token approvals, and risk warnings.
6. User approves or rejects.

## Protocol and chain support

### Standards to use

Use these standards where applicable:
- CAIP-2 for blockchain network identifiers.
- CAIP-10 for account identifiers.
- EIP-1193 for Ethereum provider API.
- EIP-6963 for multi-injected Ethereum provider discovery.
- BIP-39 for mnemonic phrase generation.
- BIP-32 and BIP-44 for hierarchical deterministic wallet paths where applicable.
- SLIP-44 coin types for multi-chain derivation registry.
- Solana Wallet Adapter and Solana Pay patterns for Solana.
- WalletConnect only as an optional bridge, not as the core wallet security model.

### Chain table for v1

| Chain | Primary asset | Signing curve | Address model | Recommended v1 support | Notes |
|---|---:|---|---|---|---|
| Ethereum | ETH | secp256k1 | Account-based EVM address | Full | Use EIP-1193, EIP-155, EIP-712, viem or ethers. |
| Solana | SOL | Ed25519 | Account-based public key | Full | Use Solana Wallet Standard / Wallet Adapter. |
| Bitcoin | BTC | secp256k1 | UTXO | Receive and send basic first | Use Native SegWit first. Taproot later. UTXO coin selection adds complexity. |
| TRON | TRX | secp256k1 | Account-based TRON address | Basic send and receive | TronLink docs show create, sign, broadcast flow. USDT TRC-20 is likely important. |
| XRP Ledger | XRP | secp256k1 or Ed25519 depending account | Account plus optional destination tag | Basic send and receive | Destination tags and X-addresses need careful UX. |

### Derivation path baseline

Use these as starting points, then verify against chosen libraries and hardware wallet behavior:

| Chain | Common path |
|---|---|
| BTC Native SegWit | `m/84'/0'/0'/0/0` |
| ETH | `m/44'/60'/0'/0/0` |
| SOL | `m/44'/501'/0'/0'` |
| TRON | `m/44'/195'/0'/0/0` |
| XRP | `m/44'/144'/0'/0/0` |

Do not hardcode only one path forever. Store derivation metadata per account so imports and future compatibility can be handled.

## Architecture options

### Option A: Extension-first non-custodial wallet

Score: 88/100

Use:
- Chrome/Brave/Edge extension using Manifest V3.
- React and TypeScript popup.
- Background service worker.
- Content script bridge.
- Local encrypted vault.
- NUMPAY web app for dashboard and payment flows.
- Backend only for alias registry, payment intents, risk checks, notifications, and RPC abstraction.

Pros:
- Closest to Phantom and MetaMask security model.
- Best dApp integration path.
- Private keys can remain local.
- Easier to block web app XSS from directly touching keys.

Cons:
- Extension development is harder than web-only.
- Browser store review and extension supply-chain risk.
- Manifest V3 service worker lifecycle must be handled carefully.

Recommendation:
Use this for v1.

### Option B: Web-only wallet with encrypted local vault

Score: 60/100

Use:
- Next.js or Vite web app.
- Encrypted vault stored in IndexedDB.
- WebAuthn/passkey unlock.
- No extension at first.

Pros:
- Fastest to prototype.
- Good for internal demos.
- Simple deployment.

Cons:
- Higher XSS risk because web app runtime can access the vault after unlock.
- Poor dApp integration.
- More phishing risk.
- Harder to guarantee trusted UI for transaction approval.

Recommendation:
Use only as PoC if extension build is too slow.

### Option C: Mobile-first wallet

Score: 78/100

Use:
- React Native or native iOS/Android.
- Secure Enclave / Keychain / Keystore.
- Push notifications.
- QR payments.

Pros:
- Stronger device key storage.
- Better payment UX.
- Easier camera QR flow.

Cons:
- Slower development.
- App store review.
- Multi-chain signing libraries are more complex in mobile.

Recommendation:
Plan as v2 after extension PoC.

### Option D: Custodial payment app

Score: 35/100 for v1

Use:
- Server controlled wallets.
- Internal ledger.
- KYC/AML.
- Compliance infrastructure.

Pros:
- Familiar payment app UX.
- Password recovery possible.
- Easier internal transfers.

Cons:
- Highest legal and operational risk.
- Server compromise can drain funds.
- Requires custody, segregation, audits, monitoring, and possibly licensing.
- Not aligned with Phantom-inspired self-custody model.

Recommendation:
Do not use for v1.

## Recommended technical stack

### Frontend and extension

- TypeScript.
- React.
- Vite.
- Tailwind CSS.
- shadcn/ui or Radix primitives.
- Zustand or Jotai for local UI state.
- React Hook Form and Zod for forms.
- Browser extension Manifest V3.
- WebCrypto for encryption primitives where suitable.
- Carefully selected crypto libraries for chain signing.

### Wallet and chain libraries

Potential libraries to evaluate, not blindly adopt:
- `viem` for EVM transactions and RPC.
- `ethers` as secondary EVM reference.
- `@solana/web3.js` and Solana wallet standards.
- `bitcoinjs-lib` or `scure-btc-signer` for BTC.
- `xrpl` for XRP Ledger.
- `tronweb` for TRON.
- `@noble/secp256k1`, `@noble/ed25519`, `@noble/hashes` for low-level audited primitives where needed.
- `bip39`, `bip32`, or `@scure/bip39`, `@scure/bip32`.

Security note:
Do not mix low-level crypto libraries casually. Pick one approach per chain, pin versions, audit dependencies, and write test vectors.

### Backend

Recommended:
- NestJS with TypeScript for same-language full stack.
- PostgreSQL for durable data.
- Redis for rate limits, nonce storage, payment intent locks, and queue state.
- Prisma or Drizzle ORM.
- OpenAPI spec generation.
- Worker queue for chain monitoring and notifications.
- RPC provider abstraction with fallback providers.
- Structured logging with Pino or OpenTelemetry.

Alternative:
- FastAPI if the dev team strongly prefers Python.

### Infrastructure

- Local-first repository during early research, as requested.
- Docker Compose for local dev.
- Postgres local container.
- Redis local container.
- No public GitHub dependency for project storage.
- Cloudflare or equivalent WAF in production.
- TLS everywhere.
- Separate staging and production.
- Secrets in environment manager or local sealed files, never in repo.

### Database core tables

```sql
users
  id uuid primary key
  created_at timestamptz
  status text

numpay_aliases
  id uuid primary key
  user_id uuid references users(id)
  numpay_id char(11) unique not null
  checksum_valid boolean not null
  status text not null
  created_at timestamptz

wallet_accounts
  id uuid primary key
  user_id uuid references users(id)
  account_label text
  custody_model text
  created_at timestamptz

address_bindings
  id uuid primary key
  alias_id uuid references numpay_aliases(id)
  wallet_account_id uuid references wallet_accounts(id)
  chain_id text not null
  account_id text not null
  address text not null
  derivation_path text
  public_key text
  proof_signature text not null
  proof_message text not null
  status text not null
  created_at timestamptz

payment_intents
  id uuid primary key
  sender_user_id uuid null
  recipient_alias_id uuid references numpay_aliases(id)
  chain_id text not null
  asset_id text not null
  amount_numeric numeric null
  recipient_account_id text not null
  expires_at timestamptz not null
  server_signature text not null
  status text not null
  created_at timestamptz

transactions
  id uuid primary key
  payment_intent_id uuid references payment_intents(id)
  chain_id text not null
  tx_hash text
  from_address text
  to_address text
  amount_numeric numeric
  status text
  confirmations int
  created_at timestamptz
```

## Security architecture

### Security principle 1: local keys only

Private key material must never be sent to:
- Backend.
- Analytics.
- Logs.
- Error reporting.
- Browser page context.
- dApp content script.
- Cloud sync in v1.

### Security principle 2: separate trust zones

Trust zones:
1. Web page context: untrusted.
2. Content script: semi-trusted bridge.
3. Extension background/service worker: trusted controller.
4. Extension popup/fullscreen approval UI: trusted UI.
5. Local encrypted vault: high sensitivity.
6. Backend: untrusted for custody, trusted for alias availability only.
7. RPC providers: untrusted data source, verify where possible.

### Security principle 3: signed address bindings

When a user binds an address to a NUMPAY ID, require a challenge signature.

Example challenge:

```text
NUMPAY address binding
Alias: 12345678903
Chain: eip155:1
Address: 0xabc...
Issued at: 2026-05-22T00:00:00Z
Nonce: random-128-bit
Purpose: register-address-binding
```

Store:
- Challenge text.
- Signature.
- Public key/address.
- Verification result.
- Chain ID.
- Timestamp.

Do not let users manually type an address and call it verified without proof.

### Security principle 4: signed payment intents

The backend should sign payment intent payloads so the extension can detect tampering.

Payload example:

```json
{
  "intent_id": "uuid",
  "numpay_id": "12345678903",
  "chain_id": "eip155:1",
  "asset_id": "native:ETH",
  "recipient": "0xabc...",
  "amount": "0.05",
  "expires_at": "2026-05-22T12:00:00Z"
}
```

The extension must verify:
- Server signature.
- Domain of the resolver.
- Chain selected by user.
- Recipient displayed to user.
- Expiry.
- Nonce uniqueness.

### Security principle 5: human-readable signing

Every signing request must show:
- Origin domain.
- Request type.
- Chain.
- Asset.
- Amount.
- Recipient.
- Fee estimate.
- Contract address if token transfer.
- Approval allowance if token approval.
- Whether transaction is a simple transfer, token approval, swap, contract call, or unknown method.
- Warnings for unlimited approvals.
- Warnings for new or suspicious contracts.

### Security principle 6: transaction simulation where possible

For EVM:
- Simulate `eth_call` where possible before signing.
- Decode ERC-20 transfers and approvals.
- Estimate gas.
- Display balance changes where possible.

For Solana:
- Simulate transaction through RPC where possible.
- Decode program IDs and known instructions.
- Warn for unknown programs.

For BTC:
- Show UTXO inputs, recipient outputs, change output, and fee.
- Protect against address replacement and change address confusion.

For TRON:
- Decode TRX and TRC-20 transfer details.
- Show bandwidth and energy impact where possible.

For XRP:
- Show destination tag if present.
- Warn if destination tag is required but missing when sending to known hosted accounts.
- Consider X-address support.

## Threat model

### High-priority threats

| Threat | Impact | Required mitigation |
|---|---:|---|
| Private key exfiltration | Critical | Local encrypted vault, no keys in backend, no keys in page context, dependency audit. |
| Seed phrase phishing | Critical | Never ask for seed after setup except recovery/export screen, warning UI, domain education. |
| Alias poisoning | Critical | Signed address binding, visible recipient profile, server signatures, audit log. |
| Address substitution | Critical | Payment intent signature, copy/paste detection, confirmation screen. |
| Malicious dApp signing | Critical | Origin display, method decoding, simulation, risk rules, per-origin permissions. |
| Unlimited token approvals | High | Decode approvals, default to exact approval, warning for unlimited. |
| Clickjacking | High | CSP frame-ancestors, X-Frame-Options, trusted extension approval UI. |
| XSS in web app | High | Strict CSP, no inline scripts, output encoding, no key access in web app. |
| CSRF | High | SameSite cookies, CSRF tokens, origin checks, no state changes via GET. |
| API enumeration | High | Redis rate limits, generic errors, no public bulk lookup, abuse detection. |
| RPC provider manipulation | High | Multiple RPC providers, sanity checks, simulation warnings. |
| Supply-chain attack | Critical | Lockfiles, dependency pinning, package provenance checks, SCA tooling. |
| Malicious extension update | Critical | Release signing, reproducible build plan, minimal permissions. |
| Clipboard hijacking | High | Detect pasted addresses, address book confirmation, display full/partial address. |
| Log leakage | High | Redaction, no sensitive fields, structured logging policy. |
| Regulatory scope creep | High | Keep v1 non-custodial and no fiat custody. Legal review before payments marketing. |

### Browser extension risks

Official Chrome docs describe content scripts as isolated from the page by default, but also warn that using main-world scripts allows host pages to access or interfere with injected script behavior. NUMPAY should minimize main-world code and keep only a thin provider shim there.

Required controls:
- Manifest V3 only.
- Minimal permissions.
- No `<all_urls>` unless justified.
- No remote code execution.
- No `eval`.
- No remotely hosted scripts.
- Isolated content scripts by default.
- Main-world injection only for provider shim.
- Strict message validation between page, content script, background, and popup.
- Request IDs and nonces on every message.
- Origin validation.
- Timeout and cancellation handling.
- Service worker state persistence tests.

### Wallet-specific academic risk findings

Recent academic research on browser wallet extensions reports large attack surfaces:
- WalletRadar analyzed 96 browser-based wallets and found 116 vulnerabilities across 70 wallets.
- WalletProbe tested 39 wallet extensions and identified attack vectors across user interaction and wallet features.

Practical implication:
NUMPAY must not assume "it is an extension, therefore it is safe". The extension itself is part of the attack surface and needs automated tests, mutation tests for approval UI, and adversarial dApp test fixtures.

## Security headers and web hardening

### Production headers baseline

Use a strict policy and tune through report-only first.

```http
Strict-Transport-Security: max-age=63072000; includeSubDomains; preload
X-Content-Type-Options: nosniff
X-Frame-Options: DENY
Referrer-Policy: no-referrer
Permissions-Policy: camera=(), microphone=(), geolocation=(), payment=()
Cross-Origin-Opener-Policy: same-origin
Cross-Origin-Resource-Policy: same-origin
Cross-Origin-Embedder-Policy: require-corp
Content-Security-Policy: default-src 'none'; base-uri 'none'; object-src 'none'; frame-ancestors 'none'; script-src 'self' 'nonce-{RANDOM}'; style-src 'self' 'nonce-{RANDOM}'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://api.numpay.local https://rpc-allowlist.example wss://api.numpay.local; form-action 'self'; manifest-src 'self'; upgrade-insecure-requests
```

### Notes

- CSP must be app-specific and tested.
- Avoid `unsafe-inline`.
- Avoid broad `connect-src`.
- Do not allow arbitrary RPC URLs in production without explicit user opt-in and warnings.
- Use CSP report-only during staging to collect violations before enforcing.
- Admin routes need stricter policy than public marketing routes.

## API security requirements

Use OWASP API Top 10 as minimum baseline.

Controls:
- Object-level authorization on every user-owned resource.
- No direct object references without ownership checks.
- Rate limiting per IP, user, alias, and endpoint.
- Abuse controls for NUMPAY ID lookup.
- Separate admin API.
- Strong request validation with Zod or class-validator.
- Idempotency keys for payment intent creation.
- Replay protection with nonces and timestamps.
- Audit log for alias and address binding changes.
- Tamper-evident audit events for high-risk operations.
- No secrets in logs.
- No state-changing GET endpoints.
- CSRF protection if cookie sessions are used.
- Strict CORS allowlist.

## Authentication and account recovery

### Recommended v1

- Wallet unlock password for local vault.
- Optional biometric unlock where platform supports it.
- WebAuthn/passkeys for NUMPAY web account login.
- Recovery phrase backup for wallet recovery.
- No server recovery of private keys.

### Optional later

- Social recovery.
- Hardware wallet support.
- MPC or threshold signatures.
- Passkey-controlled smart accounts for EVM chains.

Warning:
Passkeys are excellent for app login, but passkeys alone do not magically solve multi-chain self-custody. If passkeys control assets directly through smart accounts or embedded signers, the custody and recovery model changes and must be threat-modeled separately.

## Regulatory and compliance scope

### Non-custodial v1

If NUMPAY only provides:
- Local wallet software.
- User-controlled keys.
- Public alias registry.
- Payment intent metadata.
- Chain broadcasting.

Then regulatory risk is lower, but not zero.

### Higher-risk features

Legal review is required before adding:
- Custodial balances.
- Server-held private keys.
- Fiat on/off ramps.
- Stablecoin conversion.
- Merchant settlement.
- Internal ledger transfers.
- Exchange, swap, or brokerage routing.
- Yield, staking, or investment features.
- Holding funds on behalf of users.
- KYC/AML-triggering flows.

### EU MiCA warning

MiCA requires authorization for crypto-asset service providers in the EU and includes custody and administration duties for client crypto-assets. If NUMPAY provides custody or administration of crypto-assets on behalf of clients, this becomes a CASP-style compliance topic.

### US FinCEN warning

FinCEN guidance treats administrators and exchangers of convertible virtual currency as potential money services businesses, while ordinary users are not MSBs. If NUMPAY accepts and transmits value or provides exchange/admin functions, legal review is required.

## Design direction

### Visual style

- Dark theme by default.
- Theme switch because it is friendly and gives the product personality.
- Use a clean fintech/Web3 hybrid style, not degen casino UI.
- Avoid neon overload.
- Use soft gradients, glass panels, and crisp contrast.
- Make the 11-digit number the hero identity element.
- Use strong security reassurance without looking boring.

### Design tokens

```css
:root {
  --bg: #070A12;
  --surface: #0E1320;
  --surface-2: #151B2B;
  --text: #F5F7FB;
  --muted: #9AA4B2;
  --primary: #7C5CFF;
  --primary-2: #22D3EE;
  --success: #29D391;
  --warning: #F5B84B;
  --danger: #FF5C7A;
  --border: rgba(255,255,255,0.10);
  --radius-card: 24px;
}

[data-theme="light"] {
  --bg: #F7F8FC;
  --surface: #FFFFFF;
  --surface-2: #EEF1F7;
  --text: #101828;
  --muted: #667085;
  --primary: #6D5DFB;
  --primary-2: #0891B2;
  --success: #039855;
  --warning: #DC6803;
  --danger: #D92D20;
  --border: rgba(16,24,40,0.10);
}
```

### Key screens

1. Welcome
2. Create or import wallet
3. Recovery phrase backup
4. Claim NUMPAY ID
5. Home dashboard
6. Receive by number
7. Send by number
8. Send to address
9. Transaction approval
10. Connected apps
11. Security center
12. Address bindings
13. Theme settings
14. Activity history
15. Developer mode

### Approval screen must be boringly clear

Do not make signing screens too cute. They must be readable, strict, and hard to spoof.

Approval screen sections:
- You are signing on: `example.com`
- Network: `Ethereum Mainnet`
- Action: `Send ETH`
- To: `Thomas, NUMPAY 123 456 789 03`
- Address: `0x1234...abcd`
- Amount: `0.05 ETH`
- Estimated fee: `0.0009 ETH`
- Risk: `Low`
- Buttons: `Reject` and `Approve`

## Development phases

### Phase 0: Research confirmation

Deliverables:
- Confirm final custody model.
- Confirm supported chains for v1.
- Confirm whether extension-first is accepted.
- Confirm legal review boundary.
- Confirm NUMPAY ID format.
- Create threat model v1.
- Create architecture diagram.

Exit criteria:
- No private key touches backend.
- Team agrees number is alias only.
- Security requirements accepted.

### Phase 1: Local PoC

Deliverables:
- Extension shell.
- Local encrypted vault.
- Generate/import wallet.
- Derive ETH and SOL addresses first.
- Register local NUMPAY ID in local backend.
- Address binding proof.
- Resolve ID to address.
- Send testnet transfer.

Exit criteria:
- Keys remain local.
- Backend stores no secrets.
- Tests prove signing and resolution.
- Security headers exist in local/staging.

### Phase 2: Five-chain prototype

Add:
- BTC testnet.
- TRON testnet or Nile.
- XRP testnet.
- Chain abstraction layer.
- Payment intent system.
- Confirmation monitoring.

Exit criteria:
- Basic send and receive on all five target chains.
- Clear per-chain UX.
- Test vectors pass.

### Phase 3: Security hardening

Add:
- Threat model review.
- Dependency audit.
- Static analysis.
- Extension message fuzz tests.
- API abuse tests.
- ZAP scan for web app.
- CSP enforcement.
- Supply-chain controls.
- Manual red-team checklist.

Exit criteria:
- No critical or high findings open.
- Security tests documented.
- Rollback procedures defined.

### Phase 4: Private alpha

Add:
- Limited invite.
- Real monitoring.
- Bug reporting.
- Safety limits.
- No marketing claims beyond tested features.

Exit criteria:
- Stable payment flows.
- Clear incident response.
- User support playbooks.

## Test plan

### Unit tests

- NUMPAY ID checksum validation.
- NUMPAY ID generation uniqueness retry.
- Address validation per chain.
- CAIP-2 and CAIP-10 parsing.
- Binding challenge generation.
- Signature verification.
- Payment intent signature verification.
- Fee estimation formatting.
- Sensitive data redaction.

### Integration tests

- Extension popup to background messaging.
- Content script to background messaging.
- dApp request origin validation.
- Backend alias creation.
- Backend payment intent creation.
- Redis rate limits.
- Postgres uniqueness.
- RPC provider failover.
- Transaction monitor.

### Security tests

- XSS payloads against web app.
- CSP report-only then enforcement.
- CSRF attempts against state-changing API.
- Clickjacking frame test.
- Alias enumeration simulation.
- Message replay tests.
- Payment intent tampering.
- Address binding tampering.
- Malicious dApp test fixtures.
- Clipboard replacement simulation.
- Dependency audit.
- Secret scanning.
- No private key in logs test.

### Manual tests

- Restore wallet from recovery phrase.
- Wrong recovery phrase handling.
- Wrong network warning.
- XRP missing destination tag warning.
- BTC change output display.
- Unlimited token approval warning.
- Reject flow.
- Expired payment intent.
- Offline mode.
- RPC failure.
- Extension service worker restart.

## Claude Code implementation instructions

Use this document as a source of requirements, not as a command to blindly implement everything.

Before coding:
1. Create `docs/NUMPAY_ARCHITECTURE_DECISIONS.md`.
2. Create `docs/THREAT_MODEL.md`.
3. Create `docs/SECURITY_REQUIREMENTS.md`.
4. Create `docs/CHAIN_SUPPORT_MATRIX.md`.
5. Create `docs/POC_PLAN.md`.
6. Create `test-area/` for verification scripts.
7. Create a local-only repo. Do not push online unless explicitly approved.

Hard rules:
- Do not store private keys in backend.
- Do not log private keys, mnemonic, seed, signatures containing sensitive intent, or decrypted vault data.
- Do not use the 11-digit ID as a secret.
- Do not add custodial functionality.
- Do not add swaps before basic send and receive are secure.
- Do not add fiat rails.
- Do not add remote analytics that can capture sensitive screens.
- Do not use broad extension permissions without written reason.
- Do not use remote scripts in extension.
- Do not implement dApp signing before origin validation and approval UI exist.

## Open questions

1. Should NUMPAY ID be permanent or can users rotate it?
2. Should users be allowed to own multiple NUMPAY IDs?
3. Should businesses get special number ranges or verified profiles?
4. Should sender see all recipient chains or only the selected chain?
5. Should address resolution be public or require wallet session?
6. Should v1 support only native coins, or also USDT/USDC on each chain?
7. Should v1 include token approvals and swaps, or strictly transfers?
8. Should account recovery be only seed phrase in v1?
9. Should there be a mobile app roadmap from day one?
10. Which jurisdictions are in scope for launch?

## Recommended v1 decisions

1. Use extension-first non-custodial architecture.
2. Support ETH, SOL, BTC, TRON, and XRP.
3. For tokens, support only the most important stablecoins after native transfers work.
4. Use 10 random digits plus 1 checksum digit for NUMPAY ID.
5. Use signed address bindings.
6. Use signed payment intents.
7. Use CAIP-2 and CAIP-10 internally.
8. Use Postgres and Redis backend.
9. Use strict CSP and OWASP API baseline.
10. Treat custody, fiat, swaps, and smart account passkey wallets as later phases.

## Source list

### Phantom

- Phantom Browser SDK: https://docs.phantom.com/sdks/browser-sdk/
- Phantom Solana integration docs: https://docs.phantom.com/integrating/displaying-your-app
- Phantom recovery phrase and private key docs: https://help.phantom.com/hc/en-us/articles/25334064171795-View-your-recovery-phrase-or-private-keys-in-Phantom
- Phantom supported networks: https://help.phantom.com/hc/en-us/articles/41372840389651-Supported-networks-chains-in-Phantom
- Phantom funds storage: https://help.phantom.com/hc/en-us/articles/49409366802067-How-your-funds-are-stored
- Phantom private key loss docs: https://help.phantom.com/hc/en-us/articles/46497185594003-What-if-I-lost-my-private-key
- Phantom recovery phrase docs: https://help.phantom.com/hc/en-us/articles/46494910417171-How-to-retrieve-your-recovery-phrase-if-you-lose-or-forget-it

### Wallet standards

- EIP-1193: https://eips.ethereum.org/EIPS/eip-1193
- EIP-6963: https://eip.info/eip/6963
- CAIP-2: https://chainagnostic.org/CAIPs/caip-2
- CAIP-10: https://chainagnostic.org/CAIPs/caip-10
- BIP-32: https://bips.dev/32/
- BIP-44: https://bips.dev/44
- ERC-4337: https://eips.ethereum.org/EIPS/eip-4337

### Chain docs and payment patterns

- Ethereum JSON-RPC: https://ethereum.org/developers/docs/apis/json-rpc/
- Solana Wallet Adapter intro: https://solana.com/developers/courses/intro-to-solana/interact-with-wallets
- Solana Pay spec: https://launch.solana.com/docs/solana-pay/specification/version1.1
- TronLink docs: https://docs.tronlink.org/
- TronLink transfer docs: https://docs.tronlink.org/dapp/transfer/
- XRP Ledger addresses: https://xrpl.org/docs/concepts/accounts/addresses
- XRP Ledger destination tags: https://xrpl.org/docs/concepts/transactions/source-and-destination-tags

### Security

- OWASP Secure Headers: https://owasp.org/www-project-secure-headers/
- OWASP Clickjacking Defense: https://cheatsheetseries.owasp.org/cheatsheets/Clickjacking_Defense_Cheat_Sheet.html
- OWASP CSRF Prevention: https://cheatsheetseries.owasp.org/cheatsheets/Cross-Site_Request_Forgery_Prevention_Cheat_Sheet.html
- OWASP API Security Top 10: https://owasp.org/API-Security/
- OWASP Mobile Top 10 2024: https://owasp.org/www-project-mobile-top-10/
- CISA Secure by Design: https://www.cisa.gov/resources-tools/resources/secure-by-design
- W3C WebAuthn: https://w3c.github.io/webauthn/
- Chrome content scripts: https://developer.chrome.com/docs/extensions/reference/manifest/content-scripts
- Chrome extension content scripts: https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts
- MDN CSP connect-src: https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/connect-src

### Wallet research

- WalletRadar paper: https://arxiv.org/abs/2405.04332
- WalletProbe paper: https://arxiv.org/abs/2504.11735
- SecureSign paper: https://arxiv.org/abs/2511.14611
- HFIPay paper: https://arxiv.org/abs/2603.26970

### Payments and regulatory context

- Open Payments: https://interledger.org/open-payments
- Payment Pointers: https://interledger.github.io/rfcs/0026-payment-pointers/
- EU MiCA Regulation: https://eur-lex.europa.eu/legal-content/EN/ALL/?uri=CELEX%3A32023R1114
- FinCEN virtual currency guidance: https://www.fincen.gov/resources/statutes-regulations/guidance/application-fincens-regulations-persons-administering

## Final sanity check for next step

Before implementation begins, Claude must produce:

```text
docs/THREAT_MODEL.md
docs/ARCHITECTURE_DECISION_RECORDS/
docs/SECURITY_REQUIREMENTS.md
docs/CHAIN_SUPPORT_MATRIX.md
docs/LOCAL_DEV_SETUP.md
test-area/verify_numpay_id_checksum.ts
test-area/verify_address_binding_signatures.ts
test-area/verify_payment_intent_signatures.ts
test-area/verify_no_secret_logging.ts
```

Do not start production code until the above exists.
