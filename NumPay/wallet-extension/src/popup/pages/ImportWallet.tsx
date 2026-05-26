import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { importFromMnemonic, importFromPrivateKey, encryptAndSave } from "@/lib/wallet";
import { cacheWalletSession } from "../hooks/useWallet";
import { ArrowLeftIcon } from "../components/Icons";

interface Props {
  onComplete: () => void;
}

export default function ImportWallet({ onComplete }: Props) {
  const navigate = useNavigate();
  const [tab, setTab] = useState<"mnemonic" | "privateKey">("mnemonic");
  const [input, setInput] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPw, setConfirmPw] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  async function handleImport() {
    if (password.length < 8) {
      setError("Password must be at least 8 characters");
      return;
    }
    if (password !== confirmPw) {
      setError("Passwords do not match");
      return;
    }
    if (!input.trim()) {
      setError(tab === "mnemonic" ? "Enter your recovery phrase" : "Enter your private key");
      return;
    }

    setError("");
    setLoading(true);
    try {
      const wallet =
        tab === "mnemonic"
          ? importFromMnemonic(input)
          : importFromPrivateKey(input.trim());
      const id = await encryptAndSave(wallet, password, "Wallet 1");
      await cacheWalletSession(wallet, id);
      onComplete();
    } catch (e: any) {
      setError(e.message || "Invalid input");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col h-full bg-surface-0 px-5 py-4 animate-fade-in">
      <button onClick={() => navigate(-1)} className="text-muted hover:text-text-primary mb-5 self-start transition-colors">
        <ArrowLeftIcon size={18} />
      </button>

      <h2 className="text-lg font-bold text-text-primary mb-5">Import Wallet</h2>

      {/* Tabs */}
      <div className="flex bg-surface-1 rounded-xl p-1 mb-5 border border-border">
        <button
          onClick={() => { setTab("mnemonic"); setError(""); }}
          className={`flex-1 py-2 text-[13px] rounded-lg font-medium transition-all duration-150 ${
            tab === "mnemonic" ? "bg-brand-500 text-white" : "text-muted hover:text-text-secondary"
          }`}
        >
          Recovery Phrase
        </button>
        <button
          onClick={() => { setTab("privateKey"); setError(""); }}
          className={`flex-1 py-2 text-[13px] rounded-lg font-medium transition-all duration-150 ${
            tab === "privateKey" ? "bg-brand-500 text-white" : "text-muted hover:text-text-secondary"
          }`}
        >
          Private Key
        </button>
      </div>

      {tab === "mnemonic" ? (
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter your 12-word recovery phrase..."
          rows={3}
          className="input-field mb-3 resize-none"
        />
      ) : (
        <input
          type="password"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Enter your private key (0x...)"
          className="input-field mb-3"
        />
      )}

      <label className="text-xs text-text-secondary mb-1.5 block font-medium">Password</label>
      <input
        type="password"
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        placeholder="At least 8 characters"
        className="input-field mb-3"
      />

      <label className="text-xs text-text-secondary mb-1.5 block font-medium">Confirm Password</label>
      <input
        type="password"
        value={confirmPw}
        onChange={(e) => setConfirmPw(e.target.value)}
        placeholder="Re-enter password"
        className="input-field mb-3"
      />

      {error && <p className="text-accent-red text-xs mb-3 animate-fade-in">{error}</p>}

      <button onClick={handleImport} disabled={loading} className="btn-primary mt-auto">
        {loading ? "Importing..." : "Import Wallet"}
      </button>
    </div>
  );
}
