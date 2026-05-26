export const CHAINS = [
  { id: "eth",   sym: "E", name: "Ethereum" },
  { id: "poly",  sym: "P", name: "Polygon" },
  { id: "arb",   sym: "A", name: "Arbitrum" },
  { id: "opt",   sym: "O", name: "Optimism" },
  { id: "base",  sym: "B", name: "Base" },
  { id: "avax",  sym: "X", name: "Avalanche" },
  { id: "bnb",   sym: "B", name: "BNB Chain" },
  { id: "zks",   sym: "z", name: "zkSync Era" },
  { id: "scr",   sym: "S", name: "Scroll" },
  { id: "lin",   sym: "L", name: "Linea" },
  { id: "mnt",   sym: "M", name: "Mantle" },
  { id: "blst",  sym: "B", name: "Blast" },
  { id: "zkevm", sym: "Z", name: "Polygon zkEVM" },
  { id: "ftm",   sym: "F", name: "Fantom" },
  { id: "sei",   sym: "S", name: "Sei" },
  { id: "btc",   sym: "B", name: "Bitcoin" },
  { id: "sol",   sym: "S", name: "Solana" },
  { id: "sui",   sym: "S", name: "Sui" },
  { id: "tron",  sym: "T", name: "Tron" },
  { id: "xrp",   sym: "X", name: "XRP Ledger" },
  { id: "ltc",   sym: "L", name: "Litecoin" },
] as const;

export type ChainId = (typeof CHAINS)[number]["id"];

export function ChainChip({ id, size = 20 }: { id: string; size?: number }) {
  const c = CHAINS.find((x) => x.id === id);
  return (
    <span
      className={`chain-chip c-${id} inline-grid flex-shrink-0 place-items-center rounded-full font-bold text-white`}
      style={{
        width: size,
        height: size,
        fontSize: size < 18 ? 8 : 9,
      }}
      title={c?.name}
    >
      {c?.sym ?? "?"}
    </span>
  );
}

export function ChainStack({
  ids = ["eth", "arb", "base", "opt", "poly"],
  extra = 0,
  size = 20,
}: {
  ids?: string[];
  extra?: number;
  size?: number;
}) {
  return (
    <span className="inline-flex">
      {ids.slice(0, 5).map((id, i) => (
        <span
          key={id}
          style={{
            marginLeft: i === 0 ? 0 : -6,
            border: "2px solid var(--bg)",
            borderRadius: "50%",
            display: "inline-flex",
          }}
        >
          <ChainChip id={id} size={size} />
        </span>
      ))}
      {extra > 0 && (
        <span
          className="inline-grid place-items-center rounded-full"
          style={{
            width: size,
            height: size,
            marginLeft: -6,
            background: "var(--card)",
            color: "var(--muted)",
            border: "2px solid var(--bg)",
            fontSize: 9,
            fontWeight: 700,
          }}
        >
          +{extra}
        </span>
      )}
    </span>
  );
}
