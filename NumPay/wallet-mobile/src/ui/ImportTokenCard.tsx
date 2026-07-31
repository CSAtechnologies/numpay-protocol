// Import-by-address card, shown inside a token picker when what the user
// typed is a contract address rather than a search term. Shared by the Swap
// and Send pickers so importing a token reads and behaves the same wherever
// it happens: fetch, look at what came back, then add it deliberately.
//
// The two-step (fetch, then confirm) is the point. Adding a token straight
// from a pasted string gives the user nothing to check the address against;
// showing symbol, name, decimals and the holding first lets them notice they
// pasted the wrong contract before it is saved.
import { ActivityIndicator, StyleSheet, Text, View } from "react-native";
import { colors, radius, type as ts, themedStyles } from "./theme";
import { AssetIcon, ChainBadge } from "./coins";
import { Card, Tappable } from "./components";

export interface ImportPreview {
  symbol: string;
  name: string;
  logo?: string;
  decimals: number;
  balance: string;
  address?: string;
  chainId: string;
}

export function ImportTokenCard({
  address, chainId, chainName, rightShape, state, token, error,
  onFetch, onCancel, onAdd,
}: {
  address: string;
  chainId: string;
  chainName: string;
  /** Does the pasted address's shape belong to `chainId`? */
  rightShape: boolean;
  state: "idle" | "loading" | "preview";
  token: ImportPreview | null;
  error: string;
  onFetch: () => void;
  onCancel: () => void;
  onAdd: () => void;
}) {
  // Wrong family for the selected chain (an 0x address while Solana is
  // selected, or the reverse). Say which network it belongs on rather than
  // switching chains behind the user's back — the network a token lands on is
  // the one thing that must never change without them seeing it.
  if (!rightShape) {
    const belongs = chainId === "solana" ? "an EVM chain" : "Solana";
    return (
      <Card style={st.card}>
        <Text style={st.hint}>
          That address looks like {belongs === "Solana" ? "a Solana mint" : "an EVM contract"}, but{" "}
          {chainName} is selected. Pick {belongs} above to import it.
        </Text>
      </Card>
    );
  }

  if (state === "loading") {
    return (
      <Card style={[st.card, st.loadingRow]}>
        <ActivityIndicator size="small" color={colors.brand2} />
        <Text style={st.hint}>Reading the token contract…</Text>
      </Card>
    );
  }

  if (state === "preview" && token) {
    const bal = parseFloat(token.balance) || 0;
    return (
      <Card style={st.card}>
        <View style={st.previewHead}>
          <View style={{ width: 40, height: 40 }}>
            <AssetIcon
              symbol={token.symbol} logo={token.logo}
              chainId={token.chainId} address={token.address} size={40}
            />
            <ChainBadge chainId={token.chainId} size={16} />
          </View>
          <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
            <Text style={st.sym} numberOfLines={1}>{token.symbol}</Text>
            <Text style={st.sub} numberOfLines={1}>{token.name} · {chainName}</Text>
            {bal > 0 && (
              <Text style={st.balance}>
                You hold {bal.toLocaleString(undefined, { maximumFractionDigits: 6 })}
              </Text>
            )}
          </View>
        </View>
        <Text style={st.addr} numberOfLines={2}>{token.address}</Text>
        <View style={st.btnRow}>
          <Tappable feedback="row" onPress={onCancel} style={[st.btn, st.btnGhost]}>
            <Text style={st.btnGhostText}>Cancel</Text>
          </Tappable>
          <Tappable feedback="row" onPress={onAdd} style={[st.btn, st.btnBrand]}>
            <Text style={st.btnBrandText}>Add token</Text>
          </Tappable>
        </View>
      </Card>
    );
  }

  return (
    <Card style={st.card}>
      <Text style={st.hint}>
        Import a token on <Text style={st.strong}>{chainName}</Text>. Change the network above to
        import it somewhere else.
      </Text>
      <Text style={st.addr} numberOfLines={2}>{address}</Text>
      {!!error && <Text style={st.err}>{error}</Text>}
      <Tappable feedback="row" onPress={onFetch} style={[st.btn, st.btnBrand, { marginTop: 4 }]}>
        <Text style={st.btnBrandText}>Look up token</Text>
      </Tappable>
    </Card>
  );
}

const st = themedStyles((colors) => ({
  card: { padding: 14, marginBottom: 12 },
  loadingRow: { flexDirection: "row", alignItems: "center", gap: 10 },
  previewHead: { flexDirection: "row", alignItems: "center", marginBottom: 10 },
  sym: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "700" },
  sub: { color: colors.muted, fontSize: ts.small },
  balance: { color: colors.successText, fontSize: ts.small, fontWeight: "600", marginTop: 2 },
  hint: { color: colors.textSecondary, fontSize: ts.small, lineHeight: 17 },
  strong: { color: colors.textPrimary, fontWeight: "700" },
  addr: {
    color: colors.muted, fontSize: 10.5, fontFamily: "monospace",
    marginTop: 8, marginBottom: 10,
  },
  err: { color: colors.dangerText, fontSize: ts.small, marginBottom: 8 },
  btnRow: { flexDirection: "row", gap: 8 },
  btn: {
    flex: 1, paddingVertical: 10, borderRadius: radius.button,
    alignItems: "center", justifyContent: "center",
  },
  btnBrand: { backgroundColor: colors.brand },
  btnBrandText: { color: colors.onBrand, fontSize: ts.small, fontWeight: "700" },
  btnGhost: { backgroundColor: colors.surface3 },
  btnGhostText: { color: colors.textSecondary, fontSize: ts.small, fontWeight: "700" },
}));
