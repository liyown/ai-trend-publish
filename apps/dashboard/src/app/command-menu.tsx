import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Search } from "lucide-react";
import { AppDialog } from "#components/product/app-dialog.tsx";
import { Input } from "#components/ui/input.tsx";
import { navItems } from "./navigation.ts";

export function CommandMenu({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange(open: boolean): void;
}) {
  const [query, setQuery] = useState("");
  const navigate = useNavigate();
  const filtered = useMemo(() => {
    const value = query.trim().toLowerCase();
    return value
      ? navItems.filter((item) =>
          `${item.label}${item.description}${item.detail}`.toLowerCase().includes(value),
        )
      : navItems;
  }, [query]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        onOpenChange(!open);
      }
    };
    globalThis.addEventListener("keydown", handler);
    return () => globalThis.removeEventListener("keydown", handler);
  }, [open, onOpenChange]);
  return (
    <AppDialog
      open={open}
      onOpenChange={onOpenChange}
      title="快速跳转"
      description="搜索页面和配置入口。"
    >
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-[var(--muted)]" />
        <Input
          autoFocus
          className="pl-9"
          placeholder="搜索页面"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </div>
      <div className="mt-3 grid gap-1">
        {filtered.map((item) => {
          const Icon = item.icon;
          return (
            <button
              key={item.to}
              className="flex min-h-12 items-center gap-3 rounded px-3 text-left hover:bg-[var(--surface-2)]"
              onClick={() => {
                onOpenChange(false);
                void navigate({ to: item.to });
              }}
            >
              <Icon className="size-4" />
              <span>
                <strong className="block text-sm">{item.label}</strong>
                <span className="text-xs text-[var(--muted)]">{item.detail}</span>
              </span>
            </button>
          );
        })}
      </div>
    </AppDialog>
  );
}
