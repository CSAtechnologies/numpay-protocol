// Mobile Manage Assets — the phone port of the extension's ManageAssets page:
// two tabs, user-added custom tokens (any built-in EVM chain, Solana, or a
// custom network) and custom EVM networks. Reads/writes go through
// @numpay/core customTokens/customChains, the same modules the extension uses,
// so the storage shape stays identical across clients. useMobileWallet
// re-reads both lists on every refresh, so additions land on the dashboard
// and in the Send picker on the next sweep (App triggers one on back).
import { useEffect, useState } from "react";
import { ScrollView, StyleSheet, Text, View } from "react-native";
import { NETWORKS } from "@numpay/core/networks";
import {
  getCustomTokens, addCustomToken, removeCustomToken, type CustomToken,
} from "@numpay/core/customTokens";
import {
  getCustomChains, saveCustomChain, removeCustomChain, type CustomChain,
} from "@numpay/core/customChains";
import {
  detectEvmToken, detectSolanaToken, detectErrorMessage, type TokenPreview,
} from "../wallet/tokenDetect";
import { colors, radius, type as ts, themedStyles } from "../ui/theme";
import { Notice, Btn, Card, Field, ScreenHeader, Tappable } from "../ui/components";
import { XIcon } from "../ui/icons";
import { ChainIcon, TokenIcon } from "../ui/coins";
import { safeActionError } from "../ui/errors";

type Tab = "tokens" | "networks";

// ── Chain helpers ─────────────────────────────────────────────────────────────

interface ChainOption {
  id: string; name: string; rpcUrl: string; chainId?: number; type: "evm" | "solana";
}

function getAllChainOptions(custom: CustomChain[]): ChainOption[] {
  const evm = Object.values(NETWORKS).map((n) => ({
    id: n.id, name: n.name, rpcUrl: n.rpcUrl, chainId: n.chainId, type: "evm" as const,
  }));
  const nonEvm: ChainOption[] = [{ id: "solana", name: "Solana", rpcUrl: "", type: "solana" }];
  const customOpts = custom.map((c) => ({
    id: c.id, name: c.name, rpcUrl: c.rpcUrl, chainId: c.chainId, type: "evm" as const,
  }));
  return [...evm, ...nonEvm, ...customOpts];
}

function chainDisplayName(id: string, custom: CustomChain[]): string {
  if (NETWORKS[id]) return NETWORKS[id].name;
  if (id === "solana") return "Solana";
  return custom.find((c) => c.id === id)?.name ?? id;
}

// ── Detection helpers (same lookups the extension page makes) ────────────────
// Token detection itself lives in ../wallet/tokenDetect, shared with the Swap
// and Send pickers; only the chain-RPC probe below is specific to this screen.

async function detectChainId(rpcUrl: string): Promise<number> {
  const res = await fetch(rpcUrl, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_chainId", params: [] }),
  });
  const data = await res.json();
  if (!data.result) throw new Error("No response");
  return parseInt(data.result, 16);
}

// ── Custom RPC safety ─────────────────────────────────────────────────────────
// Hermes/RN's built-in URL is incomplete (several accessors throw), so the
// scheme/host check is a plain parse instead of new URL(). An untrusted RPC can
// lie about balances, gas, and tx state, so a secure transport is the floor;
// plain http is allowed only for local dev nodes in a development build
// (10.0.2.2 is the emulator's alias for the host machine's localhost).
function validateRpcUrl(raw: string): string {
  const v = raw.trim();
  const m = /^(https?):\/\/([^/:?#]+)(:\d+)?([/?#].*)?$/i.exec(v);
  if (!m) throw new Error("Enter a valid URL, e.g. https://rpc.example.com");
  const [, scheme, host] = m;
  if (scheme.toLowerCase() === "https") return v;
  const local = host === "localhost" || host === "127.0.0.1" || host === "10.0.2.2";
  if (local && __DEV__) return v;
  throw new Error("RPC URL must use https:// (plain http is insecure).");
}

// ── Screen ────────────────────────────────────────────────────────────────────

export function ManageAssetsScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("tokens");
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [customNetworks, setCustomNetworks] = useState<CustomChain[]>([]);

  useEffect(() => {
    Promise.all([getCustomTokens(), getCustomChains()]).then(([toks, nets]) => {
      setCustomTokens(toks);
      setCustomNetworks(nets);
    }).catch(() => {});
  }, []);

  // ── Token form ──────────────────────────────────────────────────────────────
  const [chain, setChain] = useState("ethereum");
  const [tokenAddr, setTokenAddr] = useState("");
  const [preview, setPreview] = useState<TokenPreview | null>(null);
  const [detecting, setDetecting] = useState(false);
  const [detectErr, setDetectErr] = useState("");
  const [adding, setAdding] = useState(false);

  const chainOptions = getAllChainOptions(customNetworks);
  const selectedChainOpt = chainOptions.find((c) => c.id === chain);

  async function handleDetect() {
    const addr = tokenAddr.trim();
    if (!addr) { setDetectErr("Enter an address first."); return; }
    setDetecting(true); setDetectErr(""); setPreview(null);
    try {
      let result: TokenPreview;
      if (chain === "solana") {
        result = await detectSolanaToken(addr);
      } else {
        if (!selectedChainOpt?.rpcUrl) throw new Error("No RPC for this chain.");
        result = await detectEvmToken(
          selectedChainOpt.rpcUrl, addr, undefined, selectedChainOpt.chainId,
        );
      }
      setPreview(result);
    } catch (e: any) {
      setDetectErr(detectErrorMessage(e));
    } finally {
      setDetecting(false);
    }
  }

  async function handleAddToken() {
    if (!preview) return;
    setAdding(true);
    try {
      const token = await addCustomToken({
        chainId: chain, address: tokenAddr.trim(),
        symbol: preview.symbol, name: preview.name,
        decimals: preview.decimals, logo: preview.logo,
      });
      setCustomTokens((prev) => [...prev, token]);
      setTokenAddr(""); setPreview(null);
    } finally { setAdding(false); }
  }

  async function handleRemoveToken(id: string) {
    await removeCustomToken(id);
    setCustomTokens((prev) => prev.filter((t) => t.id !== id));
  }

  // ── Network form ────────────────────────────────────────────────────────────
  const [netName, setNetName] = useState("");
  const [netRpc, setNetRpc] = useState("");
  const [netChainId, setNetChainId] = useState<number | null>(null);
  const [netSymbol, setNetSymbol] = useState("");
  const [netDecimals, setNetDecimals] = useState("18");
  const [netExplorer, setNetExplorer] = useState("");
  const [netDetecting, setNetDetecting] = useState(false);
  const [netDetectErr, setNetDetectErr] = useState("");
  const [netAdding, setNetAdding] = useState(false);
  const [netAddErr, setNetAddErr] = useState("");

  async function handleDetectChain() {
    setNetDetecting(true); setNetDetectErr("");
    try {
      const url = validateRpcUrl(netRpc);
      const id = await detectChainId(url);
      setNetChainId(id);
    } catch (e: any) {
      setNetDetectErr(e?.message?.startsWith("RPC URL") || e?.message?.startsWith("Enter a valid")
        ? e.message
        : "Could not reach this RPC. Check the URL.");
    } finally { setNetDetecting(false); }
  }

  async function handleAddNetwork() {
    if (!netName.trim() || !netRpc.trim() || !netSymbol.trim() || !netChainId) {
      setNetAddErr("Fill in all fields and detect the Chain ID.");
      return;
    }
    setNetAdding(true); setNetAddErr("");
    try {
      const url = validateRpcUrl(netRpc);

      // Reject chain ids that collide with a built-in or an existing custom
      // network — duplicates make balances/routing ambiguous.
      const builtinChainIds = Object.values(NETWORKS).map((n) => n.chainId);
      if (builtinChainIds.includes(netChainId)) {
        throw new Error(`Chain ID ${netChainId} is already a built-in network.`);
      }
      if (customNetworks.some((c) => c.chainId === netChainId)) {
        throw new Error(`Chain ID ${netChainId} is already added as a custom network.`);
      }
      const nameLc = netName.trim().toLowerCase();
      const nameTaken =
        Object.values(NETWORKS).some((n) => n.name.toLowerCase() === nameLc) ||
        customNetworks.some((c) => c.name.toLowerCase() === nameLc);
      if (nameTaken) {
        throw new Error(`A network named "${netName.trim()}" already exists.`);
      }

      const chainRec: CustomChain = {
        id: `custom_${netChainId}_${Date.now()}`,
        name: netName.trim(), chainId: netChainId,
        rpcUrl: url, symbol: netSymbol.trim(),
        decimals: parseInt(netDecimals, 10) || 18, explorer: netExplorer.trim(),
      };
      await saveCustomChain(chainRec);
      setCustomNetworks((prev) => [...prev, chainRec]);
      setNetName(""); setNetRpc(""); setNetChainId(null);
      setNetSymbol(""); setNetDecimals("18"); setNetExplorer("");
    } catch (e: any) {
      setNetAddErr(safeActionError(e, "The network could not be saved. Check the details and try again."));
    } finally { setNetAdding(false); }
  }

  async function handleRemoveNetwork(id: string) {
    await removeCustomChain(id);
    setCustomNetworks((prev) => prev.filter((c) => c.id !== id));
  }

  const TABS: { id: Tab; label: string }[] = [
    { id: "tokens", label: "Tokens" },
    { id: "networks", label: "Networks" },
  ];

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="Manage assets" onBack={onBack} />

      {/* Underline tab bar (extension ManageAssets), not a filled segment:
          the active tab is brand-coloured text over a 2px brand rule. */}
      <View style={st.tabs}>
        {TABS.map((t) => (
          <Tappable feedback="tile" key={t.id} onPress={() => setTab(t.id)} style={st.tab}>
            <Text style={[st.tabText, tab === t.id && st.tabTextOn]}>{t.label}</Text>
            {tab === t.id && <View style={st.tabUnderline} />}
          </Tappable>
        ))}
      </View>

      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flex: 1 }}>
        {tab === "tokens" && (
          <View style={{ paddingBottom: 24 }}>
            <Text style={st.blurb}>
              Tokens with a balance are auto-detected. Use this to manually add any token that isn't showing up.
            </Text>

            {/* Chain selector — a scrolling card of chips, as in the popup */}
            <Card style={st.chainCard}>
              <Text style={[st.fieldLabel, { marginTop: 0 }]}>Chain</Text>
              <ScrollView style={{ maxHeight: 118 }} nestedScrollEnabled>
                <View style={st.chainWrap}>
                  {chainOptions.map((c) => (
                    <Tappable feedback="row"
                      key={c.id}
                      onPress={() => { setChain(c.id); setPreview(null); setDetectErr(""); }}
                      style={[st.chainChip, chain === c.id && st.chainChipOn]}
                    >
                      <ChainIcon chainId={c.id} size={14} />
                      <Text
                        style={[st.chainChipText, chain === c.id && st.chainChipTextOn]}
                        numberOfLines={1}
                      >
                        {c.name}
                      </Text>
                    </Tappable>
                  ))}
                </View>
              </ScrollView>
            </Card>

            {/* Address input + inline Detect (the extension puts them on one
                row, so the action sits next to the field it acts on) */}
            <Text style={st.fieldLabel}>{chain === "solana" ? "Mint address" : "Contract address"}</Text>
            <View style={st.inlineRow}>
              <View style={{ flex: 1 }}>
                <Field
                  value={tokenAddr}
                  onChangeText={(v: string) => { setTokenAddr(v); setPreview(null); setDetectErr(""); }}
                  placeholder={chain === "solana" ? "Paste mint address…" : "0x…"}
                  autoCapitalize="none"
                  autoCorrect={false}
                  onSubmitEditing={() => { void handleDetect(); }}
                  style={{ fontFamily: "monospace", fontSize: 12 }}
                />
              </View>
              <Tappable feedback="row"
                disabled={detecting || !tokenAddr.trim()}
                onPress={() => { void handleDetect(); }}
                style={[st.detectBtn, (detecting || !tokenAddr.trim()) && { opacity: 0.4 }]}
              >
                <Text style={st.detectText}>{detecting ? "Detecting" : "Detect"}</Text>
              </Tappable>
            </View>
            {!!detectErr && <Text style={st.errText}>{detectErr}</Text>}

            {/* Token preview */}
            {preview && (
              <Card style={st.previewCard}>
                <TokenIcon symbol={preview.symbol} logo={preview.logo} size={40} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={st.previewSymbol}>{preview.symbol}</Text>
                  <Text style={st.previewName} numberOfLines={1}>{preview.name}</Text>
                  <Text style={st.previewMeta}>
                    {chainDisplayName(chain, customNetworks)} · {preview.decimals} decimals
                  </Text>
                </View>
                <Btn
                  label={adding ? "Adding…" : "Add"}
                  disabled={adding}
                  onPress={() => { void handleAddToken(); }}
                  style={{ width: undefined, marginTop: 0, paddingHorizontal: 0 }}
                />
              </Card>
            )}

            {/* Custom token list */}
            {customTokens.length > 0 && (
              <>
                <Text style={[st.fieldLabel, { marginTop: 18 }]}>Custom tokens</Text>
                <Card>
                  {customTokens.map((t, i) => (
                    <View key={t.id} style={[st.listRow, i > 0 && st.listDivider]}>
                      <TokenIcon symbol={t.symbol} logo={t.logo} size={30} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={st.listSymbol}>{t.symbol}</Text>
                        <Text style={st.listMeta} numberOfLines={1}>
                          {chainDisplayName(t.chainId, customNetworks)} · {t.address.slice(0, 6)}…{t.address.slice(-4)}
                        </Text>
                      </View>
                      <Tappable
                        hitSlop={8}
                        onPress={() => { void handleRemoveToken(t.id); }}
                        accessibilityLabel={`Remove ${t.symbol}`}
                        feedback="ghost"
                        borderRadius={radius.iconBtn}
                        style={st.removeBtn}
                      >
                        <XIcon size={12} color={colors.muted} />
                      </Tappable>
                    </View>
                  ))}
                </Card>
              </>
            )}

            {customTokens.length === 0 && !preview && (
              <Text style={st.emptyText}>No custom tokens added yet</Text>
            )}
          </View>
        )}

        {tab === "networks" && (
          <View style={{ paddingBottom: 24 }}>
            <Text style={st.blurb}>
              Add any EVM-compatible network. Paste the RPC URL, then tap Detect to fill the Chain ID automatically.
            </Text>
            <Notice
              tone="caution"
              title="Only add RPC endpoints you trust"
              body="A malicious RPC can report fake balances, gas, and transaction results. Use https:// URLs."
              style={{ marginBottom: 4 }}
            />

            <Text style={st.fieldLabel}>RPC URL</Text>
            <View style={st.inlineRow}>
              <View style={{ flex: 1 }}>
                <Field
                  value={netRpc}
                  onChangeText={(v: string) => { setNetRpc(v); setNetChainId(null); setNetDetectErr(""); }}
                  placeholder="https://rpc.example.com"
                  autoCapitalize="none"
                  autoCorrect={false}
                  keyboardType="url"
                />
              </View>
              <Tappable feedback="row"
                disabled={netDetecting || !netRpc.trim()}
                onPress={() => { void handleDetectChain(); }}
                style={[st.detectBtn, (netDetecting || !netRpc.trim()) && { opacity: 0.4 }]}
              >
                <Text style={st.detectText}>{netDetecting ? "Detecting" : "Detect"}</Text>
              </Tappable>
            </View>
            {!!netDetectErr && <Text style={st.errText}>{netDetectErr}</Text>}
            {netChainId != null && (
              <View style={st.chainIdBadge}>
                <View style={st.greenDot} />
                <Text style={st.chainIdText}>Chain ID: {netChainId}</Text>
              </View>
            )}

            <Text style={st.fieldLabel}>Network name</Text>
            <Field value={netName} onChangeText={setNetName} placeholder="e.g. Base Sepolia" />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={st.fieldLabel}>Symbol</Text>
                <Field value={netSymbol} onChangeText={setNetSymbol} placeholder="ETH" autoCapitalize="characters" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={st.fieldLabel}>Decimals</Text>
                <Field value={netDecimals} onChangeText={setNetDecimals} placeholder="18" keyboardType="number-pad" />
              </View>
            </View>

            <Text style={st.fieldLabel}>Block explorer (optional)</Text>
            <Field
              value={netExplorer}
              onChangeText={setNetExplorer}
              placeholder="https://explorer.example.com"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />

            {!!netAddErr && <Text style={st.errText}>{netAddErr}</Text>}
            <Btn
              label={netAdding ? "Saving…" : "Add network"}
              disabled={netAdding || !netChainId}
              onPress={() => { void handleAddNetwork(); }}
            />

            {/* Custom network list */}
            {customNetworks.length > 0 && (
              <>
                <Text style={[st.fieldLabel, { marginTop: 18 }]}>Custom networks</Text>
                <Card>
                  {customNetworks.map((c, i) => (
                    <View key={c.id} style={[st.listRow, i > 0 && st.listDivider]}>
                      <ChainIcon chainId={c.id} size={30} />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={st.listSymbol}>{c.name}</Text>
                        <Text style={st.listMeta}>{c.symbol} · Chain ID {c.chainId}</Text>
                      </View>
                      <Tappable
                        hitSlop={8}
                        onPress={() => { void handleRemoveNetwork(c.id); }}
                        accessibilityLabel={`Remove ${c.name}`}
                        feedback="ghost"
                        borderRadius={radius.iconBtn}
                        style={st.removeBtn}
                      >
                        <XIcon size={12} color={colors.muted} />
                      </Tappable>
                    </View>
                  ))}
                </Card>
              </>
            )}

            {customNetworks.length === 0 && (
              <Text style={st.emptyText}>No custom networks added yet</Text>
            )}
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const st = themedStyles((colors) => ({
  tabs: {
    flexDirection: "row", marginBottom: 14,
    borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: colors.divider,
  },
  tab: { paddingHorizontal: 16, paddingVertical: 10, position: "relative" },
  tabText: { color: colors.muted, fontSize: ts.row, fontWeight: "600" },
  tabTextOn: { color: colors.brand2 },
  tabUnderline: {
    position: "absolute", left: 0, right: 0, bottom: 0,
    height: 2, borderRadius: 1, backgroundColor: colors.brand2,
  },

  inlineRow: { flexDirection: "row", alignItems: "flex-start", gap: 8 },
  // Brand-tinted compact action beside its input, not a full-width button.
  detectBtn: {
    marginTop: 10, paddingHorizontal: 14, paddingVertical: 13,
    borderRadius: radius.input, backgroundColor: colors.brandTint,
  },
  detectText: { color: colors.brand2, fontSize: 12, fontWeight: "600" },

  blurb: { color: colors.muted, fontSize: ts.small, lineHeight: 17, marginBottom: 12 },
  fieldLabel: {
    color: colors.muted, fontSize: ts.label, fontWeight: "600",
    letterSpacing: 1, textTransform: "uppercase", marginTop: 14,
  },
  errText: { color: colors.dangerText, fontSize: ts.small, marginTop: 8 },
  emptyText: { color: colors.muted, fontSize: ts.small, textAlign: "center", paddingVertical: 20 },

  chainCard: { padding: 12, marginTop: 4 },
  chainWrap: { flexDirection: "row", flexWrap: "wrap", gap: 6, marginTop: 8 },
  chainChip: {
    flexDirection: "row", alignItems: "center", gap: 5,
    paddingVertical: 6, paddingHorizontal: 10,
    borderRadius: radius.tile, backgroundColor: colors.card,
    borderWidth: 1, borderColor: colors.border, maxWidth: "48%",
  },
  chainChipOn: { backgroundColor: colors.brandTint, borderColor: colors.brand },
  chainChipText: { color: colors.textSecondary, fontSize: ts.small, flexShrink: 1 },
  chainChipTextOn: { color: colors.brand2, fontWeight: "600" },

  previewCard: {
    flexDirection: "row", alignItems: "center", gap: 12,
    padding: 14, marginTop: 14,
  },
  previewSymbol: { color: colors.textPrimary, fontSize: ts.body, fontWeight: "700" },
  previewName: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
  previewMeta: { color: colors.muted2, fontSize: ts.label, marginTop: 3 },

  listRow: { flexDirection: "row", alignItems: "center", gap: 12, paddingHorizontal: 14, paddingVertical: 12 },
  listDivider: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.divider },
  listSymbol: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600" },
  listMeta: { color: colors.muted, fontSize: ts.small, marginTop: 2 },
  removeBtn: {
    width: 28, height: 28, borderRadius: 8,
    alignItems: "center", justifyContent: "center",
  },

  chainIdBadge: {
    flexDirection: "row", alignItems: "center", gap: 8,
    marginTop: 10, paddingHorizontal: 12, paddingVertical: 9,
    borderRadius: radius.tile, backgroundColor: colors.successTint,
    borderWidth: 1, borderColor: colors.successTint,
  },
  greenDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.success },
  chainIdText: { color: colors.successText, fontSize: ts.small, fontWeight: "600" },
}));
