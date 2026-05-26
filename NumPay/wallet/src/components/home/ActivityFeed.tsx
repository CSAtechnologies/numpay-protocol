"use client";

import { ActivityIcon } from "../icons/Icon";

export function ActivityFeed() {
  return (
    <section>
      <div className="mb-2.5 flex items-center justify-between">
        <h3 className="text-base font-semibold">Recent activity</h3>
        <button className="text-xs" style={{ color: "var(--brand-2)" }}>
          See all
        </button>
      </div>
      <div className="card p-0">
        <EmptyState />
      </div>
    </section>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center gap-2 py-12 text-center">
      <div
        className="grid h-12 w-12 place-items-center rounded-2xl"
        style={{
          background: "var(--card-2)",
          border: "1px dashed var(--border-2)",
          color: "var(--brand-2)",
        }}
      >
        <ActivityIcon size={20} />
      </div>
      <div className="text-sm font-medium">No activity yet</div>
      <p className="max-w-xs text-xs" style={{ color: "var(--muted)" }}>
        Your sends, receives, and claims will show up here as soon as they're on-chain.
      </p>
    </div>
  );
}
