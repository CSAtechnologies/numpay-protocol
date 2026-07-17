// Token detail — the extension's /token page at mobile scope: tap an asset row
// on the dashboard to get its balance hero, Send/Receive shortcuts, the wSOL
// unwrap affordance, and the asset's own slice of the activity log.
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { loadTxLog, loggedToRecords } from "@numpay/core/txLog";
import type { TxRecord } from "@numpay/core/txHistory";
import { WSOL_MINT, unwrapWsol } from "@numpay/core/chains/solana";
import { deriveNonEvmAddresses } from "@numpay/core/chains";
import { getUsdPrice } from "@numpay/core/currency";
import { getUnlockedMnemonic } from "../vault/mobileVault";
import type { AssetRow, MobileWalletState } from "../wallet/useMobileWallet";
import { colors, type as ts } from "../ui/theme";
import { AlertCard, Btn, Card, ScreenHeader, SectionLabel } from "../ui/components";
import { AssetIcon, ChainBadge } from "../ui/coins";
import { TxRow } from "./ActivityScreen";

export function TokenDetailScreen({ w, row, onBack, onSend, onReceive, onSessionExpired }: {
  w: MobileWalletState;
  row: AssetRow;
  onBack: () => void;
  onSend: () => void;
  onReceive: () => void;
  onSessionExpired?: () => void;
}) {
  const tokenAddr = row.isNative ? undefined : row.key.split(":")[1];
  const isWsol = row.chainId === "solana" && tokenAddr === WSOL_MINT.toLowerCase();
  const price = row.balanceNum > 0
    ? row.usdValue / row.balanceNum
    : (w.rates ? getUsdPrice(row.symbol, w.rates) : 0);

  const [txs, setTxs] = useState<TxRecord[]>([]);
  const [unwrapping, setUnwrapping] = useState(false);
  const [unwrapMsg, setUnwrapMsg] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let live = true;
    loadTxLog(w.evmAddress).then((logged) => {
      if (!live) return;
      const records = loggedToRecords(logged).filter((t) => {
        if (t.chainId !== row.chainId) return false;
        return row.isNative
          ? !t.assetAddr && t.symbol === row.symbol
          : (t.assetAddr ?? "") === tokenAddr;
      });
      setTxs(records);
    }).catch(() => {});
    return () => { live = false; };
  }, [w.evmAddress, row.chainId, row.isNative, row.symbol, tokenAddr]);

  // wSOL → SOL (extension TokenDetail parity; core does the account close).
  async function handleUnwrap() {
    setError(""); setUnwrapMsg("");
    const mnemonic = await getUnlockedMnemonic();
    if (!mnemonic) { onSessionExpired?.(); return; }
    setUnwrapping(true);
    try {
      const derived = await deriveNonEvmAddresses(mnemonic);
      const res = await unwrapWsol(derived.solana.secretKey);
      setUnwrapMsg(`Unwrapped to SOL. Tx ${res.signature.slice(0, 8)}…`);
      w.refresh();
    } catch (e: any) {
      setError(e?.message || "Unwrap failed");
    } finally {
      setUnwrapping(false);
    }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title={row.symbol} onBack={onBack} />
      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Balance hero */}
        <Card style={st.hero}>
          <View style={{ width: 56, height: 56 }}>
            <AssetIcon
              symbol={row.symbol} logo={row.logo} chainId={row.chainId}
              address={tokenAddr} size={56}
            />
            {!row.isNative && <ChainBadge chainId={row.chainId} size={18} />}
          </View>
          <Text style={st.balance}>
            {row.balanceNum.toLocaleString(undefined, { maximumFractionDigits: 6 })} {row.symbol}
          </Text>
          <Text style={st.fiat}>
            {row.usdValue > 0 ? `$${row.usdValue.toFixed(2)}` : price > 0 ? "$0.00" : " "}
          </Text>
          <Text style={st.chain}>{row.name} · {row.chainName}</Text>
        </Card>

        <View style={{ flexDirection: "row", gap: 8 }}>
          <Btn label="Send" onPress={onSend} style={{ flex: 1 }} />
          <Btn label="Receive" variant="secondary" onPress={onReceive} style={{ flex: 1 }} />
        </View>

        {isWsol && (
          <Btn
            label={unwrapping ? "Unwrapping…" : "Unwrap to SOL"}
            variant="secondary"
            onPress={() => { void handleUnwrap(); }}
            disabled={unwrapping || row.balanceNum <= 0}
          />
        )}
        {!!unwrapMsg && <Text style={st.ok}>{unwrapMsg}</Text>}
        {!!error && (
          <AlertCard tone="danger" title="Action failed" body={error} style={{ marginTop: 10 }} />
        )}

        <SectionLabel text="Activity" style={{ marginTop: 20, marginBottom: 2 } as object} />
        {txs.map((t) => <TxRow key={`${t.chainId}:${t.hash}`} tx={t} showChain={false} />)}
        {txs.length === 0 && (
          <Text style={st.dim}>No NumPay transactions for this asset yet.</Text>
        )}
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const st = StyleSheet.create({
  hero: { alignItems: "center", padding: 22, marginBottom: 14 },
  balance: {
    color: colors.textPrimary, fontSize: 24, fontWeight: "700",
    marginTop: 12, fontVariant: ["tabular-nums"],
  },
  fiat: { color: colors.textSecondary, fontSize: ts.body, marginTop: 2 },
  chain: { color: colors.muted, fontSize: ts.small, marginTop: 6 },
  ok: { color: colors.success, fontSize: ts.small, marginTop: 8 },
  dim: { color: colors.muted, fontSize: ts.row, marginTop: 8 },
});
