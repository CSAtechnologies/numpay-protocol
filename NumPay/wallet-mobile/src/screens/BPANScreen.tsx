// Mobile BPAN — the phone equivalent of the extension's BPANPage, reusing the
// same @numpay/core/bpan read/write functions so both clients hit the SAME
// mainnet registry with identical semantics.
//
// Slice A (this file): the two READ-ONLY tabs — "My BPAN" (on-chain ownership
// scan + mapping display) and "Lookup" (resolve any BPAN's owner + mappings).
// The write tabs (Register, set Mappings) land in the following slices; they
// are mainnet writes and get their own gated build. Mobile always operates on
// mainnet (there is no chain switcher), so reads use the default target and
// there is no "switch to Ethereum" gating.
import { useCallback, useEffect, useState } from "react";
import { Pressable, ScrollView, Share, StyleSheet, Text, View } from "react-native";
import {
  isValidBPAN, formatBPAN,
  getAllBPANMappings, isBPANRegistered, getBPANOwner,
  findOwnedBPANs, getOwnedBPANCount,
} from "@numpay/core/bpan";
import { BPAN_CHAINS } from "@numpay/core/networks";
import { getItem, setItem } from "@numpay/core/storage";
import type { MobileWalletState } from "../wallet/useMobileWallet";
import { colors, radius, type as ts } from "../ui/theme";
import { Btn, Card, Field, ScreenHeader } from "../ui/components";
import { ChainIcon } from "../ui/coins";

type Tab = "my-bpan" | "lookup";
type Mappings = { chains: string[]; wallets: string[] };

// Display label for a registry mapping key ("evm" is the opt-in key that covers
// every EVM chain — see BPAN_EVM_KEY in core/bpan).
function bpanChainLabel(chain: string): string {
  if (chain === "evm") return "All EVM chains";
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

export function BPANScreen({ w, onBack }: { w: MobileWalletState; onBack: () => void }) {
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
        {(["my-bpan", "lookup"] as Tab[]).map((t) => (
          <Pressable key={t} onPress={() => setTab(t)} style={[st.tab, tab === t && st.tabOn]}>
            <Text style={[st.tabText, tab === t && st.tabTextOn]}>{t === "my-bpan" ? "My BPAN" : "Lookup"}</Text>
          </Pressable>
        ))}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {tab === "my-bpan"
          ? <MyBPAN owned={owned} scanning={scanning} address={address} />
          : <Lookup />}
      </ScrollView>
    </View>
  );
}

// ── My BPAN (read-only) ───────────────────────────────────────────────────────
function MyBPAN({ owned, scanning, address }: { owned: string[]; scanning: boolean; address: string }) {
  if (scanning && owned.length === 0) {
    return <Text style={st.dim}>Scanning Ethereum mainnet for your BPANs…</Text>;
  }
  if (owned.length === 0) {
    return (
      <Card style={{ padding: 18, alignItems: "center", marginTop: 8 }}>
        <Text style={st.emptyTitle}>No BPANs yet</Text>
        <Text style={st.emptyBody}>
          A BPAN is your 11-digit payment identity: one number, addresses mapped per chain.
          Registering from your phone arrives in the next update; for now register from the
          browser extension and it will appear here.
        </Text>
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
        <Pressable onPress={() => { Share.share({ message: number }).catch(() => {}); }} style={st.cardAction} hitSlop={6}>
          <Text style={st.cardActionText}>Share</Text>
        </Pressable>
        <Pressable onPress={() => setExpanded((v) => !v)} style={st.cardAction} hitSlop={6}>
          <Text style={st.cardActionText}>{expanded ? "Hide" : "Details"}</Text>
        </Pressable>
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
            <Pressable onPress={() => void loadDetail()} style={{ marginTop: 8 }}>
              <Text style={st.link}>Refresh</Text>
            </Pressable>
          )}
        </View>
      )}
    </Card>
  );
}

function MappingRow({ chain, wallet }: { chain: string; wallet: string }) {
  return (
    <View style={st.mapRow}>
      <ChainIcon chainId={chain === "evm" ? "ethereum" : chain} size={16} />
      <Text style={st.mapChain}>{bpanChainLabel(chain)}</Text>
      <Text style={st.mapAddr} numberOfLines={1}>
        {wallet.slice(0, 8)}…{wallet.slice(-6)}
      </Text>
    </View>
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
              <ChainIcon chainId={chain === "evm" ? "ethereum" : chain} size={22} />
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

const st = StyleSheet.create({
  subRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 12, paddingHorizontal: 2 },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  subText: { color: colors.muted, fontSize: ts.small },
  tabs: { flexDirection: "row", gap: 6, marginBottom: 14, padding: 4, backgroundColor: colors.surface2, borderRadius: radius.button },
  tab: { flex: 1, paddingVertical: 8, borderRadius: radius.tile, alignItems: "center" },
  tabOn: { backgroundColor: colors.brand },
  tabText: { color: colors.muted, fontSize: ts.small, fontWeight: "600" },
  tabTextOn: { color: "#fff" },
  dim: { color: colors.muted, fontSize: ts.small, paddingVertical: 8 },
  emptyTitle: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "600", marginBottom: 6 },
  emptyBody: { color: colors.muted, fontSize: ts.small, lineHeight: 17, textAlign: "center" },
  cardHead: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  hashTile: { width: 38, height: 38, borderRadius: radius.tile, backgroundColor: colors.brand, alignItems: "center", justifyContent: "center" },
  hashGlyph: { color: "#fff", fontSize: 15, fontWeight: "700" },
  cardNumber: { color: colors.textPrimary, fontSize: 15, fontWeight: "700", fontVariant: ["tabular-nums"], letterSpacing: 0.5 },
  ownerBadge: { alignSelf: "flex-start", color: colors.success, fontSize: 9.5, fontWeight: "600", marginTop: 2 },
  cardAction: { paddingHorizontal: 8, paddingVertical: 6 },
  cardActionText: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
  cardBody: { paddingHorizontal: 12, paddingBottom: 12, paddingTop: 4, borderTopWidth: 1, borderTopColor: colors.border },
  mapLabel: { color: colors.muted, fontSize: ts.label, fontWeight: "600", letterSpacing: 0.5 },
  mapRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 2 },
  mapChain: { color: colors.brand2, fontSize: ts.small, fontWeight: "600", width: 96 },
  mapAddr: { color: colors.textSecondary, fontSize: ts.small, flex: 1, fontVariant: ["tabular-nums"] },
  link: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
  error: { color: colors.danger, fontSize: ts.small },
  ownerAddr: { color: colors.textPrimary, fontSize: ts.small, marginTop: 4 },
  lookupRow: { flexDirection: "row", alignItems: "center", gap: 10, padding: 12 },
  lookupChain: { color: colors.brand2, fontSize: ts.small, fontWeight: "600" },
  lookupAddr: { color: colors.textPrimary, fontSize: ts.small, marginTop: 1 },
});
