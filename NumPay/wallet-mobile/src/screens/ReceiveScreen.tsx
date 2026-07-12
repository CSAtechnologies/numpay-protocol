// Receive: per-chain address + QR (pure-JS qrcode-generator, no native module).
// Restyled onto the shared UI library in the design-token pass; behaviour is
// unchanged from the first committed version (306c6aa).
import { useMemo, useState } from "react";
import { ScrollView, Share, StyleSheet, Text, View } from "react-native";
import qrcode from "qrcode-generator";
import type { NonEvmAddressMap } from "@numpay/core/chains";
import { colors, radius, type as ts } from "../ui/theme";
import { AlertCard, Btn, Chip, Card, ScreenHeader } from "../ui/components";
import { ChainIcon } from "../ui/coins";

export interface ReceiveAddrs { evm: string; nonEvm: NonEvmAddressMap | null }

// Pure-JS QR: qrcode-generator computes the module matrix, rendered as Views.
function QrView({ value }: { value: string }) {
  const qr = useMemo(() => {
    const q = qrcode(0, "M"); // type 0 = auto-size for the payload
    q.addData(value);
    q.make();
    return q;
  }, [value]);
  const n = qr.getModuleCount();
  const cell = Math.max(3, Math.floor(264 / n));
  return (
    <View style={st.qrBox}>
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
    </View>
  );
}

export function ReceiveScreen({ addrs, onBack }: { addrs: ReceiveAddrs; onBack: () => void }) {
  const entries = useMemo(() => {
    const list = [
      { id: "evm", chainIcon: "ethereum", label: "EVM", note: "Ethereum, Base, BSC, Polygon and every EVM chain", address: addrs.evm },
    ];
    const n = addrs.nonEvm;
    if (n) {
      list.push(
        { id: "bitcoin",  chainIcon: "bitcoin",  label: "BTC", note: "Bitcoin",     address: n.bitcoin },
        { id: "solana",   chainIcon: "solana",   label: "SOL", note: "Solana",      address: n.solana },
        { id: "sui",      chainIcon: "sui",      label: "SUI", note: "Sui",         address: n.sui },
        { id: "tron",     chainIcon: "tron",     label: "TRX", note: "Tron",        address: n.tron },
        { id: "xrp",      chainIcon: "xrp",      label: "XRP", note: "XRP Ledger",  address: n.xrp },
        { id: "litecoin", chainIcon: "litecoin", label: "LTC", note: "Litecoin",    address: n.litecoin },
      );
    }
    return list;
  }, [addrs]);
  const [sel, setSel] = useState("evm");
  const active = entries.find((e) => e.id === sel) ?? entries[0];

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Receive" onBack={onBack} />
      <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flexGrow: 0 }}>
        {entries.map((e) => (
          <Chip
            key={e.id}
            label={e.label}
            active={sel === e.id}
            onPress={() => setSel(e.id)}
            icon={<ChainIcon chainId={e.chainIcon} size={16} />}
          />
        ))}
      </ScrollView>
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        <Text style={st.note}>{active.note}</Text>
        <Card style={{ padding: 16, marginTop: 12, alignItems: "center" }}>
          <QrView value={active.address} />
          <Text style={st.addr} selectable>{active.address}</Text>
        </Card>
        <AlertCard
          tone="amber"
          title="Wrong-chain deposits are lost"
          body={`Only send ${active.label === "EVM" ? "EVM-chain assets" : `${active.label} assets`} to this address. Anything else is lost.`}
          style={{ marginTop: 12 }}
        />
        <Btn
          label="Share address"
          onPress={() => { Share.share({ message: active.address }).catch(() => {}); }}
        />
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  note: { color: colors.muted, fontSize: ts.sub, marginTop: 14 },
  qrBox: {
    backgroundColor: "#fff",
    padding: 12,
    borderRadius: radius.tile,
    alignSelf: "center",
  },
  addr: {
    color: colors.textPrimary,
    fontFamily: "monospace",
    fontSize: 12.5,
    marginTop: 14,
    textAlign: "center",
  },
});
