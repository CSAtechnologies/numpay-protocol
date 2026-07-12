// Activity: the wallet's local tx log (every NumPay-broadcast send/swap/bridge,
// via core txLog), rendered with an RN port of the extension's TxRow — asset
// logo circle + kind corner badge, pending/failed states, explorer link. The
// on-chain history merge (core txHistory fetchers) and pending speed-up/cancel
// follow in a later slice; this one makes every mobile send show up instantly.
import { useEffect, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { loadTxLog, loggedToRecords } from "@numpay/core/txLog";
import { kindOf, type TxKind, type TxRecord } from "@numpay/core/txHistory";
import { colors, type as ts } from "../ui/theme";
import { ScreenHeader } from "../ui/components";
import { AssetIcon } from "../ui/coins";

function shortAddr(addr: string): string {
  if (!addr || addr.length < 12) return addr || "";
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`;
}

function timeAgo(ms: number): string {
  if (!ms) return "";
  const diff = Date.now() - ms;
  const mins = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days = Math.floor(diff / 86_400_000);
  if (mins < 2) return "Just now";
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days}d ago`;
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

const KIND_META: Record<TxKind, { label: string; color: string; glyph: string }> = {
  send:    { label: "Send",    color: "#ef4444", glyph: "↗" },
  receive: { label: "Receive", color: "#22c55e", glyph: "↙" },
  swap:    { label: "Swap",    color: colors.brand, glyph: "⇄" },
  bridge:  { label: "Bridge",  color: "#3b82f6", glyph: "→" },
};

// RN port of components/TxRow.tsx (extension). Same information hierarchy:
// kind-coloured label + pending/failed chip, counterparty or from→to subtitle,
// chain + age + View line, signed amount on the right.
export function TxRow({ tx, showChain = true }: { tx: TxRecord; showChain?: boolean }) {
  const kind = kindOf(tx);
  const meta = KIND_META[kind];
  const pending = tx.status === "pending";
  const failed = tx.status === "failed";

  const face = kind === "swap" && tx.toSymbol
    ? { symbol: tx.toSymbol, logo: tx.toLogo, chainId: tx.toChainId ?? tx.chainId, address: tx.toAssetAddr }
    : { symbol: tx.symbol, logo: tx.logo, chainId: tx.chainId, address: tx.assetAddr };

  const amount =
    kind === "send"      ? { text: `-${tx.value} ${tx.symbol}`, color: "#ef4444" }
    : kind === "receive" ? { text: `+${tx.value} ${tx.symbol}`, color: "#22c55e" }
    : kind === "swap"    ? { text: `+${tx.toValue ?? ""} ${tx.toSymbol ?? ""}`.trim(), color: "#22c55e" }
    : /* bridge */         { text: `${tx.value} ${tx.symbol}`, color: colors.textPrimary };

  const subtitle =
    kind === "swap"     ? `${tx.symbol} → ${tx.toSymbol ?? ""}`
    : kind === "bridge" ? `${tx.chainName ?? ""} → ${tx.toChainName ?? tx.chainName ?? ""}`
    : tx.counterparty   ? `${kind === "send" ? "To" : "From"} ${shortAddr(tx.counterparty)}`
    : "";

  return (
    <Pressable
      style={st.row}
      onPress={() => { if (tx.explorerUrl) Linking.openURL(tx.explorerUrl).catch(() => {}); }}
    >
      <View style={{ width: 36, height: 36 }}>
        <AssetIcon
          symbol={face.symbol} logo={face.logo}
          chainId={face.chainId} address={face.address} size={36}
        />
        <View style={[st.kindBadge, { backgroundColor: meta.color }]}>
          <Text style={st.kindGlyph}>{meta.glyph}</Text>
        </View>
      </View>

      <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: meta.color, fontSize: ts.row, fontWeight: "600" }}>{meta.label}</Text>
          {pending && <Text style={st.pendingChip}>● Pending</Text>}
          {failed && <Text style={st.failedChip}>Failed</Text>}
        </View>
        <Text style={st.sub} numberOfLines={1}>
          {subtitle || "address unavailable"}
        </Text>
        <View style={{ flexDirection: "row", gap: 8, marginTop: 2 }}>
          {showChain && !!tx.chainName && <Text style={st.metaChain}>{tx.chainName}</Text>}
          {tx.timestamp > 0 && <Text style={st.metaDim}>{timeAgo(tx.timestamp)}</Text>}
          {!!tx.explorerUrl && <Text style={st.metaDim}>View ↗</Text>}
        </View>
      </View>

      <Text style={[st.amount, { color: amount.color }]} numberOfLines={1}>
        {amount.text}
      </Text>
    </Pressable>
  );
}

export function ActivityScreen({ owner, onBack }: { owner: string; onBack: () => void }) {
  const [records, setRecords] = useState<TxRecord[] | null>(null);

  useEffect(() => {
    if (!owner) { setRecords([]); return; }
    let live = true;
    loadTxLog(owner)
      .then((logged) => { if (live) setRecords(loggedToRecords(logged)); })
      .catch(() => { if (live) setRecords([]); });
    return () => { live = false; };
  }, [owner]);

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Activity" onBack={onBack} />
      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {records === null && <Text style={st.empty}>Loading…</Text>}
        {records !== null && records.length === 0 && (
          <Text style={st.empty}>
            No activity yet. Transactions you send from NumPay on this phone show
            up here instantly.
          </Text>
        )}
        {records?.map((tx) => (
          <TxRow key={`${tx.chainId}-${tx.hash}`} tx={tx} />
        ))}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(42, 36, 80, 0.7)",
  },
  kindBadge: {
    position: "absolute", right: -2, bottom: -2,
    width: 16, height: 16, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.bg,
  },
  kindGlyph: { color: "#fff", fontSize: 8, fontWeight: "700" },
  pendingChip: { color: colors.amber, fontSize: 10, fontWeight: "500" },
  failedChip: { color: colors.danger, fontSize: 10, fontWeight: "500" },
  sub: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
  metaChain: { color: "rgba(163, 148, 255, 0.7)", fontSize: 10, fontWeight: "500" },
  metaDim: { color: colors.muted2, fontSize: 10 },
  amount: {
    fontSize: ts.row, fontWeight: "600", marginLeft: 8,
    fontVariant: ["tabular-nums"], maxWidth: 140, textAlign: "right",
  },
  empty: { color: colors.muted, fontSize: ts.row, marginTop: 16, lineHeight: 19 },
});
