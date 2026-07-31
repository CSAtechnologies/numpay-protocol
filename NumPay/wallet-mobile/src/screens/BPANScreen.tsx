// Mobile BPAN — the phone equivalent of the extension's BPANPage, reusing the
// same @numpay/core/bpan read/write functions so both clients hit the SAME
// mainnet registry with identical semantics.
//
// Four tabs: My BPAN + Lookup (reads) and Register + Mapping (Ethereum-mainnet
// WRITES). Mobile always operates on mainnet (there is no chain switcher), so
// reads use the default target and writes use BPAN_MAINNET_CONTRACT /
// BPAN_MAINNET_RPC directly — no "switch to Ethereum" gating. Every write is
// gated by a fresh vault-unlock check (getUnlockedMnemonic): if the session
// expired the caller's onSessionExpired surfaces the re-auth overlay, exactly
// like Send/Swap.
import { useCallback, useEffect, useMemo, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import { ethers } from "ethers";
import {
  isValidBPAN, formatBPAN, BPAN_EVM_KEY, getBPANContract,
  getAllBPANMappings, isBPANRegistered, getBPANOwner,
  findOwnedBPANs, getOwnedBPANCount, registerBPAN, setWalletMapping,
} from "@numpay/core/bpan";
import { BPAN_CHAINS, BPAN_MAINNET_CONTRACT, BPAN_MAINNET_RPC } from "@numpay/core/networks";
import { isValidChainAddress } from "@numpay/core/addressValidation";
import { importFromMnemonic, getSigner } from "@numpay/core/wallet";
import { getItem, setItem } from "@numpay/core/storage";
import { explorerTxUrl } from "@numpay/core/txLog";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import type { MobileWalletState } from "../wallet/useMobileWallet";
import { colors, radius, type as ts, themedStyles } from "../ui/theme";
import { Notice, Btn, Card, Field, ScreenHeader, Tappable } from "../ui/components";
import { CheckIcon } from "../ui/icons";
import { ChainIcon } from "../ui/coins";

type Tab = "my-bpan" | "register" | "mapping" | "lookup";
type Mappings = { chains: string[]; wallets: string[] };

// Display label for a registry mapping key ("evm" is the opt-in key that covers
// every EVM chain — see BPAN_EVM_KEY in core/bpan).
function bpanChainLabel(chain: string): string {
  if (chain === BPAN_EVM_KEY) return "All EVM chains";
  return BPAN_CHAINS.find((c) => c.id === chain)?.name ?? chain;
}

// Saved BPAN numbers per owner address, in core storage (same key shape as the
// extension's localStorage cache so intent reads the same across clients).
async function getSavedBPANs(address: string): Promise<string[]> {
  try {
    const raw = await getItem(`bpan_numbers_${address.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}
async function saveBPANs(address: string, numbers: string[]): Promise<void> {
  try { await setItem(`bpan_numbers_${address.toLowerCase()}`, JSON.stringify(numbers)); } catch { /* non-fatal */ }
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
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);

  const address = w.evmAddress;

  // Load the cached list immediately, then scan mainnet once per wallet.
  useEffect(() => {
    if (!address) return;
    let live = true;
    setScanned(false);
    getSavedBPANs(address).then((s) => { if (live) setOwned(s); });
    return () => { live = false; };
  }, [address]);

  useEffect(() => {
    if (!address || scanned) return;
    setScanned(true);
    let live = true;
    (async () => {
      // Fast path: does this wallet own any BPAN at all?
      const count = await getOwnedBPANCount(address).catch(() => 0);
      if (!live || count === 0) return;
      setScanning(true);
      try {
        const found = await findOwnedBPANs(address);
        if (!live || found.length === 0) return;
        const saved = await getSavedBPANs(address);
        const merged = Array.from(new Set([...found, ...saved]));
        await saveBPANs(address, merged);
        if (live) setOwned(merged);
      } catch { /* non-fatal */ }
      finally { if (live) setScanning(false); }
    })();
    return () => { live = false; };
  }, [address, scanned]);

  // Reflect a freshly registered BPAN without waiting for a re-scan.
  const handleRegistered = useCallback(async (number: string) => {
    const merged = Array.from(new Set([number, ...owned]));
    setOwned(merged);
    await saveBPANs(address, merged);
    setTab("mapping");
  }, [owned, address]);

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

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="BPAN" onBack={onBack} />
      <View style={st.subRow}>
        <View style={st.greenDot} />
        <Text style={st.subText}>
          Registry on <Text style={{ color: colors.brand2 }}>Ethereum mainnet</Text>. All chain mappings stored there.
        </Text>
      </View>

      {/* Tabs */}
      <View style={st.tabs}>
        {TABS.map((t) => (
          <Tappable feedback="row" key={t.id} onPress={() => setTab(t.id)} style={[st.tab, tab === t.id && st.tabOn]}>
            <Text style={[st.tabText, tab === t.id && st.tabTextOn]}>{t.label}</Text>
          </Tappable>
        ))}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {tab === "my-bpan" && (
          <MyBPAN owned={owned} scanning={scanning} address={address} onGoRegister={() => setTab("register")} />
        )}
        {tab === "register" && (
          <RegisterSection owned={owned} requireMnemonic={requireMnemonic} onRegistered={handleRegistered} onGoMapping={() => setTab("mapping")} />
        )}
        {tab === "mapping" && (
          <MappingSection w={w} owned={owned} requireMnemonic={requireMnemonic} />
        )}
        {tab === "lookup" && <Lookup />}
      </ScrollView>
    </View>
  );
}

// ── My BPAN (read-only) ───────────────────────────────────────────────────────
function MyBPAN({ owned, scanning, address, onGoRegister }: {
  owned: string[]; scanning: boolean; address: string; onGoRegister: () => void;
}) {
  if (scanning && owned.length === 0) {
    return <Text style={st.dim}>Scanning Ethereum mainnet for your BPANs…</Text>;
  }
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
      {scanning && <Text style={st.dim}>Syncing from mainnet…</Text>}
      {owned.map((n) => <BPANCard key={n} number={n} walletAddress={address} />)}
    </View>
  );
}

function BPANCard({ number, walletAddress }: { number: string; walletAddress: string }) {
  const [expanded, setExpanded] = useState(false);
  const [mappings, setMappings] = useState<Mappings | null>(null);
  const [owner, setOwner] = useState("");
  const [loading, setLoading] = useState(false);

  const loadDetail = useCallback(async () => {
    setLoading(true);
    try {
      const [m, o] = await Promise.all([getAllBPANMappings(number), getBPANOwner(number)]);
      setMappings(m);
      setOwner(o);
    } catch { setMappings({ chains: [], wallets: [] }); }
    finally { setLoading(false); }
  }, [number]);

  useEffect(() => { if (expanded && !mappings) void loadDetail(); }, [expanded, mappings, loadDetail]);

  const isOwner = !!owner && owner.toLowerCase() === walletAddress.toLowerCase();

  return (
    <Card style={{ overflow: "hidden" }}>
      <View style={st.cardHead}>
        <View style={st.hashTile}><Text style={st.hashGlyph}>#</Text></View>
        <View style={{ flex: 1 }}>
          <Text style={st.cardNumber}>{formatBPAN(number)}</Text>
          {isOwner && <Text style={st.ownerBadge}>Owner</Text>}
        </View>
        <Tappable feedback="tile" onPress={() => { Share.share({ message: number }).catch(() => {}); }} style={st.cardAction} hitSlop={6}>
          <Text style={st.cardActionText}>Share</Text>
        </Tappable>
        <Tappable feedback="tile" onPress={() => setExpanded((v) => !v)} style={st.cardAction} hitSlop={6}>
          <Text style={st.cardActionText}>{expanded ? "Hide" : "Details"}</Text>
        </Tappable>
      </View>

      {expanded && (
        <View style={st.cardBody}>
          {loading && <Text style={st.dim}>Loading from Ethereum mainnet…</Text>}
          {!loading && mappings && mappings.chains.length > 0 && (
            <View style={{ gap: 6 }}>
              <Text style={st.mapLabel}>WALLET MAPPINGS</Text>
              {mappings.chains.map((chain, i) => (
                <MappingRow key={chain + i} chain={chain} wallet={mappings.wallets[i]} />
              ))}
            </View>
          )}
          {!loading && mappings && mappings.chains.length === 0 && (
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
      <Text style={st.mapAddr} numberOfLines={1}>
        {wallet.slice(0, 8)}…{wallet.slice(-6)}
      </Text>
    </View>
  );
}

// ── Register (mainnet write) ──────────────────────────────────────────────────
function RegisterSection({ owned, requireMnemonic, onRegistered, onGoMapping }: {
  owned: string[];
  requireMnemonic: () => Promise<string | null>;
  onRegistered: (n: string) => void | Promise<void>;
  onGoMapping: () => void;
}) {
  const [number, setNumber] = useState("");
  const [checking, setChecking] = useState(false);
  const [available, setAvailable] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(false);
  const [txHash, setTxHash] = useState("");
  const [error, setError] = useState("");
  const [fee, setFee] = useState<string | null>(null);

  // Read the live registration fee for the mainnet contract.
  useEffect(() => {
    let live = true;
    (async () => {
      try {
        const provider = new ethers.JsonRpcProvider(BPAN_MAINNET_RPC, 1, { staticNetwork: true });
        const contract = getBPANContract(BPAN_MAINNET_CONTRACT, provider);
        const f: bigint = await contract.registrationFee();
        if (live) setFee(ethers.formatEther(f));
      } catch { /* fee line stays hidden */ }
    })();
    return () => { live = false; };
  }, []);

  // A wallet holds one BPAN — block registration if it already owns one.
  if (owned.length > 0) {
    return (
      <Card style={{ padding: 16 }}>
        <Text style={st.emptyTitle}>Already registered</Text>
        <Text style={st.emptyBody}>
          This wallet owns {owned.length === 1 ? "a BPAN" : `${owned.length} BPANs`}. One number works across every
          supported chain — add wallet mappings to receive on more chains.
        </Text>
        <View style={{ gap: 6, marginTop: 12 }}>
          {owned.map((n) => (
            <View key={n} style={st.ownedPill}>
              <Text style={st.ownedPillText}>{formatBPAN(n)}</Text>
            </View>
          ))}
        </View>
        <Btn label="Add chain mappings" onPress={onGoMapping} style={{ marginTop: 14 }} />
      </Card>
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
    if (!isValidBPAN(number)) { setError("Enter a valid 11-digit number"); return; }
    const mnemonic = await requireMnemonic();
    if (!mnemonic) return;
    setError(""); setLoading(true); setTxHash("");
    try {
      const wd = importFromMnemonic(mnemonic);
      const signer = getSigner(wd.privateKey, BPAN_MAINNET_RPC);
      const tx = await registerBPAN(number, BPAN_MAINNET_CONTRACT, signer);
      setTxHash(tx.hash);
      await tx.wait();
      await onRegistered(number);
    } catch (e: any) {
      setError(e?.reason || e?.message || "Registration failed");
    } finally { setLoading(false); }
  }

  return (
    <View style={{ gap: 10 }}>
      <Card style={{ padding: 14 }}>
        <Text style={st.mapLabel}>HOW IT WORKS</Text>
        <Text style={[st.emptyBody, { textAlign: "left", marginTop: 4 }]}>
          Register any 11-digit number as your BPAN identity. It mints as an NFT on Ethereum mainnet. You then map
          wallet addresses for each chain you want to receive on.
        </Text>
        {fee && (
          <Text style={st.feeLine}>
            Registration fee: {parseFloat(fee) === 0 ? "Free" : `${fee} ETH`} (plus gas)
          </Text>
        )}
      </Card>

      <View style={{ flexDirection: "row", gap: 8 }}>
        <Field
          placeholder="e.g. 12345678901"
          keyboardType="number-pad"
          value={number}
          onChangeText={(v) => { setNumber(v.replace(/\D/g, "").slice(0, 11)); setAvailable(null); setError(""); }}
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

      {available === true && (
        <View style={st.availableRow}>
          <CheckIcon size={12} color={colors.success} />
          <Text style={st.available}>Available</Text>
        </View>
      )}
      {available === false && <Text style={st.error}>Already taken. Try a different number.</Text>}
      {!!error && <Text style={st.error}>{error}</Text>}
      {!!txHash && <TxSuccessRow chain="Register" hash={txHash} />}

      <Btn
        label={loading ? "Registering…" : "Register BPAN"}
        onPress={() => void handleRegister()}
        disabled={loading || !isValidBPAN(number) || available === false}
      />
    </View>
  );
}

// ── Mapping (mainnet writes) ──────────────────────────────────────────────────
function MappingSection({ w, owned, requireMnemonic }: {
  w: MobileWalletState;
  owned: string[];
  requireMnemonic: () => Promise<string | null>;
}) {
  const [number, setNumber] = useState(owned[0] ?? "");
  // "evm" is a single synthetic entry covering every EVM chain (one registry
  // mapping, one tx). Only non-EVM chains are listed individually.
  const [selected, setSelected] = useState<Set<string>>(new Set([BPAN_EVM_KEY]));
  const [evmAddr, setEvmAddr] = useState(w.evmAddress);
  const [nonEvmAddrs, setNonEvmAddrs] = useState<Record<string, string>>({});
  const [existingMap, setExistingMap] = useState<Record<string, string> | null>(null);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState({ current: 0, total: 0, chain: "" });
  const [txHashes, setTxHashes] = useState<{ chain: string; hash: string }[]>([]);
  const [error, setError] = useState("");

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

  async function handleSetMappings() {
    if (!isValidBPAN(number)) { setError("Enter a valid 11-digit BPAN"); return; }
    if (selected.size === 0) { setError("Select at least one chain"); return; }
    if (!allAddressesFilled) { setError("Fill in all wallet addresses before mapping"); return; }

    // Validate every address against its chain format BEFORE any write — a
    // malformed or wrong-chain mapping misdirects every future payment.
    if (evmSelected && !isValidChainAddress(evmAddr.trim(), "ethereum", true)) {
      setError("The EVM address is not valid.");
      return;
    }
    for (const c of selectedNonEvm) {
      if (!isValidChainAddress((nonEvmAddrs[c.id] || "").trim(), c.id, false)) {
        setError(`The ${c.name} address is not valid.`);
        return;
      }
    }

    const mnemonic = await requireMnemonic();
    if (!mnemonic) return;

    setError(""); setLoading(true); setTxHashes([]);
    try {
      // Re-read CURRENT mappings (fresh, not the UI cache): they drive the
      // no-op skip and the per-chain-EVM override rewrites below.
      let existing: Record<string, string> | null = null;
      try {
        const m = await getAllBPANMappings(number);
        existing = Object.fromEntries(m.chains.map((c, i) => [c, m.wallets[i]]));
        setExistingMap(existing);
      } catch { existing = null; }

      // Build the write list. All selected EVM chains collapse into ONE "evm"
      // mapping (the resolver falls back to it for any EVM chain with no exact
      // mapping) — one tx instead of one per chain. Exact per-chain EVM
      // mappings WIN at resolution, so any existing per-chain EVM mapping
      // pointing at a DIFFERENT address must be rewritten in the same batch or
      // it would silently keep overriding the new evm mapping. Non-EVM stay
      // per-chain. A chain already mapped to the same address is skipped.
      const writes: { key: string; addr: string; label: string }[] = [];
      if (evmSelected) {
        if (!existing) {
          setError("Could not read this BPAN's current mappings (needed to check for per-chain overrides). Try again.");
          return;
        }
        const addr = evmAddr.trim();
        if ((existing[BPAN_EVM_KEY] ?? "").trim().toLowerCase() !== addr.toLowerCase()) {
          writes.push({ key: BPAN_EVM_KEY, addr, label: "All EVM chains" });
        }
        for (const [cid, mapped] of Object.entries(existing)) {
          const def = BPAN_CHAINS.find((c) => c.id === cid);
          if (def?.isEVM && mapped.toLowerCase() !== addr.toLowerCase()) {
            writes.push({ key: cid, addr, label: def.name });
          }
        }
      }
      for (const c of selectedNonEvm) {
        const addr = (nonEvmAddrs[c.id] || "").trim();
        if (existing && (existing[c.id] ?? "").trim() === addr) continue; // already mapped
        writes.push({ key: c.id, addr, label: c.name });
      }

      if (writes.length === 0) {
        setError("Everything selected is already mapped to these addresses — nothing to write.");
        return;
      }

      setProgress({ current: 0, total: writes.length, chain: "" });
      const wd = importFromMnemonic(mnemonic);
      const signer = getSigner(wd.privateKey, BPAN_MAINNET_RPC);

      for (let i = 0; i < writes.length; i++) {
        const wr = writes[i];
        setProgress({ current: i + 1, total: writes.length, chain: wr.label });
        const tx = await setWalletMapping(number, wr.key, wr.addr, BPAN_MAINNET_CONTRACT, signer);
        setTxHashes((prev) => [...prev, { chain: wr.label, hash: tx.hash }]);
        await tx.wait();
        setExistingMap((prev) => ({ ...(prev ?? {}), [wr.key]: wr.addr }));
      }
    } catch (e: any) {
      setError(e?.reason || e?.message || "Failed to set mapping");
    } finally { setLoading(false); }
  }

  if (owned.length === 0) {
    return (
      <Card style={{ padding: 16, alignItems: "center" }}>
        <Text style={st.emptyTitle}>No BPAN to map</Text>
        <Text style={st.emptyBody}>Register a BPAN first, then map your wallet addresses to it here.</Text>
      </Card>
    );
  }

  const plannedTx =
    (evmSelected && !evmUpToDate ? 1 : 0) +
    selectedNonEvm.filter((c) => !nonEvmUpToDate(c.id)).length;
  const allDone = selected.size > 0 && plannedTx === 0;

  return (
    <View style={{ gap: 10 }}>
      <Text style={[st.emptyBody, { textAlign: "left" }]}>
        Map your wallet addresses to your BPAN across chains. All mappings are stored on Ethereum mainnet.
      </Text>

      {/* BPAN selector (chips when multiple) */}
      {owned.length > 1 ? (
        <View style={{ flexDirection: "row", flexWrap: "wrap", gap: 6 }}>
          {owned.map((n) => (
            <Tappable feedback="row" key={n} onPress={() => setNumber(n)} style={[st.bpanChip, number === n && st.bpanChipOn]}>
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
        return (
          <View key={c.id} style={{ gap: 6 }}>
            <ChainToggle
              label={c.name}
              chainId={c.id}
              on={on}
              badge={nonEvmUpToDate(c.id) ? "mapped" : undefined}
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

      {!!error && <Text style={st.error}>{error}</Text>}

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
          loading ? `Mapping ${progress.current}/${progress.total}…`
          : allDone ? "Already mapped ✓"
          : plannedTx > 1 ? `Set Mappings (${plannedTx} transactions)`
          : "Set Mapping (1 transaction)"
        }
        onPress={() => void handleSetMappings()}
        disabled={loading || selected.size === 0 || !allAddressesFilled || allDone}
      />
    </View>
  );
}

function ChainToggle({ label, sublabel, chainId, on, badge, onPress }: {
  label: string; sublabel?: string; chainId: string; on: boolean; badge?: string; onPress: () => void;
}) {
  return (
    <Tappable feedback="tile" onPress={onPress} style={[st.toggleRow, on && st.toggleRowOn]}>
      <View style={[st.checkbox, on && st.checkboxOn]}>{on && <CheckIcon size={11} color="#fff" />}</View>
      <ChainIcon chainId={chainId} size={18} />
      <View style={{ flex: 1 }}>
        <Text style={[st.toggleLabel, on && { color: colors.brand2 }]}>{label}</Text>
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
          placeholder={auto || label}
          autoCapitalize="none"
          autoCorrect={false}
          value={value}
          onChangeText={onChange}
          style={{ flex: 1, fontFamily: "monospace", fontSize: 12 }}
        />
        {!!auto && (
          <Tappable feedback="tile" onPress={() => onChange(auto)} style={st.mineBtn}>
            <Text style={st.mineBtnText}>Mine</Text>
          </Tappable>
        )}
      </View>
    </View>
  );
}

function TxSuccessRow({ chain, hash }: { chain: string; hash: string }) {
  return (
    <Tappable feedback="ghost" onPress={() => { Share.share({ message: explorerTxUrl("ethereum", hash) }).catch(() => {}); }}>
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
      setError(e?.reason || e?.message || "Lookup failed");
    } finally { setLoading(false); }
  }

  return (
    <View style={{ gap: 10 }}>
      <Field
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
  subRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12, paddingHorizontal: 2 },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  subText: { color: colors.muted, fontSize: ts.small },
  tabs: { flexDirection: "row", gap: 4, marginBottom: 14, padding: 4, backgroundColor: colors.surface2, borderRadius: radius.button },
  tab: { flex: 1, paddingVertical: 8, borderRadius: radius.tile, alignItems: "center" },
  tabOn: { backgroundColor: colors.brand },
  // textSecondary, not muted: this label sits on the surface2 tab track, where
  // muted measures 4.18:1 in light. Matches bpanChipText, which is the same
  // quiet-label-on-surface2 job further down.
  tabText: { color: colors.textSecondary, fontSize: ts.small, fontWeight: "600" },
  tabTextOn: { color: "#fff" },
  dim: { color: colors.muted, fontSize: ts.small, paddingVertical: 8 },
  emptyTitle: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "600", marginBottom: 6 },
  emptyBody: { color: colors.muted, fontSize: ts.small, lineHeight: 17, textAlign: "center" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  hashTile: { width: 38, height: 38, borderRadius: radius.tile, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  hashGlyph: { color: "#fff", fontSize: 15, fontWeight: "700" },
  cardNumber: { color: colors.textPrimary, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"], letterSpacing: 0.5 },
  ownerBadge: { alignSelf: "flex-start", color: colors.successText, fontSize: 9.5, fontWeight: "600", marginTop: 2 },
  cardAction: { paddingHorizontal: 8, paddingVertical: 6 },
  cardActionText: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
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
  bpanChipOn: { backgroundColor: colors.brand, borderColor: colors.brand },
  bpanChipText: { color: colors.textSecondary, fontSize: ts.small, fontWeight: "600", fontVariant: ["tabular-nums"] },
  bpanChipTextOn: { color: "#fff" },
  toggleRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12, borderRadius: radius.button, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card },
  toggleRowOn: { borderColor: colors.brand },
  checkbox: { width: 18, height: 18, borderRadius: 5, borderWidth: 1, borderColor: colors.border, alignItems: "center", justifyContent: "center" },
  checkboxOn: { backgroundColor: colors.brand, borderColor: colors.brand },
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
