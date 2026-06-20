import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { ethers } from "ethers";
import { NETWORKS } from "@/lib/networks";
import {
  isLocked,
  unlockActiveVault,
  touchActivity,
  SESSION_KEY,
  type WalletData,
} from "@/lib/wallet";
import { setSession, getSession } from "@/lib/storage";
import {
  MSG_DAPP_DECISION,
  type DappPending,
  type PendingConnect,
  type PendingSign,
} from "@/lib/dapp/types";
import {
  decodePersonalSignMessage,
  parseTypedData,
  assessTypedDataRisk,
  typesForEthers,
  type RiskFlag,
} from "@/lib/dapp/signDecode";
import PasswordPrompt from "../popup/components/PasswordPrompt";
import "../popup/index.css";

document.documentElement.setAttribute(
  "data-theme",
  localStorage.getItem("numpay_theme") || "dark"
);

const PENDING_PFX = "numpay_dapp_pending_";

function chainName(chainId: number): string {
  const net = Object.values(NETWORKS).find((n) => n.chainId === chainId);
  return net ? net.name : `Chain ${chainId}`;
}

// Read the active wallet (with its key) out of the unlocked session. Under
// decrypt-only-active this is the ONLY wallet whose key is present, which is
// exactly the account a signature is allowed to be bound to.
async function getActiveSessionWallet(): Promise<WalletData | null> {
  const raw = await getSession(SESSION_KEY);
  if (!raw) return null;
  try {
    const p = JSON.parse(raw);
    if (p.wallets && p.activeId) return (p.wallets[p.activeId] as WalletData) ?? null;
    if (p.address) return p as WalletData; // legacy single-wallet session
  } catch {
    /* malformed session */
  }
  return null;
}

function App() {
  const requestId = new URLSearchParams(location.search).get("requestId") || "";
  const [pending, setPending] = useState<DappPending | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [locked, setLocked] = useState(true);
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    (async () => {
      const key = PENDING_PFX + requestId;
      const got = (await chrome.storage.session.get(key))[key] as DappPending | undefined;
      if (!got) { setNotFound(true); return; }
      setPending(got);
      setLocked(await isLocked());
    })();
  }, [requestId]);

  // If the user closes the window without deciding, reject so the dApp promise
  // settles instead of hanging.
  useEffect(() => {
    const onUnload = () => {
      if (!decided) {
        try { chrome.runtime.sendMessage({ type: MSG_DAPP_DECISION, requestId, approved: false }); } catch {}
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [decided, requestId]);

  function decide(approved: boolean, signature?: string) {
    setDecided(true);
    try {
      chrome.runtime.sendMessage({ type: MSG_DAPP_DECISION, requestId, approved, signature });
    } catch {}
    window.close();
  }

  async function unlock(password: string) {
    const { id, wallet } = await unlockActiveVault(password);
    await setSession(SESSION_KEY, JSON.stringify({ activeId: id, wallets: { [id]: wallet } }));
    await touchActivity();
    setLocked(false);
  }

  if (notFound) {
    return (
      <div className="app-bg h-full flex items-center justify-center p-6">
        <p className="text-sm text-muted text-center">
          This request has expired. Close this window and try again from the site.
        </p>
      </div>
    );
  }

  if (!pending) {
    return (
      <div className="app-bg h-full flex items-center justify-center">
        <div className="w-6 h-6 border-2 border-brand-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (locked) {
    return (
      <PasswordPrompt
        title="Unlock NumPay"
        subtitle={
          pending.type === "sign"
            ? "Unlock your wallet to review this signature request."
            : "Unlock your wallet to review this connection request."
        }
        actionLabel="Unlock"
        onCancel={() => decide(false)}
        onSubmit={unlock}
      />
    );
  }

  return pending.type === "sign" ? (
    <SignView pending={pending} onDecide={decide} />
  ) : (
    <ConnectView pending={pending} onDecide={decide} />
  );
}

// ── Connect ─────────────────────────────────────────────────────────────────────

function ConnectView({
  pending,
  onDecide,
}: {
  pending: PendingConnect;
  onDecide: (approved: boolean) => void;
}) {
  return (
    <div className="app-bg min-h-full flex flex-col">
      <div className="px-5 pt-6 pb-4 flex-1">
        <div className="flex flex-col items-center text-center mb-6">
          <img src="/logo.png" alt="NumPay" className="w-12 h-12 mb-3" />
          <h1 className="text-[17px] font-bold text-text-primary">Connection request</h1>
          <p className="text-[12px] text-muted mt-1 break-all">{pending.origin}</p>
        </div>

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-2">This site will be able to</p>
          <ul className="text-[12px] text-text-secondary space-y-1.5 list-disc pl-4">
            <li>See your wallet address and balance</li>
            <li>Ask you to approve transactions and signatures</li>
          </ul>
          <p className="text-[11px] text-muted mt-2">It cannot move funds without your approval each time.</p>
        </div>

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">Account</p>
          <p className="text-[12px] font-mono text-text-primary break-all">{pending.account}</p>
          <p className="text-[11px] text-muted mt-2">Network: <span className="text-brand-400 font-medium">{chainName(pending.chainId)}</span></p>
        </div>
      </div>

      <div className="px-5 pb-6 flex gap-2">
        <button
          onClick={() => onDecide(false)}
          className="flex-1 py-2.5 rounded-xl bg-surface-2 text-text-secondary text-[13px] font-medium border border-border hover:bg-surface-3 transition-colors"
        >
          Reject
        </button>
        <button onClick={() => onDecide(true)} className="flex-1 btn-primary-premium text-[13px]">
          Connect
        </button>
      </div>
    </div>
  );
}

// ── Sign ─────────────────────────────────────────────────────────────────────────

function SignView({
  pending,
  onDecide,
}: {
  pending: PendingSign;
  onDecide: (approved: boolean, signature?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const isPersonal = pending.method === "personal_sign";
  const decoded = isPersonal ? decodePersonalSignMessage(pending.payload) : null;
  const parsed = !isPersonal ? parseTypedData(pending.payload) : null;
  const risk: RiskFlag[] =
    parsed && parsed.ok ? assessTypedDataRisk(parsed, pending.chainId) : [];

  async function approve() {
    setError(null);
    setBusy(true);
    try {
      const wd = await getActiveSessionWallet();
      if (!wd) {
        setError("Wallet is locked. Close and retry.");
        setBusy(false);
        return;
      }
      // Re-bind to the requested account at sign time. If the user switched the
      // active wallet while this window was open, refuse rather than sign with a
      // different key than the dApp asked for.
      let sameAccount = false;
      try {
        sameAccount = ethers.getAddress(wd.address) === ethers.getAddress(pending.account);
      } catch {
        sameAccount = false;
      }
      if (!sameAccount) {
        setError("Active wallet changed. Reject and retry from the site.");
        setBusy(false);
        return;
      }

      const wallet = new ethers.Wallet(wd.privateKey);
      let signature: string;
      if (isPersonal) {
        signature = await wallet.signMessage(ethers.getBytes(decoded!.hex));
      } else {
        if (!parsed || !parsed.ok) {
          setError(parsed ? parsed.error : "Invalid typed data");
          setBusy(false);
          return;
        }
        signature = await wallet.signTypedData(
          parsed.domain as ethers.TypedDataDomain,
          typesForEthers(parsed.types),
          parsed.message as Record<string, any>
        );
      }
      await touchActivity();
      onDecide(true, signature);
    } catch {
      setError("Could not sign this request.");
      setBusy(false);
    }
  }

  const canSign = isPersonal || (parsed != null && parsed.ok);

  return (
    <div className="app-bg min-h-full flex flex-col">
      <div className="px-5 pt-6 pb-4 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center text-center mb-5">
          <img src="/logo.png" alt="NumPay" className="w-12 h-12 mb-3" />
          <h1 className="text-[17px] font-bold text-text-primary">
            {isPersonal ? "Signature request" : "Typed data signature"}
          </h1>
          <p className="text-[12px] text-muted mt-1 break-all">{pending.origin}</p>
        </div>

        {risk.map((r, i) => (
          <div
            key={i}
            className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5"
          >
            <p className="text-[12px] text-amber-300 leading-snug">⚠ {r.text}</p>
          </div>
        ))}

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">Signing account</p>
          <p className="text-[12px] font-mono text-text-primary break-all">{pending.account}</p>
          <p className="text-[11px] text-muted mt-2">Network: <span className="text-brand-400 font-medium">{chainName(pending.chainId)}</span></p>
        </div>

        {isPersonal && decoded && (
          <div className="premium-card p-3.5 mb-3">
            <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">Message</p>
            {decoded.isUtf8 ? (
              <pre className="text-[12px] text-text-primary whitespace-pre-wrap break-words font-sans">{decoded.text}</pre>
            ) : (
              <>
                <p className="text-[11px] text-muted mb-1">Raw bytes (not readable text):</p>
                <pre className="text-[11px] text-text-secondary whitespace-pre-wrap break-all font-mono">{decoded.hex}</pre>
              </>
            )}
          </div>
        )}

        {!isPersonal && parsed && (
          <div className="premium-card p-3.5 mb-3">
            {parsed.ok ? (
              <>
                <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">
                  {parsed.domain.name ? parsed.domain.name + " · " : ""}{parsed.primaryType}
                </p>
                {parsed.domain.verifyingContract && (
                  <p className="text-[11px] text-muted break-all mb-2">
                    Contract: <span className="font-mono text-text-secondary">{parsed.domain.verifyingContract}</span>
                  </p>
                )}
                <pre className="text-[11px] text-text-primary whitespace-pre-wrap break-words font-mono">
                  {JSON.stringify(parsed.message, null, 2)}
                </pre>
              </>
            ) : (
              <p className="text-[12px] text-rose-300">Could not read typed data: {parsed.error}</p>
            )}
          </div>
        )}

        {error && <p className="text-[12px] text-rose-300 mt-1 mb-1">{error}</p>}
      </div>

      <div className="px-5 pb-6 flex gap-2">
        <button
          onClick={() => onDecide(false)}
          disabled={busy}
          className="flex-1 py-2.5 rounded-xl bg-surface-2 text-text-secondary text-[13px] font-medium border border-border hover:bg-surface-3 transition-colors disabled:opacity-50"
        >
          Reject
        </button>
        <button
          onClick={approve}
          disabled={busy || !canSign}
          className="flex-1 btn-primary-premium text-[13px] disabled:opacity-50"
        >
          {busy ? "Signing..." : "Sign"}
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
