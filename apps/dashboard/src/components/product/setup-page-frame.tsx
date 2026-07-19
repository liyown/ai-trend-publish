import type React from "react";
import { cn } from "#lib/utils.ts";

export function SetupObjectList({
  title,
  description,
  action,
  toolbar,
  children,
  className,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "min-w-0 overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]",
        className,
      )}
    >
      <div className="grid gap-3 border-b border-[var(--border)] px-4 py-3.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center sm:px-5">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-[var(--ink)]">{title}</h2>
          <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">{description}</p>
        </div>
        {(toolbar || action) && (
          <div className="flex min-w-0 flex-wrap gap-2 lg:justify-end">
            {toolbar}
            {action}
          </div>
        )}
      </div>
      <div className="divide-y divide-[var(--border)]">{children}</div>
    </section>
  );
}
