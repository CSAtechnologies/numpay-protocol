"use client";

import { useState } from "react";
import { useMyNumber, formatBPAN } from "@/hooks/useMyNumber";
import { useTheme } from "@/context/ThemeContext";
import { useCurrency, CURRENCIES, CurrencyCode } from "@/context/CurrencyContext";
import { useNetwork } from "@/context/NetworkContext";
import { useWallet } from "@/context/WalletContext";
import { useConnectedApps } from "@/hooks/useConnectedApps";
import {
  SunIcon,
  MoonIcon,
  GlobeIcon,
  LockIcon,
  KeyIcon,
  ShieldIcon,
  TrashIcon,
  LinkIcon,
  CopyIcon,
  CheckIcon,
  ChevronRight,
} from "../icons/Icon";
import { Pill } from "../primitives/Pill";
import { Segmented } from "../primitives/Segmented";

export function SettingsView() {
  const { number, clear } = useMyNumber();
  const { address, lock, reset, exportPrivateKey } = useWallet();
  const { theme, setTheme } = useTheme();
  const { code: currencyCode, setCode: setCurrency, currency } = useCurrency();
  const { mode: netMode, setMode: setNetMode } = useNetwork();
  const { apps, disconnect, disconnectAll } = useConnectedApps();
  const [confirmReset, setConfirmReset] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState<"addr" | "key" | null>(null);

  const copy = async (kind: "addr" | "key", value: string | undefined) => {
    if (!value) return;
    await navigator.clipboard.writeText(value);
    setCopied(kind);
    setTimeout(() => setCopied(null), 1400);
  };

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <h1 className="text-[22px] font-semibold tracking-tight">Settings</h1>

      {/* Profile */}
      {address && (
        <div className="card p-5">
          <div className="flex items-center gap-3">
            <span
              className="grid h-12 w-12 place-items-center rounded-full text-base font-bold text-white"
              style={{ background: "linear-gradient(135deg,#ff8fb4,#7c6df0)" }}
            >
              {address.slice(2, 3).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-semibold">
                {number ? formatBPAN(number) : "Wallet"}
              </div>
              <div className="mono truncate text-[11px]" style={{ color: "var(--muted)" }}>
                {address}
              </div>
            </div>
            <button
              onClick={() => copy("addr", address)}
              className="btn-secondary px-3 py-2 text-xs"
              title="Copy wallet address"
            >
              {copied === "addr" ? <CheckIcon size={13} /> : <LinkIcon size={13} />}
              {copied === "addr" ? "Copied" : "Copy address"}
            </button>
          </div>
        </div>
      )}

      {/* Preferences */}
      <Section title="Preferences">
        {/* Theme */}
        <Row
          icon={theme === "dark" ? <MoonIcon size={16} /> : <SunIcon size={16} />}
          label="Theme"
          right={
            <Segmented
              items={[
                { value: "dark", label: "Dark" },
                { value: "light", label: "Light" },
              ]}
              value={theme}
              onChange={setTheme}
            />
          }
        />

        {/* Currency */}
        <Row
          icon={<GlobeIcon size={16} />}
          label="Display currency"
          right={
            <select
              value={currencyCode}
              onChange={(e) => setCurrency(e.target.value as CurrencyCode)}
              className="rounded-lg border px-3 py-1.5 text-[13px] font-medium"
              style={{ background: "var(--card-2)", borderColor: "var(--border)", color: "var(--text)" }}
            >
              {Object.values(CURRENCIES).map((c) => (
                <option key={c.code} value={c.code}>
                  {c.symbol} {c.code} — {c.name}
                </option>
              ))}
            </select>
          }
          sub={`Showing balances in ${currency.name}.`}
        />

        {/* Network mode */}
        <Row
          icon={<GlobeIcon size={16} />}
          label="Network"
          right={
            <Segmented
              items={[
                { value: "mainnet", label: "Mainnet" },
                { value: "testnet", label: "Testnet" },
              ]}
              value={netMode}
              onChange={setNetMode}
            />
          }
          sub={
            netMode === "testnet"
              ? "Testnet mode — using development chain."
              : "Live mainnet mode."
          }
        />
      </Section>

      {/* Security */}
      <Section title="Security">
        <Row
          icon={<KeyIcon size={16} />}
          label="Private key"
          right={
            revealed ? (
              <button
                onClick={() => copy("key", exportPrivateKey())}
                className="btn-secondary px-3 py-2 text-xs"
              >
                {copied === "key" ? <CheckIcon size={13} /> : <CopyIcon size={13} />}
                {copied === "key" ? "Copied" : "Copy key"}
              </button>
            ) : (
              <button
                onClick={() => setRevealed(true)}
                className="btn-secondary px-3 py-2 text-xs"
              >
                Reveal
              </button>
            )
          }
          sub={
            revealed
              ? "Anyone with this key controls your wallet. Don't share it."
              : "Tap to reveal. Anyone with this key can control your wallet."
          }
        />
        <Row
          icon={<LockIcon size={16} />}
          label="Lock wallet"
          right={
            <button onClick={lock} className="btn-secondary px-3 py-2 text-xs">
              Lock now
            </button>
          }
          sub="Requires your password to unlock."
        />
        <Row
          icon={<ShieldIcon size={16} />}
          label="Auto-lock"
          right={<Pill kind="dashed">5 min</Pill>}
          sub="Wallet locks automatically after inactivity."
        />
      </Section>

      {/* Connected apps */}
      <Section
        title="Connected apps"
        action={
          apps.length > 0 ? (
            <button
              onClick={disconnectAll}
              className="text-[12px] font-medium"
              style={{ color: "var(--danger)" }}
            >
              Disconnect all
            </button>
          ) : null
        }
      >
        {apps.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <div
              className="mx-auto grid h-12 w-12 place-items-center rounded-2xl"
              style={{
                background: "var(--card-2)",
                border: "1px dashed var(--border-2)",
                color: "var(--muted)",
              }}
            >
              <LinkIcon size={18} />
            </div>
            <div className="mt-3 text-[13px] font-medium">No connected apps</div>
            <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              Sites you connect to NumPay will appear here.
            </div>
          </div>
        ) : (
          apps.map((a, i) => (
            <Row
              key={a.origin}
              first={i === 0}
              icon={<LinkIcon size={16} />}
              label={a.name || a.origin}
              sub={a.origin}
              right={
                <button
                  onClick={() => disconnect(a.origin)}
                  className="text-[12px] font-medium"
                  style={{ color: "var(--danger)" }}
                >
                  Disconnect
                </button>
              }
            />
          ))
        )}
      </Section>

      {/* BPAN linking */}
      <Section title="BPAN">
        <Row
          icon={<ChevronRight size={16} />}
          label="Linked number on this device"
          right={
            number && (
              <button onClick={clear} className="btn-secondary px-3 py-2 text-xs">
                Unlink
              </button>
            )
          }
          sub={
            number
              ? `${formatBPAN(number)} — only affects local display, on-chain ownership unchanged.`
              : "No number linked yet."
          }
        />
      </Section>

      {/* Danger */}
      <div
        className="card p-5"
        style={{ borderColor: "rgba(248,113,113,.4)" }}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-[14px] font-semibold" style={{ color: "var(--danger)" }}>
              Reset wallet
            </div>
            <div className="mt-1 text-xs" style={{ color: "var(--muted)" }}>
              Deletes the encrypted key on this device. You'll need your seed/private key to
              recover.
            </div>
          </div>
          {confirmReset ? (
            <div className="flex flex-col gap-1.5">
              <button
                onClick={reset}
                className="btn-primary px-3 py-2 text-xs"
                style={{
                  background: "var(--danger)",
                  boxShadow: "0 6px 16px rgba(248,113,113,.3)",
                }}
              >
                <TrashIcon size={13} /> Confirm reset
              </button>
              <button
                onClick={() => setConfirmReset(false)}
                className="btn-secondary px-3 py-2 text-xs"
              >
                Cancel
              </button>
            </div>
          ) : (
            <button
              onClick={() => setConfirmReset(true)}
              className="btn-secondary px-3 py-2 text-xs"
              style={{ color: "var(--danger)", borderColor: "rgba(248,113,113,.4)" }}
            >
              <TrashIcon size={13} /> Reset…
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function Section({
  title,
  children,
  action,
}: {
  title: string;
  children: React.ReactNode;
  action?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-2 flex items-center justify-between px-1">
        <div
          className="text-[10px] font-semibold uppercase tracking-[0.14em]"
          style={{ color: "var(--muted-2)" }}
        >
          {title}
        </div>
        {action}
      </div>
      <div className="card overflow-hidden p-0">{children}</div>
    </div>
  );
}

function Row({
  icon,
  label,
  right,
  sub,
  first,
}: {
  icon: React.ReactNode;
  label: string;
  right?: React.ReactNode;
  sub?: React.ReactNode;
  first?: boolean;
}) {
  return (
    <div
      className="px-4 py-3.5"
      style={{
        borderTop: first ? undefined : "1px solid var(--border)",
      }}
    >
      <div className="flex items-center gap-3">
        <span style={{ color: "var(--muted)" }}>{icon}</span>
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-medium">{label}</div>
        </div>
        {right}
      </div>
      {sub && (
        <div
          className="mt-1.5 pl-7 text-[11px] leading-relaxed"
          style={{ color: "var(--muted)" }}
        >
          {sub}
        </div>
      )}
    </div>
  );
}

