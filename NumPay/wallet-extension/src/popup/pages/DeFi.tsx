import { useState, useEffect, useMemo } from "react";
import { useWallet } from "../hooks/useWallet";
import Layout from "../components/Layout";
import { TrendingUpIcon, ExternalLinkIcon, ShieldIcon } from "../components/Icons";

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

interface LiveStat { apy: number; tvlUsd: number; }
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

// Live TVL + APY from DefiLlama's public yields API, aggregated per project slug:
// TVL is summed across the project's Ethereum pools; the headline APY is the best
// rate among its pools above a TVL floor (a real, attainable pool — shown as
// "up to"). Nothing is hardcoded.
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

export default function DeFi() {
  const { network } = useWallet();
  const [tab, setTab] = useState<Tab>("earn");
  const [stats, setStats] = useState<Record<string, LiveStat> | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let live = true;
    fetchYields().then((s) => { if (live) setStats(s); }).catch(() => { if (live) setLoadFailed(true); });
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
    <Layout>
      <div className="app-bg min-h-full">
      <div className="px-4 py-4">
        <h2 className="text-lg font-bold text-text-primary mb-1">DeFi</h2>
        <p className="text-[13px] text-muted mb-5">Earn yield on your {network.symbol} and tokens</p>

        {/* Tabs */}
        <div className="flex premium-card p-1 mb-5">
          {(["earn", "lend", "stake"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`flex-1 py-2 text-xs rounded-lg font-medium capitalize transition-all duration-150 ${
                tab === t ? "bg-brand-500 text-white shadow-lg shadow-brand-500/30" : "text-muted hover:text-text-secondary"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {/* Protocols */}
        <div className="space-y-1.5 animate-slide-up">
          {protocols.map((p) => {
            const stat = statFor(p);
            return (
            <a
              key={p.name + p.type}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="token-row block"
            >
              <div className="flex items-center gap-3">
                <img
                  src={p.logo}
                  alt={p.name}
                  className="w-9 h-9 rounded-full bg-surface-3"
                  onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }}
                />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5">
                    <p className="text-[13px] font-semibold text-text-primary">{p.name}</p>
                    <ExternalLinkIcon size={10} className="text-muted" />
                  </div>
                  <p className="text-[11px] text-muted">{p.type}</p>
                </div>
                <div className="text-right flex-shrink-0">
                  {stat ? (
                    <>
                      <div className="flex items-center gap-1 justify-end">
                        {stat.apy > 0 && <TrendingUpIcon size={12} className="text-accent-green" />}
                        <p className="text-[13px] font-bold text-accent-green">
                          {stat.apy > 0 ? `up to ${stat.apy.toFixed(2)}%` : "—"}
                        </p>
                      </div>
                      <p className="text-[10px] text-muted">TVL {fmtTvl(stat.tvlUsd)}</p>
                    </>
                  ) : (
                    <p className="text-[11px] text-muted">{stats || loadFailed ? "—" : "…"}</p>
                  )}
                </div>
              </div>
            </a>
          );})}
        </div>

        {/* Disclaimer */}
        <div className="mt-5 premium-card px-3.5 py-3">
          <div className="flex items-start gap-2">
            <ShieldIcon size={13} className="text-muted mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-muted leading-relaxed">
              Live APY and TVL from DefiLlama for the largest Ethereum pool per protocol; your
              actual rate depends on the asset and market. DeFi carries smart-contract risk. Do your own research.
            </p>
          </div>
        </div>
      </div>
      </div>
    </Layout>
  );
}
