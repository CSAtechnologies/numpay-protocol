// Receive — the extension Receive page at mobile scope: a searchable chain
// DROPDOWN (every EVM chain listed by name plus the non-EVM six, priority
// order), a QR with the NumPay mark centered (error correction H so the
// overlay never breaks scans), the address card, and a Copy Address button.
// QR stays pure-JS (qrcode-generator); copy is expo-clipboard (native module,
// ships with the same rebuild cycle as the other expo modules).
import { useMemo, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import qrcode from "qrcode-generator";
import { copyEphemeral } from "../platform/clipboard";
import { NETWORKS } from "@numpay/core/networks";
import type { NonEvmAddressMap } from "@numpay/core/chains";
import { colors, radius, type as ts, themedStyles } from "../ui/theme";
import { Btn, Card, Field, ScreenHeader, Tappable } from "../ui/components";
import { CheckIcon, ChevronDownIcon, ChevronUpIcon, CopyIcon } from "../ui/icons";
import { NumPayMark } from "../ui/NumPayLogo";
import { ChainIcon } from "../ui/coins";
import { PayModeSwitch } from "../ui/PayModeSwitch";

export interface ReceiveAddrs { evm: string; nonEvm: NonEvmAddressMap | null }

interface ReceiveChain { id: string; name: string; symbol: string; isEVM: boolean }

// Extension Receive page ordering: the majors first, the rest as declared.
const PRIORITY = [
  "ethereum", "bitcoin", "solana", "polygon", "arbitrum",
  "optimism", "base", "bsc", "avalanche", "sui",
  "tron", "xrp", "litecoin",
];

const NON_EVM_CHAINS: ReceiveChain[] = [
  { id: "bitcoin",  name: "Bitcoin",    symbol: "BTC", isEVM: false },
  { id: "solana",   name: "Solana",     symbol: "SOL", isEVM: false },
  { id: "sui",      name: "Sui",        symbol: "SUI", isEVM: false },
  { id: "tron",     name: "Tron",       symbol: "TRX", isEVM: false },
  { id: "xrp",      name: "XRP Ledger", symbol: "XRP", isEVM: false },
  { id: "litecoin", name: "Litecoin",   symbol: "LTC", isEVM: false },
];

const ALL_CHAINS: ReceiveChain[] = [
  ...Object.values(NETWORKS)
    .filter((n) => n.id !== "sepolia")
    .map((n) => ({ id: n.id, name: n.name, symbol: n.symbol, isEVM: true })),
  ...NON_EVM_CHAINS,
].sort((a, b) => {
  const ai = PRIORITY.indexOf(a.id), bi = PRIORITY.indexOf(b.id);
  if (ai !== -1 && bi !== -1) return ai - bi;
  if (ai !== -1) return -1;
  if (bi !== -1) return 1;
  return 0;
});

const QR_TILE = 50; // white cover square behind the mark

// Pure-JS QR with the NumPay mark centered. Error correction H tolerates the
// covered center modules (~30% damage budget; the tile uses well under half).
function QrView({ value }: { value: string }) {
  const qr = useMemo(() => {
    const q = qrcode(0, "H");
    q.addData(value);
    q.make();
    return q;
  }, [value]);
  const n = qr.getModuleCount();
  const cell = Math.max(3, Math.floor(264 / n));
  // The grid wrapper is exactly the symbol's size and carries no padding, so
  // the overlay can be placed with plain numbers. Percentage offsets ("50%")
  // are measured against the padded card, not the symbol, and land the mark
  // off-centre.
  const size = n * cell;
  const inset = Math.round((size - QR_TILE) / 2);
  return (
    <View style={st.qrBox}>
      <View style={{ width: size, height: size }}>
        {Array.from({ length: n }, (_, r) => (
          <View key={r} style={{ flexDirection: "row" }}>
            {Array.from({ length: n }, (_, c) => (
              <View
                key={c}
                style={{ width: cell, height: cell, backgroundColor: qr.isDark(r, c) ? "#000" : "#fff" }}
              />
            ))}
          </View>
        ))}
        <View style={[st.qrLogoTile, { top: inset, left: inset }]}>
          <NumPayMark size={34} />
        </View>
      </View>
    </View>
  );
}

export function ReceiveScreen({ addrs, initialChainId, onBack, onSend }: {
  addrs: ReceiveAddrs;
  /**
   * Chain to open on, when Receive was reached from something that already
   * knows which one the user means (a token's detail page). Arriving from a
   * SOL row and being handed an Ethereum address is worse than a wasted tap:
   * the address shown is a real one, just for the wrong chain, and the user
   * has no reason to doubt it.
   *
   * An id with no row in ALL_CHAINS falls back to the default rather than
   * leaving the picker empty. That happens for a chain the wallet holds a
   * balance on but Receive does not list (sepolia is filtered out here).
   */
  initialChainId?: string;
  onBack: () => void;
  onSend: () => void;
}) {
  const [selId, setSelId] = useState(
    initialChainId && ALL_CHAINS.some((c) => c.id === initialChainId)
      ? initialChainId
      : "ethereum",
  );
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [copied, setCopied] = useState(false);

  const sel = ALL_CHAINS.find((c) => c.id === selId) ?? ALL_CHAINS[0];
  const address = sel.isEVM
    ? addrs.evm
    : (addrs.nonEvm?.[sel.id as keyof NonEvmAddressMap] ?? "");

  const filtered = search.trim()
    ? ALL_CHAINS.filter((c) => {
        const q = search.trim().toLowerCase();
        return c.name.toLowerCase().includes(q) || c.symbol.toLowerCase().includes(q);
      })
    : ALL_CHAINS;

  async function handleCopy() {
    if (!address) return;
    try {
      await copyEphemeral(address);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* clipboard unavailable: the Share button still works */ }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Pay" onBack={onBack} />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
        <PayModeSwitch mode="receive" onSend={onSend} onReceive={() => {}} />
        <Text style={st.subLine}>
          Receive <Text style={{ color: colors.textPrimary, fontWeight: "600" }}>{sel.symbol} on {sel.name}</Text>
        </Text>

        {/* Chain dropdown (extension parity) */}
        <Tappable feedback="ghost" onPress={() => { setOpen((v) => !v); setSearch(""); }}>
          <Card style={st.selector}>
            <ChainIcon chainId={sel.id} size={22} />
            <Text style={st.selectorText}>{sel.name}</Text>
            {open
              ? <ChevronUpIcon size={14} color={colors.muted} />
              : <ChevronDownIcon size={14} color={colors.muted} />}
          </Card>
        </Tappable>
        {open && (
          <Card style={{ marginTop: 6, maxHeight: 340 }}>
            <View style={{ paddingHorizontal: 10, paddingBottom: 6 }}>
              <Field placeholder="Search networks…" value={search} onChangeText={setSearch} />
            </View>
            <ScrollView nestedScrollEnabled keyboardShouldPersistTaps="handled">
              {filtered.length === 0 && <Text style={st.noResults}>No results</Text>}
              {filtered.map((c) => {
                const disabled = !c.isEVM && !addrs.nonEvm;
                const active = c.id === selId;
                return (
                  <Tappable feedback="row"
                    key={c.id}
                    disabled={disabled}
                    onPress={() => { setSelId(c.id); setOpen(false); setCopied(false); }}
                    style={[st.chainRow, active && { backgroundColor: colors.brandTint }]}
                  >
                    <ChainIcon chainId={c.id} size={22} />
                    <Text style={[st.chainRowText, active && { color: colors.brand2 }, disabled && { color: colors.muted2 }]}>
                      {c.name} ({c.symbol})
                    </Text>
                    {active && <CheckIcon size={14} color={colors.brand2} />}
                    {disabled && <Text style={st.chainRowNote}>No mnemonic</Text>}
                  </Tappable>
                );
              })}
            </ScrollView>
          </Card>
        )}

        {/* QR with the NumPay mark centered */}
        <Card style={{ padding: 16, marginTop: 14, alignItems: "center" }}>
          {address ? <QrView value={address} /> : <Text style={st.noResults}>Address unavailable</Text>}
        </Card>

        {/* Address */}
        <Card style={{ paddingVertical: 12, paddingHorizontal: 16, marginTop: 12, alignItems: "center" }}>
          <Text style={st.addrLabel}>YOUR {sel.name.toUpperCase()} ADDRESS</Text>
          <Text style={st.addr} selectable>{address || "—"}</Text>
        </Card>

        {/* Copy: brand-gradient by default, flipping to a green-tinted
            outline with a check on success — the extension's two states. */}
        <Tappable
          onPress={() => { void handleCopy(); }}
          feedback="tile"
          borderRadius={radius.card}
          style={st.copyShell}
          accessibilityLabel="Copy address"
        >
          {copied ? (
            <View style={[st.copyFill, st.copyFillDone]}>
              <CheckIcon size={16} color={colors.successText} />
              <Text style={[st.copyText, { color: colors.successText }]}>Copied!</Text>
            </View>
          ) : (
            <View style={[st.copyFill, st.copyFillReady]}>
              <CopyIcon size={16} color={colors.onBrand} />
              <Text style={[st.copyText, { color: colors.onBrand }]}>Copy Address</Text>
            </View>
          )}
        </Tappable>
        {/* Android-only: hands the address to the system share sheet. */}
        <Btn
          label="Share address"
          variant="secondary"
          onPress={() => { Share.share({ message: address }).catch(() => {}); }}
        />
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const st = themedStyles((colors) => ({
  subLine: { color: colors.muted, fontSize: ts.row, textAlign: "center", marginBottom: 12 },

  selector: { flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  selectorText: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "600", flex: 1 },

  copyShell: {
    width: "100%", marginTop: 12,
    borderRadius: radius.button, overflow: "hidden",
    borderWidth: 1, borderColor: colors.overlayBorder,
  },
  copyFill: {
    flexDirection: "row", alignItems: "center", justifyContent: "center", gap: 8,
    paddingVertical: 13,
  },
  copyFillDone: {
    backgroundColor: colors.successTint,
  },
  copyFillReady: { backgroundColor: colors.action },
  copyText: { fontSize: ts.body, fontWeight: "600" },

  chainRow: {
    flexDirection: "row", alignItems: "center", gap: 10,
    paddingHorizontal: 14, paddingVertical: 11,
    borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider,
  },
  chainRowText: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "500", flex: 1 },
  chainRowNote: { color: colors.muted, fontSize: ts.label },
  noResults: { color: colors.muted, fontSize: ts.small, textAlign: "center", paddingVertical: 14 },

  qrBox: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: radius.tile,
    alignSelf: "center",
    position: "relative",
  },
  qrLogoTile: {
    position: "absolute",
    width: QR_TILE, height: QR_TILE,
    borderRadius: 12,
    backgroundColor: "#fff",
    alignItems: "center", justifyContent: "center",
  },

  addrLabel: { color: colors.muted, fontSize: ts.label, fontWeight: "600", letterSpacing: 1, marginBottom: 4 },
  addr: {
    color: colors.textPrimary,
    fontFamily: "monospace",
    fontSize: 12.5,
    textAlign: "center",
    lineHeight: 18,
  },
}));
