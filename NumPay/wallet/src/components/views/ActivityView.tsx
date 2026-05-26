"use client";

import { ActivityIcon } from "../icons/Icon";

export function ActivityView() {
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="mb-1 text-2xl font-bold tracking-tight">Activity</h1>
      <p className="mb-6 text-sm text-ink-muted">Every send, receive, and claim on your account.</p>
      <div className="card flex flex-col items-center justify-center gap-2 py-16 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-line/50 text-ink-muted">
          <ActivityIcon size={22} />
        </div>
        <div className="text-base font-semibold">No activity yet</div>
        <p className="max-w-xs text-sm text-ink-muted">
          Once you send or receive through a NumPay number, the transactions will appear here.
        </p>
      </div>
    </div>
  );
}
