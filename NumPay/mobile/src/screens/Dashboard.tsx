import React, { useCallback, useEffect, useState } from "react";
import {
  View, Text, StyleSheet, TouchableOpacity, RefreshControl, ScrollView, Alert,
} from "react-native";
import { LinearGradient } from "expo-linear-gradient";
import * as Clipboard from "expo-clipboard";
import { GhostButton } from "../components/ui";
import { Logo } from "../components/Logo";
import { colors, gradient, radius, spacing } from "../theme";
import { getSessionWallets, lockWallet, touchActivity } from "../lib/vault";
import { deriveAccounts, fetchEthBalance, fetchSolBalance, ChainAccount } from "../lib/chains";
import { bpanOfOwner, formatBPAN } from "../lib/bpan";

interface Row extends ChainAccount {
  balance: string | null; // null = loading
}

function short(addr: string): string {
  return addr.length > 14 ? `${addr.slice(0, 7)}...${addr.slice(-5)}` : addr;
}

export function Dashboard({ onLock }: { onLock: () => void }) {
  const session = getSessionWallets();
  const active = session?.wallets.find((w) => w.id === session.activeId) ?? session?.wallets[0];

  const [rows, setRows] = useState<Row[]>([]);
  const [bpan, setBpan] = useState<string | null | "loading">("loading");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    if (!active) return;
    touchActivity();
    const accounts = deriveAccounts(active.wallet.mnemonic, active.wallet.address);
    setRows(accounts.map((a) => ({ ...a, balance: null })));

    // Balances, best-effort per chain
    accounts.forEach(async (a, i) => {
      try {
        const bal = a.chain === "ethereum"
          ? await fetchEthBalance(a.address)
          : await fetchSolBalance(a.address);
        setRows((prev) => prev.map((r, j) => (j === i ? { ...r, balance: bal } : r)));
      } catch {
        setRows((prev) => prev.map((r, j) => (j === i ? { ...r, balance: "unavailable" } : r)));
      }
    });

    // NumPay ID for the ETH address, best-effort
    try {
      setBpan(await bpanOfOwner(active.wallet.address));
    } catch {
      setBpan(null);
    }
  }, [active?.id]);

  useEffect(() => { load(); }, [load]);

  async function copy(label: string, value: string) {
    await Clipboard.setStringAsync(value);
    Alert.alert("Copied", `${label} copied to clipboard.`);
  }

  function handleLock() {
    lockWallet();
    onLock();
  }

  if (!active) {
    return (
      <View style={[styles.screen, { alignItems: "center", justifyContent: "center" }]}>
        <Text style={{ color: colors.textSecondary }}>Session expired.</Text>
        <GhostButton title="Unlock again" onPress={onLock} />
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <View style={styles.header}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
          <Logo size={34} animate={false} />
          <Text style={styles.walletName}>{active.name}</Text>
        </View>
        <TouchableOpacity onPress={handleLock} style={styles.lockBtn}>
          <Text style={styles.lockText}>Lock</Text>
        </TouchableOpacity>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: spacing.lg, gap: spacing.md }}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            tintColor={colors.purpleLight}
            onRefresh={async () => { setRefreshing(true); await load(); setRefreshing(false); }}
          />
        }
      >
        <LinearGradient colors={[...gradient.card]} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={styles.card}>
          <Text style={styles.cardLabel}>NUMPAY ID</Text>
          {bpan === "loading" ? (
            <Text style={styles.cardValueSub}>Checking registry...</Text>
          ) : bpan ? (
            <TouchableOpacity onPress={() => copy("NumPay ID", bpan)}>
              <Text style={styles.cardValue}>
                <Text style={{ opacity: 0.55 }}># </Text>{formatBPAN(bpan)}
              </Text>
              <Text style={styles.cardHint}>Tap to copy. Share this to get paid.</Text>
            </TouchableOpacity>
          ) : (
            <>
              <Text style={styles.cardValueSub}>Not registered yet</Text>
              <Text style={styles.cardHint}>Register a NumPay ID in the extension to claim your number.</Text>
            </>
          )}
        </LinearGradient>

        <Text style={styles.section}>Accounts</Text>
        {rows.map((r) => (
          <TouchableOpacity key={r.chain} style={styles.row} onPress={() => copy(`${r.symbol} address`, r.address)}>
            <View style={styles.chainBadge}>
              <Text style={styles.chainBadgeText}>{r.symbol}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{r.chain === "ethereum" ? "Ethereum" : "Solana"}</Text>
              <Text style={styles.rowSub}>{short(r.address)}</Text>
            </View>
            <Text style={styles.rowBalance}>
              {r.balance === null ? "..." : r.balance === "unavailable" ? "n/a" : `${r.balance} ${r.symbol}`}
            </Text>
          </TouchableOpacity>
        ))}

        <Text style={styles.footnote}>
          Tap an account to copy its address. Balances read from public RPC endpoints.
          Sending arrives in the next milestone; keys stay on this device either way.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    paddingHorizontal: spacing.lg, paddingTop: 64, paddingBottom: spacing.md,
  },
  walletName: { color: colors.text, fontSize: 18, fontWeight: "800" },
  lockBtn: {
    borderColor: colors.border, borderWidth: 1, borderRadius: radius.pill,
    paddingHorizontal: 16, paddingVertical: 7,
  },
  lockText: { color: colors.purpleLight, fontSize: 14, fontWeight: "700" },
  card: { borderRadius: radius.card, padding: spacing.lg, gap: 6 },
  cardLabel: { color: "rgba(255,255,255,0.72)", fontSize: 12, fontWeight: "700", letterSpacing: 2.5 },
  cardValue: { color: colors.white, fontSize: 30, fontWeight: "800", letterSpacing: 1 },
  cardValueSub: { color: colors.white, fontSize: 20, fontWeight: "700" },
  cardHint: { color: "rgba(255,255,255,0.75)", fontSize: 12, marginTop: 6 },
  section: { color: colors.textSecondary, fontSize: 13, fontWeight: "700", letterSpacing: 1.5, marginTop: spacing.sm },
  row: {
    flexDirection: "row", alignItems: "center", gap: spacing.md,
    backgroundColor: colors.bgCard, borderColor: colors.border, borderWidth: 1,
    borderRadius: radius.card, padding: spacing.md,
  },
  chainBadge: {
    width: 44, height: 44, borderRadius: 14, backgroundColor: colors.bgInput,
    alignItems: "center", justifyContent: "center",
  },
  chainBadgeText: { color: colors.purpleLight, fontWeight: "800", fontSize: 13 },
  rowTitle: { color: colors.text, fontSize: 16, fontWeight: "700" },
  rowSub: { color: colors.textFaint, fontSize: 13, marginTop: 2 },
  rowBalance: { color: colors.textSecondary, fontSize: 14, fontWeight: "700" },
  footnote: { color: colors.textFaint, fontSize: 12, lineHeight: 18, marginTop: spacing.sm },
});
