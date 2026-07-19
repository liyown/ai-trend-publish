import type React from "react";
import { cn } from "#lib/utils.ts";

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string; icon?: React.ReactNode }>;
  className?: string;
}) {
  return (
    <div
      role="tablist"
      className={cn(
        "inline-flex h-9 flex-wrap items-center gap-0.5 rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-0.5",
        className,
      )}
    >
      {items.map((item) => (
        <button
          key={item.value}
          type="button"
          role="tab"
          aria-selected={value === item.value}
          onClick={() => onChange(item.value)}
          className={cn(
            "inline-flex h-8 items-center gap-1.5 rounded-[7px] px-3 text-xs font-semibold text-[var(--muted-strong)] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
            value === item.value &&
              "bg-[var(--surface)] text-[var(--ink)] shadow-[var(--shadow-card)]",
          )}
        >
          {item.icon}
          {item.label}
        </button>
      ))}
    </div>
  );
}
