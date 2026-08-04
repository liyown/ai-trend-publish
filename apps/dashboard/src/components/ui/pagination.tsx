import { ChevronLeft, ChevronRight } from "lucide-react";
import type React from "react";
import { cn } from "#lib/utils.ts";

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onChange(page: number): void;
  className?: string;
}

export function Pagination({ page, pageSize, total, onChange, className }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  if (totalPages <= 1) return null;

  const pages = buildPageList(page, totalPages);

  return (
    <nav
      aria-label="分页导航"
      className={cn("flex items-center justify-between gap-4 px-4 py-3 sm:px-5", className)}
    >
      <p className="text-xs text-[var(--muted-strong)]">
        第 {(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} 条，共 {total} 条
      </p>
      <div className="flex items-center gap-1">
        <PageButton
          label="上一页"
          icon={<ChevronLeft className="size-4" />}
          disabled={page <= 1}
          onClick={() => onChange(page - 1)}
        />
        {pages.map((p, i) =>
          p === "ellipsis" ? (
            <span
              key={`ellipsis-${i}`}
              className="flex size-8 items-center justify-center text-xs text-[var(--muted)]"
            >
              …
            </span>
          ) : (
            <PageButton key={p} label={String(p)} active={p === page} onClick={() => onChange(p)} />
          ),
        )}
        <PageButton
          label="下一页"
          icon={<ChevronRight className="size-4" />}
          disabled={page >= totalPages}
          onClick={() => onChange(page + 1)}
        />
      </div>
    </nav>
  );
}

function PageButton({
  label,
  icon,
  active,
  disabled,
  onClick,
}: {
  label: string;
  icon?: React.ReactNode;
  active?: boolean;
  disabled?: boolean;
  onClick(): void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      aria-current={active ? "page" : undefined}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex size-8 items-center justify-center rounded-[var(--radius-xs)] text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
        active
          ? "bg-[var(--ink)] font-semibold text-[var(--surface)]"
          : disabled
            ? "cursor-not-allowed text-[var(--muted)] opacity-40"
            : "text-[var(--muted-strong)] hover:bg-[var(--surface-3)] hover:text-[var(--ink)]",
      )}
    >
      {icon ?? label}
    </button>
  );
}

function buildPageList(current: number, total: number): Array<number | "ellipsis"> {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const pages: Array<number | "ellipsis"> = [];
  pages.push(1);
  if (current > 4) pages.push("ellipsis");
  for (let p = Math.max(2, current - 1); p <= Math.min(total - 1, current + 1); p++) {
    pages.push(p);
  }
  if (current < total - 3) pages.push("ellipsis");
  pages.push(total);
  return pages;
}
