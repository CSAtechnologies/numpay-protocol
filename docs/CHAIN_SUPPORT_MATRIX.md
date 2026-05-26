# NUMPAY Chain Support Matrix

Status: ACTIVE.
Last updated: 2026-05-22.
Mode: CRITICAL_CODE.

This file lists the chains v1 product targets, the phase each enters, and the per-chain choices (signing curve, address format, derivation path, libraries, simulation rules, UX warnings). Phase 1 PoC is testnet only.

## TLDR

1. Phase 1: ETH (Sepolia) and SOL (devnet). Implement fully.
2. Phase 2: BTC (testnet3, signet), TRON (Nile), XRP (testnet). Receive + send native asset first; tokens follow.
3. The chain abstraction layer (CAIP-2 chain IDs, CAIP-10 account IDs, a typed signing-curve registry) is in place from day one even though only two chains are implemented in Phase 1.
4. No mainnet RPC is configured in v1.

## Phase 1 (in scope)

| Chain | Asset | CAIP-2 | Curve | Address model | Library | Phase 1 status |
|---|---|---|---|---|---|---|
| Ethereum Sepolia | ETH (testnet) | `eip155:11155111` | secp256k1 | EVM account (20-byte hex with EIP-55 checksum) | `viem` for tx, `@noble/secp256k1` underneath | Full send + receive |
| Solana devnet | SOL (devnet) | `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet genesis hash short) | ed25519 | Account public key (base58, 32 bytes) | `@solana/web3.js` | Full send + receive |

### 1.1 Ethereum Sepolia

- Chain ID (CAIP-2): `eip155:11155111`. Numeric chain ID `11155111`.
- Signing: EIP-1559 transactions (`type: 2`) by default. EIP-155 replay protection (chain ID in the signature) is mandatory.
- Address derivation: BIP-44 path `m/44'/60'/0'/0/0` for the first account. Store derivation metadata per account to support future paths.
- Provider API: EIP-1193 with EIP-6963 discovery.
- RPC providers (ADR-013): Infura (`https://sepolia.infura.io/v3/{KEY}`) and Alchemy (`https://eth-sepolia.g.alchemy.com/v2/{KEY}`). Fallback: `https://ethereum-sepolia.publicnode.com`.
- Simulation: `eth_call` before signing for any non-simple transfer. Decode ERC-20 `transfer`, `approve`, `transferFrom`. Show balance change for the sender.
- UX warnings:
  - Unlimited approve (`type(uint256).max`) is a red banner with a held-click and a default offer to switch to exact amount.
  - Unknown method signatures (no ABI match) trigger a warning and a slower path.
  - Token transfers to a contract address trigger a "this is a contract, not an EOA" notice.
- Gas: use viem fee estimators with fallback to provider `eth_feeHistory`.
- Tx broadcast: send to the primary provider, repeat to the secondary on failure or on a primary-side disagreement.

### 1.2 Solana devnet

- Chain ID (CAIP-2): `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1` (devnet cluster). The full canonical form is the genesis hash short identifier. See CAIP-30 registry.
- Signing: ed25519 over canonical Solana message bytes.
- Address derivation: BIP-44 path `m/44'/501'/0'/0'`. Solana wallets use a 32-byte ed25519 public key encoded as base58. v1 uses this Phantom-compatible derivation.
- Provider API: Solana Wallet Standard (CAIP-style window object). Implement `connect`, `disconnect`, `signTransaction`, `signAllTransactions`, `signMessage`.
- RPC providers: `https://api.devnet.solana.com` (official) and a second provider configurable via env (Helius or QuickNode devnet endpoint).
- Simulation: `simulateTransaction` on each transaction before user approval. Decode `SystemProgram.transfer` and the SPL token program transfer/approve instructions. Warn for unknown program IDs.
- UX warnings:
  - Unknown program in the transaction triggers a yellow banner. Held-click to approve.
  - Versioned transactions (`MessageV0` with address lookup tables) display the resolved accounts post-lookup, not the raw indices.
  - Priority fees displayed explicitly. Compute-unit price changes from the wallet default are flagged.
- Tx broadcast: send via `sendRawTransaction` to the primary provider. Confirm via `getSignatureStatuses` against both providers.

## Phase 2 (planned, not implemented in v1)

| Chain | Asset | CAIP-2 | Curve | Address model | Library candidate | Phase 2 status |
|---|---|---|---|---|---|---|
| Bitcoin signet | BTC (signet) | `bip122:00000008819873e925422c1ff0f99f7c` (signet block-0 short) | secp256k1 | UTXO. Native SegWit (bech32 `tb1...`) default. Taproot later. | `@scure/btc-signer` | Receive + send native first |
| TRON Nile | TRX (testnet) | `tron:cd8690dc89b4cf32` (Nile chain id placeholder, confirm at impl time) | secp256k1 | Account address (base58 `T...`) | `tronweb` | Basic send + receive |
| XRP testnet | XRP (testnet) | `xrpl:11112FA0` (testnet identifier; confirm at impl time) | secp256k1 by default, ed25519 supported | Account address (r... base58) plus optional destination tag | `xrpl` | Basic send + receive |

Phase 2 notes per chain.

### 2.1 Bitcoin signet (Phase 2)

- Path: BIP-84 Native SegWit, `m/84'/1'/0'/0/0` for testnet/signet (coin type `1'`).
- UTXO coin selection: branch-and-bound first, knapsack fallback. Coin selection is its own module, tested independently.
- Approval UI shows inputs, outputs, change address, fee in sat/vB and absolute sats. Change address is explicitly labelled.
- RBF on by default, configurable.
- Address substitution: warn if a pasted address matches a known scam pattern (basic regex pass for now).

### 2.2 TRON Nile (Phase 2)

- Path: BIP-44 `m/44'/195'/0'/0/0`.
- USDT TRC-20 likely needed early in Phase 2 once native send works.
- Bandwidth and energy are explicitly displayed pre-sign. Approval UI shows what the user is "burning".
- RPC: TronGrid (Nile) plus a second provider.

### 2.3 XRP testnet (Phase 2)

- Path: BIP-44 `m/44'/144'/0'/0/0` for secp256k1 accounts. ed25519 accounts use the `ed` prefix.
- Destination tag handling: when sending to a known exchange-style account, require a destination tag. When the recipient is a NUMPAY alias, the alias resolution can include a destination tag in the binding payload.
- X-addresses (X-prefix format embedding the destination tag) are supported on the resolution side; the wallet displays both classic and X-address forms.
- Reserve requirement: warn if a send would drop the source account below the XRP reserve.

## Chain abstraction layer (v1 design)

The wallet code paths are abstract over chain even when only two chains are wired.

- `ChainId` is a TypeScript branded string in CAIP-2 form.
- `AccountId` is a TypeScript branded string in CAIP-10 form, `<chainId>:<address>`.
- A `SigningCurve` enum is one of `secp256k1`, `ed25519`. Each curve has a typed signer interface.
- A `TransactionBuilder` interface per chain produces an unsigned canonical message plus a human-readable summary.
- A `Simulator` interface per chain takes an unsigned transaction and returns a decoded `SimulationResult` (balance changes, decoded calls, warnings).
- A `Broadcaster` interface per chain takes a signed transaction and returns a chain-specific receipt promise.

Adding a Phase 2 chain implements those interfaces. The approval UI does not need to grow.

## Address binding rules (cross-chain)

- A NUMPAY alias can have at most one address per chain ID in v1. Multi-account-per-chain bindings are a Phase 3 decision.
- Each binding is signed by the alias's ed25519 owner key, not by the chain account key. The binding includes the chain account ID (CAIP-10) and a fresh nonce.
- The chain account also produces a self-attestation signing the binding statement with its own chain key. This proves the user controls that address on that chain at registration time.
- Verification on resolution:
  1. Verify the alias owner's signature with the pinned owner pubkey.
  2. Verify the chain-key self-attestation with the address (or derived public key) for that chain.

## Test vector requirements

For each chain implemented in v1, we ship:

- At least 5 deterministic key-derivation test vectors (mnemonic to first address per chain) sourced from public test vector sets where they exist (BIP-39 official vectors, Solana SDK examples).
- At least 3 transaction-encoding test vectors per chain (known mnemonic, known nonce, expected signed bytes) to catch silent library upgrades.
- A round-trip test: sign with NUMPAY's signer, verify with the chain's standard verifier.

Failure of any vector is a build break.

## RPC provider table (v1)

| Chain | Primary | Secondary | Tertiary fallback |
|---|---|---|---|
| Sepolia | Infura | Alchemy | publicnode.com |
| Solana devnet | api.devnet.solana.com | Helius (if key available) or QuickNode | none yet |

Outside this list, RPC URLs are configurable in the extension but require a user-visible warning banner ("Custom RPC: do not trust unknown providers with your queries") and are gated behind a developer-mode toggle.

## References

Verified primary sources.

- BIP-39. https://bips.dev/39
- BIP-32. https://bips.dev/32
- BIP-44. https://bips.dev/44
- BIP-84. https://bips.dev/84
- CAIP-2 blockchain identifiers. https://chainagnostic.org/CAIPs/caip-2
- CAIP-10 account identifiers. https://chainagnostic.org/CAIPs/caip-10
- EIP-1193 provider API. https://eips.ethereum.org/EIPS/eip-1193
- EIP-1559 fee market. https://eips.ethereum.org/EIPS/eip-1559
- EIP-155 chain id and replay. https://eips.ethereum.org/EIPS/eip-155
- EIP-6963 multi-injected provider discovery. https://eip.info/eip/6963
- Solana Wallet Adapter intro. https://solana.com/developers/courses/intro-to-solana/interact-with-wallets
- Solana versioned transactions. https://solana.com/docs/advanced/versions
- Ethereum JSON-RPC. https://ethereum.org/developers/docs/apis/json-rpc/
- XRP Ledger destination tags. https://xrpl.org/docs/concepts/transactions/source-and-destination-tags
- TronWeb docs. https://docs.tronlink.org/
