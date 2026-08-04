import type React from "react";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyTitle,
} from "#components/ui/empty.tsx";
import { cn } from "#lib/utils.ts";

interface EmptyStateProps {
  title?: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}

export function EmptyState({
  title = "暂无数据",
  description,
  action,
  className,
}: EmptyStateProps) {
  return (
    <Empty className={cn("min-h-36 bg-[var(--surface)] px-5 py-8", className)}>
      <EmptyHeader>
        <EmptyTitle className="text-sm font-semibold text-[var(--ink)]">{title}</EmptyTitle>
        {description ? (
          <EmptyDescription className="max-w-md text-sm leading-6 text-[var(--muted-strong)]">
            {description}
          </EmptyDescription>
        ) : null}
      </EmptyHeader>
      {action ? <EmptyContent>{action}</EmptyContent> : null}
    </Empty>
  );
}
