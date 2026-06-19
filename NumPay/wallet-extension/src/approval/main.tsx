import React, { useEffect, useState } from "react";
import ReactDOM from "react-dom/client";
import { NETWORKS } from "@/lib/networks";
import { isLocked, unlockActiveVault, touchActivity, SESSION_KEY } from "@/lib/wallet";
import { setSession } from "@/lib/storage";
import { MSG_DAPP_DECISION } from "@/lib/dapp/types";
import PasswordPrompt from "../popup/components/PasswordPrompt";
import "../popup/index.css";

document.documentElement.setAttribute(
  "data-theme",
  localStorage.getItem("numpay_theme") || "dark"
);

const PENDING_PFX = "numpay_dapp_pending_";

interface Pending {
  origin: string;
  account: string;
  chainId: number;
}

function chainName(chainId: number): string {
  const net = Object.values(NETWORKS).find((n) => n.chainId === chainId);
  return net ? net.name : `Chain ${chainId}`;
}

function ApproveConnect() {
  const requestId = new URLSearchParams(location.search).get("requestId") || "";
  const [pending, setPending] = useState<Pending | null>(null);
  const [notFound, setNotFound] = useState(false);
  const [locked, setLocked] = useState(true);
  const [decided, setDecided] = useState(false);

  useEffect(() => {
    (async () => {
      const key = PENDING_PFX + requestId;
      const got = (await chrome.storage.session.get(key))[key] as Pending | undefined;
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

  function decide(approved: boolean) {
    setDecided(true);
    try { chrome.runtime.sendMessage({ type: MSG_DAPP_DECISION, requestId, approved }); } catch {}
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
          This connection request has expired. Close this window and try again from the site.
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
        subtitle="Unlock your wallet to review this connection request."
        actionLabel="Unlock"
        onCancel={() => decide(false)}
        onSubmit={unlock}
      />
    );
  }

  const acct = pending.account;
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
          <p className="text-[12px] font-mono text-text-primary break-all">{acct}</p>
          <p className="text-[11px] text-muted mt-2">Network: <span className="text-brand-400 font-medium">{chainName(pending.chainId)}</span></p>
        </div>
      </div>

      <div className="px-5 pb-6 flex gap-2">
        <button
          onClick={() => decide(false)}
          className="flex-1 py-2.5 rounded-xl bg-surface-2 text-text-secondary text-[13px] font-medium border border-border hover:bg-surface-3 transition-colors"
        >
          Reject
        </button>
        <button onClick={() => decide(true)} className="flex-1 btn-primary-premium text-[13px]">
          Connect
        </button>
      </div>
    </div>
  );
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <ApproveConnect />
  </React.StrictMode>
);
