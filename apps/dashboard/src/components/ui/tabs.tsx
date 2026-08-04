import { useId, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { cn } from "#lib/utils.ts";

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  items: Array<{ value: T; label: string; icon?: ReactNode }>;
  className?: string;
}) {
  const instanceId = useId();
  const reduceMotion = useReducedMotion();
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
            "relative isolate inline-flex h-8 items-center gap-1.5 overflow-hidden rounded-[7px] px-3 text-xs font-semibold text-[var(--muted-strong)] transition-colors duration-[var(--motion-fast)] ease-[var(--ease-standard)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
            value === item.value && "text-[var(--ink)]",
          )}
        >
          {value === item.value ? (
            <motion.span
              layoutId={`tab-active-${instanceId}`}
              className="absolute inset-0 -z-10 rounded-[7px] bg-[var(--surface)] shadow-[var(--shadow-card)]"
              transition={{
                duration: reduceMotion ? 0 : 0.24,
                ease: [0.16, 1, 0.3, 1],
              }}
            />
          ) : null}
          <span className="relative z-10 contents">
            {item.icon}
            {item.label}
          </span>
        </button>
      ))}
    </div>
  );
}
