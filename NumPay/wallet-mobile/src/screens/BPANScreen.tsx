import { BPAN_DEPLOYMENT, BPAN_UNAVAILABLE_MESSAGE, bpanOwnershipKey } from "@numpay/core/bpanDeployment";
// BPAN registration, ownership and resolution use only the fresh Base registry.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { ethers } from "ethers";
import {
  isValidBPAN, formatBPAN, BPAN_EVM_KEY, getBPANContract,
  getAllBPANMappings, isBPANRegistered, getBPANOwner,
  findOwnedBPANs, registerBPAN, assertBPANWriteNetwork,
} from "@numpay/core/bpan";
import { BPAN_CHAINS, BPAN_MAINNET_CONTRACT, BPAN_MAINNET_RPC } from "@numpay/core/networks";
import { isValidChainAddress } from "@numpay/core/addressValidation";
import { importFromMnemonic, getSigner } from "@numpay/core/wallet";
import { setItem } from "@numpay/core/storage";
import { explorerTxUrl } from "@numpay/core/txLog";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import type { MobileWalletState } from "../wallet/useMobileWallet";
import { colors, radius, type as ts, themedStyles } from "../ui/theme";
import { Notice, Btn, Card, Field, ScreenHeader, Tappable, SkeletonBlock } from "../ui/components";
import { CheckIcon, CopyIcon, ExternalLinkIcon, SearchIcon, ShieldIcon } from "../ui/icons";
import { ChainIcon } from "../ui/coins";
import { safeActionError } from "../ui/errors";
import { copyEphemeral } from "../platform/clipboard";
import { ConfirmSheet, SheetPanel, SheetRow } from "../ui/Sheet";
import { TxResultOverlay, type TxFxStatus } from "../ui/TxResultOverlay";

type Tab = "my-bpan" | "register" | "mapping" | "lookup";
type Mappings = { chains: string[]; wallets: string[] };
type MappingWrite = { key: string; addr: string; label: string };
type BPANTxFx = {
  status: TxFxStatus;
  kind: "bpan-register" | "bpan-map";
  amountLabel?: string;
  detail?: string;
  txHash?: string;
  errorMessage?: string;
};
type SetBPANTxFx = (state: BPANTxFx | null) => void;
type FeePreview = {
  balanceWei: bigint;
  networkFeeWei: bigint;
  protocolFeeWei: bigint;
};

const BPAN_GAS_MARGIN_NUMERATOR = 12n;
const BPAN_GAS_MARGIN_DENOMINATOR = 10n;
const BPAN_CONFIRMATION_POLL_MS = 1_500;
const BPAN_CONFIRMATION_ATTEMPTS = 8;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function formatEth(wei: bigint): string {
  if (wei === 0n) return "0 ETH";
  if (wei < ethers.parseEther("0.000001")) return "<0.000001 ETH";
  return `${Number(ethers.formatEther(wei)).toLocaleString(undefined, { maximumFractionDigits: 6 })} ETH`;
}

function shortAddress(value: string): string {
  return value.length > 18 ? `${value.slice(0, 9)}…${value.slice(-7)}` : value;
}

function buildMappingWrites(
  existing: Record<string, string>,
  evmSelected: boolean,
  evmAddr: string,
  selectedNonEvm: { id: string; name: string }[],
  nonEvmAddrs: Record<string, string>,
): MappingWrite[] {
  const writes: MappingWrite[] = [];
  if (evmSelected) {
    const addr = evmAddr.trim();
    if ((existing[BPAN_EVM_KEY] ?? "").trim().toLowerCase() !== addr.toLowerCase()) {
      writes.push({ key: BPAN_EVM_KEY, addr, label: "All EVM chains" });
    }
    for (const [chainId, mapped] of Object.entries(existing)) {
      const chain = BPAN_CHAINS.find((candidate) => candidate.id === chainId);
      if (chain?.isEVM && mapped.trim().toLowerCase() !== addr.toLowerCase()) {
        writes.push({ key: chainId, addr, label: chain.name });
      }
    }
  }
  for (const chain of selectedNonEvm) {
    const addr = (nonEvmAddrs[chain.id] || "").trim();
    if ((existing[chain.id] ?? "").trim() !== addr) {
      writes.push({ key: chain.id, addr, label: chain.name });
    }
  }
  return writes;
}

function mappingPlanKey(writes: MappingWrite[]): string {
  return writes.map((write) => `${write.key}\u0000${write.addr}`).join("\u0001");
}

function mappingPlanIsSubset(next: MappingWrite[], reviewed: MappingWrite[]): boolean {
  const approved = new Set(reviewed.map((write) => `${write.key}\u0000${write.addr}`));
  return next.every((write) => approved.has(`${write.key}\u0000${write.addr}`));
}

async function estimateBPANFees(
  owner: string,
  estimateGas: (contract: ethers.Contract) => Promise<bigint>,
  protocolFeeWei = 0n,
): Promise<FeePreview> {
  const provider = new ethers.JsonRpcProvider(
    BPAN_MAINNET_RPC, BPAN_DEPLOYMENT.chainId, { staticNetwork: true },
  );
  try {
    const contract = getBPANContract(BPAN_MAINNET_CONTRACT, provider);
    const [balanceWei, gasEstimate, feeData] = await Promise.all([
      provider.getBalance(owner),
      estimateGas(contract),
      provider.getFeeData(),
    ]);
    const gasPrice = feeData.maxFeePerGas ?? feeData.gasPrice;
    if (gasPrice == null) throw new Error("The Base network did not return a gas price");
    const gasWithMargin = (gasEstimate * BPAN_GAS_MARGIN_NUMERATOR + BPAN_GAS_MARGIN_DENOMINATOR - 1n)
      / BPAN_GAS_MARGIN_DENOMINATOR;
    return { balanceWei, networkFeeWei: gasWithMargin * gasPrice, protocolFeeWei };
  } finally {
    provider.destroy?.();
  }
}

// Display label for a registry mapping key ("evm" is the opt-in key that covers
// every EVM chain — see BPAN_EVM_KEY in core/bpan).
function bpanChainLabel(chain: string): string {
  if (chain === BPAN_EVM_KEY) return "All EVM chains";
  return BPAN_CHAINS.find((c) => c.id === chain)?.name ?? chain;
}

// Save confirmed BPAN numbers per owner address for cross-client compatibility.
// Reads intentionally do not use this cache as ownership proof.
async function saveBPANs(address: string, numbers: string[]): Promise<void> {
  try { await setItem(bpanOwnershipKey(address), JSON.stringify(numbers)); } catch { /* non-fatal */ }
}

// Native address auto-derived for a non-EVM chain, or "" if unknown. Mirrors the
// extension's autoNonEvmAddress; source is the wallet's derived address map.
function autoNonEvmAddress(chainId: string, map: MobileWalletState["nonEvmAddresses"]): string {
  if (!map) return "";
  switch (chainId) {
    case "bitcoin":  return map.bitcoin;
    case "litecoin": return map.litecoin;
    case "solana":   return map.solana;
    case "sui":      return map.sui;
    case "tron":     return map.tron;
    case "xrp":      return map.xrp;
    default:         return "";
  }
}

export function BPANScreen({ w, onBack, onSessionExpired }: {
  w: MobileWalletState;
  onBack: () => void;
  onSessionExpired?: () => void;
}) {
  const [tab, setTab] = useState<Tab>("my-bpan");
  const [owned, setOwned] = useState<string[]>([]);
  const [scanning, setScanning] = useState(true);
  const [scanError, setScanError] = useState(false);
  const [scanRevision, setScanRevision] = useState(0);
  const [txFx, setTxFx] = useState<BPANTxFx | null>(null);

  const address = w.evmAddress;

  // A payment identity is only displayed after the canonical registry confirms
  // ownership. A stale local value must never become the recipient identity.
  useEffect(() => {
    if (!BPAN_DEPLOYMENT.deployed) { setOwned([]); setScanning(false); return; }
    if (!address) { setOwned([]); setScanning(false); return; }
    let live = true;
    setOwned([]);
    setScanning(true);
    setScanError(false);
    (async () => {
      try {
        const found = await findOwnedBPANs(address);
        if (!live) return;
        await saveBPANs(address, found);
        if (live) setOwned(found);
      } catch {
        if (live) {
          setOwned([]);
          setScanError(true);
        }
      }
      finally { if (live) setScanning(false); }
    })();
    return () => { live = false; };
  }, [address, scanRevision]);

  // Reflect a freshly registered BPAN without waiting for a re-scan.
  const handleRegistered = useCallback(async (number: string) => {
    const merged = Array.from(new Set([number, ...owned]));
    setOwned(merged);
    await saveBPANs(address, merged);
    w.refreshBPAN();
    setTab("mapping");
  }, [owned, address, w.refreshBPAN]);

  // Resolve the vault mnemonic for a write, or surface the re-auth overlay.
  const requireMnemonic = useCallback(async (): Promise<string | null> => {
    const mn = await getUnlockedMnemonic();
    if (!mn) onSessionExpired?.();
    return mn;
  }, [onSessionExpired]);

  const TABS: { id: Tab; label: string }[] = [
    { id: "my-bpan",  label: "My BPAN"  },
    { id: "register", label: "Register" },
    { id: "mapping",  label: "Mapping"  },
    { id: "lookup",   label: "Lookup"   },
  ];

  if (!BPAN_DEPLOYMENT.deployed) return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="BPAN" onBack={onBack} />
      <Card style={{ padding: 16 }}>
        <Text style={st.emptyTitle}>Coming to Base</Text>
        <Text accessibilityLiveRegion="polite" style={st.emptyBody}>{BPAN_UNAVAILABLE_MESSAGE}</Text>
      </Card>
    </View>
  );

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="BPAN" onBack={onBack} />
      {/* Tabs */}
      <View style={st.tabs}>
        {TABS.map((t) => (
          <Tappable accessibilityRole="tab" accessibilityState={{ selected: tab === t.id }} accessibilityLabel={t.label} feedback="row" key={t.id} onPress={() => setTab(t.id)} style={[st.tab, tab === t.id && st.tabOn]}>
            <Text style={[st.tabText, tab === t.id && st.tabTextOn]}>{t.label}</Text>
          </Tappable>
        ))}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {tab === "my-bpan" && (
          <MyBPAN
            error={scanError}
            onRetry={() => setScanRevision((value) => value + 1)}
            owned={owned}
            scanning={scanning}
            address={address}
            onGoRegister={() => setTab("register")}
            onGoLookup={() => setTab("lookup")}
          />
        )}
        {tab === "register" && (
          <RegisterSection owner={address} requireMnemonic={requireMnemonic} onRegistered={handleRegistered} onTxFx={setTxFx} />
        )}
        {tab === "mapping" && (
          <MappingSection w={w} owned={owned} requireMnemonic={requireMnemonic} onTxFx={setTxFx} />
        )}
        {tab === "lookup" && <Lookup />}
      </ScrollView>
      {txFx && (
        <TxResultOverlay
          status={txFx.status}
          kind={txFx.kind}
          amountLabel={txFx.amountLabel}
          detail={txFx.detail}
          txHash={txFx.txHash}
          explorerUrl={txFx.txHash ? explorerTxUrl(BPAN_DEPLOYMENT.networkId, txFx.txHash) : undefined}
          errorMessage={txFx.errorMessage}
          onClose={() => setTxFx(null)}
        />
      )}
    </View>
  );
}

// ── My BPAN (read-only) ───────────────────────────────────────────────────────
function MyBPAN({ owned, scanning, error, onRetry, address, onGoRegister, onGoLookup }: {
  error: boolean; onRetry: () => void;
  owned: string[]; scanning: boolean; address: string; onGoRegister: () => void;
  onGoLookup: () => void;
}) {
  if (scanning && owned.length === 0) {
    return (
      <Card style={{ padding: 16 }}>
        <Text accessibilityLiveRegion="polite" style={st.dim}>Loading your BPANs…</Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, marginTop: 8 }}>
          <SkeletonBlock width={40} height={40} radius={12} />
          <View style={{ gap: 8 }}>
            <SkeletonBlock width={150} height={16} />
            <SkeletonBlock width={80} height={12} />
          </View>
        </View>
      </Card>
    );
  }
  const scanFailure = error && (
    <Card style={{ padding: 14 }}>
      <Text accessibilityRole="alert" style={{ color: colors.caution, fontSize: ts.body }}>
        Could not verify your BPANs. Check your connection and try again.
      </Text>
      <Btn label="Retry" variant="secondary" onPress={onRetry} />
    </Card>
  );
  if (error && owned.length === 0) return scanFailure;
  if (owned.length === 0) {
    return (
      <Card style={{ padding: 18, alignItems: "center", marginTop: 8 }}>
        <Text style={st.emptyTitle}>No BPANs yet</Text>
        <Text style={st.emptyBody}>
          A BPAN is your 11-digit payment identity: one number, addresses mapped per chain.
        </Text>
        <Btn label="Register BPAN" onPress={onGoRegister} style={{ marginTop: 14, alignSelf: "stretch" }} />
      </Card>
    );
  }
  return (
    <View style={{ gap: 8 }}>
      {scanFailure}
      {scanning && <Text style={st.dim}>Refreshing your BPANs…</Text>}
      {owned.map((n) => <BPANCard key={n} number={n} onGoLookup={onGoLookup} />)}
    </View>
  );
}

function BPANCard({ number, onGoLookup }: {
  number: string; onGoLookup: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const [mappings, setMappings] = useState<Mappings | null>(null);
  const [loading, setLoading] = useState(false);

  const [detailError, setDetailError] = useState(false);
  const loadDetail = useCallback(async () => {
    setLoading(true);
    setDetailError(false);
    try {
      setMappings(await getAllBPANMappings(number));
    } catch { setDetailError(true); }
    finally { setLoading(false); }
  }, [number]);

  useEffect(() => { if (expanded && !mappings) void loadDetail(); }, [expanded, mappings, loadDetail]);

  return (
    <Card style={{ overflow: "hidden" }}>
      <View style={st.bpanHero}>
        <Text style={st.bpanEyebrow}>YOUR PAYMENT NUMBER</Text>
        <Text style={st.cardNumber}>{formatBPAN(number)}</Text>
        <Text style={st.readyText}>
          {mappings && mappings.chains.length > 0 ? "Ready to receive" : "Registered payment identity"}
        </Text>
      </View>
      <View style={st.quickActions}>
        <Tappable
          accessibilityLabel={`Copy BPAN ${formatBPAN(number)}`}
          feedback="tile"
          borderRadius={radius.tile}
          onPress={() => {
            void copyEphemeral(number).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }).catch(() => {});
          }}
          style={[st.quickAction, st.quickActionPrimary]}
        >
          {copied ? <CheckIcon size={18} color={colors.onBrand} /> : <CopyIcon size={18} color={colors.onBrand} />}
          <Text style={st.quickActionPrimaryText}>{copied ? "Copied" : "Copy"}</Text>
        </Tappable>
        <Tappable accessibilityLabel={`Share BPAN ${formatBPAN(number)}`} feedback="tile" borderRadius={radius.tile} onPress={() => { Share.share({ message: number }).catch(() => {}); }} style={st.quickAction}>
          <ExternalLinkIcon size={18} color={colors.textPrimary} />
          <Text style={st.quickActionText}>Share</Text>
        </Tappable>
        <Tappable accessibilityLabel="Lookup a BPAN" feedback="tile" borderRadius={radius.tile} onPress={onGoLookup} style={st.quickAction}>
          <SearchIcon size={18} color={colors.textPrimary} />
          <Text style={st.quickActionText}>Lookup</Text>
        </Tappable>
      </View>
      <Tappable accessibilityLabel={`Mappings for BPAN ${formatBPAN(number)}`} accessibilityState={{ expanded }} feedback="row" onPress={() => setExpanded((v) => !v)} style={st.mappingDisclosure}>
        <Text style={st.mappingDisclosureText}>{expanded ? "Hide wallet mappings" : "View wallet mappings"}</Text>
      </Tappable>

      {expanded && (
        <View style={st.cardBody}>
          {detailError && <Text accessibilityRole="alert" style={{ color: colors.caution }}>Could not refresh mappings. Try Refresh again.</Text>}
          {loading && <Text style={st.dim}>Loading from {BPAN_DEPLOYMENT.name}…</Text>}
          {mappings && mappings.chains.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={st.mapLabel}>WALLET MAPPINGS</Text>
              {mappings.chains.map((chain, i) => (
                <MappingRow key={chain + i} chain={chain} wallet={mappings.wallets[i]} />
              ))}
            </View>
          )}
          {!loading && !detailError && mappings && mappings.chains.length === 0 && (
            <Text style={st.dim}>No mappings set yet.</Text>
          )}
          {!loading && (
            <Tappable feedback="ghost" onPress={() => void loadDetail()} style={{ marginTop: 8 }}>
              <Text style={st.link}>Refresh</Text>
            </Tappable>
          )}
        </View>
      )}
    </Card>
  );
}

function MappingRow({ chain, wallet }: { chain: string; wallet: string }) {
  return (
    <View style={st.mapRow}>
      <ChainIcon chainId={chain === BPAN_EVM_KEY ? "ethereum" : chain} size={16} />
      <Text style={st.mapChain}>{bpanChainLabel(chain)}</Text>
      <Text accessibilityLabel={wallet} style={st.mapAddr} numberOfLines={1}>
        {wallet.slice(0, 8)}…{wallet.slice(-6)}
      </Text>
    </View>
  );
}

// ── Register (mainnet write) ──────────────────────────────────────────────────
function RegisterSection({ owner, requireMnemonic, onRegistered, onTxFx }: {
  owner: string;
  requireMnemonic: () => Promise<string | null>;
  onRegistered: (n: string) => void | Promise<void>;
  onTxFx: SetBPANTxFx;
}) {
  const [number, setNumber] = useState("");
  const [checking, setChecking] = useState(false);
  const [availability, setAvailability] = useState<"available" | "owned" | "taken" | null>(null);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [fee, setFee] = useState<string | null>(null);
  const [review, setReview] = useState<(FeePreview & { number: string }) | null>(null);

  // Read the live registration fee for the mainnet contract.
  useEffect(() => {
    let live = true;
    (async () => {
      const provider = new ethers.JsonRpcProvider(
        BPAN_MAINNET_RPC, BPAN_DEPLOYMENT.chainId, { staticNetwork: true },
      );
      try {
        const contract = getBPANContract(BPAN_MAINNET_CONTRACT, provider);
        const f: bigint = await contract.registrationFee();
        if (live) setFee(ethers.formatEther(f));
      } catch { /* fee line stays hidden */ }
      finally { provider.destroy?.(); }
    })();
    return () => { live = false; };
  }, []);

  async function readRegistrationOwner(value: string): Promise<string | null> {
    if (!(await isBPANRegistered(value))) return null;
    return getBPANOwner(value);
  }

  function isCurrentOwner(value: string | null): boolean {
    return !!value && !!owner && value.toLowerCase() === owner.toLowerCase();
  }

  async function completeRegistration(value: string, hash?: string) {
    setAvailability("owned");
    setReview(null);
    setError("");
    if (hash) setTxHash(hash);
    onTxFx({
      status: "success",
      kind: "bpan-register",
      amountLabel: `${formatBPAN(value)} is ready to receive payments`,
      txHash: hash,
    });
    await onRegistered(value);
  }

  async function checkAvailability() {
    if (!isValidBPAN(number)) { setError("Enter a valid 11-digit number"); return; }
    setError(""); setAvailability(null); setChecking(true);
    try {
      const registeredOwner = await readRegistrationOwner(number);
      setAvailability(registeredOwner == null ? "available" : isCurrentOwner(registeredOwner) ? "owned" : "taken");
    } catch {
      setError("Check failed. Verify your connection.");
    } finally { setChecking(false); }
  }

  async function prepareRegistration() {
    if (!isValidBPAN(number)) { setError("Enter a valid 11-digit number"); return; }
    if (!owner) { setError("Your wallet address is not ready yet."); return; }
    setError(""); setPreparing(true); setReview(null);
    try {
      const provider = new ethers.JsonRpcProvider(
        BPAN_MAINNET_RPC, BPAN_DEPLOYMENT.chainId, { staticNetwork: true },
      );
      let registeredOwner: string | null = null;
      let protocolFeeWei = 0n;
      try {
        const contract = getBPANContract(BPAN_MAINNET_CONTRACT, provider);
        const registered = await contract.isRegistered(BigInt(number)) as boolean;
        [registeredOwner, protocolFeeWei] = await Promise.all([
          registered ? contract.ownerOf(BigInt(number)) as Promise<string> : Promise.resolve(null),
          contract.registrationFee() as Promise<bigint>,
        ]);
      } finally {
        provider.destroy?.();
      }
      if (isCurrentOwner(registeredOwner)) {
        await completeRegistration(number);
        return;
      }
      if (registeredOwner) {
        setAvailability("taken");
        return;
      }
      const preview = await estimateBPANFees(
        owner,
        (contract) => contract.registerNumber.estimateGas(
          BigInt(number), { value: protocolFeeWei, from: owner },
        ),
        protocolFeeWei,
      );
      const totalWei = preview.protocolFeeWei + preview.networkFeeWei;
      if (preview.balanceWei < totalWei) {
        setError(`Not enough Base ETH. This wallet has ${formatEth(preview.balanceWei)}; about ${formatEth(totalWei)} is needed.`);
        return;
      }
      setAvailability("available");
      setReview({ ...preview, number });
    } catch (e: any) {
      setError(safeActionError(e, "Registration could not be prepared. Check your Base connection and ETH balance."));
    } finally {
      setPreparing(false);
    }
  }

  async function confirmRegistration() {
    if (!review || review.number !== number) return;
    const mnemonic = await requireMnemonic();
    if (!mnemonic) return;
    setError(""); setLoading(true); setTxHash("");
    onTxFx({
      status: "pending",
      kind: "bpan-register",
      amountLabel: formatBPAN(number),
      detail: "Checking the final registry state…",
    });
    let writeProvider: ethers.JsonRpcProvider | null = null;
    let submittedHash = "";
    try {
      const wd = importFromMnemonic(mnemonic);
      const signer = getSigner(wd.privateKey, BPAN_MAINNET_RPC);
      writeProvider = signer.provider as ethers.JsonRpcProvider;
      const contract = getBPANContract(BPAN_MAINNET_CONTRACT, signer);
      if (await contract.isRegistered(BigInt(number))) {
        const registeredOwner = await contract.ownerOf(BigInt(number)) as string;
        if (isCurrentOwner(registeredOwner)) {
          await completeRegistration(number);
        } else {
          setAvailability("taken");
          setReview(null);
          const message = "This BPAN now belongs to another wallet. Choose a different number.";
          setError(message);
          onTxFx(null);
        }
        return;
      }
      onTxFx({
        status: "pending",
        kind: "bpan-register",
        amountLabel: formatBPAN(number),
        detail: "Signing and broadcasting on Base…",
      });
      const tx = await registerBPAN(number, BPAN_MAINNET_CONTRACT, signer);
      submittedHash = tx.hash;
      setTxHash(tx.hash);
      onTxFx({
        status: "pending",
        kind: "bpan-register",
        amountLabel: formatBPAN(number),
        detail: "Transaction sent. Waiting for Base confirmation…",
        txHash: tx.hash,
      });
      await tx.wait();
      await completeRegistration(number, tx.hash);
    } catch (e: any) {
      try {
        const registeredOwner = await readRegistrationOwner(number);
        if (isCurrentOwner(registeredOwner)) {
          await completeRegistration(number, submittedHash || undefined);
          return;
        }
      } catch { /* preserve the original write error */ }
      const message = safeActionError(e, "Registration could not be completed. Check your network and try again.");
      setReview(null);
      setError(message);
      onTxFx(null);
    } finally {
      writeProvider?.destroy?.();
      setLoading(false);
    }
  }

  return (
    <View style={{ gap: 10 }}>
      <Card style={{ padding: 14 }}>
        <Text style={st.mapLabel}>HOW IT WORKS</Text>
        <Text style={[st.emptyBody, { textAlign: "left", marginTop: 4 }]}>
          Choose an 11-digit number, then add addresses to receive payments.
        </Text>
        {fee && (
          <Text style={st.feeLine}>
            Registration fee: {parseFloat(fee) === 0 ? "0 ETH" : `${fee} ETH`}. Network gas is paid in ETH on {BPAN_DEPLOYMENT.name}.
          </Text>
        )}
      </Card>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Field
          accessibilityLabel="BPAN number to register"
          placeholder="e.g. 12345678901"
          keyboardType="number-pad"
          value={number}
          onChangeText={(v) => { setNumber(v.replace(/\D/g, "").slice(0, 11)); setAvailability(null); setReview(null); setError(""); }}
          style={{ flex: 1 }}
        />
        <Tappable feedback="row"
          onPress={() => void checkAvailability()}
          disabled={checking || number.length !== 11}
          style={[st.checkBtn, (checking || number.length !== 11) && { opacity: 0.4 }]}
        >
          <Text style={st.checkBtnText}>{checking ? "…" : "Check"}</Text>
        </Tappable>
      </View>

      {availability === "available" && (
        <View style={st.availableRow}>
          <CheckIcon size={12} color={colors.success} />
          <Text style={st.available}>Available</Text>
        </View>
      )}
      {availability === "owned" && (
        <View style={st.availableRow}>
          <CheckIcon size={12} color={colors.success} />
          <Text style={st.available}>Already registered to this wallet</Text>
        </View>
      )}
      {availability === "taken" && <Text style={st.error}>Already registered to another wallet.</Text>}
      {!!error && <Text style={st.error}>{error}</Text>}
      {!!txHash && <TxSuccessRow chain="Register" hash={txHash} />}

      <Btn
        label={
          preparing ? "Checking BPAN…"
          : loading ? "Confirming on Base…"
          : availability === "owned" ? "Continue to wallet mapping"
          : error && availability === "available" ? "Try registration again"
          : "Review registration"
        }
        onPress={() => availability === "owned" ? void completeRegistration(number) : void prepareRegistration()}
        disabled={preparing || loading || !isValidBPAN(number) || (availability !== "available" && availability !== "owned")}
      />

      <ConfirmSheet
        open={!!review}
        onClose={() => { if (!loading) setReview(null); }}
        onConfirm={() => void confirmRegistration()}
        title="Register this BPAN?"
        body="This creates your payment identity on Base. The transaction cannot be reversed after confirmation."
        confirmLabel="Register on Base"
        tone="caution"
        icon={<ShieldIcon size={22} color={colors.caution} />}
        busy={loading}
      >
        {review && (
          <SheetPanel>
            <SheetRow label="BPAN" value={formatBPAN(review.number)} strong />
            <SheetRow label="Network" value={BPAN_DEPLOYMENT.name} />
            <SheetRow label="Registration fee" value={formatEth(review.protocolFeeWei)} />
            <SheetRow label="Estimated network fee" value={formatEth(review.networkFeeWei)} />
            <SheetRow label="Wallet balance" value={formatEth(review.balanceWei)} />
          </SheetPanel>
        )}
      </ConfirmSheet>
    </View>
  );
}

// ── Mapping (mainnet writes) ──────────────────────────────────────────────────
function MappingSection({ w, owned, requireMnemonic, onTxFx }: {
  w: MobileWalletState;
  owned: string[];
  requireMnemonic: () => Promise<string | null>;
  onTxFx: SetBPANTxFx;
}) {
  const [number, setNumber] = useState(owned[0] ?? "");
  // "evm" is a single synthetic entry covering every EVM chain (one registry
  // mapping, one tx). Only non-EVM chains are listed individually.
  const [selected, setSelected] = useState<Set<string>>(new Set([BPAN_EVM_KEY]));
  const [evmAddr, setEvmAddr] = useState(w.evmAddress);
  const [nonEvmAddrs, setNonEvmAddrs] = useState<Record<string, string>>({});
  const [existingMap, setExistingMap] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [preparing, setPreparing] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, chain: "" });
  const [txHashes, setTxHashes] = useState<{ chain: string; hash: string }[]>([]);
  const [error, setError] = useState("");
  const [review, setReview] = useState<(FeePreview & {
    number: string;
    writes: MappingWrite[];
  }) | null>(null);

  const nonEvmChains = useMemo(() => BPAN_CHAINS.filter((c) => !c.isEVM), []);

  useEffect(() => { if (owned.length > 0 && !number) setNumber(owned[0]); }, [owned, number]);

  // Auto-fill known non-EVM addresses when the derived map is available.
  useEffect(() => {
    setNonEvmAddrs((prev) => {
      const next = { ...prev };
      for (const c of nonEvmChains) {
        if (!next[c.id]) {
          const auto = autoNonEvmAddress(c.id, w.nonEvmAddresses);
          if (auto) next[c.id] = auto;
        }
      }
      return next;
    });
  }, [w.nonEvmAddresses, nonEvmChains]);

  // Current on-chain mappings for the selected BPAN → drives no-op skip + the
  // "mapped" badges. null = not loaded / load failed (skip nothing).
  useEffect(() => {
    setExistingMap(null);
    if (!isValidBPAN(number)) return;
    let live = true;
    getAllBPANMappings(number)
      .then((m) => { if (live) setExistingMap(Object.fromEntries(m.chains.map((c, i) => [c, m.wallets[i]]))); })
      .catch(() => { /* stays null */ });
    return () => { live = false; };
  }, [number]);

  const evmSelected = selected.has(BPAN_EVM_KEY);
  const selectedNonEvm = nonEvmChains.filter((c) => selected.has(c.id));

  const evmUpToDate =
    !!existingMap?.[BPAN_EVM_KEY] &&
    existingMap[BPAN_EVM_KEY].trim().toLowerCase() === evmAddr.trim().toLowerCase();
  const nonEvmUpToDate = (id: string) =>
    !!existingMap?.[id] && existingMap[id].trim() === (nonEvmAddrs[id] || "").trim();

  const allAddressesFilled =
    (!evmSelected || !!evmAddr.trim()) &&
    selectedNonEvm.every((c) => !!(nonEvmAddrs[c.id] || "").trim());

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  function validateMappingInputs(): string | null {
    if (!isValidBPAN(number)) return "Enter a valid 11-digit BPAN";
    if (selected.size === 0) return "Select at least one chain";
    if (!allAddressesFilled) return "Fill in all wallet addresses before mapping";

    // Validate every address against its chain format BEFORE any write — a
    // malformed or wrong-chain mapping misdirects every future payment.
    if (evmSelected && !isValidChainAddress(evmAddr.trim(), "ethereum", true)) {
      return "The EVM address is not valid.";
    }
    for (const c of selectedNonEvm) {
      if (!isValidChainAddress((nonEvmAddrs[c.id] || "").trim(), c.id, false)) {
        return `The ${c.name} address is not valid.`;
      }
    }
    return null;
  }

  async function prepareMappings() {
    const validationError = validateMappingInputs();
    if (validationError) { setError(validationError); return; }
    setError(""); setPreparing(true); setReview(null);
    try {
      const [mappings, onChainOwner] = await Promise.all([
        getAllBPANMappings(number),
        getBPANOwner(number),
      ]);
      if (onChainOwner.toLowerCase() !== w.evmAddress.toLowerCase()) {
        setError("This wallet is no longer the owner of that BPAN.");
        return;
      }
      const existing = Object.fromEntries(mappings.chains.map((chain, index) => [chain, mappings.wallets[index]]));
      setExistingMap(existing);
      const writes = buildMappingWrites(existing, evmSelected, evmAddr, selectedNonEvm, nonEvmAddrs);
      if (writes.length === 0) {
        setError("");
        onTxFx({
          status: "success",
          kind: "bpan-map",
          amountLabel: "Selected wallet mappings are already live",
        });
        w.refreshBPAN();
        return;
      }
      const preview = await estimateBPANFees(w.evmAddress, async (contract) => {
        let totalGas = 0n;
        for (const write of writes) {
          totalGas += await contract.setWalletMapping.estimateGas(
            BigInt(number), write.key, write.addr, { from: w.evmAddress },
          );
        }
        return totalGas;
      });
      if (preview.balanceWei < preview.networkFeeWei) {
        setError(`Not enough Base ETH. This wallet has ${formatEth(preview.balanceWei)}; about ${formatEth(preview.networkFeeWei)} is needed.`);
        return;
      }
      setReview({ ...preview, number, writes });
    } catch (e: any) {
      setError(safeActionError(e, "The mapping could not be prepared. Check your Base connection and ETH balance."));
    } finally { setPreparing(false); }
  }

  async function confirmMappings() {
    if (!review || review.number !== number) return;
    setError("");
    let submitted: { chain: string; hash: string }[] = [];
    const broadcasts: { write: MappingWrite; tx: ethers.TransactionResponse }[] = [];
    let activeWrites = review.writes;
    try {
      const [mappings, onChainOwner] = await Promise.all([
        getAllBPANMappings(number),
        getBPANOwner(number),
      ]);
      if (onChainOwner.toLowerCase() !== w.evmAddress.toLowerCase()) {
        setReview(null);
        const message = "This wallet is no longer the owner of that BPAN.";
        setError(message);
        onTxFx(null);
        return;
      }
      const latest = Object.fromEntries(mappings.chains.map((chain, index) => [chain, mappings.wallets[index]]));
      const freshWrites = buildMappingWrites(latest, evmSelected, evmAddr, selectedNonEvm, nonEvmAddrs);
      if (freshWrites.length === 0) {
        setExistingMap(latest);
        setReview(null);
        setError("");
        onTxFx({
          status: "success",
          kind: "bpan-map",
          amountLabel: "All selected wallet mappings are confirmed",
        });
        w.refreshBPAN();
        return;
      }
      if (mappingPlanKey(freshWrites) !== mappingPlanKey(review.writes) && !mappingPlanIsSubset(freshWrites, review.writes)) {
        setExistingMap(latest);
        setReview(null);
        const message = "The requested wallet addresses changed before signing. Review the updated mapping list and try again.";
        setError(message);
        onTxFx(null);
        return;
      }
      activeWrites = freshWrites;

      const mnemonic = await requireMnemonic();
      if (!mnemonic) return;
      setLoading(true); setTxHashes([]);
      setProgress({ current: 0, total: activeWrites.length, chain: "" });
      onTxFx({
        status: "pending",
        kind: "bpan-map",
        amountLabel: `${activeWrites.length} mapping${activeWrites.length === 1 ? "" : "s"}`,
        detail: activeWrites.length < review.writes.length
          ? `${review.writes.length - activeWrites.length} already confirmed. Preparing the rest…`
          : "Preparing wallet signatures…",
      });
      const wallet = importFromMnemonic(mnemonic);
      const baseSigner = getSigner(wallet.privateKey, BPAN_MAINNET_RPC);
      const writeProvider = baseSigner.provider as ethers.JsonRpcProvider;
      try {
        // Validate the registry once, then keep one nonce-managed signer and
        // contract for the entire batch. Rebuilding the write path per row can
        // make an RPC return the just-used nonce again, so only the first
        // transaction lands. NonceManager advances locally after every send.
        await assertBPANWriteNetwork(BPAN_MAINNET_CONTRACT, baseSigner);
        const batchSigner = new ethers.NonceManager(baseSigner);
        const batchContract = getBPANContract(BPAN_MAINNET_CONTRACT, batchSigner);
        // Broadcast every approved write first. Waiting for receipt #1 before
        // broadcasting #2 meant a temporary receipt-poll failure stopped the
        // batch after exactly one chain even though the remaining writes were
        // still valid. NonceManager safely queues the full ordered batch.
        for (let index = 0; index < activeWrites.length; index++) {
          const write = activeWrites[index];
          setProgress({ current: index + 1, total: activeWrites.length, chain: write.label });
          onTxFx({
            status: "pending",
            kind: "bpan-map",
            amountLabel: `${activeWrites.length} mapping${activeWrites.length === 1 ? "" : "s"}`,
            detail: `Broadcasting ${write.label} (${index + 1} of ${activeWrites.length})…`,
          });
          const tx = await batchContract.setWalletMapping(BigInt(number), write.key, write.addr) as ethers.TransactionResponse;
          broadcasts.push({ write, tx });
          submitted = [...submitted, { chain: write.label, hash: tx.hash }];
          setTxHashes(submitted);
          onTxFx({
            status: "pending",
            kind: "bpan-map",
            amountLabel: `${activeWrites.length} mapping${activeWrites.length === 1 ? "" : "s"}`,
            detail: `${index + 1} of ${activeWrites.length} transactions sent to Base…`,
            txHash: tx.hash,
          });
        }

        // All transactions are now on the network. Confirm each one without
        // abandoning later receipts when a single RPC poll fails.
        let confirmationError: unknown = null;
        for (let index = 0; index < broadcasts.length; index++) {
          const { write, tx } = broadcasts[index];
          setProgress({ current: index + 1, total: broadcasts.length, chain: write.label });
          onTxFx({
            status: "pending",
            kind: "bpan-map",
            amountLabel: `${broadcasts.length} mapping${broadcasts.length === 1 ? "" : "s"}`,
            detail: `Confirming ${write.label} (${index + 1} of ${broadcasts.length}) on Base…`,
            txHash: tx.hash,
          });
          try {
            await tx.wait();
            setExistingMap((previous) => ({ ...(previous ?? {}), [write.key]: write.addr }));
          } catch (error) {
            confirmationError ??= error;
          }
        }

        // A receipt endpoint can briefly fail even after every transaction was
        // accepted. Reconcile the canonical mapping state for a bounded period
        // before reporting a partial failure.
        let confirmedMap: Record<string, string> | null = null;
        let remaining: MappingWrite[] = activeWrites;
        for (let attempt = 0; attempt < BPAN_CONFIRMATION_ATTEMPTS; attempt++) {
          try {
            const confirmed = await getAllBPANMappings(number);
            confirmedMap = Object.fromEntries(
              confirmed.chains.map((chain, mappingIndex) => [chain, confirmed.wallets[mappingIndex]]),
            );
            remaining = buildMappingWrites(confirmedMap, evmSelected, evmAddr, selectedNonEvm, nonEvmAddrs);
            setExistingMap(confirmedMap);
            if (remaining.length === 0) break;
          } catch (error) {
            confirmationError ??= error;
          }
          if (attempt + 1 < BPAN_CONFIRMATION_ATTEMPTS) await delay(BPAN_CONFIRMATION_POLL_MS);
        }
        if (remaining.length > 0) throw confirmationError ?? new Error("Base has not confirmed every mapping yet");
      } finally {
        writeProvider.destroy?.();
      }
      setReview(null);
      setError("");
      w.refreshBPAN();
      onTxFx({
        status: "success",
        kind: "bpan-map",
        amountLabel: `${review.writes.length} wallet mapping${review.writes.length === 1 ? "" : "s"} confirmed`,
        txHash: submitted.at(-1)?.hash,
      });
    } catch (e: any) {
      try {
        const latestMappings = await getAllBPANMappings(number);
        const latestMap: Record<string, string> = Object.fromEntries(
          latestMappings.chains.map((chain, index) => [chain, latestMappings.wallets[index]]),
        );
        setExistingMap(latestMap);
        const remaining = buildMappingWrites(latestMap, evmSelected, evmAddr, selectedNonEvm, nonEvmAddrs);
        if (remaining.length === 0) {
          setReview(null);
          setError("");
          w.refreshBPAN();
          onTxFx({
            status: "success",
            kind: "bpan-map",
            amountLabel: "All selected wallet mappings are confirmed",
            txHash: submitted.at(-1)?.hash,
          });
          return;
        }
      } catch { /* preserve the original write error */ }
      const message = safeActionError(e, "The wallet mapping could not be saved. Check your network and try again.");
      setReview(null);
      setError(submitted.length > 0
        ? `${submitted.length} mapping transaction${submitted.length === 1 ? " was" : "s were"} sent. Only the unconfirmed mappings remain in the next review. ${message}`
        : message);
      onTxFx(null);
    } finally {
      setLoading(false);
    }
  }

  if (owned.length === 0) {
    return (
      <Card style={{ padding: 16, alignItems: "center" }}>
        <Text style={st.emptyTitle}>No BPAN to map</Text>
        <Text style={st.emptyBody}>Register a BPAN first, then map your wallet addresses to it here.</Text>
      </Card>
    );
  }

  const plannedWrites = existingMap
    ? buildMappingWrites(existingMap, evmSelected, evmAddr, selectedNonEvm, nonEvmAddrs)
    : [];
  const plannedTx = existingMap
    ? plannedWrites.length
    : (evmSelected ? 1 : 0) + selectedNonEvm.length;
  const allDone = existingMap !== null && selected.size > 0 && plannedTx === 0;

  return (
    <View style={{ gap: 10 }}>
      <Text style={[st.emptyBody, { textAlign: "left" }]}>
        Map your wallet addresses to your BPAN across chains. All mappings are stored on {BPAN_DEPLOYMENT.name}.
      </Text>

      {/* BPAN selector (chips when multiple) */}
      {owned.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {owned.map((n) => (
            <Tappable accessibilityLabel={`BPAN ${formatBPAN(n)}`} accessibilityState={{ selected: number === n }} feedback="row" key={n} onPress={() => setNumber(n)} style={[st.bpanChip, number === n && st.bpanChipOn]}>
              <Text style={[st.bpanChipText, number === n && st.bpanChipTextOn]}>{formatBPAN(n)}</Text>
            </Tappable>
          ))}
        </View>
      ) : (
        <Text style={st.selectedBpan}>{formatBPAN(number)}</Text>
      )}

      {/* All EVM chains toggle */}
      <ChainToggle
        label="All EVM chains"
        sublabel="Covers every EVM chain, one transaction"
        chainId="ethereum"
        on={evmSelected}
        mapped={evmUpToDate}
        disabled={evmUpToDate}
        badge={evmUpToDate ? "mapped" : "1 tx"}
        onPress={() => toggle(BPAN_EVM_KEY)}
      />
      {evmSelected && (
        <AddressField
          label="EVM Address"
          value={evmAddr}
          auto={w.evmAddress}
          onChange={setEvmAddr}
          mapped={evmUpToDate}
        />
      )}

      {/* Non-EVM chains */}
      {nonEvmChains.map((c) => {
        const on = selected.has(c.id);
        const mapped = nonEvmUpToDate(c.id);
        return (
          <View key={c.id} style={{ gap: 6 }}>
            <ChainToggle
              label={c.name}
              chainId={c.id}
              on={on}
              mapped={mapped}
              disabled={mapped}
              badge={mapped ? "mapped" : undefined}
              onPress={() => toggle(c.id)}
            />
            {on && (
              <AddressField
                label={`${c.name} Address`}
                value={nonEvmAddrs[c.id] || ""}
                auto={autoNonEvmAddress(c.id, w.nonEvmAddresses)}
                onChange={(v) => setNonEvmAddrs((prev) => ({ ...prev, [c.id]: v }))}
                mapped={nonEvmUpToDate(c.id)}
              />
            )}
          </View>
        );
      })}

      {!!error && (
        <Notice
          dense
          tone="danger"
          title={txHashes.length > 0 ? "Mapping interrupted" : "Mapping not completed"}
          body={error}
        />
      )}

      {loading && (
        <Card style={{ padding: 12 }}>
          <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 6 }}>
            <Text style={st.subText}>Setting mappings on mainnet…</Text>
            <Text style={{ color: colors.brand2, fontSize: ts.small, fontWeight: "700" }}>{progress.current}/{progress.total}</Text>
          </View>
          <View style={st.progressTrack}>
            <View style={[st.progressFill, { width: `${progress.total ? (progress.current / progress.total) * 100 : 0}%` }]} />
          </View>
          <Text style={[st.dim, { marginTop: 6 }]}>Processing: {progress.chain}</Text>
        </Card>
      )}

      {txHashes.map((t, i) => <TxSuccessRow key={i} chain={t.chain} hash={t.hash} />)}

      <Btn
        label={
          preparing ? "Checking mappings…"
          : loading ? `Confirming ${progress.current}/${progress.total}…`
          : allDone ? "Already mapped ✓"
          : error && plannedTx > 1 ? `Review ${plannedTx} remaining mappings`
          : error && plannedTx === 1 ? "Review remaining mapping"
          : plannedTx > 1 ? `Review ${plannedTx} mapping transactions`
          : "Review mapping transaction"
        }
        onPress={() => void prepareMappings()}
        disabled={preparing || loading || selected.size === 0 || !allAddressesFilled || allDone}
      />

      <ConfirmSheet
        open={!!review}
        onClose={() => { if (!loading) setReview(null); }}
        onConfirm={() => void confirmMappings()}
        title={review?.writes.length === 1 ? "Save this mapping?" : "Save these mappings?"}
        body="Each row below is a separate Base transaction. Exact EVM overrides are included so they cannot silently route payments to an old address."
        confirmLabel={review?.writes.length === 1 ? "Save 1 mapping" : `Save ${review?.writes.length ?? 0} mappings`}
        tone="caution"
        icon={<ShieldIcon size={22} color={colors.caution} />}
        busy={loading}
      >
        {review && (
          <>
            <SheetPanel>
              <SheetRow label="BPAN" value={formatBPAN(review.number)} strong />
              <SheetRow label="Network" value={BPAN_DEPLOYMENT.name} />
              <SheetRow label="Transactions" value={String(review.writes.length)} />
              <SheetRow label="Estimated network fees" value={formatEth(review.networkFeeWei)} />
              <SheetRow label="Wallet balance" value={formatEth(review.balanceWei)} />
            </SheetPanel>
            <SheetPanel style={{ marginTop: 10 }}>
              {review.writes.map((write) => (
                <SheetRow key={write.key} label={write.label} value={shortAddress(write.addr)} />
              ))}
            </SheetPanel>
          </>
        )}
      </ConfirmSheet>
    </View>
  );
}

function ChainToggle({ label, sublabel, chainId, on, mapped = false, disabled = false, badge, onPress }: {
  label: string;
  sublabel?: string;
  chainId: string;
  on: boolean;
  mapped?: boolean;
  disabled?: boolean;
  badge?: string;
  onPress: () => void;
}) {
  const checked = on || mapped;
  return (
    <Tappable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      accessibilityLabel={mapped ? `${label}, already mapped` : label}
      disabled={disabled}
      dimWhenDisabled={!mapped}
      feedback="tile"
      onPress={onPress}
      style={[st.toggleRow, on && !mapped && st.toggleRowOn, mapped && st.toggleRowMapped]}
    >
      <View style={[st.checkbox, checked && st.checkboxOn, mapped && st.checkboxMapped]}>
        {checked && <CheckIcon size={11} color="#fff" />}
      </View>
      <ChainIcon chainId={chainId} size={18} />
      <View style={{ flex: 1 }}>
        <Text style={[st.toggleLabel, on && !mapped && { color: colors.brand2 }]}>{label}</Text>
        {!!sublabel && <Text style={st.toggleSub}>{sublabel}</Text>}
      </View>
      {!!badge && (
        <Text style={[st.badge, badge === "mapped" ? st.badgeMapped : st.badgeTx]}>{badge}</Text>
      )}
    </Tappable>
  );
}

function AddressField({ label, value, auto, onChange, mapped }: {
  label: string; value: string; auto: string; onChange: (v: string) => void; mapped: boolean;
}) {
  return (
    <View style={{ gap: 4 }}>
      <Text style={st.addrLabel}>
        {label}{mapped ? "  ✓ mapped" : auto && value === auto ? "  auto" : ""}
      </Text>
      <View style={{ flexDirection: "row", gap: 8 }}>
        <Field
          accessibilityLabel={label}
          placeholder={auto || label}
          autoCapitalize="none"
          autoCorrect={false}
          value={value}
          onChangeText={onChange}
          style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
        />
        {!!auto && (
          <Tappable accessibilityLabel={`Use my ${label}`} feedback="tile" onPress={() => onChange(auto)} style={st.mineBtn}>
            <Text style={st.mineBtnText}>Mine</Text>
          </Tappable>
        )}
      </View>
    </View>
  );
}

function TxSuccessRow({ chain, hash }: { chain: string; hash: string }) {
  return (
    <Tappable feedback="ghost" onPress={() => { Share.share({ message: explorerTxUrl(BPAN_DEPLOYMENT.networkId, hash) }).catch(() => {}); }}>
      <Card style={st.txRow}>
        <View style={st.txCheck}><CheckIcon size={9} color={colors.success} /></View>
        <Text style={st.txChain} numberOfLines={1}>{chain}</Text>
        <Text style={st.txHash} numberOfLines={1}>{hash.slice(0, 12)}…{hash.slice(-6)}</Text>
      </Card>
    </Tappable>
  );
}

// ── Lookup (read-only) ────────────────────────────────────────────────────────
function Lookup() {
  const [number, setNumber] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [owner, setOwner] = useState("");
  const [result, setResult] = useState<Mappings | null>(null);

  async function handleLookup() {
    const clean = number.trim().replace(/\D/g, "");
    if (!isValidBPAN(clean)) { setError("Enter a valid 11-digit BPAN number"); return; }
    setError(""); setLoading(true); setResult(null); setOwner("");
    try {
      const registered = await isBPANRegistered(clean);
      if (!registered) { setError("This number is not registered"); return; }
      const [m, o] = await Promise.all([getAllBPANMappings(clean), getBPANOwner(clean)]);
      setResult(m);
      setOwner(o);
    } catch (e: any) {
      setError(safeActionError(e, "This BPAN could not be checked right now. Please try again shortly."));
    } finally { setLoading(false); }
  }

  return (
    <View style={{ gap: 10 }}>
      <Field
        accessibilityLabel="BPAN number to look up"
        placeholder="11-digit BPAN number"
        keyboardType="number-pad"
        value={number}
        onChangeText={(v) => { setNumber(v.replace(/\D/g, "").slice(0, 11)); setError(""); }}
      />
      <Btn label={loading ? "Looking up…" : "Lookup"} onPress={() => void handleLookup()} disabled={loading} />

      {!!error && <Text style={st.error}>{error}</Text>}

      {!!owner && (
        <Card style={{ padding: 14 }}>
          <Text style={st.mapLabel}>NFT OWNER</Text>
          <Text style={st.ownerAddr}>{owner}</Text>
        </Card>
      )}

      {result && result.chains.length > 0 && (
        <View style={{ gap: 6 }}>
          <Text style={st.mapLabel}>WALLET MAPPINGS ({result.chains.length})</Text>
          {result.chains.map((chain, i) => (
            <Card key={chain + i} style={st.lookupRow}>
              <ChainIcon chainId={chain === BPAN_EVM_KEY ? "ethereum" : chain} size={22} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={st.lookupChain}>{bpanChainLabel(chain)}</Text>
                <Text style={st.lookupAddr} numberOfLines={1}>{result.wallets[i]}</Text>
              </View>
            </Card>
          ))}
        </View>
      )}
      {result && result.chains.length === 0 && (
        <Text style={st.dim}>No wallet mappings set for this BPAN.</Text>
      )}
    </View>
  );
}

const st = themedStyles((colors) => ({
  subText: { color: colors.muted, fontSize: ts.small },
  tabs: {
    flexDirection: "row", marginBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider,
  },
  tab: {
    flex: 1, minHeight: 44, justifyContent: "center", alignItems: "center",
    borderBottomWidth: 2, borderBottomColor: "transparent",
  },
  tabOn: { borderBottomColor: colors.brand },
  // textSecondary, not muted: this label sits on the surface2 tab track, where
  // muted measures 4.18:1 in light. Matches bpanChipText, which is the same
  // quiet-label-on-surface2 job further down.
  tabText: { color: colors.textSecondary, fontSize: ts.small, fontWeight: "600" },
  tabTextOn: { color: colors.brand2 },
  dim: { color: colors.muted, fontSize: ts.small, paddingVertical: 8 },
  emptyTitle: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "600", marginBottom: 6 },
  emptyBody: { color: colors.muted, fontSize: ts.small, lineHeight: 17, textAlign: "center" },
  bpanHero: { paddingHorizontal: 16, paddingTop: 18, paddingBottom: 16 },
  bpanEyebrow: { color: colors.muted, fontSize: ts.label, fontWeight: "700", letterSpacing: 1.1 },
  cardNumber: {
    color: colors.textPrimary, fontSize: 26, lineHeight: 34, fontWeight: "700",
    fontVariant: ["tabular-nums"], letterSpacing: 0.7, marginTop: 7,
  },
  readyText: { color: colors.successText, fontSize: ts.small, fontWeight: "600", marginTop: 4 },
  quickActions: { flexDirection: "row", gap: 8, paddingHorizontal: 12, paddingBottom: 10 },
  quickAction: {
    flex: 1, minHeight: 62, paddingHorizontal: 9, paddingVertical: 9,
    alignItems: "flex-start", justifyContent: "space-between",
    borderRadius: radius.tile, borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border, backgroundColor: colors.card2,
  },
  quickActionPrimary: { backgroundColor: colors.action, borderColor: colors.action },
  quickActionText: { color: colors.textPrimary, fontSize: ts.small, fontWeight: "600" },
  quickActionPrimaryText: { color: colors.onBrand, fontSize: ts.small, fontWeight: "600" },
  mappingDisclosure: {
    minHeight: 44, justifyContent: "center", paddingHorizontal: 14,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider,
  },
  mappingDisclosureText: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
  cardBody: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border },
  mapLabel: { color: colors.muted, fontSize: ts.label, fontWeight: "600", letterSpacing: 0.5 },
  mapRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  mapChain: { color: colors.brand2, fontSize: ts.small, fontWeight: "600", width: 96 },
  mapAddr: { color: colors.textSecondary, fontSize: ts.small, flex: 1, fontVariant: ["tabular-nums"] },
  link: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
  error: { color: colors.dangerText, fontSize: ts.small },
  availableRow: { flexDirection: "row", alignItems: "center", gap: 5 },
  available: { color: colors.successText, fontSize: ts.small, fontWeight: "600" },
  feeLine: { color: colors.brand2, fontSize: ts.small, fontWeight: "600", marginTop: 8 },
  ownerAddr: { color: colors.textPrimary, fontSize: ts.small, marginTop: 4 },
  ownedPill: { backgroundColor: colors.brandTint, borderRadius: radius.tile, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, paddingVertical: 8, alignSelf: "flex-start" },
  ownedPillText: { color: colors.brand2, fontSize: ts.row, fontWeight: "700", fontVariant: ["tabular-nums"] },
  checkBtn: { paddingHorizontal: 14, justifyContent: "center", borderRadius: radius.button, backgroundColor: colors.surface2, borderWidth: 1, borderColor: colors.border },
  checkBtnText: { color: colors.textSecondary, fontSize: ts.small, fontWeight: "600" },
  lookupRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  lookupChain: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
  lookupAddr: { color: colors.textPrimary, fontSize: ts.small, marginTop: 1 },
  // Mapping
  selectedBpan: { color: colors.brand2, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"] },
  bpanChip: { paddingHorizontal: 12, paddingVertical: 7, borderRadius: radius.button, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.surface2 },
  bpanChipOn: { backgroundColor: colors.action, borderColor: colors.action },
  bpanChipText: { color: colors.textSecondary, fontSize: ts.small, fontWeight: "600", fontVariant: ["tabular-nums"] },
  bpanChipTextOn: { color: "#fff" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.button, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  toggleRowOn: { borderColor: colors.brand },
  toggleRowMapped: { borderColor: colors.success, backgroundColor: colors.successTint },
  checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  checkboxMapped: { backgroundColor: colors.success, borderColor: colors.success },
  toggleLabel: { color: colors.textPrimary, fontSize: ts.small, fontWeight: "600" },
  toggleSub: { color: colors.muted, fontSize: ts.label, marginTop: 1 },
  badge: { fontSize: 9, fontWeight: "600", paddingHorizontal: 6, paddingVertical: 2, borderRadius: radius.pill, overflow: "hidden" },
  badgeMapped: { color: colors.successText, backgroundColor: colors.successTint },
  badgeTx: { color: colors.brand2, backgroundColor: colors.brandTint },
  addrLabel: { color: colors.textSecondary, fontSize: ts.label, fontWeight: "500" },
  mineBtn: { paddingHorizontal: 12, justifyContent: "center", borderRadius: radius.button, backgroundColor: colors.brandTint, borderWidth: 1, borderColor: colors.border },
  mineBtnText: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
  progressTrack: { height: 6, borderRadius: 3, backgroundColor: colors.surface3, overflow: "hidden" },
  progressFill: { height: "100%", backgroundColor: colors.brand, borderRadius: 3 },
  txRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingHorizontal: 12, paddingVertical: 8 },
  txCheck: { width: 16, height: 16, borderRadius: 8, backgroundColor: colors.successTint, alignItems: "center", justifyContent: "center" },
  txChain: { color: colors.textSecondary, fontSize: ts.small, fontWeight: "600", width: 88 },
  txHash: { color: colors.brand2, fontSize: ts.small, flex: 1, fontVariant: ["tabular-nums"] },
}));
