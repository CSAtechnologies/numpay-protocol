// Activity: the wallet's local tx log (every NumPay-broadcast send/swap/bridge,
// via core txLog), rendered with an RN port of the extension's TxRow — asset
// logo circle + kind corner badge, pending/failed states, explorer link. The
// on-chain history merge (core txHistory fetchers) and pending speed-up/cancel
// follow in a later slice; this one makes every mobile send show up instantly.
import { useCallback, useEffect, useState } from "react";
import { Linking, ScrollView, StyleSheet, Text, View } from "react-native";
import { loadTxLog, loggedToRecords } from "@numpay/core/txLog";
import { kindOf, type TxKind, type TxRecord } from "@numpay/core/txHistory";
import { colors, radius, type as ts, themedStyles } from "../ui/theme";
import { EmptyState, ScreenHeader, SkeletonRow, Tappable } from "../ui/components";
import { ActivityIcon, ExternalLinkIcon, RefreshIcon, TxKindGlyph } from "../ui/icons";
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

const KIND_LABEL: Record<TxKind, string> = {
  send: "Send", receive: "Receive", swap: "Swap", bridge: "Bridge",
};

/**
 * The kind's two colours, resolved at RENDER time so a theme switch reaches
 * them. This used to be a module-level table of four raw hex values, ported 1:1
 * from the extension's TxRow — which was written when the product was dark-only.
 * Measured against the light page (#faf9ff), which is now the default theme, all
 * four failed AA as 14px semibold type:
 *
 *   send    #ef4444  3.59:1
 *   receive #22c55e  2.18:1   <- the worst contrast in the app
 *   swap    #7c6df0  3.78:1
 *   bridge  #3b82f6  3.51:1
 *
 * So the two jobs are split, the same way the palette already splits
 * danger/dangerText. `fill` paints the corner badge, which is a disc carrying a
 * white glyph and wants the saturated tone. `text` paints the kind label and the
 * signed amount, and steps down to the type tone that clears 4.5:1 in both
 * themes.
 */
function kindMeta(kind: TxKind): { label: string; fill: string; text: string } {
  const label = KIND_LABEL[kind];
  switch (kind) {
    case "send":    return { label, fill: colors.danger,  text: colors.dangerText };
    case "receive": return { label, fill: colors.success, text: colors.successText };
    case "swap":    return { label, fill: colors.brand,   text: colors.brand2 };
    case "bridge":  return { label, fill: colors.info,    text: colors.infoText };
  }
}

// RN port of components/TxRow.tsx (extension). Same information hierarchy:
// kind-coloured label + pending/failed chip, counterparty or from→to subtitle,
// chain + age + View line, signed amount on the right.
export function TxRow({ tx, showChain = true, size = 36 }: {
  tx: TxRecord;
  showChain?: boolean;
  size?: number;
}) {
  const kind = kindOf(tx);
  const meta = kindMeta(kind);
  const pending = tx.status === "pending";
  const failed = tx.status === "failed";

  const face = kind === "swap" && tx.toSymbol
    ? { symbol: tx.toSymbol, logo: tx.toLogo, chainId: tx.toChainId ?? tx.chainId, address: tx.toAssetAddr }
    : { symbol: tx.symbol, logo: tx.logo, chainId: tx.chainId, address: tx.assetAddr };

  // A swap's amount is what LANDED, so it is signed and coloured like a receive
  // even though the row's kind is swap. A bridge moves value without changing
  // it, so it stays neutral.
  const amount =
    kind === "send"      ? { text: `-${tx.value} ${tx.symbol}`, color: colors.dangerText }
    : kind === "receive" ? { text: `+${tx.value} ${tx.symbol}`, color: colors.successText }
    : kind === "swap"    ? { text: `+${tx.toValue ?? ""} ${tx.toSymbol ?? ""}`.trim(), color: colors.successText }
    : /* bridge */         { text: `${tx.value} ${tx.symbol}`, color: colors.textPrimary };

  const subtitle =
    kind === "swap"     ? `${tx.symbol} → ${tx.toSymbol ?? ""}`
    : kind === "bridge" ? `${tx.chainName ?? ""} → ${tx.toChainName ?? tx.chainName ?? ""}`
    : tx.counterparty   ? `${kind === "send" ? "To" : "From"} ${shortAddr(tx.counterparty)}`
    : "";

  // Corner badge scales with the disc, same ratio as the extension's TxRow.
  const badge = Math.max(14, Math.round(size * 0.44));

  return (
    <Tappable feedback="row"
      style={st.row}
      onPress={() => { if (tx.explorerUrl) Linking.openURL(tx.explorerUrl).catch(() => {}); }}
    >
      <View style={{ width: size, height: size }}>
        <AssetIcon
          symbol={face.symbol} logo={face.logo}
          chainId={face.chainId} address={face.address} size={size}
        />
        <View style={[st.kindBadge, {
          backgroundColor: meta.fill,
          width: badge, height: badge, borderRadius: badge / 2,
        }]}>
          <TxKindGlyph kind={kind} size={Math.round(badge * 0.56)} />
        </View>
      </View>

      <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Text style={{ color: meta.text, fontSize: ts.row, fontWeight: "600" }}>{meta.label}</Text>
          {pending && (
            <View style={st.chipRow}>
              <View style={st.pendingDot} />
              <Text style={st.pendingChip}>Pending</Text>
            </View>
          )}
          {failed && <Text style={st.failedChip}>Failed</Text>}
        </View>
        <Text style={[st.sub, !subtitle && st.subMissing]} numberOfLines={1}>
          {subtitle || "address unavailable"}
        </Text>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginTop: 2 }}>
          {showChain && !!tx.chainName && <Text style={st.metaChain}>{tx.chainName}</Text>}
          {tx.timestamp > 0 && <Text style={st.metaDim}>{timeAgo(tx.timestamp)}</Text>}
          {!!tx.explorerUrl && (
            <View style={st.chipRow}>
              <ExternalLinkIcon size={9} color={colors.muted2} />
              <Text style={st.metaDim}>View</Text>
            </View>
          )}
        </View>
      </View>

      <Text style={[st.amount, { color: amount.color }]} numberOfLines={1}>
        {amount.text}
      </Text>
    </Tappable>
  );
}

export function ActivityScreen({ owner, onBack }: { owner: string; onBack: () => void }) {
  const [records, setRecords] = useState<TxRecord[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [filter, setFilter] = useState<"all" | "send" | "receive">("all");

  const load = useCallback(async () => {
    if (!owner) { setRecords([]); return; }
    setRefreshing(true);
    try {
      setRecords(loggedToRecords(await loadTxLog(owner)));
    } catch {
      setRecords([]);
    } finally {
      setRefreshing(false);
    }
  }, [owner]);

  useEffect(() => { void load(); }, [load]);

  const visibleRecords = records?.filter((tx) => filter === "all" || kindOf(tx) === filter) ?? null;

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader
        title="Activity"
        onBack={onBack}
        right={(
        <Tappable feedback="row"
          hitSlop={8}
          disabled={refreshing}
          onPress={() => { void load(); }}
          style={[st.scopeBtn, refreshing && { opacity: 0.4 }]}
          accessibilityLabel="Refresh activity"
        >
          <RefreshIcon size={17} color={colors.muted} />
        </Tappable>
        )}
      />

      <View style={st.filters} accessibilityRole="tablist">
        {([
          ["all", "All"],
          ["send", "Sent"],
          ["receive", "Received"],
        ] as const).map(([id, label]) => {
          const active = filter === id;
          return (
            <Tappable
              key={id}
              feedback="row"
              style={[st.filter, active && st.filterOn]}
              onPress={() => setFilter(id)}
              accessibilityRole="tab"
              accessibilityState={{ selected: active }}
            >
              <Text style={[st.filterText, active && st.filterTextOn]}>{label}</Text>
            </Tappable>
          );
        })}
      </View>

      <ScrollView style={{ flex: 1 }} showsVerticalScrollIndicator={false}>
        {records === null && (
          <>
            <SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow /><SkeletonRow />
          </>
        )}
        {visibleRecords !== null && visibleRecords.length === 0 && (
          <EmptyState
            icon={<ActivityIcon size={20} color={colors.muted} />}
            title={filter === "all" ? "No activity yet" : filter === "send" ? "No sent payments" : "No received payments"}
            hint={filter === "all"
              ? "Payments, swaps, and bridges will appear here after you use the wallet."
              : "Choose All to see the rest of your wallet activity."}
          />
        )}
        {visibleRecords?.map((tx) => (
          <TxRow key={`${tx.chainId}-${tx.hash}`} tx={tx} />
        ))}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const st = themedStyles((colors) => ({
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.divider,
  },
  kindBadge: {
    position: "absolute", right: -2, bottom: -2,
    alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: colors.bg,
  },
  chipRow: { flexDirection: "row", alignItems: "center", gap: 4 },
  pendingDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.caution },
  pendingChip: { color: colors.caution, fontSize: 10, fontWeight: "500" },
  failedChip: { color: colors.dangerText, fontSize: 10, fontWeight: "500" },
  sub: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
  subMissing: { fontStyle: "italic", opacity: 0.6 },
  // The extension tints the chain name with the brand so it reads as a scope
  // marker rather than another muted metadata field.
  metaChain: { color: colors.brand2, fontSize: 10, fontWeight: "500", opacity: 0.7 },
  metaDim: { color: colors.muted2, fontSize: 10 },
  amount: {
    fontSize: ts.row, fontWeight: "600", marginLeft: 8,
    fontVariant: ["tabular-nums"], maxWidth: 140, textAlign: "right",
  },

  filters: { flexDirection: "row", gap: 6, marginBottom: 8 },
  filter: {
    minHeight: 44, paddingHorizontal: 14, alignItems: "center", justifyContent: "center",
    borderRadius: radius.pill,
  },
  filterOn: { backgroundColor: colors.brandTint },
  filterText: { color: colors.muted, fontSize: ts.small, fontWeight: "600" },
  filterTextOn: { color: colors.brand2 },
  scopeBtn: { width: 44, height: 44, alignItems: "center", justifyContent: "center", borderRadius: radius.iconBtn },
}));
