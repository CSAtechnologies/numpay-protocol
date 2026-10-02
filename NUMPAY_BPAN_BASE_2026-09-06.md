# BPAN on Base

Updated 2026-09-07. The fresh Base contract is finalized, independently
verified, and active in the wallet source and rebuilt extension.

## Deployment

- Network: Base mainnet, chain ID 8453.
- Contract: `0x185a78Dd6bB8D2444B118BAc65Ac73816EBe4686`.
- Deployment transaction: `0xdc9967606ed5dfb4a51a73c5c89168281afe19003a4c0de8a6e50ec0ed253696`.
- Deployment block: 50998047.
- Deployer and owner: `0x616Fb832c3208c5dA5Dc1575F87F537132152FCd`.
- Initial registration fee: 0 ETH. Registration still pays Base network gas.
- The user's wallet signed the creation transaction. No private key was shared
  with the deployment helper. The local signing helper has been stopped.

The creation transaction and deployed runtime match the compiled standalone
`BANPRegistryBase` contract. Sourcify reports exact creation and runtime matches:
[verified source](https://repo.sourcify.dev/8453/0x185a78Dd6bB8D2444B118BAc65Ac73816EBe4686).
This does not claim an independent security audit or confirmed Basescan source
verification. The locally recorded Sourcify result is in
`BPAN/contracts/deploy/base-source-verification.json`.

Finalized-state reads through `mainnet.base.org` and `base.drpc.org` independently
returned the same owner, zero registration fee and runtime code hash on
2026-09-07. Both also reported two registered numbers at verification time. No
transaction was submitted by these checks.

## Fresh registrations only

There is no migration or import API. Ethereum/Sepolia BPAN contract addresses,
legacy resolver selection, old ownership-cache reads and old recipient-pin reuse
are removed from both wallets. Every Base registration is new. Historical
sources, interface, tools, receipt and tests are reference-only under
`BPAN/contracts/archive/ethereum-bpan/`, outside active compile/test paths.

The Base contract is standalone and supports multiple numbers per wallet.
Bounded ownership pages replace NFT-indexer and historical-log discovery.
Transfers update ownership and clear the previous owner's address mappings.
Registration bounds, owner checks, chain/address validation, mapping limits,
refunds, fee cap and owner-only withdrawals remain enforced. Future registration
fee changes remain possible through the capped owner setter.

Both clients consume `NumPay/packages/core/src/bpanDeployment.ts`. Owned numbers
and recipient pins are scoped to this fresh deployment. Ethereum remains a
supported asset/payment destination chain; the identity registry is Base only.
Management reads show mined changes. Payment destination reads require finalized
state and agreement from at least two independent providers. A later mapping
change still requires the user's explicit acceptance of the new destination.

## Validation

- 9 local contract/shared-core integration tests passed, including registration,
  paginated ownership, mappings, transfers and cleared destinations.
- Local first registration used 144,217 gas and zero protocol fee.
- A read-only estimate against the actual deployed contract accepted a zero-value
  registration and estimated 149,806 gas. No number was registered by that check.
- Full contract TypeScript validation passed.
- Extension: 33 address vectors, 137 adversarial checks, Base RPC integration
  and UI render tests passed. Both active and undeployed UI states are covered.
- The extension TypeScript check and production build passed after activation.
- All 16 mobile test suites and the mobile TypeScript check passed after
  activation.
- Two independent finalized-state checks matched the deployment transaction,
  contract address, owner, zero fee and runtime bytecode. The live registry had
  two registered numbers when checked.

## Release boundary

The wallets are configured only from the verified deployment transaction and
receipt block, never from the earlier predicted address. The finalized record is
`BPAN/contracts/deploy/deployed-8453-0x185a78Dd6bB8D2444B118BAc65Ac73816EBe4686.json`.

The extension has been rebuilt and requires a reload in Chrome. Mobile source
updates do not modify an already-installed APK. No APK distribution, API
deployment or installed-wallet visual test is claimed here. The read-only
activation checks submitted no mainnet transaction; two registrations observed
on the live registry occurred separately.
