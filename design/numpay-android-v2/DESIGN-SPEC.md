# NumPay Android V2 — Design Specification

Status: design proposal only. This package does not modify the React Native application.

## Direction

NumPay V2 is a calm payments wallet rather than a crypto dashboard. The visual hierarchy is carried by typography, alignment, whitespace, and predictable interaction. Neutral surfaces dominate; violet identifies the brand, active selection, and the one primary action on a screen.

The design removes the recurring generated-UI patterns from the current app: excessive rounded containers, decorative borders, unrelated icon styles, full-screen gradients, oversized empty areas, and large warning cards containing implementation language.

## Navigation

The six-tab navigation becomes five destinations:

1. Wallet — portfolio, assets, wallet switcher, and shortcuts.
2. Pay — send and receive entry, recipient, asset, amount, scan, and review.
3. BPAN — identity, registration, mapping, and lookup.
4. Activity — transaction list, filters, and transaction detail.
5. Settings — accounts, security, connections, preferences, and advanced tools.

Swap, bridge, token detail, asset management, browser, WalletConnect, and DeFi are focused flows reached from these destinations. They do not occupy permanent bottom-navigation slots.

## Foundation

- Canvas: neutral near-white in light mode and ink/graphite in dark mode.
- Brand: controlled violet used for primary action, active navigation, focus, and NumPay identity.
- Status: green for completed/safe, amber for pending/caution, red for destructive/error, and blue for informational network state.
- Type: system sans; 32–40dp display only for portfolio value, 22–24dp page title, 16–18dp section title, 14–16dp body/control text, and 12–13dp metadata.
- Numerals: tabular figures for balances, fees, BPANs, exchange values, and timestamps.
- Spacing: 4, 8, 12, 16, 20, 24, and 32dp rhythm.
- Radius: 10–12dp controls, 14–18dp grouped surfaces, full pills only for filters and compact status.
- Elevation: one subtle level for sheets and selected floating surfaces; repeated lists use dividers rather than individual cards.
- Icons: one optical 20/24dp monoline family. Chain/token marks remain filled identity assets.
- Touch: minimum 44dp target, visible pressed/focused/disabled states, safe-area and keyboard-aware layouts.

## Motion

- Tap response begins immediately: subtle scale and surface tint, 80–140ms.
- Primary routes render the destination immediately and settle 8–18dp along the navigation axis over 160–240ms.
- Bottom-navigation selection slides continuously between measured positions.
- Sheets enter with scrim fade and restrained spring; actions remain stable.
- Value changes use a short numeric/crossfade transition; unchanged rows do not animate.
- Pending-to-success transitions preserve layout and replace status in place.
- Reduced motion removes travel and overshoot while retaining state feedback.

## Screen inventory

### Access and accounts

- Welcome
- Import wallet
- Recovery phrase
- Recovery verification
- Create PIN
- Unlock
- Wrong PIN / lockout
- Add wallet: create
- Add wallet: import
- Wallet switcher
- Session expired re-authentication

### Wallet

- Portfolio home: cached/loading/live
- Portfolio home: empty
- Hidden assets
- Token detail
- Token transaction history
- Manage assets: tokens
- Import token
- Manage assets: networks
- Add network

### Pay and receive

- Pay hub / send form
- Asset picker
- Network picker
- Address or BPAN entry
- Scanner
- BPAN resolved
- Address changed verification
- Amount and fee state
- Insufficient balance
- Review payment
- Sending/pending
- Payment complete
- Payment failed
- Receive hub
- Receive QR/address
- Share address

### Swap and bridge

- Swap form
- Token picker
- Slippage settings
- Route selection
- Bridge destination chain
- Review swap/bridge
- Submitting
- Completed/failed

### BPAN

- BPAN home: none/owned/loading/error
- Register number
- Registration review/pending/success
- Wallet mappings
- Edit mapping
- Mapping review/pending/success
- Lookup
- Lookup result
- Recent mapping / finality warning

### Activity

- Activity list
- Activity filters
- Empty activity
- Transaction detail: pending/completed/failed
- Explorer/share actions

### Connections and discovery

- Connected dApps
- WalletConnect scan/manual entry
- WalletConnect session detail
- In-app browser start
- Browser connected state
- Connection/signature/transaction/network approval sheets
- DeFi discovery: earn/lend/stake

### Settings and security

- Settings index
- Accounts and rename
- Security index
- Device integrity warning
- PIN confirmation
- Recovery phrase reveal
- Auto-erase confirmation
- Remove wallet confirmation
- Remove all wallets confirmation
- Theme and currency pickers
- Advanced/developer tools

## State language

- Loading: show final geometry with skeletons or quiet inline progress. Navigation remains available.
- Empty: state what is absent and offer one relevant action.
- Offline: keep cached content visible and show a compact inline status with retry.
- Warning: title explains the condition; body explains consequence or next step. Avoid generic “Try this” filler.
- Error: user-safe message only. Never show RPC payloads, stack traces, calldata, trace IDs, or provider internals.
- Success: confirm what happened, amount/asset/destination, and one sensible next action.
- Destructive: plain-language consequence, neutral cancel action, deliberate destructive confirmation.

## Approval gate before implementation

Implementation should begin only after the visual direction, five-destination navigation, representative light/dark screens, and high-risk states are accepted. Any requested revisions should be made in this design package first so the React Native rewrite follows one stable system.
