"use client";

import { ReactNode } from "react";
import { ArrowUpRight, ArrowDownLeft, QRIcon, SwapIcon } from "../icons/Icon";

interface Props {
  onSend: () => void;
  onRequest: () => void;
  onLookup: () => void;
}

export function ActionGrid({ onSend, onRequest, onLookup }: Props) {
  return (
    <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
      <Action
        primary
        onClick={onSend}
        icon={<ArrowUpRight size={18} />}
        title="Send"
        sub="To BPAN or address"
      />
      <Action
        onClick={onRequest}
        icon={<ArrowDownLeft size={18} />}
        title="Request"
        sub="Generate a link"
      />
      <Action
        onClick={onLookup}
        icon={<QRIcon size={18} />}
        title="Show QR"
        sub="Share your BPAN"
      />
      <Action disabled icon={<SwapIcon size={18} />} title="Swap" sub="Best cross-chain rate" />
    </div>
  );
}

function Action({
  primary,
  disabled,
  onClick,
  icon,
  title,
  sub,
}: {
  primary?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  icon: ReactNode;
  title: string;
  sub: string;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`action-tile ${primary ? "primary" : ""}`}
    >
      <div className="ic">{icon}</div>
      <div>
        <div className="ttl">{title}</div>
        <div className="sub">{sub}</div>
      </div>
    </button>
  );
}
