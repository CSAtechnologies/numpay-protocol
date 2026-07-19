import "@/platform/init";
import React, { useEffect, useState, useRef } from "react";
import ReactDOM from "react-dom/client";
import { ethers } from "ethers";
import { NETWORKS, type Network } from "@numpay/core/networks";
import { getCustomChains } from "@numpay/core/customChains";
import {
  isLocked,
  unlockActiveVault,
  touchActivity,
  getSigner,
  SESSION_KEY,
  type WalletData,
} from "@numpay/core/wallet";
import { setSession, getSession } from "@numpay/core/storage";
import {
  MSG_DAPP_DECISION,
  type DappPending,
  type PendingConnect,
  type PendingSign,
  type PendingSendTx,
  type PendingSwitchChain,
  type PendingAddChain,
  type PendingSolConnect,
  type PendingSolSign,
  type PendingSolSignTx,
} from "@/lib/dapp/types";
import {
  deriveSolanaAddress,
  inspectSolanaTransaction,
  signSolanaTransaction,
  simulateSolanaTx,
  type SolTxInspection,
} from "@numpay/core/chains/solana";
import { decodeSolSignMessage, bytesToBase64, base64ToBytes } from "@/lib/dapp/solDecode";
import nacl from "tweetnacl";
import {
  decodePersonalSignMessage,
  parseTypedData,
  assessTypedDataRisk,
  type RiskFlag,
} from "@/lib/dapp/signDecode";
// The actual signing goes through the shared core engine — the same code the
// mobile WalletConnect sheet uses — so there is exactly ONE signing path to
// audit. The decode imports above remain for rendering the preview.
import { signDappRequest, type EvmSignMethod } from "@numpay/core/dapp";
import {
  decodeTxData,
  formatNativeValue,
  normalizeTxForEthers,
} from "@/lib/dapp/txDecode";
import PasswordPrompt from "../popup/components/PasswordPrompt";
import { DEFAULT_THEME } from "../popup/hooks/useTheme";
import "../popup/index.css";

document.documentElement.setAttribute(
  "data-theme",
  localStorage.getItem("numpay_theme") || DEFAULT_THEME
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
  // A ref, not state: decide() closes the window synchronously, before a state
  // update could propagate, so the beforeunload guard below must read a value
  // that is already current at close time.
  const decidedRef = useRef(false);

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
      // Only auto-reject when the user closed the window WITHOUT deciding. A
      // spurious reject here would race the real decision and could beat it to
      // the page, settling the dApp promise as "user rejected" after an approve.
      if (!decidedRef.current) {
        try { chrome.runtime.sendMessage({ type: MSG_DAPP_DECISION, requestId, approved: false }); } catch {}
      }
    };
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [requestId]);

  function decide(approved: boolean, result?: string) {
    decidedRef.current = true;
    try {
      chrome.runtime.sendMessage({ type: MSG_DAPP_DECISION, requestId, approved, result });
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
          pending.type === "sign" || pending.type === "solSign"
            ? "Unlock your wallet to review this signature request."
            : pending.type === "sendTx" || pending.type === "solSignTx"
            ? "Unlock your wallet to review this transaction request."
            : "Unlock your wallet to review this connection request."
        }
        actionLabel="Unlock"
        onCancel={() => decide(false)}
        onSubmit={unlock}
      />
    );
  }

  if (pending.type === "sendTx") return <SendTxView pending={pending} onDecide={decide} />;
  if (pending.type === "switchChain") return <SwitchChainView pending={pending} onDecide={decide} />;
  if (pending.type === "addChain") return <AddChainView pending={pending} onDecide={decide} />;
  if (pending.type === "solConnect") return <SolConnectView pending={pending} onDecide={decide} />;
  if (pending.type === "solSign") return <SolSignView pending={pending} onDecide={decide} />;
  if (pending.type === "solSignTx") return <SolSignTxView pending={pending} onDecide={decide} />;
  if (pending.type === "sign") return <SignView pending={pending} onDecide={decide} />;
  return <ConnectView pending={pending} onDecide={decide} />;
}

// Request the runtime host permission for a custom RPC origin (declared under
// optional_host_permissions). Must run from a user gesture in this window.
async function requestRpcHostPermission(rpcUrl: string): Promise<boolean> {
  try {
    if (typeof chrome === "undefined" || !chrome.permissions) return true;
    const origins = [`${new URL(rpcUrl).origin}/*`];
    if (await chrome.permissions.contains({ origins })) return true;
    return await chrome.permissions.request({ origins });
  } catch {
    return false;
  }
}

// Resolve an EVM network (built-in or custom) by numeric chainId, for the rpcUrl
// and native symbol/decimals used to broadcast and to format the value.
async function resolveEvmNetwork(chainId: number): Promise<Network | null> {
  const builtin = Object.values(NETWORKS).find((n) => n.chainId === chainId);
  if (builtin) return builtin;
  const custom = (await getCustomChains()).find((c) => c.chainId === chainId);
  if (custom) {
    return {
      id: custom.id, name: custom.name, chainId: custom.chainId, rpcUrl: custom.rpcUrl,
      symbol: custom.symbol, decimals: custom.decimals, explorer: custom.explorer, logo: custom.logo || "",
    };
  }
  return null;
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

// ── Solana connect ────────────────────────────────────────────────────────────────

function SolConnectView({
  pending,
  onDecide,
}: {
  pending: PendingSolConnect;
  onDecide: (approved: boolean, result?: string) => void;
}) {
  const [address, setAddress] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Derive the active wallet's Solana address from the unlocked session
  // mnemonic. The router never sees a key; the address is returned on approve.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const wd = await getActiveSessionWallet();
      if (!wd?.mnemonic) {
        if (!cancelled) setError("Wallet is locked. Close and retry.");
        return;
      }
      try {
        const { address: addr } = await deriveSolanaAddress(wd.mnemonic);
        if (!cancelled) setAddress(addr);
      } catch {
        if (!cancelled) setError("Could not derive your Solana address.");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="app-bg min-h-full flex flex-col">
      <div className="px-5 pt-6 pb-4 flex-1">
        <div className="flex flex-col items-center text-center mb-6">
          <img src="/logo.png" alt="NumPay" className="w-12 h-12 mb-3" />
          <h1 className="text-[17px] font-bold text-text-primary">Solana connection request</h1>
          <p className="text-[12px] text-muted mt-1 break-all">{pending.origin}</p>
        </div>

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-2">This site will be able to</p>
          <ul className="text-[12px] text-text-secondary space-y-1.5 list-disc pl-4">
            <li>See your Solana address and balance</li>
            <li>Ask you to approve signatures and transactions</li>
          </ul>
          <p className="text-[11px] text-muted mt-2">It cannot move funds without your approval each time.</p>
        </div>

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">Solana account</p>
          <p className="text-[12px] font-mono text-text-primary break-all">{address ?? "Deriving…"}</p>
          <p className="text-[11px] text-muted mt-2">Network: <span className="text-brand-400 font-medium">Solana Mainnet</span></p>
        </div>

        {error && <p className="text-[12px] text-rose-300 mt-1">{error}</p>}
      </div>

      <div className="px-5 pb-6 flex gap-2">
        <button
          onClick={() => onDecide(false)}
          className="flex-1 py-2.5 rounded-xl bg-surface-2 text-text-secondary text-[13px] font-medium border border-border hover:bg-surface-3 transition-colors"
        >
          Reject
        </button>
        <button
          onClick={() => address && onDecide(true, address)}
          disabled={!address}
          className="flex-1 btn-primary-premium text-[13px] disabled:opacity-50"
        >
          Connect
        </button>
      </div>
    </div>
  );
}

// ── Solana sign message ────────────────────────────────────────────────────────────

function SolSignView({
  pending,
  onDecide,
}: {
  pending: PendingSolSign;
  onDecide: (approved: boolean, result?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const decoded = decodeSolSignMessage(pending.message);

  async function approve() {
    setError(null);
    setBusy(true);
    try {
      const wd = await getActiveSessionWallet();
      if (!wd?.mnemonic) {
        setError("Wallet is locked. Close and retry.");
        setBusy(false);
        return;
      }
      const { address, secretKey } = await deriveSolanaAddress(wd.mnemonic);
      // Bind to the connected account. If the user switched the active wallet
      // since connecting, refuse rather than sign with a different key.
      if (address !== pending.account) {
        setError("Active wallet changed. Reject and retry from the site.");
        setBusy(false);
        return;
      }
      const signature = nacl.sign.detached(decoded.bytes, secretKey);
      await touchActivity();
      onDecide(true, bytesToBase64(signature));
    } catch {
      setError("Could not sign this message.");
      setBusy(false);
    }
  }

  return (
    <div className="app-bg min-h-full flex flex-col">
      <div className="px-5 pt-6 pb-4 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center text-center mb-5">
          <img src="/logo.png" alt="NumPay" className="w-12 h-12 mb-3" />
          <h1 className="text-[17px] font-bold text-text-primary">Signature request</h1>
          <p className="text-[12px] text-muted mt-1 break-all">{pending.origin}</p>
        </div>

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">Signing account</p>
          <p className="text-[12px] font-mono text-text-primary break-all">{pending.account}</p>
          <p className="text-[11px] text-muted mt-2">Network: <span className="text-brand-400 font-medium">Solana Mainnet</span></p>
        </div>

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">Message</p>
          {decoded.isUtf8 ? (
            <pre className="text-[12px] text-text-primary whitespace-pre-wrap break-words font-sans">{decoded.text}</pre>
          ) : (
            <>
              <p className="text-[11px] text-muted mb-1">Raw bytes (not readable text), base64:</p>
              <pre className="text-[11px] text-text-secondary whitespace-pre-wrap break-all font-mono">{decoded.base64}</pre>
            </>
          )}
        </div>

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
        <button onClick={approve} disabled={busy} className="flex-1 btn-primary-premium text-[13px] disabled:opacity-50">
          {busy ? "Signing..." : "Sign"}
        </button>
      </div>
    </div>
  );
}

// ── Solana sign / send transaction ─────────────────────────────────────────────────

type SolSimState =
  | { status: "loading" }
  | { status: "ok" }
  | { status: "revert"; message: string };

function SolSignTxView({
  pending,
  onDecide,
}: {
  pending: PendingSolSignTx;
  onDecide: (approved: boolean, result?: string) => void;
}) {
  const [info, setInfo] = useState<SolTxInspection | null>(null);
  const [sim, setSim] = useState<SolSimState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Decode the transaction bytes once; base64ToBytes never throws.
  const txBytes = base64ToBytes(pending.transaction);

  // The fee payer must be the connected account, or signing would bind the user
  // to a transaction they don't pay for / didn't intend. inspectSolanaTransaction
  // never throws; an empty fee payer means the bytes did not parse.
  const feePayerMismatch = info !== null && info.feePayer !== pending.account;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const i = inspectSolanaTransaction(txBytes);
      if (!cancelled) setInfo(i);
      // Preview simulation against current state. The tx may not be signed yet,
      // so sigVerify is off; this is informational, not a hard block.
      const s = await simulateSolanaTx(pending.transaction, false);
      if (!cancelled) {
        setSim(s.ok ? { status: "ok" } : { status: "revert", message: s.err ?? "Transaction is expected to fail" });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function approve() {
    setError(null);
    setBusy(true);
    try {
      const wd = await getActiveSessionWallet();
      if (!wd?.mnemonic) {
        setError("Wallet is locked. Close and retry.");
        setBusy(false);
        return;
      }
      const { address, secretKey } = await deriveSolanaAddress(wd.mnemonic);
      // Re-bind to the connected account at sign time (the user may have switched
      // the active wallet while this window was open).
      if (address !== pending.account) {
        setError("Active wallet changed. Reject and retry from the site.");
        setBusy(false);
        return;
      }
      // signSolanaTransaction re-checks the fee-payer bind before using the key.
      const res = await signSolanaTransaction(secretKey, address, txBytes, pending.send);
      await touchActivity();
      onDecide(true, pending.send ? res.signature! : res.signedB64);
    } catch (e: any) {
      setError(e?.message || "Could not sign this transaction.");
      setBusy(false);
    }
  }

  return (
    <div className="app-bg min-h-full flex flex-col">
      <div className="px-5 pt-6 pb-4 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center text-center mb-5">
          <img src="/logo.png" alt="NumPay" className="w-12 h-12 mb-3" />
          <h1 className="text-[17px] font-bold text-text-primary">
            {pending.send ? "Transaction request" : "Sign transaction"}
          </h1>
          <p className="text-[12px] text-muted mt-1 break-all">{pending.origin}</p>
        </div>

        {feePayerMismatch && (
          <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5">
            <p className="text-[12px] text-rose-300 leading-snug">
              ⚠ The fee payer of this transaction is not your connected account. NumPay will not sign it. Reject it.
            </p>
          </div>
        )}

        {info?.usesLookupTables && (
          <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5">
            <p className="text-[12px] text-amber-300 leading-snug">
              ⚠ This transaction uses address lookup tables, so some accounts it touches cannot be shown here. Only approve it if you trust this site.
            </p>
          </div>
        )}

        {sim.status === "revert" && !feePayerMismatch && (
          <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5">
            <p className="text-[12px] text-rose-300 leading-snug">
              ⚠ This transaction is likely to fail: {sim.message}
            </p>
          </div>
        )}

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">
            {pending.send ? "Sending from" : "Signing account"}
          </p>
          <p className="text-[12px] font-mono text-text-primary break-all">{pending.account}</p>
          <p className="text-[11px] text-muted mt-2">Network: <span className="text-brand-400 font-medium">Solana Mainnet</span></p>
        </div>

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">Programs called</p>
          {info && info.programs.length > 0 ? (
            <ul className="text-[12px] text-text-primary space-y-1">
              {info.programs.map((p, i) => (
                <li key={i} className="break-all">
                  {p.name ? <span className="text-text-primary">{p.name}</span> : <span className="font-mono text-text-secondary">{p.id}</span>}
                  {p.name && <span className="text-muted font-mono text-[10px]"> · {p.id.slice(0, 8)}…</span>}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[12px] text-muted">{info ? "None decoded" : "Decoding…"}</p>
          )}
          {info && (
            <p className="text-[11px] text-muted mt-2">
              {info.instructionCount} instruction{info.instructionCount === 1 ? "" : "s"}
              {sim.status === "ok" && <span className="text-emerald-400"> · simulation passed</span>}
            </p>
          )}
        </div>

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
          disabled={busy || feePayerMismatch}
          className="flex-1 btn-primary-premium text-[13px] disabled:opacity-50"
        >
          {busy ? (pending.send ? "Sending..." : "Signing...") : pending.send ? "Confirm" : "Sign"}
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

      if (!isPersonal && (!parsed || !parsed.ok)) {
        setError(parsed && !parsed.ok ? parsed.error : "Invalid typed data");
        setBusy(false);
        return;
      }
      // Shared core engine (same ops as before: personal_sign signs the raw
      // message bytes, typed data signs with EIP712Domain stripped). Params in
      // spec order, exactly as a transport would deliver them.
      const wallet = new ethers.Wallet(wd.privateKey);
      const signature = await signDappRequest(
        {
          method: pending.method as EvmSignMethod,
          params: isPersonal
            ? [pending.payload, pending.account]
            : [pending.account, pending.payload],
        },
        wallet
      );
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

// ── Send transaction ─────────────────────────────────────────────────────────────

type SimState =
  | { status: "loading" }
  | { status: "ok"; gas: string }
  | { status: "revert"; message: string }
  | { status: "skipped" };

function SendTxView({
  pending,
  onDecide,
}: {
  pending: PendingSendTx;
  onDecide: (approved: boolean, result?: string) => void;
}) {
  const [net, setNet] = useState<Network | null>(null);
  const [netMissing, setNetMissing] = useState(false);
  const [sim, setSim] = useState<SimState>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const decoded = decodeTxData(pending.tx.data);
  const risk = decoded.risk;

  // Resolve the target network, then run a pre-broadcast estimateGas as a
  // simulation. A revert here is surfaced as a warning, not a hard block: some
  // valid transactions do not estimate cleanly, so we let the user decide.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const n = await resolveEvmNetwork(pending.chainId);
      if (cancelled) return;
      if (!n) { setNetMissing(true); setSim({ status: "skipped" }); return; }
      setNet(n);
      try {
        const provider = new ethers.JsonRpcProvider(n.rpcUrl);
        const req = { ...normalizeTxForEthers(pending.tx), from: pending.account };
        delete (req as any).gasLimit; // estimate fresh
        const gas = await provider.estimateGas(req as ethers.TransactionRequest);
        if (!cancelled) setSim({ status: "ok", gas: gas.toString() });
      } catch (e: any) {
        if (!cancelled) {
          const reason = e?.shortMessage || e?.reason || e?.message || "Transaction is expected to fail";
          setSim({ status: "revert", message: reason });
        }
      }
    })();
    return () => { cancelled = true; };
  }, [pending]);

  async function approve() {
    setError(null);
    if (!net) { setError("Network not available."); return; }
    setBusy(true);
    try {
      const wd = await getActiveSessionWallet();
      if (!wd) { setError("Wallet is locked. Close and retry."); setBusy(false); return; }

      let sameAccount = false;
      try {
        sameAccount = ethers.getAddress(wd.address) === ethers.getAddress(pending.account);
      } catch { sameAccount = false; }
      if (!sameAccount) {
        setError("Active wallet changed. Reject and retry from the site.");
        setBusy(false);
        return;
      }

      const signer = getSigner(wd.privateKey, net.rpcUrl);
      // Confirm the RPC actually serves the expected chain before broadcasting,
      // so a stale/wrong RPC can never produce a wrong-chain send.
      const providerNet = await signer.provider!.getNetwork();
      if (Number(providerNet.chainId) !== net.chainId) {
        setError(`Network mismatch: RPC reports chain ${providerNet.chainId}, expected ${net.chainId}.`);
        setBusy(false);
        return;
      }

      // Shared core engine: normalizes the tx (gas->gasLimit, from dropped)
      // and broadcasts through the chain-verified signer above.
      const hash = await signDappRequest(
        { method: "eth_sendTransaction", params: [pending.tx] },
        signer
      );
      await touchActivity();
      onDecide(true, hash);
    } catch (e: any) {
      setError(e?.shortMessage || e?.reason || e?.message || "Could not send this transaction.");
      setBusy(false);
    }
  }

  const valueStr = net ? formatNativeValue(pending.tx.value, net.decimals, net.symbol) : "…";

  return (
    <div className="app-bg min-h-full flex flex-col">
      <div className="px-5 pt-6 pb-4 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center text-center mb-5">
          <img src="/logo.png" alt="NumPay" className="w-12 h-12 mb-3" />
          <h1 className="text-[17px] font-bold text-text-primary">Transaction request</h1>
          <p className="text-[12px] text-muted mt-1 break-all">{pending.origin}</p>
        </div>

        {netMissing && (
          <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5">
            <p className="text-[12px] text-rose-300 leading-snug">
              This transaction targets chain {pending.chainId}, which is not configured in NumPay. Reject it.
            </p>
          </div>
        )}

        {risk.map((r, i) => (
          <div
            key={i}
            className={`mb-3 rounded-xl border px-3.5 py-2.5 ${
              r.level === "warn"
                ? "border-amber-500/40 bg-amber-500/10"
                : "border-border bg-surface-2"
            }`}
          >
            <p className={`text-[12px] leading-snug ${r.level === "warn" ? "text-amber-300" : "text-text-secondary"}`}>
              {r.level === "warn" ? "⚠ " : ""}{r.text}
            </p>
          </div>
        ))}

        {sim.status === "revert" && (
          <div className="mb-3 rounded-xl border border-rose-500/40 bg-rose-500/10 px-3.5 py-2.5">
            <p className="text-[12px] text-rose-300 leading-snug">
              ⚠ This transaction is likely to fail: {sim.message}
            </p>
          </div>
        )}

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">From</p>
          <p className="text-[12px] font-mono text-text-primary break-all">{pending.account}</p>
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1 mt-3">To</p>
          <p className="text-[12px] font-mono text-text-primary break-all">{pending.tx.to || "(contract creation)"}</p>
          <p className="text-[11px] text-muted mt-3">
            Amount: <span className="text-text-primary font-medium">{valueStr}</span>
            <span className="text-muted"> · {net ? net.name : `Chain ${pending.chainId}`}</span>
          </p>
        </div>

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[11px] text-muted uppercase tracking-wider font-medium mb-1">Action</p>
          <p className="text-[12px] text-text-primary break-all">{decoded.summary}</p>
          {sim.status === "ok" && (
            <p className="text-[11px] text-muted mt-2">Estimated gas: <span className="text-text-secondary font-mono">{sim.gas}</span></p>
          )}
          {decoded.hasData && (
            <details className="mt-2">
              <summary className="text-[11px] text-muted cursor-pointer">Raw data</summary>
              <pre className="text-[10px] text-text-secondary whitespace-pre-wrap break-all font-mono mt-1">{pending.tx.data}</pre>
            </details>
          )}
        </div>

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
          disabled={busy || netMissing}
          className="flex-1 btn-primary-premium text-[13px] disabled:opacity-50"
        >
          {busy ? "Sending..." : "Confirm"}
        </button>
      </div>
    </div>
  );
}

// ── Switch chain ─────────────────────────────────────────────────────────────────

function SwitchChainView({
  pending,
  onDecide,
}: {
  pending: PendingSwitchChain;
  onDecide: (approved: boolean, result?: string) => void;
}) {
  return (
    <div className="app-bg min-h-full flex flex-col">
      <div className="px-5 pt-6 pb-4 flex-1">
        <div className="flex flex-col items-center text-center mb-6">
          <img src="/logo.png" alt="NumPay" className="w-12 h-12 mb-3" />
          <h1 className="text-[17px] font-bold text-text-primary">Switch network</h1>
          <p className="text-[12px] text-muted mt-1 break-all">{pending.origin}</p>
        </div>

        <div className="premium-card p-3.5 mb-3">
          <p className="text-[12px] text-text-secondary">
            This site wants NumPay to switch to{" "}
            <span className="text-brand-400 font-medium">{pending.chainName}</span>.
          </p>
          <p className="text-[11px] text-muted mt-2">
            This changes the active network for the whole wallet, not just this site.
          </p>
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
          Switch
        </button>
      </div>
    </div>
  );
}

// ── Add chain ─────────────────────────────────────────────────────────────────────

function AddChainView({
  pending,
  onDecide,
}: {
  pending: PendingAddChain;
  onDecide: (approved: boolean, result?: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const c = pending.chain;

  async function approve() {
    setError(null);
    setBusy(true);
    // Granting the host permission needs this user gesture; the background then
    // verifies the RPC actually serves this chain before saving it.
    const granted = await requestRpcHostPermission(c.rpcUrl);
    if (!granted) {
      setError("Permission to reach this RPC was denied. NumPay needs it to use the network.");
      setBusy(false);
      return;
    }
    onDecide(true);
  }

  return (
    <div className="app-bg min-h-full flex flex-col">
      <div className="px-5 pt-6 pb-4 flex-1 overflow-y-auto">
        <div className="flex flex-col items-center text-center mb-5">
          <img src="/logo.png" alt="NumPay" className="w-12 h-12 mb-3" />
          <h1 className="text-[17px] font-bold text-text-primary">Add network</h1>
          <p className="text-[12px] text-muted mt-1 break-all">{pending.origin}</p>
        </div>

        <div className="mb-3 rounded-xl border border-amber-500/40 bg-amber-500/10 px-3.5 py-2.5">
          <p className="text-[12px] text-amber-300 leading-snug">
            ⚠ Only add networks you trust. NumPay will route balances and transactions for this chain through the RPC below.
          </p>
        </div>

        <div className="premium-card p-3.5 mb-3 space-y-2">
          <div>
            <p className="text-[11px] text-muted uppercase tracking-wider font-medium">Network</p>
            <p className="text-[12px] text-text-primary">{c.name}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted uppercase tracking-wider font-medium">Chain ID</p>
            <p className="text-[12px] text-text-primary">{c.chainId}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted uppercase tracking-wider font-medium">Currency</p>
            <p className="text-[12px] text-text-primary">{c.symbol}</p>
          </div>
          <div>
            <p className="text-[11px] text-muted uppercase tracking-wider font-medium">RPC URL</p>
            <p className="text-[12px] font-mono text-text-primary break-all">{c.rpcUrl}</p>
          </div>
        </div>

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
        <button onClick={approve} disabled={busy} className="flex-1 btn-primary-premium text-[13px] disabled:opacity-50">
          {busy ? "Adding..." : "Add network"}
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
