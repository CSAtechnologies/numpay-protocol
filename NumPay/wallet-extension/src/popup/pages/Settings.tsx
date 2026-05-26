import { useState } from "react";
import {
  lockWallet, deleteWallet, deleteOneWallet,
  addEncryptedWallet, createWallet, importFromMnemonic, importFromPrivateKey,
  getActiveId, type VaultMeta,
} from "@/lib/wallet";
import { CURRENCIES } from "@/lib/currency";
import { useWallet } from "../hooks/useWallet";
import { useCurrency } from "../hooks/useCurrency";
import { useTheme } from "../hooks/useTheme";
import { getItem, setItem, removeItem } from "@/lib/storage";
import Layout from "../components/Layout";
import { LockIcon, CopyIcon, CheckIcon, ShieldIcon, SearchIcon, ChevronDownIcon, SunIcon, MoonIcon } from "../components/Icons";

interface Props {
  onLock: () => void;
  onReset: () => void;
}

export default function Settings({ onLock, onReset }: Props) {
  const { wallet, network, walletMetas, activeWalletId, switchActiveWallet, addWalletToSession, removeWalletMeta } = useWallet();
  const { currencyCode, currency, setCurrency } = useCurrency();
  const { theme, toggleTheme } = useTheme();
  const [showPrivateKey, setShowPrivateKey] = useState(false);
  const [showMnemonic, setShowMnemonic] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
  const [copied, setCopied] = useState("");
  const [showCurrencyPicker, setShowCurrencyPicker] = useState(false);
  const [currencySearch, setCurrencySearch] = useState("");

  // Add wallet form state
  const [showAddWallet, setShowAddWallet] = useState(false);
  const [addTab, setAddTab] = useState<"create" | "import">("create");
  const [addName, setAddName] = useState("");
  const [addInput, setAddInput] = useState("");
  const [addPassword, setAddPassword] = useState("");
  const [addError, setAddError] = useState("");
  const [addLoading, setAddLoading] = useState(false);

  async function handleLock() {
    await lockWallet();
    onLock();
  }

  async function handleReset() {
    await deleteWallet();
    await removeItem("numpay_session");
    await removeItem("numpay_network");
    onReset();
  }

  async function handleAddWallet() {
    setAddError("");
    setAddLoading(true);
    try {
      let walletData;
      if (addTab === "create") {
        walletData = createWallet();
      } else {
        const raw = addInput.trim();
        if (!raw) throw new Error("Enter a recovery phrase or private key");
        walletData = raw.includes(" ") ? importFromMnemonic(raw) : importFromPrivateKey(raw);
      }
      const name = addName.trim() || `Wallet ${walletMetas.length + 1}`;
      const id = await addEncryptedWallet(walletData, addPassword, name);
      const meta: VaultMeta = { id, name, address: walletData.address };
      await addWalletToSession(walletData, id, meta);
      setShowAddWallet(false);
      setAddName(""); setAddInput(""); setAddPassword("");
    } catch (e: any) {
      setAddError(e.message || "Failed to add wallet");
    } finally {
      setAddLoading(false);
    }
  }

  async function handleRemoveWallet(id: string) {
    const remaining = await deleteOneWallet(id);

    if (remaining === 0) {
      await removeItem("numpay_session");
      await removeItem("numpay_network");
      onReset();
      return;
    }

    // Remove from session
    const raw = await getItem("numpay_session");
    if (raw) {
      try {
        const session = JSON.parse(raw);
        delete session.wallets[id];
        if (session.activeId === id) {
          const newId = await getActiveId();
          session.activeId = newId ?? Object.keys(session.wallets)[0];
        }
        await setItem("numpay_session", JSON.stringify(session));
      } catch {}
    }

    removeWalletMeta(id);
    setConfirmRemoveId(null);

    if (id === activeWalletId) {
      const newId = await getActiveId();
      if (newId) await switchActiveWallet(newId);
    }
  }

  async function copyText(text: string, label: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = document.createElement("textarea");
      ta.value = text;
      ta.style.position = "fixed";
      ta.style.opacity = "0";
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      document.body.removeChild(ta);
    }
    setCopied(label);
    setTimeout(() => setCopied(""), 2000);
  }

  // Convert a flag emoji (e.g. 🇺🇸) to its ISO 3166-1 country code ("us")
  // so we can load a real flag image instead of relying on OS emoji support.
  function flagUrl(emoji: string): string {
    const code = [...emoji]
      .map((ch) => String.fromCharCode(ch.codePointAt(0)! - 0x1F1A5))
      .join("")
      .toLowerCase();
    return `https://flagcdn.com/20x15/${code}.png`;
  }

  const filteredCurrencies = CURRENCIES.filter((c) => {
    const q = currencySearch.toLowerCase();
    return c.name.toLowerCase().includes(q) || c.code.includes(q) || c.symbol.toLowerCase().includes(q);
  });

  return (
    <Layout>
      <div className="app-bg min-h-full">
      <div className="px-4 py-4">
        <h2 className="text-lg font-bold text-text-primary mb-5">Settings</h2>

        {/* Currency */}
        <p className="section-label mb-2">Display Currency</p>
        <button
          onClick={() => { setShowCurrencyPicker(!showCurrencyPicker); setCurrencySearch(""); }}
          className="w-full premium-card px-3.5 py-3 mb-1.5 text-left hover:bg-surface-2 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              {currency?.logo ? (
                <img src={currency.logo} alt={currency.name} className="w-5 h-5 rounded-full flex-shrink-0" />
              ) : currency?.flag ? (
                <img src={flagUrl(currency.flag)} alt={currency.name} width={20} height={15} className="rounded-sm flex-shrink-0" />
              ) : (
                <span className="text-xs font-bold text-brand-400 flex-shrink-0">{currency?.symbol}</span>
              )}
              <div>
                <span className="text-[13px] text-text-primary font-medium">{currency?.name || currencyCode.toUpperCase()}</span>
                <span className="text-xs text-muted ml-1.5">({currency?.symbol || currencyCode.toUpperCase()})</span>
              </div>
            </div>
            <ChevronDownIcon size={14} className={`text-muted transition-transform duration-200 ${showCurrencyPicker ? "rotate-180" : ""}`} />
          </div>
        </button>

        {showCurrencyPicker && (
          <div className="mb-3 premium-card overflow-hidden animate-slide-up">
            <div className="relative border-b border-border">
              <SearchIcon size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={currencySearch}
                onChange={(e) => setCurrencySearch(e.target.value)}
                placeholder="Search currencies..."
                className="w-full pl-9 pr-3 py-2.5 bg-transparent text-[13px] text-text-primary outline-none placeholder:text-muted/60"
                autoFocus
              />
            </div>
            <div className="max-h-[240px] overflow-y-auto">
              {filteredCurrencies.map((c) => (
                <button
                  key={c.code}
                  onClick={() => { setCurrency(c.code); setShowCurrencyPicker(false); }}
                  className={`w-full flex items-center gap-2.5 px-3.5 py-2 text-[13px] hover:bg-surface-2 transition-colors ${
                    c.code === currencyCode ? "text-brand-400" : "text-text-primary"
                  }`}
                >
                  {c.logo ? (
                    <img src={c.logo} alt={c.name} className="w-5 h-5 rounded-full flex-shrink-0" />
                  ) : c.flag ? (
                    <img src={flagUrl(c.flag)} alt={c.name} width={20} height={15} className="rounded-sm flex-shrink-0" />
                  ) : (
                    <span className="text-xs font-bold text-brand-400 w-6 text-center flex-shrink-0">{c.symbol}</span>
                  )}
                  <span className="font-medium flex-1 text-left">{c.name}</span>
                  <span className="text-xs text-muted">{c.code.toUpperCase()}</span>
                  {c.code === currencyCode && <CheckIcon size={14} className="text-brand-400 ml-1" />}
                </button>
              ))}
              {filteredCurrencies.length === 0 && (
                <p className="text-xs text-muted text-center py-4">No currencies found</p>
              )}
            </div>
          </div>
        )}

        {/* Theme */}
        <p className="section-label mb-2 mt-4">Appearance</p>
        <div className="premium-card px-3.5 py-3 mb-5">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              {theme === "dark" ? <MoonIcon size={14} className="text-brand-400" /> : <SunIcon size={14} className="text-accent-amber" />}
              <span className="text-[13px] text-text-primary font-medium">{theme === "dark" ? "Dark Mode" : "Light Mode"}</span>
            </div>
            <button
              onClick={toggleTheme}
              className={`w-11 h-6 rounded-full transition-colors duration-200 relative ${
                theme === "light" ? "bg-brand-500" : "bg-surface-4"
              }`}
            >
              <div
                className={`absolute top-[3px] rounded-full bg-white shadow transition-transform duration-200 ${
                  theme === "light" ? "translate-x-[22px]" : "translate-x-[3px]"
                }`}
                style={{ width: 18, height: 18 }}
              />
            </button>
          </div>
        </div>

        {/* Accounts */}
        <p className="section-label mb-2 mt-4">Accounts</p>
        <div className="space-y-1.5 mb-2">
          {walletMetas.map((meta) => (
            <div key={meta.id}>
              <div
                className={`premium-card px-3.5 py-2.5 flex items-center gap-2.5 ${
                  meta.id === activeWalletId ? "border border-brand-500/30" : ""
                }`}
              >
                <div
                  className="w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold text-white flex-shrink-0"
                  style={{ background: "linear-gradient(135deg, var(--brand-500), var(--brand-600))" }}
                >
                  {meta.name.charAt(0).toUpperCase()}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-[13px] font-medium text-text-primary truncate">{meta.name}</p>
                  <p className="text-[10px] text-muted font-mono">
                    {meta.address ? `${meta.address.slice(0, 6)}…${meta.address.slice(-4)}` : "—"}
                  </p>
                </div>
                <div className="flex items-center gap-1">
                  {meta.id === activeWalletId ? (
                    <span className="text-[10px] text-brand-400 font-medium">Active</span>
                  ) : (
                    <button
                      onClick={() => switchActiveWallet(meta.id)}
                      className="text-[11px] text-brand-400 hover:text-brand-300 font-medium px-2 py-1 rounded-lg hover:bg-brand-500/10 transition-colors"
                    >
                      Switch
                    </button>
                  )}
                  {walletMetas.length > 1 && (
                    <button
                      onClick={() => setConfirmRemoveId(meta.id)}
                      className="text-[11px] text-muted hover:text-accent-red font-medium px-2 py-1 rounded-lg hover:bg-accent-red/5 transition-colors"
                    >
                      Remove
                    </button>
                  )}
                </div>
              </div>

              {confirmRemoveId === meta.id && (
                <div className="mt-1 px-3.5 py-2.5 rounded-xl bg-accent-red/5 border border-accent-red/15 animate-slide-up">
                  <p className="text-xs text-accent-red mb-2">Remove &ldquo;{meta.name}&rdquo;? Make sure you have the recovery phrase backed up.</p>
                  <div className="flex gap-2">
                    <button onClick={() => setConfirmRemoveId(null)} className="flex-1 py-1.5 rounded-lg bg-surface-2 text-text-secondary text-[12px] border border-border">Cancel</button>
                    <button onClick={() => handleRemoveWallet(meta.id)} className="flex-1 py-1.5 rounded-lg bg-accent-red text-white text-[12px] font-semibold">Remove</button>
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add wallet */}
        {!showAddWallet ? (
          <button
            onClick={() => { setShowAddWallet(true); setAddError(""); }}
            className="w-full premium-card px-3.5 py-2.5 mb-5 text-left hover:bg-surface-2 transition-colors flex items-center gap-2"
          >
            <span className="text-brand-400 text-base leading-none font-bold">+</span>
            <span className="text-[13px] text-brand-400 font-medium">Add Account</span>
          </button>
        ) : (
          <div className="mb-5 premium-card px-3.5 py-3 space-y-2.5 animate-slide-up">
            <p className="text-[13px] font-semibold text-text-primary">Add Account</p>

            <div className="flex bg-surface-1 rounded-xl p-1 border border-border">
              <button
                onClick={() => setAddTab("create")}
                className={`flex-1 py-1.5 text-[12px] rounded-lg font-medium transition-all ${addTab === "create" ? "bg-brand-500 text-white" : "text-muted"}`}
              >
                Create New
              </button>
              <button
                onClick={() => setAddTab("import")}
                className={`flex-1 py-1.5 text-[12px] rounded-lg font-medium transition-all ${addTab === "import" ? "bg-brand-500 text-white" : "text-muted"}`}
              >
                Import
              </button>
            </div>

            <input
              value={addName}
              onChange={(e) => setAddName(e.target.value)}
              placeholder={`Wallet ${walletMetas.length + 1}`}
              className="input-field"
            />

            {addTab === "import" && (
              <textarea
                value={addInput}
                onChange={(e) => setAddInput(e.target.value)}
                placeholder="Recovery phrase or private key"
                rows={2}
                className="input-field resize-none"
              />
            )}

            <input
              type="password"
              value={addPassword}
              onChange={(e) => setAddPassword(e.target.value)}
              placeholder="Your wallet password"
              className="input-field"
            />

            {addError && <p className="text-accent-red text-xs">{addError}</p>}

            <div className="flex gap-2">
              <button
                onClick={() => { setShowAddWallet(false); setAddError(""); setAddInput(""); setAddPassword(""); setAddName(""); }}
                className="flex-1 py-2 rounded-lg bg-surface-2 text-text-secondary text-[12px] border border-border"
              >
                Cancel
              </button>
              <button
                onClick={handleAddWallet}
                disabled={addLoading}
                className="flex-1 btn-primary-premium text-[12px]"
              >
                {addLoading ? "Adding…" : "Add"}
              </button>
            </div>
          </div>
        )}

        {/* Wallet */}
        <p className="section-label mb-2">Wallet</p>
        <div className="premium-card px-3.5 py-3 mb-1.5">
          <div className="flex items-center justify-between mb-1">
            <p className="text-[11px] text-muted font-medium">Address</p>
            <button onClick={() => wallet && copyText(wallet.address, "address")} className="p-1 text-muted hover:text-brand-400 transition-colors">
              {copied === "address" ? <CheckIcon size={12} className="text-accent-green" /> : <CopyIcon size={12} />}
            </button>
          </div>
          <p className="text-xs font-mono text-text-primary break-all">{wallet?.address || "---"}</p>
        </div>

        <div className="premium-card px-3.5 py-3 mb-5">
          <p className="text-[11px] text-muted font-medium mb-1">Network</p>
          <p className="text-[13px] text-text-primary font-medium">{network.name} ({network.symbol})</p>
        </div>

        {/* Security */}
        <p className="section-label mb-2">Security</p>

        <button
          onClick={() => setShowPrivateKey(!showPrivateKey)}
          className="w-full premium-card px-3.5 py-3 mb-1.5 text-left hover:bg-surface-2 transition-colors"
        >
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <ShieldIcon size={14} className="text-accent-amber" />
              <span className="text-[13px] text-text-primary font-medium">Private Key</span>
            </div>
            <span className="text-xs text-muted">{showPrivateKey ? "Hide" : "Reveal"}</span>
          </div>
        </button>
        {showPrivateKey && (
          <div className="mb-1.5 px-3.5 py-3 rounded-xl bg-accent-red/5 border border-accent-red/10 animate-slide-up">
            <p className="text-[11px] text-accent-red mb-1.5 font-medium">Never share your private key!</p>
            <div className="flex items-start justify-between gap-2">
              <p className="text-[11px] font-mono text-text-primary break-all select-all leading-relaxed">
                {wallet?.privateKey || "---"}
              </p>
              <button onClick={() => wallet && copyText(wallet.privateKey, "pk")} className="p-1 text-muted hover:text-text-primary flex-shrink-0">
                {copied === "pk" ? <CheckIcon size={12} className="text-accent-green" /> : <CopyIcon size={12} />}
              </button>
            </div>
          </div>
        )}

        {wallet?.mnemonic && (
          <>
            <button
              onClick={() => setShowMnemonic(!showMnemonic)}
              className="w-full premium-card px-3.5 py-3 mb-1.5 text-left hover:bg-surface-2 transition-colors"
            >
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <ShieldIcon size={14} className="text-accent-amber" />
                  <span className="text-[13px] text-text-primary font-medium">Recovery Phrase</span>
                </div>
                <span className="text-xs text-muted">{showMnemonic ? "Hide" : "Reveal"}</span>
              </div>
            </button>
            {showMnemonic && (
              <div className="mb-1.5 px-3.5 py-3 rounded-xl bg-accent-red/5 border border-accent-red/10 animate-slide-up">
                <p className="text-[11px] text-accent-red mb-1.5 font-medium">Never share your recovery phrase!</p>
                <div className="flex items-start justify-between gap-2">
                  <p className="text-[11px] font-mono text-text-primary break-all select-all leading-relaxed">
                    {wallet.mnemonic}
                  </p>
                  <button onClick={() => copyText(wallet.mnemonic, "mn")} className="p-1 text-muted hover:text-text-primary flex-shrink-0">
                    {copied === "mn" ? <CheckIcon size={12} className="text-accent-green" /> : <CopyIcon size={12} />}
                  </button>
                </div>
              </div>
            )}
          </>
        )}

        {/* Actions */}
        <div className="mt-5 space-y-2">
          <button onClick={handleLock} className="btn-secondary text-[13px]">
            <LockIcon size={14} />
            Lock Wallet
          </button>

          {!confirmReset ? (
            <button
              onClick={() => setConfirmReset(true)}
              className="w-full py-3 rounded-xl bg-accent-red/5 hover:bg-accent-red/10 text-accent-red font-semibold text-[13px] border border-accent-red/15 transition-colors"
            >
              Reset Wallet
            </button>
          ) : (
            <div className="p-3.5 rounded-xl bg-accent-red/5 border border-accent-red/15 animate-slide-up">
              <p className="text-xs text-accent-red mb-2.5 leading-relaxed">
                This will permanently delete your wallet from this device. Make sure you have your recovery phrase backed up.
              </p>
              <div className="flex gap-2">
                <button onClick={() => setConfirmReset(false)} className="flex-1 py-2 rounded-lg bg-surface-2 text-text-primary text-[13px] font-medium border border-border">
                  Cancel
                </button>
                <button onClick={handleReset} className="flex-1 py-2 rounded-lg bg-accent-red text-white text-[13px] font-semibold">
                  Delete
                </button>
              </div>
            </div>
          )}
        </div>

        <p className="text-center text-[10px] text-muted/40 mt-6">NumPay v0.1.0</p>
      </div>
      </div>
    </Layout>
  );
}
