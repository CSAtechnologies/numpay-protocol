import { useState } from "react";
import { useWallet } from "../hooks/useWallet";
import Layout from "../components/Layout";
import { TrendingUpIcon, ExternalLinkIcon, ShieldIcon } from "../components/Icons";

type Tab = "earn" | "lend" | "stake";

interface Protocol {
  name: string;
  logo: string;
  apy: string;
  tvl: string;
  type: string;
  url: string;
}

const EARN_PROTOCOLS: Protocol[] = [
  { name: "Aave V3", logo: "https://assets.coingecko.com/coins/images/12645/small/AAVE.png", apy: "3.2%", tvl: "$12.4B", type: "Lending", url: "https://app.aave.com" },
  { name: "Compound", logo: "https://assets.coingecko.com/coins/images/10775/small/COMP.png", apy: "2.8%", tvl: "$2.1B", type: "Lending", url: "https://app.compound.finance" },
  { name: "Yearn", logo: "https://assets.coingecko.com/coins/images/11849/small/yearn.jpg", apy: "5.1%", tvl: "$450M", type: "Yield", url: "https://yearn.fi" },
  { name: "Convex", logo: "https://assets.coingecko.com/coins/images/15585/small/convex.png", apy: "4.5%", tvl: "$1.8B", type: "Yield", url: "https://www.convexfinance.com" },
];

const LEND_PROTOCOLS: Protocol[] = [
  { name: "Aave V3", logo: "https://assets.coingecko.com/coins/images/12645/small/AAVE.png", apy: "3.2%", tvl: "$12.4B", type: "Supply ETH", url: "https://app.aave.com" },
  { name: "Compound", logo: "https://assets.coingecko.com/coins/images/10775/small/COMP.png", apy: "2.8%", tvl: "$2.1B", type: "Supply ETH", url: "https://app.compound.finance" },
  { name: "Spark", logo: "https://assets.coingecko.com/coins/images/9956/small/Badge_Dai.png", apy: "3.5%", tvl: "$1.6B", type: "Supply DAI", url: "https://app.spark.fi" },
  { name: "Morpho", logo: "https://assets.coingecko.com/coins/images/29837/small/morpho.png", apy: "4.2%", tvl: "$800M", type: "Optimized", url: "https://app.morpho.org" },
];

const STAKE_PROTOCOLS: Protocol[] = [
  { name: "Lido", logo: "https://assets.coingecko.com/coins/images/13573/small/Lido_DAO.png", apy: "3.4%", tvl: "$33.5B", type: "Liquid Staking", url: "https://stake.lido.fi" },
  { name: "Rocket Pool", logo: "https://assets.coingecko.com/coins/images/20764/small/reth.png", apy: "3.1%", tvl: "$3.8B", type: "Liquid Staking", url: "https://stake.rocketpool.net" },
  { name: "Frax Ether", logo: "https://assets.coingecko.com/coins/images/28284/small/frxETH_icon.png", apy: "3.6%", tvl: "$1.2B", type: "Liquid Staking", url: "https://app.frax.finance" },
  { name: "EigenLayer", logo: "https://assets.coingecko.com/coins/images/37547/small/eigen.png", apy: "---", tvl: "$15.2B", type: "Restaking", url: "https://app.eigenlayer.xyz" },
];

export default function DeFi() {
  const { network } = useWallet();
  const [tab, setTab] = useState<Tab>("earn");

  const protocols = tab === "earn" ? EARN_PROTOCOLS : tab === "lend" ? LEND_PROTOCOLS : STAKE_PROTOCOLS;

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
          {protocols.map((p) => (
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
                  <div className="flex items-center gap-1 justify-end">
                    <TrendingUpIcon size={12} className="text-accent-green" />
                    <p className="text-[13px] font-bold text-accent-green">{p.apy}</p>
                  </div>
                  <p className="text-[10px] text-muted">TVL {p.tvl}</p>
                </div>
              </div>
            </a>
          ))}
        </div>

        {/* Disclaimer */}
        <div className="mt-5 premium-card px-3.5 py-3">
          <div className="flex items-start gap-2">
            <ShieldIcon size={13} className="text-muted mt-0.5 flex-shrink-0" />
            <p className="text-[11px] text-muted leading-relaxed">
              DeFi protocols involve smart contract risk. Always do your own research. APY rates are approximate.
            </p>
          </div>
        </div>
      </div>
      </div>
    </Layout>
  );
}
