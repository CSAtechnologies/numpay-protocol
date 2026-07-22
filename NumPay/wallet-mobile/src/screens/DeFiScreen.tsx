// Mobile DeFi — port of the extension's DeFi page (popup/pages/DeFi.tsx):
// three tabs of curated protocols with LIVE APY and TVL from DefiLlama's
// public yields API, each row opening the protocol's own app in the system
// browser. Nothing is hardcoded except the protocol list and its slugs, and
// nothing is custodial: these are outbound links, not integrations.
//
// One deliberate deviation from the extension copy: the popup says "Earn yield
// on your {network.symbol} and tokens" because it has a single active network.
// Mobile is multi-chain with no active-network selector, so the subtitle stays
// chain-agnostic rather than naming a chain that means nothing here.
import { useEffect, useMemo, useState } from "react";
import { Linking, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { colors, radius, type as ts } from "../ui/theme";
import { Card, ScreenHeader } from "../ui/components";
import { ExternalLinkIcon, ShieldIcon, TrendingUpIcon } from "../ui/icons";
import { LogoCoin } from "../ui/coins";

type Tab = "earn" | "lend" | "stake";

interface Protocol {
  name: string;
  logo: string;
  // DefiLlama project slug(s) used to pull live APY + TVL. The best-TVL pool
  // matching any of these on Ethereum is shown. Numbers are NOT hardcoded.
  slugs: string[];
  type: string;
  url: string;
}

const EARN_PROTOCOLS: Protocol[] = [
  { name: "Aave V3", logo: "https://assets.coingecko.com/coins/images/12645/small/AAVE.png", slugs: ["aave-v3"], type: "Lending", url: "https://app.aave.com" },
  { name: "Compound", logo: "https://assets.coingecko.com/coins/images/10775/small/COMP.png", slugs: ["compound-v3", "compound-v2"], type: "Lending", url: "https://app.compound.finance" },
  { name: "Yearn", logo: "https://assets.coingecko.com/coins/images/11849/small/yearn.jpg", slugs: ["yearn-finance"], type: "Yield", url: "https://yearn.fi" },
  { name: "Convex", logo: "https://assets.coingecko.com/coins/images/15585/small/convex.png", slugs: ["convex-finance"], type: "Yield", url: "https://www.convexfinance.com" },
];

const LEND_PROTOCOLS: Protocol[] = [
  { name: "Aave V3", logo: "https://assets.coingecko.com/coins/images/12645/small/AAVE.png", slugs: ["aave-v3"], type: "Supply", url: "https://app.aave.com" },
  { name: "Compound", logo: "https://assets.coingecko.com/coins/images/10775/small/COMP.png", slugs: ["compound-v3", "compound-v2"], type: "Supply", url: "https://app.compound.finance" },
  { name: "Spark", logo: "https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png", slugs: ["sparklend", "spark-savings"], type: "Supply", url: "https://app.spark.fi" },
  { name: "Morpho", logo: "https://assets.coingecko.com/coins/images/29837/small/morpho.png", slugs: ["morpho-blue"], type: "Optimized", url: "https://app.morpho.org" },
];

const STAKE_PROTOCOLS: Protocol[] = [
  { name: "Lido", logo: "https://assets.coingecko.com/coins/images/13573/small/Lido_DAO.png", slugs: ["lido"], type: "Liquid Staking", url: "https://stake.lido.fi" },
  { name: "Rocket Pool", logo: "https://assets.coingecko.com/coins/images/20764/small/reth.png", slugs: ["rocket-pool"], type: "Liquid Staking", url: "https://stake.rocketpool.net" },
  { name: "Frax Ether", logo: "https://assets.coingecko.com/coins/images/28284/small/frxETH_icon.png", slugs: ["frax-ether"], type: "Liquid Staking", url: "https://app.frax.finance" },
  { name: "ether.fi", logo: "https://assets.coingecko.com/coins/images/33049/small/ether.fi_logo.png", slugs: ["ether.fi-stake"], type: "Restaking", url: "https://app.ether.fi" },
];

interface LiveStat { apy: number; tvlUsd: number }
// Ignore dust pools when picking the headline APY so a $10k pool at 900% can't
// misrepresent a protocol.
const MIN_APY_POOL_TVL = 5e6;

function fmtTvl(n: number): string {
  if (!(n > 0)) return "—";
  if (n >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

// Live TVL + APY from DefiLlama's public yields API, aggregated per project
// slug: TVL is summed across the project's Ethereum pools; the headline APY is
// the best rate among its pools above a TVL floor (a real, attainable pool —
// shown as "up to"). Keyless endpoint, so no proxy hop needed.
async function fetchYields(): Promise<Record<string, LiveStat>> {
  const res = await fetch("https://yields.llama.fi/pools");
  const json = await res.json();
  const pools: any[] = json?.data || [];
  const out: Record<string, LiveStat> = {};
  for (const p of pools) {
    if (p.chain !== "Ethereum") continue;
    const slug = p.project;
    const tvl = Number(p.tvlUsd) || 0;
    const apy = Number(p.apy) || 0;
    if (!slug || tvl <= 0) continue;
    const acc = out[slug] || (out[slug] = { apy: 0, tvlUsd: 0 });
    acc.tvlUsd += tvl;
    if (tvl >= MIN_APY_POOL_TVL && apy > acc.apy) acc.apy = apy;
  }
  return out;
}

export function DeFiScreen({ onBack }: { onBack: () => void }) {
  const [tab, setTab] = useState<Tab>("earn");
  const [stats, setStats] = useState<Record<string, LiveStat> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetchYields()
      .then((s) => { if (live) setStats(s); })
      .catch(() => { if (live) setLoadFailed(true); });
    return () => { live = false; };
  }, []);

  const protocols = tab === "earn" ? EARN_PROTOCOLS : tab === "lend" ? LEND_PROTOCOLS : STAKE_PROTOCOLS;

  // Aggregate a protocol's live stat across its slugs (sum TVL, best APY).
  const statFor = useMemo(() => (p: Protocol): LiveStat | null => {
    if (!stats) return null;
    let tvlUsd = 0, apy = 0, matched = false;
    for (const s of p.slugs) {
      const st = stats[s];
      if (!st) continue;
      matched = true;
      tvlUsd += st.tvlUsd;
      if (st.apy > apy) apy = st.apy;
    }
    return matched ? { apy, tvlUsd } : null;
  }, [stats]);

  return (
    <View style={{ flex: 1 }}>
      <ScreenHeader title="DeFi" onBack={onBack} />
      <ScrollView showsVerticalScrollIndicator={false}>
        <Text style={sx.sub}>Earn yield on your assets</Text>

        {/* Tabs */}
        <Card style={sx.tabBar}>
          {(["earn", "lend", "stake"] as Tab[]).map((t) => (
            <Pressable
              key={t}
              onPress={() => setTab(t)}
              style={[sx.tab, tab === t && sx.tabActive]}
            >
              <Text style={[sx.tabLabel, tab === t && sx.tabLabelActive]}>
                {t[0].toUpperCase() + t.slice(1)}
              </Text>
            </Pressable>
          ))}
        </Card>

        {/* Protocols */}
        {protocols.map((p) => {
          const stat = statFor(p);
          return (
            <Pressable
              key={p.name + p.type}
              onPress={() => { Linking.openURL(p.url).catch(() => {}); }}
              style={({ pressed }) => [sx.row, pressed && { borderColor: colors.brand }]}
            >
              <LogoCoin uri={p.logo} label={p.name} size={36} />
              <View style={{ flex: 1, marginLeft: 12, minWidth: 0 }}>
                <View style={sx.nameLine}>
                  <Text style={sx.name} numberOfLines={1}>{p.name}</Text>
                  <ExternalLinkIcon size={10} color={colors.muted} />
                </View>
                <Text style={sx.type} numberOfLines={1}>{p.type}</Text>
              </View>
              <View style={{ alignItems: "flex-end" }}>
                {stat ? (
                  <>
                    <View style={sx.apyLine}>
                      {stat.apy > 0 && <TrendingUpIcon size={12} color={colors.success} />}
                      <Text style={sx.apy}>{stat.apy > 0 ? `up to ${stat.apy.toFixed(2)}%` : "—"}</Text>
                    </View>
                    <Text style={sx.tvl}>TVL {fmtTvl(stat.tvlUsd)}</Text>
                  </>
                ) : (
                  <Text style={sx.tvl}>{stats || loadFailed ? "—" : "…"}</Text>
                )}
              </View>
            </Pressable>
          );
        })}

        {/* Disclaimer */}
        <Card style={sx.note}>
          <ShieldIcon size={13} color={colors.muted} />
          <Text style={sx.noteText}>
            Live APY and TVL from DefiLlama for the largest Ethereum pool per protocol; your
            actual rate depends on the asset and market. DeFi carries smart-contract risk. Do your own research.
          </Text>
        </Card>
        <View style={{ height: 24 }} />
      </ScrollView>
    </View>
  );
}

const sx = StyleSheet.create({
  sub: { color: colors.muted, fontSize: ts.row, marginTop: 2, marginBottom: 14 },

  tabBar: { flexDirection: "row", padding: 4, marginBottom: 14 },
  tab: { flex: 1, paddingVertical: 8, borderRadius: radius.button, alignItems: "center" },
  tabActive: { backgroundColor: colors.brand },
  tabLabel: { color: colors.muted, fontSize: ts.small, fontWeight: "500" },
  tabLabelActive: { color: "#fff", fontWeight: "600" },

  row: {
    flexDirection: "row",
    alignItems: "center",
    padding: 12,
    marginBottom: 6,
    borderRadius: radius.button,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.card,
  },
  nameLine: { flexDirection: "row", alignItems: "center", gap: 5 },
  name: { color: colors.textPrimary, fontSize: ts.row, fontWeight: "600" },
  type: { color: colors.muted, fontSize: ts.small, marginTop: 1 },
  apyLine: { flexDirection: "row", alignItems: "center", gap: 4 },
  apy: { color: colors.success, fontSize: ts.row, fontWeight: "700" },
  tvl: { color: colors.muted, fontSize: ts.label, marginTop: 1 },

  note: { flexDirection: "row", gap: 8, padding: 12, marginTop: 12, alignItems: "flex-start" },
  noteText: { color: colors.muted, fontSize: ts.small, flex: 1, lineHeight: 16 },
});
