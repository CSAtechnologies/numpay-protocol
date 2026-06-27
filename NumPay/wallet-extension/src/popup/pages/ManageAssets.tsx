import { useState, useEffect } from "react";
import { ethers } from "ethers";
import Layout from "../components/Layout";
import { NETWORKS } from "@/lib/networks";
import { BPAN_CHAINS } from "@/lib/networks";
import { getCustomTokens, addCustomToken, removeCustomToken, type CustomToken } from "@/lib/customTokens";
import { getCustomChains, saveCustomChain, removeCustomChain, type CustomChain } from "@/lib/customChains";
import { SOL_RPC } from "@/lib/chains/solana";

const ERC20_ABI = [
  "function symbol() view returns (string)",
  "function name() view returns (string)",
  "function decimals() view returns (uint8)",
];

// ── Chain helpers ─────────────────────────────────────────────────────────────

function getAllChainOptions(custom: CustomChain[]) {
  const evm = Object.values(NETWORKS).map((n) => ({
    id: n.id, name: n.name, logo: n.logo, rpcUrl: n.rpcUrl, type: "evm" as const,
  }));
  const nonEvm = [{ id: "solana", name: "Solana", logo: "", rpcUrl: "", type: "solana" as const }];
  const customOpts = custom.map((c) => ({
    id: c.id, name: c.name, logo: c.logo || "", rpcUrl: c.rpcUrl, type: "evm" as const,
  }));
  return [...evm, ...nonEvm, ...customOpts];
}

function chainDisplayName(id: string, custom: CustomChain[]): string {
  if (NETWORKS[id]) return NETWORKS[id].name;
  const bc = BPAN_CHAINS.find((c) => c.id === id);
  if (bc) return bc.name;
  return custom.find((c) => c.id === id)?.name ?? id;
}

// ── Detection helpers ─────────────────────────────────────────────────────────

async function detectEvmToken(rpcUrl: string, address: string) {
  const provider = new ethers.JsonRpcProvider(rpcUrl);
  const contract = new ethers.Contract(address, ERC20_ABI, provider);
  const [symbol, name, decimals] = await Promise.all([
    contract.symbol(), contract.name(), contract.decimals(),
  ]);
  return { symbol: String(symbol).trim(), name: String(name).trim(), decimals: Number(decimals) };
}

async function detectSolanaToken(mint: string) {
  const [dasRes, mintRes] = await Promise.all([
    fetch(SOL_RPC, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAsset", params: { id: mint } }),
    }).then((r) => r.json()).catch(() => null),
    fetch(SOL_RPC, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getAccountInfo", params: [mint, { encoding: "jsonParsed" }] }),
    }).then((r) => r.json()).catch(() => null),
  ]);
  const meta = dasRes?.result?.content?.metadata;
  if (!meta?.symbol) throw new Error("Token not found");
  const decimals = mintRes?.result?.value?.data?.parsed?.info?.decimals ?? 9;
  const logo = dasRes?.result?.content?.links?.image ?? dasRes?.result?.content?.files?.[0]?.cdn_uri;
  return { symbol: String(meta.symbol).trim(), name: String(meta.name || meta.symbol).trim(), decimals: Number(decimals), logo };
}

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

function isLocalHost(host: string): boolean {
  return host === "localhost" || host === "127.0.0.1" || host === "[::1]";
}

// An untrusted RPC can lie about balances, gas, and transaction state, so we
// at least require a secure transport. Plain http is allowed only for local
// dev nodes and only in a development build.
function validateRpcUrl(raw: string): URL {
  let u: URL;
  try {
    u = new URL(raw.trim());
  } catch {
    throw new Error("Enter a valid URL, e.g. https://rpc.example.com");
  }
  if (u.protocol === "https:") return u;
  if (u.protocol === "http:" && isLocalHost(u.hostname) && import.meta.env.DEV) return u;
  if (u.protocol === "http:") {
    throw new Error("RPC URL must use https:// (plain http is insecure).");
  }
  throw new Error("RPC URL must use https://");
}

// Request access to the custom RPC origin at runtime (granted from the
// optional_host_permissions declared in the manifest) so fetches succeed under
// the narrowed default host permissions.
async function requestRpcHostPermission(u: URL): Promise<void> {
  try {
    if (typeof chrome === "undefined" || !chrome.permissions) return;
    const origins = [`${u.origin}/*`];
    if (await chrome.permissions.contains({ origins })) return;
    await chrome.permissions.request({ origins });
  } catch { /* permission flow unavailable (e.g. dev web build) */ }
}

// ── Subcomponents ─────────────────────────────────────────────────────────────

function XIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
      <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}

interface TokenPreview {
  symbol: string; name: string; decimals: number; logo?: string;
}

// ── Main component ────────────────────────────────────────────────────────────

export default function ManageAssets() {
  const [tab, setTab] = useState<"tokens" | "networks">("tokens");
  const [customTokens, setCustomTokens] = useState<CustomToken[]>([]);
  const [customNetworks, setCustomNetworks] = useState<CustomChain[]>([]);

  useEffect(() => {
    Promise.all([getCustomTokens(), getCustomChains()]).then(([toks, nets]) => {
      setCustomTokens(toks);
      setCustomNetworks(nets);
    });
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
        result = await detectEvmToken(selectedChainOpt.rpcUrl, addr);
      }
      setPreview(result);
    } catch (e: any) {
      setDetectErr(e.message?.includes("could not decode") || e.message?.includes("call revert")
        ? "Not a valid token contract on this chain."
        : e.message || "Detection failed.");
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
  const [netDecimals, setNetDecimals] = useState(18);
  const [netExplorer, setNetExplorer] = useState("");
  const [netDetecting, setNetDetecting] = useState(false);
  const [netDetectErr, setNetDetectErr] = useState("");
  const [netAdding, setNetAdding] = useState(false);
  const [netAddErr, setNetAddErr] = useState("");

  async function handleDetectChain() {
    setNetDetecting(true); setNetDetectErr("");
    try {
      const u = validateRpcUrl(netRpc);
      await requestRpcHostPermission(u);
      const id = await detectChainId(u.toString());
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
      const u = validateRpcUrl(netRpc);

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

      await requestRpcHostPermission(u);

      const chain: CustomChain = {
        id: `custom_${netChainId}_${Date.now()}`,
        name: netName.trim(), chainId: netChainId,
        rpcUrl: u.toString(), symbol: netSymbol.trim(),
        decimals: netDecimals, explorer: netExplorer.trim(),
      };
      await saveCustomChain(chain);
      setCustomNetworks((prev) => [...prev, chain]);
      setNetName(""); setNetRpc(""); setNetChainId(null);
      setNetSymbol(""); setNetDecimals(18); setNetExplorer("");
    } catch (e: any) {
      setNetAddErr(e.message || "Failed to save.");
    } finally { setNetAdding(false); }
  }

  async function handleRemoveNetwork(id: string) {
    await removeCustomChain(id);
    setCustomNetworks((prev) => prev.filter((c) => c.id !== id));
  }

  return (
    <Layout title="Manage Assets" showBack showNav={false}>
      <div className="min-h-full" style={{ background: "var(--surface-0)" }}>

        {/* Tab bar */}
        <div className="px-4 pt-3 pb-0">
          <div className="flex gap-0 border-b border-surface-3/40">
            {(["tokens", "networks"] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTab(t)}
                className={`px-4 py-2.5 text-[13px] font-semibold capitalize relative transition-colors ${
                  tab === t ? "text-brand-400" : "text-muted hover:text-text-secondary"
                }`}
              >
                {t}
                {tab === t && (
                  <span className="absolute bottom-0 left-0 right-0 h-[2px] bg-brand-400 rounded-full" />
                )}
              </button>
            ))}
          </div>
        </div>

        {/* ── Tokens tab ──────────────────────────────────────────────────────── */}
        {tab === "tokens" && (
          <div className="px-4 pt-4 space-y-5 pb-6">

            <p className="text-[12px] text-muted leading-relaxed">
              Tokens with a balance are auto-detected. Use this to manually add any token that isn't showing up.
            </p>

            {/* Chain selector */}
            <div className="premium-card p-3 space-y-3">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Chain</p>
              <div className="grid grid-cols-3 gap-1.5 max-h-[110px] overflow-y-auto">
                {chainOptions.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => { setChain(c.id); setPreview(null); setDetectErr(""); }}
                    className={`flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all truncate ${
                      chain === c.id
                        ? "bg-brand-500/20 text-brand-400 ring-1 ring-brand-500/30"
                        : "text-muted hover:bg-surface-3 hover:text-text-secondary"
                    }`}
                  >
                    {c.logo ? (
                      <img src={c.logo} alt="" className="w-[14px] h-[14px] rounded-full flex-shrink-0"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                    ) : (
                      <div className="w-[14px] h-[14px] rounded-full bg-surface-3 flex-shrink-0" />
                    )}
                    <span className="truncate">{c.name}</span>
                  </button>
                ))}
              </div>
            </div>

            {/* Address input */}
            <div className="space-y-2">
              <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">
                {chain === "solana" ? "Mint Address" : "Contract Address"}
              </p>
              <div className="flex gap-2">
                <input
                  value={tokenAddr}
                  onChange={(e) => { setTokenAddr(e.target.value); setPreview(null); setDetectErr(""); }}
                  onKeyDown={(e) => e.key === "Enter" && handleDetect()}
                  placeholder={chain === "solana" ? "Paste mint address..." : "0x..."}
                  className="input-field flex-1 text-[12px] font-mono"
                />
                <button
                  onClick={handleDetect}
                  disabled={detecting || !tokenAddr.trim()}
                  className="px-3 py-2 rounded-xl bg-brand-500/15 text-brand-400 text-[12px] font-semibold hover:bg-brand-500/25 transition-colors disabled:opacity-40 flex-shrink-0"
                >
                  {detecting ? (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 border border-brand-400 border-t-transparent rounded-full animate-spin inline-block" />
                      Detecting
                    </span>
                  ) : "Detect"}
                </button>
              </div>
              {detectErr && <p className="text-accent-red text-[12px]">{detectErr}</p>}
            </div>

            {/* Token preview card */}
            {preview && (
              <div className="premium-card p-3.5 flex items-center gap-3 animate-slide-up">
                {preview.logo ? (
                  <img src={preview.logo} alt={preview.symbol}
                    className="w-10 h-10 rounded-full flex-shrink-0 object-cover"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = "none"; }} />
                ) : (
                  <div className="w-10 h-10 rounded-full bg-gradient-to-br from-brand-500/30 to-brand-600/20 flex items-center justify-center flex-shrink-0">
                    <span className="text-[14px] font-bold text-brand-400">
                      {preview.symbol.slice(0, 2).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <p className="text-[14px] font-bold text-text-primary">{preview.symbol}</p>
                  <p className="text-[12px] text-muted truncate">{preview.name}</p>
                  <p className="text-[11px] text-muted/60 mt-0.5">{chainDisplayName(chain, customNetworks)} · {preview.decimals} decimals</p>
                </div>
                <button
                  onClick={handleAddToken}
                  disabled={adding}
                  className="btn-primary-premium text-[12px] px-4 py-2 flex-shrink-0 disabled:opacity-50"
                >
                  {adding ? "Adding..." : "Add"}
                </button>
              </div>
            )}

            {/* Custom token list */}
            {customTokens.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Custom Tokens</p>
                {customTokens.map((t) => (
                  <div key={t.id} className="flex items-center gap-3 px-3 py-2.5 premium-card">
                    <div className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0">
                      <span className="text-[11px] font-bold text-muted">{t.symbol.slice(0, 2)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-text-primary">{t.symbol}</p>
                      <p className="text-[10px] text-muted">
                        {chainDisplayName(t.chainId, customNetworks)} ·{" "}
                        <span className="font-mono">{t.address.slice(0, 6)}...{t.address.slice(-4)}</span>
                      </p>
                    </div>
                    <button
                      onClick={() => handleRemoveToken(t.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                    >
                      <XIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {customTokens.length === 0 && !preview && (
              <div className="text-center py-6 text-muted text-[12px]">
                No custom tokens added yet
              </div>
            )}
          </div>
        )}

        {/* ── Networks tab ────────────────────────────────────────────────────── */}
        {tab === "networks" && (
          <div className="px-4 pt-4 space-y-4 pb-6">
            <p className="text-[12px] text-muted leading-relaxed">
              Add any EVM-compatible network. Paste the RPC URL, then tap Detect to fill the Chain ID automatically.
            </p>
            <p className="text-[11px] leading-relaxed" style={{ color: "#f5b301" }}>
              Only add RPC endpoints you trust. A malicious RPC can report fake balances, gas, and transaction results. Use https:// URLs.
            </p>

            <div className="premium-card p-3.5 space-y-3">
              {/* RPC URL with detect */}
              <div>
                <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">RPC URL</label>
                <div className="flex gap-2">
                  <input
                    value={netRpc}
                    onChange={(e) => { setNetRpc(e.target.value); setNetChainId(null); setNetDetectErr(""); }}
                    placeholder="https://rpc.example.com"
                    className="input-field flex-1 text-[12px]"
                  />
                  <button
                    onClick={handleDetectChain}
                    disabled={netDetecting || !netRpc.trim()}
                    className="px-3 py-2 rounded-xl bg-brand-500/15 text-brand-400 text-[12px] font-semibold hover:bg-brand-500/25 transition-colors disabled:opacity-40 flex-shrink-0"
                  >
                    {netDetecting ? (
                      <span className="w-3 h-3 border border-brand-400 border-t-transparent rounded-full animate-spin inline-block" />
                    ) : "Detect"}
                  </button>
                </div>
                {netDetectErr && <p className="text-accent-red text-[11px] mt-1">{netDetectErr}</p>}
              </div>

              {/* Chain ID badge */}
              {netChainId && (
                <div className="flex items-center gap-2 px-3 py-2 bg-accent-green/10 rounded-xl border border-accent-green/20">
                  <div className="w-1.5 h-1.5 rounded-full bg-accent-green" />
                  <span className="text-[12px] text-accent-green font-medium">Chain ID: {netChainId}</span>
                </div>
              )}

              {/* Name */}
              <div>
                <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">Network Name</label>
                <input
                  value={netName}
                  onChange={(e) => setNetName(e.target.value)}
                  placeholder="e.g. Base Sepolia"
                  className="input-field text-[13px]"
                />
              </div>

              {/* Symbol + Decimals */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">Symbol</label>
                  <input
                    value={netSymbol}
                    onChange={(e) => setNetSymbol(e.target.value)}
                    placeholder="ETH"
                    className="input-field text-[13px]"
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">Decimals</label>
                  <input
                    value={netDecimals}
                    onChange={(e) => setNetDecimals(parseInt(e.target.value) || 18)}
                    type="number"
                    placeholder="18"
                    className="input-field text-[13px]"
                  />
                </div>
              </div>

              {/* Explorer */}
              <div>
                <label className="block text-[11px] font-semibold text-muted uppercase tracking-wider mb-1.5">Block Explorer <span className="normal-case font-normal">(optional)</span></label>
                <input
                  value={netExplorer}
                  onChange={(e) => setNetExplorer(e.target.value)}
                  placeholder="https://explorer.example.com"
                  className="input-field text-[13px]"
                />
              </div>

              {netAddErr && <p className="text-accent-red text-[12px]">{netAddErr}</p>}

              <button
                onClick={handleAddNetwork}
                disabled={netAdding || !netChainId}
                className="btn-primary-premium w-full text-[13px] disabled:opacity-40"
              >
                {netAdding ? "Saving..." : "Add Network"}
              </button>
            </div>

            {/* Custom network list */}
            {customNetworks.length > 0 && (
              <div className="space-y-2">
                <p className="text-[11px] font-semibold text-muted uppercase tracking-wider">Custom Networks</p>
                {customNetworks.map((c) => (
                  <div key={c.id} className="flex items-center gap-3 px-3 py-2.5 premium-card">
                    <div className="w-8 h-8 rounded-full bg-surface-3 flex items-center justify-center flex-shrink-0">
                      <span className="text-[11px] font-bold text-muted">{c.symbol.slice(0, 2)}</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-[13px] font-semibold text-text-primary">{c.name}</p>
                      <p className="text-[11px] text-muted">{c.symbol} · Chain ID {c.chainId}</p>
                    </div>
                    <button
                      onClick={() => handleRemoveNetwork(c.id)}
                      className="w-7 h-7 flex items-center justify-center rounded-lg text-muted hover:text-accent-red hover:bg-accent-red/10 transition-colors"
                    >
                      <XIcon />
                    </button>
                  </div>
                ))}
              </div>
            )}

            {customNetworks.length === 0 && (
              <div className="text-center py-4 text-muted text-[12px]">
                No custom networks added yet
              </div>
            )}
          </div>
        )}
      </div>
    </Layout>
  );
}
