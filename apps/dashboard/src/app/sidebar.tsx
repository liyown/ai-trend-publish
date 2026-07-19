import { Link, useNavigate } from "@tanstack/react-router";
import { PanelLeftClose, PanelLeftOpen, Search, X } from "lucide-react";
import { IconButton } from "#components/ui/button.tsx";
import { cn } from "#lib/utils.ts";
import { navDomains, type NavItem } from "./navigation.ts";

export function ProductSidebar({
  activeItem,
  collapsed,
  open,
  onClose,
  onCommand,
  onSelect,
  onToggleCollapsed,
}: {
  activeItem: NavItem;
  collapsed: boolean;
  open: boolean;
  onClose(): void;
  onCommand(): void;
  onSelect(): void;
  onToggleCollapsed(): void;
}) {
  const navigate = useNavigate();
  return (
    <aside
      aria-label="工作台导航"
      className={cn(
        "fixed inset-y-0 left-0 z-40 w-[288px] max-w-[calc(100vw-20px)] -translate-x-full overflow-hidden border-r border-[var(--border)] bg-[var(--surface)] shadow-xl transition-[transform,width]",
        "lg:inset-y-3 lg:left-3 lg:translate-x-0 lg:rounded-[var(--radius-lg)] lg:border lg:border-[color-mix(in_srgb,var(--border)_82%,transparent)] lg:shadow-[var(--shadow-card)]",
        collapsed ? "lg:w-[72px]" : "lg:w-[252px]",
        open && "translate-x-0",
      )}
    >
      <div className="flex h-full min-h-0 flex-col">
        <div
          className={cn(
            "flex h-[60px] shrink-0 items-center gap-2 border-b border-[color-mix(in_srgb,var(--border)_60%,transparent)] px-4",
            collapsed && "lg:justify-center lg:px-2",
          )}
        >
          <button
            className={cn(
              "flex min-w-0 flex-1 items-center gap-3 text-left",
              collapsed && "lg:flex-none",
            )}
            onClick={() => {
              onSelect();
              void navigate({ to: "/workspace" });
            }}
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-[10px] border border-[var(--border)] text-xs font-black">
              TP
            </span>
            <span className={cn("min-w-0", collapsed && "lg:hidden")}>
              <span className="block text-[10px] font-semibold uppercase text-[var(--muted)]">
                TrendPublish
              </span>
              <span className="mt-0.5 block truncate text-base font-semibold">内容工作台</span>
            </span>
          </button>
          <IconButton
            label="搜索"
            variant="ghost"
            className={cn("size-9 min-h-0", collapsed && "lg:hidden")}
            onClick={onCommand}
          >
            <Search className="size-4" />
          </IconButton>
          <IconButton
            label="关闭导航"
            variant="ghost"
            className="size-9 min-h-0 lg:hidden"
            onClick={onClose}
          >
            <X className="size-4" />
          </IconButton>
        </div>
        <nav
          aria-label="工作台入口"
          className={cn("min-h-0 flex-1 overflow-y-auto px-4 py-4", collapsed && "lg:px-2")}
        >
          <div className="grid gap-5">
            {navDomains.map((domain) => (
              <section key={domain.id} className="grid gap-1">
                <div
                  className={cn(
                    "px-1.5 text-[11px] font-semibold text-[var(--muted)]",
                    collapsed && "lg:sr-only",
                  )}
                >
                  {domain.label}
                </div>
                {domain.items.map((item) => {
                  const Icon = item.icon;
                  const active = item.to === activeItem.to;
                  return (
                    <Link
                      key={item.to}
                      to={item.to}
                      onClick={onSelect}
                      title={collapsed ? item.label : undefined}
                      className={cn(
                        "flex min-h-10 items-center gap-2 rounded-[10px] px-2 text-sm transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]",
                        collapsed && "lg:size-10 lg:justify-center lg:px-0",
                        active
                          ? "bg-[var(--surface-3)] font-semibold text-[var(--ink)]"
                          : "text-[var(--muted-strong)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]",
                      )}
                    >
                      <Icon className="size-4 shrink-0" />
                      <span className={cn("truncate", collapsed && "lg:hidden")}>{item.label}</span>
                    </Link>
                  );
                })}
              </section>
            ))}
          </div>
        </nav>
        <div className="border-t border-[color-mix(in_srgb,var(--border)_60%,transparent)] p-3">
          <IconButton
            label={collapsed ? "展开侧栏" : "收起侧栏"}
            variant="ghost"
            className={cn(
              "hidden min-h-0 lg:inline-flex",
              collapsed ? "size-10" : "h-10 w-full justify-start px-2",
            )}
            onClick={onToggleCollapsed}
          >
            {collapsed ? (
              <PanelLeftOpen className="size-5" />
            ) : (
              <>
                <PanelLeftClose className="size-5" />
                <span>收起侧栏</span>
              </>
            )}
          </IconButton>
        </div>
      </div>
    </aside>
  );
}
