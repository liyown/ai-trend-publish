import type React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "#lib/utils.ts";

const badgeVariants = cva(
  "inline-flex min-h-5 max-w-full items-center gap-1 rounded-[6px] border px-1.5 text-[11px] font-medium",
  {
    variants: {
      tone: {
        neutral: "border-[var(--border)] bg-[var(--surface-2)] text-[var(--muted-strong)]",
        success: "border-[var(--success-border)] bg-[var(--success-bg)] text-[var(--success)]",
        warning: "border-[var(--warning-border)] bg-[var(--warning-bg)] text-[var(--warning)]",
        danger: "border-[var(--danger-border)] bg-[var(--danger-bg)] text-[var(--danger)]",
        info: "border-[var(--info-border)] bg-[var(--info-bg)] text-[var(--info)]",
        accent: "border-[var(--accent-border)] bg-[var(--accent-bg)] text-[var(--accent)]",
      },
    },
    defaultVariants: { tone: "neutral" },
  },
);

export function Badge({
  tone,
  className,
  children,
  title,
}: VariantProps<typeof badgeVariants> & {
  className?: string;
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <span title={title} className={cn(badgeVariants({ tone }), className)}>
      {children}
    </span>
  );
}
