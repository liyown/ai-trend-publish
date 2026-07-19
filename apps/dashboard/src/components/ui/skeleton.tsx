import { cn } from "#lib/utils.ts";

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      className={cn("animate-pulse rounded-[var(--radius-sm)] bg-[var(--surface-3)]", className)}
    />
  );
}
