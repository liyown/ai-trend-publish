import type React from "react";
import { Badge } from "#components/ui/badge.tsx";
import { Button } from "#components/ui/button.tsx";
import { EmptyState } from "#components/product/empty-state.tsx";
import { SetupObjectList } from "#components/product/setup-page-frame.tsx";

export function StudioPage({ children }: { children: React.ReactNode }) {
  return <div className="grid gap-4">{children}</div>;
}

export function EntityList({
  title,
  description,
  action,
  empty,
  emptyTitle,
  emptyDescription,
  emptyAction,
  children,
}: {
  title: string;
  description: string;
  action?: React.ReactNode;
  empty?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  emptyAction?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <SetupObjectList title={title} description={description} action={action}>
      {empty ? (
        <EmptyState
          title={emptyTitle ?? "暂无内容"}
          description={emptyDescription ?? "创建第一个对象后会显示在这里。"}
          action={emptyAction}
        />
      ) : (
        children
      )}
    </SetupObjectList>
  );
}

export function EntityRow({
  title,
  description,
  status,
  meta,
  onEdit,
  onDelete,
  children,
}: {
  title: string;
  description: string;
  status?: "ready" | "disabled" | "warning";
  meta?: React.ReactNode;
  onEdit?: () => void;
  onDelete?: () => void;
  children?: React.ReactNode;
}) {
  return (
    <div className="grid min-w-0 gap-3 px-4 py-3.5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center sm:px-5">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="truncate text-sm font-semibold text-[var(--ink)]">{title}</h3>
          {status && status !== "ready" ? (
            <Badge tone={status === "warning" ? "warning" : "neutral"}>
              {status === "warning" ? "需处理" : "已停用"}
            </Badge>
          ) : null}
          {meta}
        </div>
        <p className="mt-1 max-w-[90ch] text-xs leading-5 text-[var(--muted-strong)]">
          {description}
        </p>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 lg:justify-end [&_button]:min-h-8 [&_button]:px-2.5 [&_button]:text-xs">
        {children}
        {onEdit ? (
          <Button variant="ghost" onClick={onEdit}>
            编辑
          </Button>
        ) : null}
        {onDelete ? (
          <Button variant="ghost" onClick={onDelete}>
            删除
          </Button>
        ) : null}
      </div>
    </div>
  );
}

export function FormError({ error }: { error: unknown }) {
  if (!error) return null;
  return (
    <p className="rounded-[var(--radius-sm)] border border-[var(--danger-border)] bg-[var(--danger-bg)] px-3 py-2 text-xs text-[var(--danger)]">
      {describeError(error)}
    </p>
  );
}

export function describeError(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  try {
    return JSON.stringify(error) ?? "请求失败";
  } catch {
    return "请求失败";
  }
}

export function splitLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .map((item) => item.trim())
    .filter(Boolean);
}
