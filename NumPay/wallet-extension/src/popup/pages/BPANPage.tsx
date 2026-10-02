import { BPAN_DEPLOYMENT, BPAN_UNAVAILABLE_MESSAGE, bpanOwnershipKey } from "@numpay/core/bpanDeployment";
import { useState, useEffect } from "react";
import { ethers } from "ethers";
import { useWallet } from "../hooks/useWallet";
import { type NonEvmWallet } from "@numpay/core/chains";
import {
  getBPANContract, isValidBPAN, formatBPAN,
  getAllBPANMappings, isBPANRegistered, getBPANOwner,
  registerBPAN, setWalletMapping, findOwnedBPANs,
} from "@numpay/core/bpan";
import {
  BPAN_MAINNET_CONTRACT,
  BPAN_MAINNET_RPC, NETWORKS, BPAN_CHAINS,
} from "@numpay/core/networks";
import { getSigner, isLocked } from "@numpay/core/wallet";
import { isValidChainAddress } from "@numpay/core/addressValidation";
import Layout from "../components/Layout";
import AlertCard, { InlineNotice } from "../components/AlertCard";
import {
  SearchIcon, CheckIcon, ExternalLinkIcon, ChevronDownIcon,
  CopyIcon, HashIcon, RefreshIcon, LayersIcon, AlertIcon, GlobeIcon,
} from "../components/Icons";
import { ChainIcon } from "../components/Icons";

type Tab = "my-bpan" | "register" | "mapping" | "lookup";

// ── localStorage helpers ──────────────────────────────────────────────────────
function getSavedBPANs(address: string): string[] {
  try { return JSON.parse(localStorage.getItem(bpanOwnershipKey(address)) || "[]"); }
  catch { return []; }
}
function saveBPAN(address: string, number: string) {
  const saved = getSavedBPANs(address);
  if (!saved.includes(number)) {
    saved.unshift(number);
    localStorage.setItem(bpanOwnershipKey(address), JSON.stringify(saved));
  }
}
function removeBPAN(address: string, number: string) {
  localStorage.setItem(
    bpanOwnershipKey(address),
    JSON.stringify(getSavedBPANs(address).filter((n) => n !== number))
  );
}
// Display label for a registry mapping key ("evm" is the opt-in key that
// covers every EVM chain — see BPAN_EVM_KEY in lib/bpan.ts).
function bpanChainLabel(chain: string): string {
  if (chain === "evm") return "All EVM chains";
  return BPAN_CHAINS.find((c) => c.id === chain)?.name ?? chain;
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

function canWriteBPAN(networkId: string): boolean {
  return BPAN_DEPLOYMENT.deployed && networkId === BPAN_DEPLOYMENT.networkId;
}

// ── Main page ──────────────────────────────────────────────────────────────────
export default function BPANPage() {
  const { wallet, network, nonEvmWallet, switchNetwork } = useWallet();
  const [tab, setTab] = useState<Tab>("my-bpan");

  // Central ownership state — shared by all tabs
  const [ownedBPANs, setOwnedBPANs] = useState<string[]>([]);
  const [ownershipLoading, setOwnershipLoading] = useState(true);
  const [ownershipError, setOwnershipError] = useState(false);
  const [scanRevision, setScanRevision] = useState(0);

  const isOnRegistry = canWriteBPAN(network.id);
  const contractAddr = BPAN_MAINNET_CONTRACT;
  const contractRPC = BPAN_MAINNET_RPC;

  // A wallet or deployment change must cancel the old scan and load only
  // this registry's cache. Never mix ownership from different wallets.
  useEffect(() => {
    if (!BPAN_DEPLOYMENT.deployed) { setOwnedBPANs([]); setOwnershipLoading(false); return; }
    if (!wallet?.address) { setOwnedBPANs([]); setOwnershipLoading(false); return; }
    let live = true;
    const address = wallet.address;
    setOwnedBPANs(getSavedBPANs(address));
    setOwnershipLoading(true);
    setOwnershipError(false);
    (async () => {
      try {
        const found = await findOwnedBPANs(address);
        if (!live) return;
        localStorage.setItem(bpanOwnershipKey(address), JSON.stringify(found));
        setOwnedBPANs(found);
      } catch { if (live) setOwnershipError(true); }
      finally { if (live) setOwnershipLoading(false); }
    })();
    return () => { live = false; };
  }, [wallet?.address, scanRevision]);

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

  if (!BPAN_DEPLOYMENT.deployed) return (
    <Layout>
      <div className="app-bg min-h-full px-4 py-4">
        <h2 className="text-lg font-bold text-text-primary mb-3">BPAN</h2>
        <div role="status" className="premium-card p-4">
          <p className="text-sm font-semibold text-text-primary mb-2">Coming to Base</p>
          <p className="text-xs text-text-secondary">{BPAN_UNAVAILABLE_MESSAGE}</p>
        </div>
      </div>
    </Layout>
  );

  return (
    <Layout>
      <div className="app-bg min-h-full">
        <div className="px-4 py-4">

          {/* Header */}
          <div className="flex items-center gap-2 mb-1">
            <h2 className="text-lg font-bold text-text-primary">BPAN</h2>
          </div>
          <div className="flex items-center gap-1.5 mb-4">
            <GlobeIcon size={11} className="text-muted" />
            <p className="text-[11px] text-muted">
              Registry: <span className="text-brand-400 font-medium">{BPAN_DEPLOYMENT.name}</span>
            </p>
          </div>

          {/* Write-action warning when not on Base */}
          {!isOnRegistry && (tab === "register" || tab === "mapping") && (
            <AlertCard
              title="Base is required"
              body={`Registration and mapping changes happen on ${BPAN_DEPLOYMENT.name}. Lookups still work from any network.`}
              tone="amber"
              action={{ label: `Switch to ${BPAN_DEPLOYMENT.name}`, onClick: () => switchNetwork(BPAN_DEPLOYMENT.networkId) }}
            />
          )}

          {/* Tab row */}
          <div role="tablist" aria-label="BPAN" className="flex premium-card p-1 mb-5 gap-0.5">
            {TABS.map((t) => (
              <button
                key={t.id}
                role="tab"
                id={`bpan-tab-${t.id}`}
                aria-selected={tab === t.id}
                aria-controls={`bpan-panel-${t.id}`}
                tabIndex={tab === t.id ? 0 : -1}
                onKeyDown={(event) => {
                  const index = TABS.findIndex((item) => item.id === t.id);
                  const next = event.key === "ArrowRight" ? (index + 1) % TABS.length
                    : event.key === "ArrowLeft" ? (index + TABS.length - 1) % TABS.length
                    : event.key === "Home" ? 0 : event.key === "End" ? TABS.length - 1 : -1;
                  if (next < 0) return;
                  event.preventDefault();
                  // Manual activation avoids clearing an unfinished form on arrow navigation.
                  document.getElementById(`bpan-tab-${TABS[next].id}`)?.focus();
                }}
                onClick={() => setTab(t.id)}
                className={`flex-1 py-2 text-[11px] rounded-lg font-medium transition-all duration-150 ${
                  tab === t.id
                    ? "bg-brand-600 text-white shadow-lg shadow-brand-500/30"
                    : "text-text-secondary hover:text-text-primary"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>

          {TABS.map((panel) => (
          <div key={panel.id} role="tabpanel" id={`bpan-panel-${panel.id}`} aria-labelledby={`bpan-tab-${panel.id}`} hidden={tab !== panel.id} tabIndex={0} className="motion-safe:animate-slide-up">
            {tab === panel.id && (<>
            {tab === "my-bpan" && (
              <MyBPANSection
                wallet={wallet}
                ownedBPANs={ownedBPANs}
                loading={ownershipLoading}
                error={ownershipError}
                onRetry={() => setScanRevision((value) => value + 1)}
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
                onRegistered={handleRegistered}
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
              />
            )}
            {tab === "lookup" && <LookupSection />}
            </>)}
          </div>
          ))}
        </div>
      </div>
    </Layout>
  );
}

// ── My BPAN ───────────────────────────────────────────────────────────────────
function MyBPANSection({
  wallet, ownedBPANs, loading, error, onRetry, onRemove, onGoRegister, onGoMapping,
}: {
  wallet: any;
  ownedBPANs: string[];
  loading: boolean;
  error: boolean;
  onRetry: () => void;
  onRemove: (n: string) => void;
  onGoRegister: () => void;
  onGoMapping: () => void;
}) {
  if (loading && ownedBPANs.length === 0) {
    return (
      <div role="status" aria-label="Loading your BPANs" className="premium-card p-3.5">
        <span className="sr-only">Loading your BPANs</span>
        <div aria-hidden="true" className="flex items-center gap-3 motion-safe:animate-pulse">
          <div className="w-10 h-10 rounded-xl bg-surface-3" />
          <div className="flex-1 space-y-2">
            <div className="h-4 w-36 rounded bg-surface-3" />
            <div className="h-3 w-20 rounded bg-surface-3" />
          </div>
        </div>
      </div>
    );
  }

  const scanFailure = error && (
    <AlertCard
      title="Could not refresh BPANs"
      body={ownedBPANs.length > 0 ? "Showing saved numbers from this device." : "Check your connection and try again."}
      tone="amber"
      urgent
      action={{ label: "Retry", onClick: onRetry }}
      className="mb-2"
    />
  );
  if (error && ownedBPANs.length === 0) return scanFailure;

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
      {scanFailure}
      {loading && (
        <div className="flex items-center gap-2 mb-1">
          <div className="w-3 h-3 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-[11px] text-muted">Refreshing your BPANs...</p>
        </div>
      )}
      {ownedBPANs.map((num) => (
        <BPANCard
          key={`${BPAN_DEPLOYMENT.chainId}:${num}`}
          number={num}
          walletAddress={wallet?.address}
          onRemove={() => onRemove(num)}
          onGoMapping={onGoMapping}
        />
      ))}
    </div>
  );
}

function BPANCard({
  number, walletAddress, onRemove, onGoMapping,
}: {
  number: string;
  walletAddress?: string;
  onRemove: () => void;
  onGoMapping: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [mappings, setMappings] = useState<{ chains: string[]; wallets: string[] } | null>(null);
  const [owner, setOwner] = useState("");
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [detailError, setDetailError] = useState(false);

  useEffect(() => {
    if (expanded && !mappings) loadDetail();
  }, [expanded]);

  async function loadDetail() {
    setLoadingDetail(true);
    setDetailError(false);
    try {
      const [m, o] = await Promise.all([
        getAllBPANMappings(number),
        getBPANOwner(number),
      ]);
      setMappings(m);
      setOwner(o);
    } catch { setDetailError(true); }
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
            <span className="inline-block text-[10px] bg-accent-green/10 bpan-success px-1.5 py-0.5 rounded-full font-medium mt-0.5 border border-accent-green/20">
              Owner
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            aria-label={copied ? "BPAN copied" : `Copy BPAN ${formatted}`}
            onClick={async () => { await copyText(number); setCopied(true); setTimeout(() => setCopied(false), 1500); }}
            className="p-2 min-w-8 min-h-8 rounded-lg hover:bg-surface-2 transition-colors"
          >
            {copied
              ? <CheckIcon size={14} className="bpan-success" />
              : <CopyIcon size={14} className="text-muted" />}
          </button>
          <button
            aria-label={`${expanded ? "Hide" : "Show"} details for BPAN ${formatted}`}
            aria-expanded={expanded}
            aria-controls={`bpan-details-${number}`}
            onClick={() => setExpanded(!expanded)}
            className="p-2 min-w-8 min-h-8 rounded-lg hover:bg-surface-2 transition-colors"
          >
            <ChevronDownIcon size={14} className={`text-muted transition-transform duration-200 ${expanded ? "rotate-180" : ""}`} />
          </button>
        </div>
      </div>

      {expanded && (
        <div id={`bpan-details-${number}`} className="px-3.5 pb-3 border-t border-border pt-2.5 animate-slide-up">
          {detailError && <InlineNotice message="Could not refresh mappings. Try Refresh again." tone="amber" className="mb-2" />}
          {loadingDetail && (
            <div className="flex items-center gap-2 py-2">
              <div className="w-4 h-4 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
              <p className="text-xs text-muted">Loading from {BPAN_DEPLOYMENT.name}...</p>
            </div>
          )}

          {mappings && mappings.chains.length > 0 && (
            <div className="space-y-1.5 mb-2.5">
              <p className="text-[11px] text-muted uppercase tracking-wider font-medium">Wallet Mappings</p>
              {mappings.chains.map((chain, i) => (
                <div key={i} className="flex items-center gap-2 py-1">
                  <ChainIcon chainId={chain === "evm" ? "ethereum" : chain} size={16} />
                  <span className="text-[11px] text-brand-400 font-medium w-24 flex-shrink-0 capitalize">{bpanChainLabel(chain)}</span>
                  <span className="text-[10px] font-mono text-text-secondary break-all flex-1">
                    {mappings.wallets[i].slice(0, 8)}...{mappings.wallets[i].slice(-6)}
                  </span>
                </div>
              ))}
            </div>
          )}

          {!loadingDetail && !detailError && mappings && mappings.chains.length === 0 && (
            <p className="text-xs text-muted mb-2.5">No mappings set yet.</p>
          )}

          <div className="flex items-center gap-2">
            <button onClick={loadDetail} className="text-[11px] text-brand-400 font-medium hover:underline">Refresh</button>
            <span className="text-muted text-xs">·</span>
            <button onClick={onGoMapping} className="text-[11px] text-brand-400 font-medium hover:underline">Add mappings</button>
            <span className="text-muted text-xs">·</span>
            <button onClick={onRemove} className="text-[11px] font-medium hover:underline" style={{ color: "var(--danger-text)" }}>Remove</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Register ──────────────────────────────────────────────────────────────────
function RegisterSection({
  wallet, network, contractAddr, contractRPC, onRegistered,
}: {
  wallet: any;
  network: any;
  contractAddr: string;
  contractRPC: string;
  onRegistered: (n: string) => void;
}) {
  const [number, setNumber] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [fee, setFee] = useState<string | null>(null);

  const isOnRegistry = canWriteBPAN(network.id);

  useEffect(() => {
    if (!isOnRegistry) return;
    (async () => {
      try {
        const provider = new ethers.JsonRpcProvider(contractRPC);
        const contract = getBPANContract(contractAddr, provider);
        const f: bigint = await contract.registrationFee();
        setFee(ethers.formatEther(f));
      } catch {}
    })();
  }, [contractAddr, contractRPC, isOnRegistry]);

  if (!isOnRegistry) {
    return (
      <div className="text-center py-8">
        <div className="w-14 h-14 rounded-2xl premium-card flex items-center justify-center mx-auto mb-3">
          <AlertIcon size={24} className="text-muted" />
        </div>
        <p className="text-[13px] text-text-secondary font-medium mb-1">Switch to {BPAN_DEPLOYMENT.name}</p>
        <p className="text-xs text-muted">BPAN registration requires {BPAN_DEPLOYMENT.name}.</p>
      </div>
    );
  }

  async function checkAvailability() {
    if (!isValidBPAN(number)) { setError("Enter a valid 11-digit number"); return; }
    setError(""); setAvailable(null); setChecking(true);
    try {
      const registered = await isBPANRegistered(number);
      setAvailable(!registered);
    } catch {
      setError("Check failed. Verify your connection.");
    } finally { setChecking(false); }
  }

  async function handleRegister() {
    if (!wallet || !isOnRegistry) return;
    if (!isValidBPAN(number)) { setError("Enter a valid 11-digit number"); return; }
    // Authoritative lock check before any key is used: auto-lock clears the
    // session, but an open popup can still hold this wallet in memory until it
    // re-renders as locked, so the signing paths must re-check (H-06).
    if (await isLocked()) { setError("Wallet is locked. Reopen NumPay to unlock, then try again."); return; }
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
          Choose an 11-digit number, then add addresses to receive payments.
        </p>
        {fee && (
          <p className="text-xs text-brand-400 font-medium mt-2">
            Registration fee: {parseFloat(fee) === 0 ? "0 ETH" : `${fee} ETH`}. Network gas is paid in ETH on {BPAN_DEPLOYMENT.name}.
          </p>
        )}
      </div>

      <label htmlFor="bpan-register-number" className="text-xs text-text-secondary mb-1.5 block font-medium">Your BPAN number</label>
      <div className="flex gap-2 mb-3">
        <input
          id="bpan-register-number"
          inputMode="numeric"
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
          <CheckIcon size={14} className="bpan-success" />
          <p role="status" className="text-xs bpan-success font-medium">Available!</p>
        </div>
      )}
      {available === false && (
        <InlineNotice message="Already taken. Try a different number." className="mb-3" />
      )}

      {error && <InlineNotice message={error} className="mb-3" />}
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
  wallet, network, contractAddr, contractRPC, ownedBPANs, nonEvmWallet,
}: {
  wallet: any;
  network: any;
  contractAddr: string;
  contractRPC: string;
  ownedBPANs: string[];
  nonEvmWallet: NonEvmWallet | null;
}) {
  const defaultBPAN = ownedBPANs[0] || "";
  const [number, setNumber] = useState(defaultBPAN);
  // "evm" is a single synthetic picker entry covering every EVM chain (one
  // registry mapping, one tx — see BPAN_EVM_KEY in lib/bpan.ts). Only non-EVM
  // chains are listed individually.
  const [selectedChains, setSelectedChains] = useState<Set<string>>(new Set(["evm"]));
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

  // Existing on-chain mappings for the selected BPAN (key -> address). A chain
  // already mapped to the SAME address is a no-op write: it is badged "mapped"
  // and skipped from the tx batch, so the user never pays gas to re-write an
  // identical mapping. A DIFFERENT address stays writable (a legitimate
  // update). null = not loaded / load failed → skip nothing.
  const [existingMap, setExistingMap] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    setExistingMap(null);
    if (!isValidBPAN(number)) return;
    let stale = false;
    getAllBPANMappings(number)
      .then((m) => {
        if (!stale) setExistingMap(Object.fromEntries(m.chains.map((c, i) => [c, m.wallets[i]])));
      })
      .catch(() => { /* stays null — no skipping without data */ });
    return () => { stale = true; };
  }, [number]);

  // "Up to date" = an existing mapping equals what would be written (EVM
  // addresses compare case-insensitively; base58/bech32 chains exactly).
  const evmUpToDate =
    !!existingMap?.["evm"] &&
    existingMap["evm"].trim().toLowerCase() === evmAddr.trim().toLowerCase();
  const nonEvmUpToDate = (id: string) =>
    !!existingMap?.[id] && existingMap[id].trim() === (nonEvmAddrs[id] || "").trim();

  const isOnRegistry = canWriteBPAN(network.id);

  const evmChains = BPAN_CHAINS.filter((c) => c.isEVM);
  const q = chainSearch.toLowerCase();
  // Individually listed entries are non-EVM only; the EVM chains ride the
  // single "All EVM chains" row above the list.
  const filteredChains = BPAN_CHAINS.filter(
    (c) => !c.isEVM && (c.name.toLowerCase().includes(q) || c.id.includes(q)),
  );
  // Show the EVM row when the search is empty or matches "evm"/any EVM chain.
  const evmRowVisible =
    !q || "all evm chains".includes(q) ||
    evmChains.some((c) => c.name.toLowerCase().includes(q) || c.id.includes(q));

  function toggleChain(id: string) {
    setSelectedChains((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  const evmSelected = selectedChains.has("evm");
  const selectedNonEvmChains = BPAN_CHAINS.filter((c) => !c.isEVM && selectedChains.has(c.id));

  const labelParts: string[] = [];
  if (evmSelected) labelParts.push("All EVM chains");
  for (const c of selectedNonEvmChains) labelParts.push(c.name);
  const selectedLabel =
    labelParts.length === 0 ? "Select chains"
    : labelParts.length <= 2 ? labelParts.join(" + ")
    : evmSelected ? `All EVM + ${selectedNonEvmChains.length} non-EVM`
    : `${selectedNonEvmChains.length} chains selected`;

  // All selected chains have a non-empty address
  const allAddressesFilled =
    (!evmSelected || !!evmAddr.trim()) &&
    selectedNonEvmChains.every((c) => !!(nonEvmAddrs[c.id] || "").trim());

  async function handleSetMappings() {
    if (!wallet || !isOnRegistry) return;
    if (!isValidBPAN(number)) { setError("Enter a valid 11-digit BPAN"); return; }
    if (selectedChains.size === 0) { setError("Select at least one chain"); return; }
    if (!allAddressesFilled) { setError("Fill in all wallet addresses before mapping"); return; }

    // Validate every address against its chain's format BEFORE any on-chain
    // write. A malformed or wrong-chain mapping in the registry misdirects
    // every future payment to this BPAN. The synthetic "evm" entry validates
    // as an EVM address.
    if (evmSelected && !isValidChainAddress(evmAddr.trim(), "ethereum", true)) {
      const a = evmAddr.trim();
      setError(`"${a.slice(0, 24)}${a.length > 24 ? "…" : ""}" is not a valid EVM address.`);
      return;
    }
    for (const c of selectedNonEvmChains) {
      const addr = (nonEvmAddrs[c.id] || "").trim();
      if (!isValidChainAddress(addr, c.id, false)) {
        setError(`"${addr.slice(0, 24)}${addr.length > 24 ? "…" : ""}" is not a valid ${c.name} address.`);
        return;
      }
    }

    // Authoritative lock check before any key is used (H-06): see handleRegister.
    if (await isLocked()) { setError("Wallet is locked. Reopen NumPay to unlock, then try again."); return; }

    setError(""); setLoading(true); setTxHashes([]);

    try {
      // Re-read the CURRENT on-chain mappings (fresh, not the UI cache): they
      // drive both the no-op skip and the stale-override rewrites below.
      let existing: Record<string, string> | null = null;
      try {
        const m = await getAllBPANMappings(number);
        existing = Object.fromEntries(m.chains.map((c, i) => [c, m.wallets[i]]));
        setExistingMap(existing);
      } catch {
        existing = null;
      }

      // Build the write list. All selected EVM chains collapse into ONE
      // "evm" mapping (the resolver falls back to it for any EVM chain with
      // no exact mapping) — one mainnet tx instead of one per chain. Exact
      // per-chain mappings WIN over the fallback at resolution time, so any
      // existing per-chain EVM mapping that points at a DIFFERENT address
      // must be rewritten in the same batch, or it would silently keep
      // overriding the new evm mapping. Non-EVM chains stay per-chain.
      // A chain whose existing mapping ALREADY equals the address being
      // written is skipped — never pay gas for a no-op.
      const writes: { key: string; addr: string; label: string }[] = [];
      if (evmSelected) {
        if (!existing) {
          setError("Could not read this BPAN's current mappings (needed to check for per-chain overrides). Try again.");
          return;
        }
        const addr = evmAddr.trim();
        if ((existing["evm"] ?? "").trim().toLowerCase() !== addr.toLowerCase()) {
          writes.push({ key: "evm", addr, label: "All EVM chains" });
        }
        for (const [cid, mapped] of Object.entries(existing)) {
          const def = BPAN_CHAINS.find((c) => c.id === cid);
          if (def?.isEVM && mapped.toLowerCase() !== addr.toLowerCase()) {
            writes.push({ key: cid, addr, label: def.name });
          }
        }
      }
      for (const c of selectedNonEvmChains) {
        const addr = (nonEvmAddrs[c.id] || "").trim();
        if (existing && (existing[c.id] ?? "").trim() === addr) continue; // already mapped
        writes.push({ key: c.id, addr, label: c.name });
      }

      if (writes.length === 0) {
        setError("Everything selected is already mapped to these addresses — nothing to write.");
        return;
      }

      setProgress({ current: 0, total: writes.length, chain: "" });
      const signer = getSigner(wallet.privateKey, contractRPC);

      for (let i = 0; i < writes.length; i++) {
        const w = writes[i];
        setProgress({ current: i + 1, total: writes.length, chain: w.label });
        const tx = await setWalletMapping(number, w.key, w.addr, contractAddr, signer);
        setTxHashes((prev) => [...prev, { chain: w.label, hash: tx.hash }]);
        await tx.wait();
        // Reflect the confirmed write in the UI cache so rows flip to
        // "mapped" and the tx count updates without a refetch.
        setExistingMap((prev) => ({ ...(prev ?? {}), [w.key]: w.addr }));
      }
    } catch (e: any) {
      setError(e.reason || e.message || "Failed to set mapping");
    } finally { setLoading(false); }
  }

  if (!isOnRegistry) {
    return (
      <div className="text-center py-8">
        <div className="w-14 h-14 rounded-2xl premium-card flex items-center justify-center mx-auto mb-3">
          <AlertIcon size={24} className="text-muted" />
        </div>
        <p className="text-[13px] text-text-secondary font-medium mb-1">Switch to {BPAN_DEPLOYMENT.name}</p>
        <p className="text-xs text-muted">Setting wallet mappings requires {BPAN_DEPLOYMENT.name}.</p>
      </div>
    );
  }

  return (
    <div>
      <p className="text-[13px] text-muted mb-4 leading-relaxed">
        Map your wallet addresses to your BPAN across multiple chains. All mappings are stored on {BPAN_DEPLOYMENT.name}.
      </p>

      <label className="text-xs text-text-secondary mb-1.5 block font-medium">BPAN Number</label>
      {ownedBPANs.length > 1 ? (
        <div className="flex gap-2 mb-3 flex-wrap">
          {ownedBPANs.map((n) => (
            <button
              key={n}
              aria-pressed={number === n}
              onClick={() => setNumber(n)}
              className={`px-3 py-1.5 rounded-xl text-xs font-mono font-semibold border transition-colors ${
                number === n
                  ? "bg-brand-600 text-white border-brand-600"
                  : "bg-surface-2 text-text-secondary border-border hover:border-brand-500/40"
              }`}
            >
              {formatBPAN(n)}
            </button>
          ))}
        </div>
      ) : (
        <input
          id="bpan-mapping-number" aria-label="Registered BPAN number"
          inputMode="numeric"
          value={number}
          onChange={(e) => setNumber(e.target.value.replace(/\D/g, "").slice(0, 11))}
          placeholder="Your registered BPAN"
          className="input-field mb-3"
        />
      )}

      <label className="text-xs text-text-secondary mb-1.5 block font-medium">Target Chains</label>
      <button
        aria-expanded={showChainPicker}
        aria-label={`Target chains: ${selectedLabel}`}
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
              aria-label="Search chains"
              value={chainSearch}
              onChange={(e) => setChainSearch(e.target.value)}
              placeholder="Search chains..."
              className="w-full pl-9 pr-3 py-2.5 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-muted/60"
              autoFocus
            />
          </div>
          <div className="flex items-center justify-between px-3.5 py-1.5 border-b border-border">
            <button onClick={() => setSelectedChains(new Set(["evm", ...BPAN_CHAINS.filter((c) => !c.isEVM).map((c) => c.id)]))} className="text-[11px] text-brand-400 font-medium hover:underline">All</button>
            <button onClick={() => setSelectedChains(new Set())} className="text-[11px] text-muted font-medium hover:underline">Clear</button>
          </div>
          <div className="max-h-[200px] overflow-y-auto">
            {/* One row = every EVM chain (a single "evm" registry mapping) */}
            {evmRowVisible && (
              <button
                role="checkbox" aria-checked={evmSelected}
                onClick={() => toggleChain("evm")}
                className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] hover:bg-surface-2 transition-colors border-b border-border ${evmSelected ? "text-brand-400" : "text-text-primary"}`}
              >
                <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors flex-shrink-0 ${evmSelected ? "bg-brand-500 border-brand-500" : "border-border"}`}>
                  {evmSelected && <CheckIcon size={9} className="text-white" />}
                </div>
                <div className="flex-1 text-left min-w-0">
                  <span className="font-medium block">All EVM chains</span>
                  <div className="flex items-center mt-1">
                    {evmChains.slice(0, 9).map((c, i) => (
                      <div key={c.id} className={i > 0 ? "-ml-1.5" : ""} style={{ zIndex: 9 - i }}>
                        <ChainIcon chainId={c.id} logo={c.logo} size={15} />
                      </div>
                    ))}
                    {evmChains.length > 9 && (
                      <span className="text-[9px] text-muted ml-1.5 font-medium">+{evmChains.length - 9} more</span>
                    )}
                  </div>
                </div>
                {evmUpToDate ? (
                  <span className="text-[9px] bpan-success bg-accent-green/10 px-1.5 py-0.5 rounded-full border border-accent-green/20 font-medium flex-shrink-0">mapped</span>
                ) : (
                  <span className="text-[9px] text-brand-400 bg-brand-500/10 px-1.5 py-0.5 rounded-full border border-brand-500/20 font-medium flex-shrink-0">1 tx</span>
                )}
              </button>
            )}
            {filteredChains.map((c) => {
              const sel = selectedChains.has(c.id);
              return (
                <button
                  key={c.id}
                  role="checkbox" aria-checked={sel}
                  onClick={() => toggleChain(c.id)}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] hover:bg-surface-2 transition-colors ${sel ? "text-brand-400" : "text-text-primary"}`}
                >
                  <div className={`w-4 h-4 rounded flex items-center justify-center border transition-colors flex-shrink-0 ${sel ? "bg-brand-500 border-brand-500" : "border-border"}`}>
                    {sel && <CheckIcon size={9} className="text-white" />}
                  </div>
                  <ChainIcon chainId={c.id} logo={c.logo} size={18} />
                  <span className="font-medium flex-1 text-left">{c.name}</span>
                  {nonEvmUpToDate(c.id) && (
                    <span className="text-[9px] bpan-success bg-accent-green/10 px-1.5 py-0.5 rounded-full border border-accent-green/20 font-medium flex-shrink-0">mapped</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* EVM address — one "evm" mapping covers every EVM chain */}
      {evmSelected && (
        <div className="mb-3">
          <label className="text-xs text-text-secondary mb-1.5 block font-medium">
            EVM Address
            {evmUpToDate ? (
              <span className="bpan-success font-normal ml-1.5">✓ already mapped to this address</span>
            ) : (
              <span className="text-muted font-normal ml-1.5">(covers ALL EVM chains, one transaction)</span>
            )}
          </label>
          <div className="flex gap-2">
            <input
              aria-label="EVM address"
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
                  {nonEvmUpToDate(c.id) ? (
                    <span className="text-[9px] bg-accent-green/10 bpan-success px-1.5 py-0.5 rounded-full border border-accent-green/20 font-medium">✓ mapped</span>
                  ) : auto && val === auto ? (
                    <span className="text-[9px] bg-accent-green/10 bpan-success px-1.5 py-0.5 rounded-full border border-accent-green/20 font-medium">auto</span>
                  ) : null}
                </div>
                <div className="flex gap-2">
                  <input
                    aria-label={`${c.name} address`}
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

      {error && <InlineNotice message={error} className="mb-3" />}

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
                <CheckIcon size={8} className="bpan-success" />
              </div>
              <span className="text-[11px] text-text-secondary font-medium w-24 truncate">{tx.chain}</span>
              <a
                href={`${NETWORKS[network.id]?.explorer || BPAN_DEPLOYMENT.explorer}/tx/${tx.hash}`}
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

      {(() => {
        // One tx covers every EVM chain (the "evm" mapping); non-EVM chains
        // are one tx each. Chains already mapped to the same address are
        // no-ops and never counted or written.
        const plannedTx =
          (evmSelected && !evmUpToDate ? 1 : 0) +
          selectedNonEvmChains.filter((c) => !nonEvmUpToDate(c.id)).length;
        const allDone = selectedChains.size > 0 && plannedTx === 0;
        return (
          <button
            onClick={handleSetMappings}
            disabled={loading || selectedChains.size === 0 || !allAddressesFilled || allDone}
            className="btn-primary-premium text-[13px]"
          >
            {loading
              ? `Mapping ${progress.current}/${progress.total}...`
              : allDone
              ? "Already mapped ✓"
              : plannedTx > 1
              ? `Set Mappings (${plannedTx} transactions)`
              : "Set Mapping (1 transaction)"}
          </button>
        );
      })()}
    </div>
  );
}

// ── Lookup ────────────────────────────────────────────────────────────────────
function LookupSection() {
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
      const registered = await isBPANRegistered(clean);
      if (!registered) { setError("This number is not registered"); setLoading(false); return; }
      const [m, o] = await Promise.all([getAllBPANMappings(clean), getBPANOwner(clean)]);
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
          id="bpan-lookup-number" aria-label="BPAN number to look up"
          inputMode="numeric"
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
            Looking up on {BPAN_DEPLOYMENT.name}...
          </span>
        ) : "Lookup"}
      </button>

      {error && <InlineNotice message={error} className="mb-3" />}

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
                <p className="text-[11px] text-brand-400 capitalize font-semibold">{bpanChainLabel(chain)}</p>
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
          <CheckIcon size={10} className="bpan-success" />
        </div>
        <p className="bpan-success text-xs font-semibold">Transaction submitted!</p>
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
