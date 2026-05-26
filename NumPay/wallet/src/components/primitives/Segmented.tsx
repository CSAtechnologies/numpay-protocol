interface Item<T extends string> {
  value: T;
  label: string;
}

interface Props<T extends string> {
  items: Item<T>[];
  value: T;
  onChange: (v: T) => void;
  className?: string;
}

export function Segmented<T extends string>({ items, value, onChange, className = "" }: Props<T>) {
  return (
    <div className={`segmented ${className}`.trim()}>
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          className={value === it.value ? "active" : ""}
          onClick={() => onChange(it.value)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}
