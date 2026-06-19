import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { useWallet } from "../hooks/useWallet";
import { type NonEvmWallet } from "@/lib/chains";
import {
  getBPANContract, isValidBPAN, formatBPAN,
  getAllBPANMappings, isBPANRegistered, getBPANOwner,
  registerBPAN, setWalletMapping, findOwnedBPANs, getOwnedBPANCount,
  type BPANReadTarget,
} from "@/lib/bpan";
import {
  BPAN_MAINNET_CONTRACT, BPAN_SEPOLIA_CONTRACT,
  BPAN_MAINNET_RPC, NETWORKS, BPAN_CHAINS,
} from "@/lib/networks";
import { getSigner } from "@/lib/wallet";
import { isValidChainAddress } from "@/lib/addressValidation";
import Layout from "../components/Layout";
import {
  SearchIcon, CheckIcon, ExternalLinkIcon, ChevronDownIcon,
  CopyIcon, HashIcon, RefreshIcon, LayersIcon, AlertIcon, GlobeIcon,
} from "../components/Icons";
import { ChainIcon } from "../components/Icons";

type Tab = "my-bpan" | "register" | "mapping" | "lookup";

// ── localStorage helpers ──────────────────────────────────────────────────────
function getSavedBPANs(address: string): string[] {
  try { return JSON.parse(localStorage.getItem(`bpan_numbers_${address.toLowerCase()}`) || "[]"); }
  catch { return []; }
}
function saveBPAN(address: string, number: string) {
  const saved = getSavedBPANs(address);
  if (!saved.includes(number)) {
    saved.unshift(number);
    localStorage.setItem(`bpan_numbers_${address.toLowerCase()}`, JSON.stringify(saved));
  }
}
function removeBPAN(address: string, number: string) {
  localStorage.setItem(
    `bpan_numbers_${address.toLowerCase()}`,
    JSON.stringify(getSavedBPANs(address).filter((n) => n !== number))
  );
}
async function copyText(text: string) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.cssText = "position:fixed;opacity:0";
    document.body.appendChild(ta);
    ta.select();
    document.execCommand("copy");
    document.body.removeChild(ta);
  }
}

// BPAN is a mainnet product. Sepolia is exposed only in dev builds so the team
// can exercise register/map flows against the testnet deployment; production
// users only ever operate on mainnet (CONTRACT-8). This keeps the read path and
// the write path on the SAME contract instead of writing to Sepolia while every
// read (and the live Send funds path) hits mainnet.
const BPAN_TESTNET_ENABLED = import.meta.env.DEV;

function canWriteBPAN(networkId: string): boolean {
  return networkId === "ethereum" || (networkId === "sepolia" && BPAN_TESTNET_ENABLED);
}

// Read the same deployment the page is writing to. Mainnet by default; the
// Sepolia contract only in dev builds, so production reads are always mainnet.
function getReadTarget(networkId: string): BPANReadTarget | undefined {
  if (networkId === "sepolia" && BPAN_TESTNET_ENABLED) {
    return { contract: BPAN_SEPOLIA_CONTRACT, rpc: NETWORKS.sepolia.rpcUrl };
  }
  return undefined;
}

function getContractAddress(networkId: string): string {
  return networkId === "sepolia" && BPAN_TESTNET_ENABLED ? BPAN_SEPOLIA_CONTRACT : BPAN_MAINNET_CONTRACT;
}
function getContractRPC(networkId: string): string {
  return networkId === "sepolia" && BPAN_TESTNET_ENABLED ? NETWORKS.sepolia.rpcUrl : BPAN_MAINNET_RPC;
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function BPANPage() {
  const { wallet, network, nonEvmWallet } = useWallet();
  const [tab, setTab] = useState<Tab>("my-bpan");

  // Central ownership state — shared by all tabs
  const [ownedBPANs, setOwnedBPANs] = useState<string[]>([]);
  const [ownershipLoading, setOwnershipLoading] = useState(false);
  const [ownershipScanned, setOwnershipScanned] = useState(false);

  const isOnEthereum = canWriteBPAN(network.id);
  const isTestnet = network.id === "sepolia" && BPAN_TESTNET_ENABLED;
  const contractAddr = getContractAddress(network.id);
  const contractRPC  = getContractRPC(network.id);
  const readTarget = getReadTarget(network.id);

  // Reset and reload from address-specific cache when active wallet changes.
  // Delete the old address-less "bpan_numbers" key if it still exists — we
  // can't know which wallet it belonged to, so the on-chain scan recovers it.
  useEffect(() => {
    if (!wallet?.address) return;
    localStorage.removeItem("bpan_numbers");
    setOwnedBPANs(getSavedBPANs(wallet.address));
    setOwnershipScanned(false);
  }, [wallet?.address]);

  // On-chain ownership scan — runs once per wallet (re-triggers when ownershipScanned resets)
  useEffect(() => {
    if (!wallet?.address || ownershipScanned) return;
    setOwnershipScanned(true);

    (async () => {
      // Fast check first: does this wallet own any BPANs at all?
      const count = await getOwnedBPANCount(wallet.address, readTarget);
      if (count === 0) return;

      // Count > 0 → do the full scan to get token IDs
      setOwnershipLoading(true);
      try {
        const found = await findOwnedBPANs(wallet.address, readTarget);
        if (found.length > 0) {
          const saved = getSavedBPANs(wallet.address);
          const merged = Array.from(new Set([...found, ...saved]));
          localStorage.setItem(`bpan_numbers_${wallet.address.toLowerCase()}`, JSON.stringify(merged));
          setOwnedBPANs(merged);
        }
      } catch { /* non-fatal */ }
      finally { setOwnershipLoading(false); }
    })();
  }, [wallet?.address, ownershipScanned]);

  function handleRegistered(number: string) {
    if (!wallet?.address) return;
    saveBPAN(wallet.address, number);
    const merged = Array.from(new Set([number, ...ownedBPANs]));
    setOwnedBPANs(merged);
    setTab("mapping");
  }

  function handleRemoved(number: string) {
    if (!wallet?.address) return;
    removeBPAN(wallet.address, number);
    setOwnedBPANs(getSavedBPANs(wallet.address));
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "my-bpan",  label: "My BPAN"  },
    { id: "register", label: "Register" },
    { id: "mapping",  label: "Mapping"  },
    { id: "lookup",   label: "Lookup"   },
  ];

  return (
    <Layout>
      <div className="app-bg min-h-full">
        <div className="px-4 py-4">

          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-text-primary">BPAN</h2>
            {ownedBPANs.length > 0 && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-accent-green/10 text-accent-green font-semibold border border-accent-green/20">
                LIVE
              </span>
            )}
            {isTestnet && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber/10 font-semibold border border-amber/20" style={{ color: "var(--amber)" }}>
                TESTNET
              </span>
            )}
          </div>
          <div className="flex items-center gap-1.5 mb-4">
            <GlobeIcon size={11} className="text-muted" />
            <p className="text-[11px] text-muted">
              Registry on <span className="text-brand-400 font-medium">Ethereum mainnet</span>. All chain mappings stored there.
            </p>
          </div>

          {/* Write-action warning when not on Ethereum */}
          {!isOnEthereum && (tab === "register" || tab === "mapping") && (
            <div className="mb-4 px-3 py-2.5 rounded-xl bg-amber/5 border border-amber/20 flex items-start gap-2 animate-fade-in">
              <AlertIcon size={13} className="text-amber mt-0.5 flex-shrink-0" style={{ color: "var(--amber)" }} />
              <p className="text-[11px] leading-relaxed" style={{ color: "var(--amber)" }}>
                Switch to <strong>Ethereum mainnet</strong>{BPAN_TESTNET_ENABLED ? " or Sepolia" : ""} to register or set mappings. Lookups work on any network.
              </p>
            </div>
          )}

          {/* Tab row */}
          <div className="flex premium-card p-1 mb-5 gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-2 text-[11px] rounded-lg font-medium transition-all duration-150 ${
                  tab === t.id
                    ? "bg-brand-500 text-white shadow-lg shadow-brand-500/30"
                    : "text-muted hover:text-text-secondary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div className="animate-slide-up">
            {tab === "my-bpan" && (
              <MyBPANSection
                wallet={wallet}
                ownedBPANs={ownedBPANs}
                loading={ownershipLoading}
                readTarget={readTarget}
                onRemove={handleRemoved}
                onGoRegister={() => setTab("register")}
                onGoMapping={() => setTab("mapping")}
              />
            )}
            {tab === "register" && (
              <RegisterSection
                wallet={wallet}
                network={network}
                contractAddr={contractAddr}
                contractRPC={contractRPC}
                ownedBPANs={ownedBPANs}
                readTarget={readTarget}
                onRegistered={handleRegistered}
                onGoMapping={() => setTab("mapping")}
              />
            )}
            {tab === "mapping" && (
              <MappingSection
                wallet={wallet}
                network={network}
                contractAddr={contractAddr}
                contractRPC={contractRPC}
                ownedBPANs={ownedBPANs}
                nonEvmWallet={nonEvmWallet}
                readTarget={readTarget}
              />
            )}
            {tab === "lookup" && <LookupSection readTarget={readTarget} />}
          </div>
        </div>
      </div>
    </Layout>
  );
}

// ── My BPAN ───────────────────────────────────────────────────────────────────
function MyBPANSection({
  wallet, ownedBPANs, loading, readTarget, onRemove, onGoRegister, onGoMapping,
}: {
  wallet: any;
  ownedBPANs: string[];
  loading: boolean;
  readTarget?: BPANReadTarget;
  onRemove: (n: string) => void;
  onGoRegister: () => void;
  onGoMapping: () => void;
}) {
  if (loading && ownedBPANs.length === 0) {
    return (
      <div className="flex flex-col items-center py-10">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin mb-3" />
        <p className="text-xs text-muted">Scanning Ethereum mainnet for your BPANs...</p>
      </div>
    );
  }

  if (ownedBPANs.length === 0) {
    return (
      <div className="text-center py-8">
        <div className="w-14 h-14 rounded-2xl premium-card flex items-center justify-center mx-auto mb-3">
          <HashIcon size={24} className="text-muted" />
        </div>
        <p className="text-[13px] text-text-secondary font-medium mb-1">No BPANs yet</p>
        <p className="text-xs text-muted mb-4">Register an 11-digit number to get your BPAN identity</p>
        <button onClick={onGoRegister} className="btn-primary-premium text-[13px]">
          Register BPAN
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {loading && (
        <div className="flex items-center gap-2 mb-1">
          <div className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-[11px] text-muted">Syncing from mainnet...</p>
        </div>
      )}
      {ownedBPANs.map((num) => (
        <BPANCard
          key={num}
          number={num}
          walletAddress={wallet?.address}
          readTarget={readTarget}
          onRemove={() => onRemove(num)}
          onGoMapping={onGoMapping}
        />
      ))}
    </div>
  );
}

function BPANCard({
  number, walletAddress, readTarget, onRemove, onGoMapping,
}: {
  number: string;
  walletAddress?: string;
  readTarget?: BPANReadTarget;
  onRemove: () => void;
  onGoMapping: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mappings, setMappings] = useState<{ chains: string[]; wallets: string[] } | null>(null);
  const [owner, setOwner] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);

  useEffect(() => {
    if (expanded && !mappings) loadDetail();
  }, [expanded]);

  async function loadDetail() {
    setLoadingDetail(true);
    try {
      const [m, o] = await Promise.all([
        getAllBPANMappings(number, readTarget),
        getBPANOwner(number, readTarget),
      ]);
      setMappings(m);
      setOwner(o);
    } catch { setMappings({ chains: [], wallets: [] }); }
    finally { setLoadingDetail(false); }
  }

  const isOwner = owner && walletAddress && owner.toLowerCase() === walletAddress.toLowerCase();
  const formatted = formatBPAN(number);

  return (
    <div className="premium-card overflow-hidden animate-fade-in">
      <div className="px-3.5 py-3 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center flex-shrink-0 shadow-lg shadow-brand-500/30">
          <span className="text-white text-[13px] font-bold">#</span>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[15px] font-bold text-text-primary tracking-wide font-mono">{formatted}</p>
          {isOwner && (
            <span className="inline-block text-[10px] bg-accent-green/10 text-accent-green px-1.5 py-0.5 rounded-full font-medium mt-0.5 border border-accent-green/20">
              Owner
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={async () => { await copyText(number); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
          >
            {copied
              ? <CheckIcon size={14} className="text-accent-green" />
              : <CopyIcon size={14} className="text-muted" />}
          </button>
          <button
            onClick={() => setExpanded(!expanded)}
            className="p-1.5 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <ChevronDownIcon size={14} className={`text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {expanded && (
        <div className="px-3.5 pb-3 border-t border-border pt-2.5 animate-slide-up">
          {loadingDetail && (
            <div className="flex items-center gap-2 py-2">
              <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-muted">Loading from Ethereum mainnet...</p>
            </div>
          )}

          {!loadingDetail && mappings && mappings.chains.length > 0 && (
            <div className="space-y-1.5 mb-2.5">
              <p className="text-[11px] text-muted uppercase tracking-wider font-medium">Wallet Mappings</p>
              {mappings.chains.map((chain, i) => (
                <div key={i} className="flex items-center gap-2 py-1">
                  <ChainIcon chainId={chain} size={16} />
                  <span className="text-[11px] text-brand-400 font-medium w-24 flex-shrink-0 capitalize">{chain}</span>
                  <span className="text-[10px] font-mono text-text-secondary break-all flex-1">
                    {mappings.wallets[i].slice(0, 8)}...{mappings.wallets[i].slice(-6)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!loadingDetail && mappings && mappings.chains.length === 0 && (
            <p className="text-xs text-muted mb-2.5">No mappings set yet.</p>
          )}

          <div className="flex items-center gap-2">
            <button onClick={loadDetail} className="text-[11px] text-brand-400 font-medium hover:underline">Refresh</button>
            <span className="text-muted text-xs">·</span>
            <button onClick={onGoMapping} className="text-[11px] text-brand-400 font-medium hover:underline">Add mappings</button>
            <span className="text-muted text-xs">·</span>
            <button onClick={onRemove} className="text-[11px] font-medium hover:underline" style={{ color: "var(--danger)" }}>Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Register ──────────────────────────────────────────────────────────────────
function RegisterSection({
  wallet, network, contractAddr, contractRPC, ownedBPANs, readTarget, onRegistered, onGoMapping,
}: {
  wallet: any;
  network: any;
  contractAddr: string;
  contractRPC: string;
  ownedBPANs: string[];
  readTarget?: BPANReadTarget;
  onRegistered: (n: string) => void;
  onGoMapping: () => void;
}) {
  const [number, setNumber] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [fee, setFee] = useState<string | null>(null);

  const isOnEthereum = canWriteBPAN(network.id);
  const alreadyOwns = ownedBPANs.length > 0;

  useEffect(() => {
    if (!isOnEthereum) return;
    (async () => {
      try {
        const provider = new ethers.JsonRpcProvider(contractRPC);
        const contract = getBPANContract(contractAddr, provider);
        const f: bigint = await contract.registrationFee();
        setFee(ethers.formatEther(f));
      } catch {}
    })();
  }, [contractAddr, contractRPC, isOnEthereum]);

  // Block registration if this wallet already owns a BPAN
  if (alreadyOwns) {
    return (
      <div className="premium-card p-4 animate-fade-in">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 flex items-center justify-center flex-shrink-0">
            <CheckIcon size={18} className="text-white" />
          </div>
          <div>
            <p className="text-[13px] font-semibold text-text-primary">Already registered</p>
            <p className="text-[11px] text-muted">
              This wallet owns {ownedBPANs.length === 1 ? "a BPAN" : `${ownedBPANs.length} BPANs`}
            </p>
          </div>
        </div>

        <div className="space-y-1.5 mb-4">
          {ownedBPANs.map((num) => (
            <div key={num} className="flex items-center gap-2 px-3 py-2 rounded-xl bg-brand-500/5 border border-brand-500/15">
              <HashIcon size={12} className="text-brand-400" />
              <span className="font-mono text-[13px] font-semibold text-brand-400">{formatBPAN(num)}</span>
            </div>
          ))}
        </div>

        <p className="text-xs text-muted mb-4 leading-relaxed">
          Each wallet holds one BPAN. To receive on more chains, add wallet mappings to your existing BPAN: one number works across every supported chain.
        </p>

        <button onClick={onGoMapping} className="btn-primary-premium text-[13px]">
          Add Chain Mappings
        </button>
      </div>
    );
  }

  if (!isOnEthereum) {
    return (
      <div className="text-center py-8">
        <div className="w-14 h-14 rounded-2xl premium-card flex items-center justify-center mx-auto mb-3">
          <AlertIcon size={24} className="text-muted" />
        </div>
        <p className="text-[13px] text-text-secondary font-medium mb-1">Switch to Ethereum</p>
        <p className="text-xs text-muted">BPAN registration requires Ethereum mainnet or Sepolia.</p>
      </div>
    );
  }

  async function checkAvailability() {
    if (!isValidBPAN(number)) { setError("Enter a valid 11-digit number"); return; }
    setError(""); setAvailable(null); setChecking(true);
    try {
      const registered = await isBPANRegistered(number, readTarget);
      setAvailable(!registered);
    } catch {
      setError("Check failed. Verify your connection.");
    } finally { setChecking(false); }
  }

  async function handleRegister() {
    if (!wallet || !isOnEthereum) return;
    if (!isValidBPAN(number)) { setError("Enter a valid 11-digit number"); return; }
    setError(""); setLoading(true); setTxHash("");
    try {
      const signer = getSigner(wallet.privateKey, contractRPC);
      const tx = await registerBPAN(number, contractAddr, signer);
      setTxHash(tx.hash);
      await tx.wait();
      onRegistered(number);
    } catch (e: any) {
      setError(e.reason || e.message || "Registration failed");
    } finally { setLoading(false); }
  }

  return (
    <div>
      <div className="premium-card p-3.5 mb-4">
        <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">How it works</p>
        <p className="text-xs text-text-secondary leading-relaxed">
          Register any 11-digit number as your BPAN identity. It mints as an NFT on Ethereum mainnet. You then map wallet addresses for each chain you want to receive on.
        </p>
        {fee && (
          <p className="text-xs text-brand-400 font-medium mt-2">
            Registration fee: {parseFloat(fee) === 0 ? "Free" : `${fee} ETH`}
          </p>
        )}
      </div>

      <label className="text-xs text-text-secondary mb-1.5 block font-medium">Your BPAN number</label>
      <div className="flex gap-2 mb-3">
        <input
          value={number}
          onChange={(e) => {
            setNumber(e.target.value.replace(/\D/g, "").slice(0, 11));
            setAvailable(null);
            setError("");
          }}
          placeholder="e.g. 12345678901"
          className="input-field flex-1"
          maxLength={11}
        />
        <button
          onClick={checkAvailability}
          disabled={checking || number.length !== 11}
          className="px-3 py-2 rounded-xl bg-surface-2 text-text-secondary text-xs font-medium border border-border hover:bg-surface-3 transition-colors flex-shrink-0 disabled:opacity-40"
        >
          {checking ? "..." : "Check"}
        </button>
      </div>

      {available === true && (
        <div className="flex items-center gap-1.5 mb-3 animate-fade-in">
          <CheckIcon size={14} className="text-accent-green" />
          <p className="text-xs text-accent-green font-medium">Available!</p>
        </div>
      )}
      {available === false && (
        <div className="flex items-center gap-1.5 mb-3 animate-fade-in">
          <AlertIcon size={14} style={{ color: "var(--danger)" }} />
          <p className="text-xs font-medium" style={{ color: "var(--danger)" }}>Already taken. Try a different number.</p>
        </div>
      )}

      {error && <p className="text-xs mb-3 animate-fade-in" style={{ color: "var(--danger)" }}>{error}</p>}
      {txHash && <TxSuccess hash={txHash} explorer={network.explorer} />}

      <button
        onClick={handleRegister}
        disabled={loading || !isValidBPAN(number) || available === false}
        className="btn-primary-premium text-[13px]"
      >
        {loading ? (
          <span className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            Registering...
          </span>
        ) : "Register BPAN"}
      </button>
    </div>
  );
}

// ── Mapping ───────────────────────────────────────────────────────────────────

// Returns the auto-derived native address for a non-EVM chain, or "" if unknown.
function autoNonEvmAddress(chainId: string, nonEvmWallet: NonEvmWallet | null): string {
  if (!nonEvmWallet) return "";
  switch (chainId) {
    case "bitcoin":  return nonEvmWallet.bitcoin.address;
    case "litecoin": return nonEvmWallet.litecoin.address; // ltc1 bech32 — distinct from the bitcoin address
    case "solana":   return nonEvmWallet.solana.address;
    case "sui":      return nonEvmWallet.sui.address;
    case "tron":     return nonEvmWallet.tron.address;
    case "xrp":      return nonEvmWallet.xrp.address;
    default:         return "";
  }
}

function MappingSection({
  wallet, network, contractAddr, contractRPC, ownedBPANs, nonEvmWallet, readTarget,
}: {
  wallet: any;
  network: any;
  contractAddr: string;
  contractRPC: string;
  ownedBPANs: string[];
  nonEvmWallet: NonEvmWallet | null;
  readTarget?: BPANReadTarget;
}) {
  const defaultBPAN = ownedBPANs[0] || "";
  const [number, setNumber] = useState(defaultBPAN);
  const [selectedChains, setSelectedChains] = useState<Set<string>>(new Set(["ethereum", "polygon", "arbitrum"]));
  const [showChainPicker, setShowChainPicker] = useState(false);
  const [chainSearch, setChainSearch] = useState("");

  // Separate address fields: one for all EVM chains, one per non-EVM chain
  const [evmAddr, setEvmAddr] = useState(wallet?.address || "");
  const [nonEvmAddrs, setNonEvmAddrs] = useState<Record<string, string>>({});

  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, chain: "" });
  const [txHashes, setTxHashes] = useState<{ chain: string; hash: string }[]>([]);
  const [error, setError] = useState("");

  // Fill EVM address when wallet loads
  useEffect(() => {
    if (wallet?.address && !evmAddr) setEvmAddr(wallet.address);
  }, [wallet?.address]);

  // Auto-fill known non-EVM addresses when nonEvmWallet loads
  useEffect(() => {
    if (!nonEvmWallet) return;
    setNonEvmAddrs((prev) => {
      const next = { ...prev };
      for (const c of BPAN_CHAINS) {
        if (!c.isEVM && !next[c.id]) {
          const auto = autoNonEvmAddress(c.id, nonEvmWallet);
          if (auto) next[c.id] = auto;
        }
      }
      return next;
    });
  }, [nonEvmWallet]);

  // Update default BPAN when owned list loads
  useEffect(() => {
    if (ownedBPANs.length > 0 && !number) setNumber(ownedBPANs[0]);
  }, [ownedBPANs]);

  const isOnEthereum = canWriteBPAN(network.id);

  const filteredChains = BPAN_CHAINS.filter((c) => {
    const q = chainSearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.id.includes(q);
  });

  function toggleChain(id: string) {
    setSelectedChains((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const selectedLabel = selectedChains.size === 0
    ? "Select chains"
    : selectedChains.size === 1
    ? BPAN_CHAINS.find((c) => c.id === Array.from(selectedChains)[0])?.name || "1 chain"
    : `${selectedChains.size} chains selected`;

  const selectedEvmChains = BPAN_CHAINS.filter((c) => c.isEVM && selectedChains.has(c.id));
  const selectedNonEvmChains = BPAN_CHAINS.filter((c) => !c.isEVM && selectedChains.has(c.id));

  // All selected chains have a non-empty address
  const allAddressesFilled =
    (selectedEvmChains.length === 0 || !!evmAddr.trim()) &&
    selectedNonEvmChains.every((c) => !!(nonEvmAddrs[c.id] || "").trim());

  async function handleSetMappings() {
    if (!wallet || !isOnEthereum) return;
    if (!isValidBPAN(number)) { setError("Enter a valid 11-digit BPAN"); return; }
    if (selectedChains.size === 0) { setError("Select at least one chain"); return; }
    if (!allAddressesFilled) { setError("Fill in all wallet addresses before mapping"); return; }

    const chains = Array.from(selectedChains);

    // Validate every address against its chain's format BEFORE any on-chain
    // write. A malformed or wrong-chain mapping in the registry misdirects
    // every future payment to this BPAN.
    for (const chainId of chains) {
      const chainDef = BPAN_CHAINS.find((c) => c.id === chainId);
      const addr = chainDef?.isEVM ? evmAddr.trim() : (nonEvmAddrs[chainId] || "").trim();
      if (!isValidChainAddress(addr, chainId, chainDef?.isEVM ?? true)) {
        setError(`"${addr.slice(0, 24)}${addr.length > 24 ? "…" : ""}" is not a valid ${chainDef?.name || chainId} address.`);
        return;
      }
    }

    setError(""); setLoading(true); setTxHashes([]);
    setProgress({ current: 0, total: chains.length, chain: "" });

    try {
      const signer = getSigner(wallet.privateKey, contractRPC);

      for (let i = 0; i < chains.length; i++) {
        const chainId = chains[i];
        const chainDef = BPAN_CHAINS.find((c) => c.id === chainId);
        const chainName = chainDef?.name || chainId;
        const addr = chainDef?.isEVM ? evmAddr.trim() : (nonEvmAddrs[chainId] || "").trim();

        setProgress({ current: i + 1, total: chains.length, chain: chainName });
        const tx = await setWalletMapping(number, chainId, addr, contractAddr, signer);
        setTxHashes((prev) => [...prev, { chain: chainName, hash: tx.hash }]);
        await tx.wait();
      }
    } catch (e: any) {
      setError(e.reason || e.message || "Failed to set mapping");
    } finally { setLoading(false); }
  }

  if (!isOnEthereum) {
    return (
      <div className="text-center py-8">
        <div className="w-14 h-14 rounded-2xl premium-card flex items-center justify-center mx-auto mb-3">
          <AlertIcon size={24} className="text-muted" />
        </div>
        <p className="text-[13px] text-text-secondary font-medium mb-1">Switch to Ethereum</p>
        <p className="text-xs text-muted">Setting wallet mappings requires Ethereum mainnet or Sepolia.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[13px] text-muted mb-4 leading-relaxed">
        Map your wallet addresses to your BPAN across multiple chains. All mappings are stored on Ethereum mainnet.
      </p>

      <label className="text-xs text-text-secondary mb-1.5 block font-medium">BPAN Number</label>
      {ownedBPANs.length > 1 ? (
        <div className="flex gap-2 mb-3 flex-wrap">
          {ownedBPANs.map((n) => (
            <button
              key={n}
              onClick={() => setNumber(n)}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border transition-colors ${
                number === n
                  ? "bg-brand-500 text-white border-brand-500"
                  : "bg-surface-2 text-text-secondary border-border hover:border-brand-500/40"
              }`}
            >
              {formatBPAN(n)}
            </button>
          ))}
        </div>
      ) : (
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="Your registered BPAN"
          className="input-field mb-3"
        />
      )}

      <label className="text-xs text-text-secondary mb-1.5 block font-medium">Target Chains</label>
      <button
        onClick={() => { setShowChainPicker(!showChainPicker); setChainSearch(""); }}
        className="w-full input-field mb-1.5 text-left flex items-center justify-between"
      >
        <span className={`text-[13px] font-medium ${selectedChains.size === 0 ? "text-muted" : "text-text-primary"}`}>
          {selectedLabel}
        </span>
        <ChevronDownIcon size={14} className={`text-muted transition-transform duration-200 ${showChainPicker ? "rotate-180" : ""}`} />
      </button>

      {showChainPicker && (
        <div className="mb-3 premium-card overflow-hidden animate-slide-up">
          <div className="relative border-b border-border">
            <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
            <input
              value={chainSearch}
              onChange={(e) => setChainSearch(e.target.value)}
              placeholder="Search chains..."
              className="w-full pl-9 pr-3 py-2.5 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-muted/60"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-border">
            <button onClick={() => setSelectedChains(new Set(BPAN_CHAINS.map((c) => c.id)))} className="text-[11px] text-brand-400 font-medium hover:underline">All</button>
            <button onClick={() => setSelectedChains(new Set())} className="text-[11px] text-muted font-medium hover:underline">Clear</button>
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {filteredChains.map((c) => {
              const sel = selectedChains.has(c.id);
              return (
                <button
                  key={c.id}
                  onClick={() => toggleChain(c.id)}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] hover:bg-surface-2 transition-colors ${sel ? "text-brand-400" : "text-text-primary"}`}
                >
                  <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors flex-shrink-0 ${sel ? "bg-brand-500 border-brand-500" : "border-border"}`}>
                    {sel && <CheckIcon size={9} className="text-white" />}
                  </div>
                  <ChainIcon chainId={c.id} logo={c.logo} size={18} />
                  <span className="font-medium flex-1 text-left">{c.name}</span>
                  {!c.isEVM && <span className="text-[9px] text-muted bg-surface-3 px-1 rounded">non-EVM</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* EVM address — shared by all EVM chains */}
      {selectedEvmChains.length > 0 && (
        <div className="mb-3">
          <label className="text-xs text-text-secondary mb-1.5 block font-medium">
            EVM Address
            <span className="text-muted font-normal ml-1.5">({selectedEvmChains.length} chain{selectedEvmChains.length > 1 ? "s" : ""})</span>
          </label>
          <div className="flex gap-2">
            <input
              value={evmAddr}
              onChange={(e) => setEvmAddr(e.target.value)}
              placeholder="0x..."
              className="input-field flex-1 font-mono text-[12px]"
            />
            <button
              onClick={() => wallet && setEvmAddr(wallet.address)}
              className="px-3 py-2 rounded-xl bg-brand-500/8 text-brand-400 text-xs font-medium border border-brand-500/15 hover:bg-brand-500/15 transition-colors flex-shrink-0"
            >
              Mine
            </button>
          </div>
        </div>
      )}

      {/* Per-chain address for each selected non-EVM chain */}
      {selectedNonEvmChains.length > 0 && (
        <div className="mb-3 space-y-2">
          <label className="text-xs text-text-secondary block font-medium">Non-EVM Addresses</label>
          {selectedNonEvmChains.map((c) => {
            const auto = autoNonEvmAddress(c.id, nonEvmWallet);
            const val = nonEvmAddrs[c.id] || "";
            return (
              <div key={c.id}>
                <div className="flex items-center gap-1.5 mb-1">
                  <ChainIcon chainId={c.id} logo={c.logo} size={14} />
                  <span className="text-[11px] text-text-secondary font-medium">{c.name}</span>
                  {auto && val === auto && (
                    <span className="text-[9px] bg-accent-green/10 text-accent-green px-1.5 py-0.5 rounded-full border border-accent-green/20 font-medium">auto</span>
                  )}
                </div>
                <div className="flex gap-2">
                  <input
                    value={val}
                    onChange={(e) => setNonEvmAddrs((prev) => ({ ...prev, [c.id]: e.target.value }))}
                    placeholder={auto || `${c.name} address`}
                    className="input-field flex-1 font-mono text-[12px]"
                  />
                  {auto && (
                    <button
                      onClick={() => setNonEvmAddrs((prev) => ({ ...prev, [c.id]: auto }))}
                      className="px-3 py-2 rounded-xl bg-brand-500/8 text-brand-400 text-xs font-medium border border-brand-500/15 hover:bg-brand-500/15 transition-colors flex-shrink-0"
                    >
                      Mine
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {error && <p className="text-xs mb-3 animate-fade-in" style={{ color: "var(--danger)" }}>{error}</p>}

      {loading && (
        <div className="mb-3 premium-card p-3 animate-fade-in">
          <div className="flex items-center justify-between mb-1.5">
            <p className="text-xs text-text-secondary font-medium">Setting mappings on mainnet...</p>
            <p className="text-xs text-brand-400 font-semibold">{progress.current}/{progress.total}</p>
          </div>
          <div className="w-full h-1.5 rounded-full bg-surface-3 overflow-hidden mb-1.5">
            <div
              className="h-full bg-brand-500 rounded-full transition-all duration-300"
              style={{ width: `${(progress.current / progress.total) * 100}%` }}
            />
          </div>
          <p className="text-[11px] text-muted">Processing: {progress.chain}</p>
        </div>
      )}

      {txHashes.length > 0 && (
        <div className="mb-3 space-y-1 animate-slide-up">
          {txHashes.map((tx, i) => (
            <div key={i} className="premium-card px-3 py-2 flex items-center gap-2">
              <div className="w-4 h-4 rounded-full bg-accent-green/15 flex items-center justify-center flex-shrink-0">
                <CheckIcon size={8} className="text-accent-green" />
              </div>
              <span className="text-[11px] text-text-secondary font-medium w-24 truncate">{tx.chain}</span>
              <a
                href={`${NETWORKS[network.id]?.explorer || "https://etherscan.io"}/tx/${tx.hash}`}
                target="_blank"
                rel="noopener noreferrer"
                className="text-[11px] text-brand-400 font-mono truncate hover:underline flex-1"
              >
                {tx.hash.slice(0, 14)}...{tx.hash.slice(-6)}
              </a>
              <ExternalLinkIcon size={10} className="text-muted flex-shrink-0" />
            </div>
          ))}
        </div>
      )}

      <button
        onClick={handleSetMappings}
        disabled={loading || selectedChains.size === 0 || !allAddressesFilled}
        className="btn-primary-premium text-[13px]"
      >
        {loading
          ? `Mapping ${progress.current}/${progress.total}...`
          : selectedChains.size > 1
          ? `Set ${selectedChains.size} Mappings`
          : "Set Mapping"}
      </button>
    </div>
  );
}

// ── Lookup ────────────────────────────────────────────────────────────────────
function LookupSection({ readTarget }: { readTarget?: BPANReadTarget }) {
  const [number, setNumber] = useState("");
  const [result, setResult] = useState<{ chains: string[]; wallets: string[] } | null>(null);
  const [owner, setOwner] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  async function handleLookup() {
    const clean = number.trim().replace(/\D/g, "");
    if (!isValidBPAN(clean)) { setError("Enter a valid 11-digit BPAN number"); return; }
    setError(""); setLoading(true); setResult(null); setOwner("");
    try {
      const registered = await isBPANRegistered(clean, readTarget);
      if (!registered) { setError("This number is not registered"); setLoading(false); return; }
      const [m, o] = await Promise.all([getAllBPANMappings(clean, readTarget), getBPANOwner(clean, readTarget)]);
      setResult(m);
      setOwner(o);
    } catch (e: any) {
      setError(e.reason || e.message || "Lookup failed");
    } finally { setLoading(false); }
  }

  return (
    <div>
      <div className="relative mb-3">
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="11-digit BPAN number"
          className="input-field pr-10"
          onKeyDown={(e) => e.key === "Enter" && handleLookup()}
        />
        <SearchIcon size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted" />
      </div>

      <button onClick={handleLookup} disabled={loading} className="btn-primary-premium mb-4 text-[13px]">
        {loading ? (
          <span className="flex items-center gap-2">
            <div className="w-4 h-4 border-2 border-white/40 border-t-white rounded-full animate-spin" />
            Looking up on Ethereum mainnet...
          </span>
        ) : "Lookup"}
      </button>

      {error && <p className="text-xs mb-3 animate-fade-in" style={{ color: "var(--danger)" }}>{error}</p>}

      {owner && (
        <div className="mb-3 premium-card px-3.5 py-3 animate-slide-up">
          <p className="text-[11px] text-muted uppercase tracking-wider mb-1 font-medium">NFT Owner</p>
          <p className="text-xs font-mono text-text-primary break-all">{owner}</p>
        </div>
      )}

      {result && result.chains.length > 0 && (
        <div className="space-y-1.5 animate-slide-up">
          <p className="section-label mb-2">Wallet Mappings ({result.chains.length} chains)</p>
          {result.chains.map((chain, i) => (
            <div key={i} className="premium-card px-3.5 py-2.5 flex items-center gap-2.5">
              <ChainIcon chainId={chain} size={22} />
              <div className="flex-1 min-w-0">
                <p className="text-[11px] text-brand-400 capitalize font-semibold">{chain}</p>
                <p className="text-[11px] font-mono text-text-primary break-all">{result.wallets[i]}</p>
              </div>
            </div>
          ))}
        </div>
      )}

      {result && result.chains.length === 0 && (
        <p className="text-xs text-muted text-center py-4">No wallet mappings set for this BPAN</p>
      )}
    </div>
  );
}

function TxSuccess({ hash, explorer }: { hash: string; explorer: string }) {
  return (
    <div className="mb-3 premium-card p-3 animate-slide-up">
      <div className="flex items-center gap-1.5 mb-1">
        <div className="w-4 h-4 rounded-full bg-accent-green/15 flex items-center justify-center">
          <CheckIcon size={10} className="text-accent-green" />
        </div>
        <p className="text-accent-green text-xs font-semibold">Transaction submitted!</p>
      </div>
      <a
        href={`${explorer}/tx/${hash}`}
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-1 text-brand-400 text-[11px] break-all hover:underline"
      >
        {hash.slice(0, 22)}...{hash.slice(-8)}
        <ExternalLinkIcon size={10} />
      </a>
    </div>
  );
}
