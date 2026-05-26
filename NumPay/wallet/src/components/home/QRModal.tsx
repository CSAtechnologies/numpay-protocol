"use client";

import { QRReceive } from "./QRReceive";
import { CloseIcon } from "../icons/Icon";

export function QRModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-40 grid place-items-center bg-black/70 backdrop-blur-sm p-4"
      onClick={onClose}
    >
      <div className="w-full max-w-sm" onClick={(e) => e.stopPropagation()}>
        <div className="card-raised relative">
          <button
            onClick={onClose}
            className="absolute right-3 top-3 icon-btn"
            aria-label="Close"
          >
            <CloseIcon size={16} />
          </button>
          <QRReceive />
        </div>
      </div>
    </div>
  );
}
