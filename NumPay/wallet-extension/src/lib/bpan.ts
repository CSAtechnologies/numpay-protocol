import { ethers } from "ethers";
import { BPAN_MAINNET_CONTRACT, BPAN_MAINNET_RPC, BPAN_MAINNET_READ_RPCS } from "./networks";
import { getItem, setItem } from "./storage";

const BPAN_ABI = [
  "function balanceOf(address owner) view returns (uint256)",
  "function registerNumber(uint256 number) payable",
  "function setWalletMapping(uint256 number, string chain, string wallet)",
  "function removeWalletMapping(uint256 number, string chain)",
  "function getWalletMapping(uint256 number, string chain) view returns (string)",
  "function getAllMappings(uint256 number) view returns (string[], string[])",
  "function isRegistered(uint256 number) view returns (bool)",
  "function ownerOf(uint256 tokenId) view returns (address)",
  "function registrationFee() view returns (uint256)",
  "function totalRegistered() view returns (uint256)",
  "event Transfer(address indexed from, address indexed to, uint256 indexed tokenId)",
];

// Funds-determining and ownership reads use the "finalized" block tag instead
// of the provider default "latest". "latest" can return a mapping from a block
// that is still inside the reorg window; a transient/forked state could resolve
// a BPAN to a recipient that the canonical chain never confirms. "finalized"
// only returns state that is past the point of reorg, at the cost of a small
// (~2 epoch) staleness that is acceptable for a payment-destination read.
const READ_BLOCK_TAG = "finalized";

// Lazy mainnet provider – reused across calls to avoid creating a new
// WebSocket/HTTP connection for every resolution.
let _mainnetProvider: ethers.JsonRpcProvider | null = null;
function getMainnetProvider(): ethers.JsonRpcProvider {
  if (!_mainnetProvider) {
    _mainnetProvider = new ethers.JsonRpcProvider(BPAN_MAINNET_RPC);
  }
  return _mainnetProvider;
}

// Returns a contract instance connected to Ethereum mainnet (for reads)
// or to the provided signer (for writes).
export function getBPANContract(
  address: string,
  signerOrProvider: ethers.Signer | ethers.Provider
): ethers.Contract {
  return new ethers.Contract(address, BPAN_ABI, signerOrProvider);
}

// Convenience: mainnet read-only contract instance.
export function getMainnetBPANContract(): ethers.Contract {
  return getBPANContract(BPAN_MAINNET_CONTRACT, getMainnetProvider());
}

// A specific registry deployment to read from. Used by the BPAN management page
// so that, when operating on a testnet (Sepolia), reads and writes hit the SAME
// contract instead of writing to Sepolia while reading mainnet (CONTRACT-8).
// The funds path (resolveBPAN*) never takes a target and always reads mainnet.
export interface BPANReadTarget { contract: string; rpc: string; }

function isMainnetTarget(target?: BPANReadTarget): boolean {
  return !target || (target.contract.toLowerCase() === BPAN_MAINNET_CONTRACT.toLowerCase());
}

// Read-only contract for an explicit target, or mainnet when none is given.
function readContractFor(target?: BPANReadTarget): ethers.Contract {
  if (!target) return getMainnetBPANContract();
  let p = _readProviders.get(target.rpc);
  if (!p) {
    p = new ethers.JsonRpcProvider(target.rpc, undefined, { staticNetwork: true });
    _readProviders.set(target.rpc, p);
  }
  return getBPANContract(target.contract, p);
}

// ── Validation ────────────────────────────────────────────────────────────────

export function isValidBPAN(value: string): boolean {
  if (!/^\d{11}$/.test(value)) return false;
  const n = BigInt(value);
  return n >= 10_000_000_000n && n <= 99_999_999_999n;
}

export function isBPANInput(value: string): boolean {
  return /^\d{7,11}$/.test(value.trim());
}

export function formatBPAN(raw: string): string {
  return `${raw.slice(0, 3)}-${raw.slice(3, 7)}-${raw.slice(7)}`;
}

// ── Resolution (always queries Ethereum mainnet) ──────────────────────────────

// Independent mainnet read providers, reused across calls. The first entry is
// the primary (Alchemy); the rest are independent public full nodes used only
// to cross-check a funds-determining resolution (TRUST-1).
const _readProviders = new Map<string, ethers.JsonRpcProvider>();
function getReadContracts(): ethers.Contract[] {
  return BPAN_MAINNET_READ_RPCS.map((url) => {
    let p = _readProviders.get(url);
    if (!p) {
      // staticNetwork avoids an eth_chainId round-trip per call on these
      // throwaway cross-check providers.
      p = new ethers.JsonRpcProvider(url, undefined, { staticNetwork: true });
      _readProviders.set(url, p);
    }
    return getBPANContract(BPAN_MAINNET_CONTRACT, p);
  });
}

// Raised when independent providers return DIFFERENT non-empty addresses for the
// same (number, chain). That can only mean a forked/stale node or a
// compromised/malicious RPC trying to redirect funds, so callers must treat it
// as a hard failure and never silently pick one.
export class BPANConsensusError extends Error {
  constructor(public readonly values: string[]) {
    super("BPAN resolution disagreement: independent providers returned different addresses");
    this.name = "BPANConsensusError";
  }
}

// Raised when fewer than two independent providers AGREE on the result (an
// address, or a confirmed "no mapping"). A single provider must never be able to
// determine a payment destination, so callers treat this as "could not verify,
// try again" rather than offering a send target (TRUST-1, hardened).
export class BPANInsufficientConfirmationError extends Error {
  constructor(
    public readonly sourcesQueried: number,
    public readonly sourcesAgreed: number,
  ) {
    super("BPAN resolution could not reach two-provider agreement");
    this.name = "BPANInsufficientConfirmationError";
  }
}

export interface BPANResolution {
  /** Agreed address, or null when the BPAN has no mapping for the chain. */
  address: string | null;
  /**
   * Always "high" on a successful return: resolution now requires >=2 providers
   * to agree, and throws BPANInsufficientConfirmationError otherwise, so a
   * "low"-confidence result is never surfaced as a send target. The field is
   * retained for back-compat with existing callers.
   */
  confidence: "high" | "low";
  /** True when the agreed address differs from the last one seen (TOFU). */
  changed: boolean;
  /** Previously pinned address for this (number, chain), if any. */
  pinnedBefore: string | null;
  sourcesAgreed: number;
  sourcesQueried: number;
}

function pinKey(number: string, chain: string): string {
  return `bpan_pin_${number}_${chain.toLowerCase()}`;
}

// Case-insensitive compare for hex addresses; exact for everything else so a
// case-sensitive chain (e.g. base58/bech32) is never wrongly treated as equal.
function sameAddress(a: string, b: string): boolean {
  const ax = a.trim();
  const bx = b.trim();
  if (/^0x[0-9a-fA-F]{40}$/.test(ax) && /^0x[0-9a-fA-F]{40}$/.test(bx)) {
    return ax.toLowerCase() === bx.toLowerCase();
  }
  return ax === bx;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    p,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error("rpc timeout")), ms)),
  ]);
}

/**
 * Resolve a BPAN number to the wallet address registered for `chain`, with
 * independent-provider agreement and a trust-on-first-use pin (TRUST-1).
 *
 * The mapping is queried from every endpoint in BPAN_MAINNET_READ_RPCS at the
 * "finalized" block tag. A result is only returned when a QUORUM agrees:
 *  - two or more agree on the same answer → returned (confidence "high")
 *  - fewer than two agree                 → BPANInsufficientConfirmationError
 *  - responders return different non-empty addresses → BPANConsensusError
 *
 * The quorum applies to a "no mapping" answer too, so a single provider can
 * never determine (or deny) a payment destination.
 *
 * ALWAYS queries Ethereum mainnet regardless of the caller's current network.
 */
export async function resolveBPANChecked(
  number: string,
  chain: string,
): Promise<BPANResolution> {
  const contracts = getReadContracts();
  const settled = await Promise.allSettled(
    contracts.map((c) =>
      withTimeout<string>(c.getWalletMapping(BigInt(number), chain, { blockTag: READ_BLOCK_TAG }), 8000)
    )
  );

  const responses: string[] = [];
  for (const r of settled) {
    if (r.status === "fulfilled") responses.push((r.value ?? "").trim());
  }
  const sourcesQueried = responses.length;

  if (sourcesQueried === 0) throw new Error("BPAN lookup failed on every provider");

  // Two distinct NON-EMPTY addresses across providers = a redirect attempt or a
  // forked node. Refuse rather than guess.
  const nonEmpty = responses.filter((a) => a.length > 0);
  for (const a of nonEmpty) {
    for (const b of nonEmpty) {
      if (!sameAddress(a, b)) throw new BPANConsensusError([a, b]);
    }
  }

  // Group identical answers (empty "" is the "no mapping" answer and is grouped
  // the same way) and take the largest group.
  let chosen = "";
  let agreed = 0;
  for (const a of responses) {
    const votes = responses.filter((b) => sameAddress(a, b)).length;
    if (votes > agreed) { agreed = votes; chosen = a; }
  }

  // QUORUM (TRUST-1, hardened): a funds-determining result — an address OR a
  // confirmed "no mapping" — must be backed by at least two independent
  // providers that agree. This means a single provider (the others unreachable,
  // or one node disagreeing with the quorum) can never determine a payment
  // destination. It also subsumes the empty/non-empty disagreement case: a lone
  // non-empty answer against a lone empty answer yields a top group of one and
  // fails here rather than being silently accepted as either result.
  if (agreed < 2) {
    throw new BPANInsufficientConfirmationError(sourcesQueried, agreed);
  }

  const address = chosen.length > 0 ? chosen : null;

  // Trust-on-first-use pin. Compare the agreed address to the last one we saw
  // for this (number, chain). On FIRST use we trust and store it. On a CHANGE we
  // flag it but DO NOT advance the pin: the stored pin stays the
  // previously-trusted address until the user explicitly accepts the new mapping
  // via acceptBPANChange(). This stops the change warning from being cleared
  // just by reopening the flow, so a moved mapping is promoted to "trusted" by a
  // deliberate security decision, never by a silent re-lookup (H-03).
  let pinnedBefore: string | null = null;
  let changed = false;
  try {
    pinnedBefore = await getItem(pinKey(number, chain));
    if (address) {
      if (pinnedBefore && !sameAddress(pinnedBefore, address)) {
        changed = true; // keep the old pin; require explicit acceptance
      } else if (!pinnedBefore) {
        await setItem(pinKey(number, chain), address); // first use: trust it
      }
    }
  } catch { /* storage unavailable — pin is best-effort, not a hard dependency */ }

  return { address, confidence: "high", changed, pinnedBefore, sourcesAgreed: agreed, sourcesQueried };
}

/**
 * Record the user's explicit acceptance of a CHANGED BPAN mapping. Call this
 * ONLY after the user has reviewed the full previous and new addresses and
 * confirmed the change out-of-band with the recipient. It advances the
 * trust-on-first-use pin to the new address, so the change warning is cleared by
 * a deliberate decision rather than a silent re-lookup (H-03).
 */
export async function acceptBPANChange(
  number: string,
  chain: string,
  address: string,
): Promise<void> {
  try {
    await setItem(pinKey(number, chain), address);
  } catch { /* best-effort: pin storage is not a hard dependency */ }
}

/**
 * Back-compat thin wrapper: returns the agreed address (or null) and throws on a
 * resolution disagreement. Existing callers automatically gain multi-provider
 * agreement; callers that want confidence/changed signals use
 * resolveBPANChecked directly.
 */
export async function resolveBPAN(
  number: string,
  chain: string,
): Promise<string | null> {
  return (await resolveBPANChecked(number, chain)).address;
}

/**
 * Get all wallet mappings for a BPAN number. Defaults to Ethereum mainnet;
 * pass a target to read the same testnet contract being written to (CONTRACT-8).
 */
export async function getAllBPANMappings(
  number: string,
  target?: BPANReadTarget,
): Promise<{ chains: string[]; wallets: string[] }> {
  const contract = readContractFor(target);
  const [chains, wallets] = await contract.getAllMappings(BigInt(number), {
    blockTag: READ_BLOCK_TAG,
  });
  return { chains: [...chains], wallets: [...wallets] };
}

/**
 * Check if a BPAN number is registered. Defaults to Ethereum mainnet.
 */
export async function isBPANRegistered(number: string, target?: BPANReadTarget): Promise<boolean> {
  const contract = readContractFor(target);
  return contract.isRegistered(BigInt(number), { blockTag: READ_BLOCK_TAG });
}

/**
 * Get the owner of a BPAN number. Defaults to Ethereum mainnet.
 */
export async function getBPANOwner(number: string, target?: BPANReadTarget): Promise<string> {
  const contract = readContractFor(target);
  return contract.ownerOf(BigInt(number), { blockTag: READ_BLOCK_TAG });
}

// Extracts the Alchemy API key from the configured RPC URL.
function getAlchemyApiKey(): string | null {
  const match = BPAN_MAINNET_RPC.match(/\/v2\/([^/?]+)/);
  return match ? match[1] : null;
}

/**
 * Discover every BPAN NFT owned by `ownerAddress` on Ethereum mainnet.
 *
 * Strategy (fastest first):
 *  1. balanceOf()           — O(1), skip if wallet has no BPANs
 *  2. Alchemy NFT API       — getNFTsForOwner, no eth_getLogs needed (works on free tier)
 *  3. Transfer event scan   — full history then chunked, last resort
 *
 * Note: BANPRegistry does NOT inherit ERC721Enumerable, so tokenOfOwnerByIndex
 * is intentionally absent — calling it would always revert (CONTRACT-4).
 */
export async function findOwnedBPANs(ownerAddress: string, target?: BPANReadTarget): Promise<string[]> {
  const contract = readContractFor(target);
  const onMainnet = isMainnetTarget(target);

  // ── Step 1: quick balance check ───────────────────────────────────────────
  let balance = 0n;
  try {
    balance = BigInt(await contract.balanceOf(ownerAddress));
  } catch (e) {
    console.warn("[BPAN] balanceOf failed:", e);
  }
  if (balance === 0n) return [];

  // ── Step 2: Alchemy NFT API (avoids eth_getLogs entirely) ────────────────
  // Mainnet-only: the NFT API endpoint and key are mainnet-scoped, so a testnet
  // target falls straight through to the event scan below.
  const apiKey = onMainnet ? getAlchemyApiKey() : null;
  if (apiKey) {
    try {
      const url =
        `https://eth-mainnet.g.alchemy.com/nft/v3/${apiKey}/getNFTsForOwner` +
        `?owner=${ownerAddress}&contractAddresses[]=${BPAN_MAINNET_CONTRACT}&withMetadata=false`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        const ids: string[] = (data.ownedNfts ?? []).map((nft: { tokenId: string }) =>
          BigInt(nft.tokenId).toString()
        );
        if (ids.length > 0) return ids;
      }
    } catch (e) {
      console.warn("[BPAN] Alchemy NFT API failed:", (e as Error)?.message);
    }
  }

  // ── Step 3: Transfer event scan (full history first, chunked fallback) ───
  const filter = contract.filters.Transfer(null, ownerAddress);
  const candidates = new Set<string>();

  let fullScanSucceeded = false;
  try {
    const events = (await contract.queryFilter(filter)) as ethers.EventLog[];
    for (const ev of events) {
      const tokenId = ev?.args?.tokenId ?? ev?.args?.[2];
      if (tokenId != null) candidates.add(tokenId.toString());
    }
    fullScanSucceeded = true;
  } catch {
    // RPC range limit — fall through to chunked scan.
  }

  if (!fullScanSucceeded) {
    const provider = (contract.runner?.provider ?? getMainnetProvider()) as ethers.Provider;
    const currentBlock = await provider.getBlockNumber();
    const CHUNK = 10_000;
    for (let from = 0; from <= currentBlock; from += CHUNK) {
      const to = Math.min(from + CHUNK - 1, currentBlock);
      try {
        const events = (await contract.queryFilter(filter, from, to)) as ethers.EventLog[];
        for (const ev of events) {
          const tokenId = ev?.args?.tokenId ?? ev?.args?.[2];
          if (tokenId != null) candidates.add(tokenId.toString());
        }
      } catch { /* chunk failed — provider likely restricts range, skip */ }
    }
  }

  // Verify current ownership (tokens may have been transferred away).
  const owned: string[] = [];
  await Promise.all(
    Array.from(candidates).map(async (num) => {
      try {
        const current: string = await contract.ownerOf(BigInt(num));
        if (current.toLowerCase() === ownerAddress.toLowerCase()) owned.push(num);
      } catch { /* burned or nonexistent */ }
    })
  );
  return owned;
}

/**
 * Fast check: how many BPANs does an address own? Uses balanceOf() — one call.
 * Returns 0 if the wallet has no BPANs, or if the call fails.
 */
export async function getOwnedBPANCount(ownerAddress: string, target?: BPANReadTarget): Promise<number> {
  try {
    const contract = readContractFor(target);
    const bal: bigint = await contract.balanceOf(ownerAddress);
    return Number(bal);
  } catch {
    return 0;
  }
}

/**
 * Register a BPAN number on Ethereum mainnet.
 * The signer must be connected to Ethereum mainnet (chainId 1 or 11155111).
 */
export async function registerBPAN(
  number: string,
  contractAddress: string,
  signer: ethers.Signer,
): Promise<ethers.TransactionResponse> {
  const contract = getBPANContract(contractAddress, signer);
  const fee: bigint = await contract.registrationFee();
  return contract.registerNumber(BigInt(number), { value: fee });
}

/**
 * Set wallet mapping(s) for a BPAN number.
 * Must be called on the chain where the contract is deployed (mainnet/sepolia).
 */
export async function setWalletMapping(
  number: string,
  chain: string,
  wallet: string,
  contractAddress: string,
  signer: ethers.Signer,
): Promise<ethers.TransactionResponse> {
  const contract = getBPANContract(contractAddress, signer);
  return contract.setWalletMapping(BigInt(number), chain, wallet);
}
