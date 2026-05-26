"use client";

import { ArrowUpRight } from "../icons/Icon";

interface Contact {
  init: string;
  name: string;
  num: string;
  g: string;
}

const CONTACTS: Contact[] = [
  { init: "MK", name: "Mira K.",  num: "204 817 365 41", g: "linear-gradient(135deg,#34d399,#0ea5e9)" },
  { init: "JP", name: "James P.", num: "611 229 304 18", g: "linear-gradient(135deg,#ffa8c5,#7c6df0)" },
  { init: "LR", name: "Lena R.",  num: "884 102 573 66", g: "linear-gradient(135deg,#fbbf24,#f472b6)" },
  { init: "DN", name: "Devon N.", num: "312 008 455 21", g: "linear-gradient(135deg,#a394ff,#5b4cdb)" },
];

interface Props {
  onSend?: (number: string) => void;
}

export function FrequentContacts({ onSend }: Props) {
  return (
    <div className="card p-5">
      <div className="mb-2 flex items-center justify-between">
        <div className="text-[13px] font-semibold">Frequent contacts</div>
        <button className="text-xs" style={{ color: "var(--brand-2)" }}>
          See all
        </button>
      </div>
      {CONTACTS.map((c) => (
        <div key={c.name} className="flex items-center gap-2.5 py-2">
          <div
            className="grid h-[34px] w-[34px] flex-shrink-0 place-items-center rounded-full text-xs font-semibold"
            style={{ background: c.g }}
          >
            {c.init}
          </div>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-medium">{c.name}</div>
            <div className="mono truncate text-[10px]" style={{ color: "var(--muted)" }}>
              {c.num}
            </div>
          </div>
          <button
            onClick={() => onSend?.(c.num.replace(/\s/g, ""))}
            className="ml-auto grid h-7 w-7 flex-shrink-0 place-items-center rounded-lg transition-colors"
            style={{ background: "rgba(124,109,240,.15)", color: "var(--brand-2)" }}
            aria-label={`Send to ${c.name}`}
          >
            <ArrowUpRight size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
