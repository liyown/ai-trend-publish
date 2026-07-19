import { Suspense, useState } from "react";
import { Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AlertTriangle, ChevronRight, Command, LogOut, Menu, RefreshCw } from "lucide-react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "./auth.tsx";
import { CommandMenu } from "./command-menu.tsx";
import { ProductSidebar } from "./sidebar.tsx";
import { Button, IconButton } from "#components/ui/button.tsx";
import { Skeleton } from "#components/ui/skeleton.tsx";
import { cn } from "../lib/utils.ts";
import type { ContentIdentity } from "#platform/api/types.ts";
import { useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { dashboardQueryKeys } from "#platform/api/query-keys.ts";
import {
  dashboardErrorMessage,
  isUnauthorizedDashboardError,
} from "../platform/api/dashboard-errors.ts";
import {
  activeNavigation,
  type DashboardRoute,
  type NavDomain,
  type NavItem,
} from "./navigation.ts";

const SIDEBAR_COLLAPSED_KEY = "trendpublish.sidebar.collapsed";

export function WorkspaceShell() {
  const { apiKey, logout } = useAuth();
  const [navOpen, setNavOpen] = useState(false);
  const [commandOpen, setCommandOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readSidebarCollapsed);
  const pathname = useRouterState({
    select: (state) => state.location.pathname,
  });
  const { domain: activeDomain, item: activeItem } = activeNavigation(pathname);
  const snapshot = useWorkspaceSnapshot();
  const queryClient = useQueryClient();
  const header = workspaceHeaderModel({
    activeDomain,
    activeItem,
    pathname,
    identities: snapshot.data?.identities ?? [],
  });
  const snapshotError = snapshot.error;
  const unauthorized = isUnauthorizedDashboardError(snapshotError);

  const refreshWorkspace = () =>
    void queryClient.invalidateQueries({
      queryKey: dashboardQueryKeys(apiKey).root,
    });

  const toggleCollapsed = () => {
    setCollapsed((current) => {
      const next = !current;
      writeSidebarCollapsed(next);
      return next;
    });
  };

  return (
    <div className="min-h-dvh bg-[var(--paper)] text-[var(--ink)]">
      <ProductSidebar
        activeItem={activeItem}
        collapsed={collapsed}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        onCommand={() => setCommandOpen(true)}
        onSelect={() => setNavOpen(false)}
        onToggleCollapsed={toggleCollapsed}
      />

      {navOpen && (
        <button
          type="button"
          aria-label="关闭导航遮罩"
          className="fixed inset-0 z-30 bg-black/36 backdrop-blur-[2px] lg:hidden"
          onClick={() => setNavOpen(false)}
        />
      )}

      <div
        className={cn(
          "flex min-h-dvh flex-col transition-[padding] duration-[var(--motion-base)] ease-[var(--ease-standard)]",
          collapsed ? "lg:pl-[84px]" : "lg:pl-[276px]",
        )}
      >
        <WorkspaceTopBar
          header={header}
          onOpenNavigation={() => setNavOpen(true)}
          onOpenCommand={() => setCommandOpen(true)}
          onRefresh={refreshWorkspace}
          onLogout={logout}
        />
        <main className="flex-1 min-w-0 w-full px-3 pb-3 sm:px-4 lg:px-5 lg:pb-5">
          <div className="grid gap-4">
            {snapshotError && (
              <WorkspaceStatusBanner
                error={snapshotError}
                unauthorized={unauthorized}
                onRefresh={refreshWorkspace}
                onLogout={logout}
              />
            )}
            <div className="motion-page">
              <Suspense fallback={<DashboardContentFallback activeItem={activeItem} />}>
                <Outlet />
              </Suspense>
            </div>
          </div>
        </main>
      </div>
      <CommandMenu open={commandOpen} onOpenChange={setCommandOpen} />
    </div>
  );
}

function DashboardContentFallback({ activeItem }: { activeItem: NavItem }) {
  return (
    <section aria-busy="true" aria-label={`${activeItem.label}加载中`} className="grid gap-5">
      <div className="grid gap-2">
        <Skeleton className="h-4 w-24" />
        <Skeleton className="h-8 w-[min(420px,70%)]" />
        <Skeleton className="h-4 w-[min(560px,82%)]" />
      </div>
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,0.85fr)]">
        <Skeleton className="min-h-[260px]" />
        <div className="grid gap-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-32" />
        </div>
      </div>
    </section>
  );
}

function WorkspaceTopBar({
  header,
  onOpenNavigation,
  onOpenCommand,
  onRefresh,
  onLogout,
}: {
  header: WorkspaceHeaderModel;
  onOpenNavigation: () => void;
  onOpenCommand: () => void;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="sticky top-3 z-20 mx-3 mt-3 mb-4 rounded-[var(--radius-lg)] border border-[color-mix(in_srgb,var(--border)_82%,transparent)] bg-[color-mix(in_srgb,var(--surface)_88%,transparent)] shadow-[var(--shadow-soft)] backdrop-blur-xl sm:mx-4 lg:mx-5">
      <div className="flex min-h-[60px] items-center justify-between gap-4 px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <IconButton
            label="打开导航"
            variant="ghost"
            className="min-h-0 size-10 lg:hidden"
            onClick={onOpenNavigation}
          >
            <Menu className="size-5" />
          </IconButton>
          <div className="min-w-0">
            <WorkspaceBreadcrumbs breadcrumbs={header.breadcrumbs} />
            <div className="mt-0.5 flex min-w-0 items-baseline gap-3">
              <h1 className="truncate text-lg font-semibold text-[var(--ink)]">{header.title}</h1>
              <p className="hidden truncate text-sm text-[var(--muted-strong)] md:block">
                {header.detail}
              </p>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 items-center gap-2">
          <Button
            size="sm"
            variant="secondary"
            className="hidden min-w-[136px] justify-start md:inline-flex"
            onClick={onOpenCommand}
          >
            <Command className="size-4" />
            快速跳转
            <span className="ml-auto rounded border border-[color-mix(in_srgb,var(--border)_74%,transparent)] px-1.5 py-0.5 text-[10px] text-[var(--muted)]">
              ⌘K
            </span>
          </Button>
          <IconButton
            label="刷新数据"
            variant="secondary"
            className="min-h-0 size-9"
            onClick={onRefresh}
          >
            <RefreshCw className="size-4" />
          </IconButton>
          <IconButton
            label="退出工作台"
            variant="ghost"
            className="min-h-0 size-9"
            onClick={onLogout}
          >
            <LogOut className="size-4" />
          </IconButton>
        </div>
      </div>
    </header>
  );
}

type WorkspaceHeaderCrumb = {
  label: string;
  to?: DashboardRoute;
};

type WorkspaceHeaderModel = {
  breadcrumbs: WorkspaceHeaderCrumb[];
  title: string;
  detail: string;
};

function WorkspaceBreadcrumbs({ breadcrumbs }: { breadcrumbs: WorkspaceHeaderCrumb[] }) {
  return (
    <nav
      aria-label="当前位置"
      className="flex min-w-0 items-center gap-1.5 text-[11px] font-medium text-[var(--muted)]"
    >
      {breadcrumbs.map((crumb, index) => {
        const isLast = index === breadcrumbs.length - 1;
        return (
          <span key={`${crumb.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
            {crumb.to && !isLast ? (
              <Link
                to={crumb.to}
                className="truncate rounded-[6px] transition hover:text-[var(--ink)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--focus)]"
              >
                {crumb.label}
              </Link>
            ) : (
              <span
                aria-current={isLast ? "page" : undefined}
                className={cn("truncate", isLast && "text-[var(--muted-strong)]")}
              >
                {crumb.label}
              </span>
            )}
            {!isLast && <ChevronRight className="size-3.5 shrink-0" />}
          </span>
        );
      })}
    </nav>
  );
}

function workspaceHeaderModel({
  activeDomain,
  activeItem,
  pathname,
  identities,
}: {
  activeDomain: NavDomain;
  activeItem: NavItem;
  pathname: string;
  identities: ContentIdentity[];
}): WorkspaceHeaderModel {
  const breadcrumbs: WorkspaceHeaderCrumb[] = [
    { label: activeDomain.label, to: activeDomain.items[0]?.to },
    { label: activeItem.label },
  ];
  const identityId = identityIdFromPath(pathname);

  if (pathname === "/content-plans/new" || /^\/content-plans\/[^/]+\/edit$/.test(pathname)) {
    const creating = pathname === "/content-plans/new";
    return {
      breadcrumbs: [
        { label: activeDomain.label, to: activeDomain.items[0]?.to },
        { label: activeItem.label, to: activeItem.to },
        { label: creating ? "新建" : "编辑" },
      ],
      title: creating ? "新建内容方案" : "编辑内容方案",
      detail: "分步配置身份、参考输入、处理插件与发布目标。",
    };
  }

  if (activeItem.to === "/identities" && identityId) {
    const identity = identities.find((item) => item.id === identityId);
    const identityName = identity?.name || "身份详情";
    return {
      breadcrumbs: [
        { label: activeDomain.label, to: activeDomain.items[0]?.to },
        { label: activeItem.label, to: activeItem.to },
        { label: identityName },
      ],
      title: identityName,
      detail: "内容身份详情",
    };
  }

  return {
    breadcrumbs,
    title: activeItem.label,
    detail: activeItem.detail,
  };
}

function identityIdFromPath(pathname: string) {
  const match = pathname.match(/^\/identities\/([^/?#]+)/);
  if (!match?.[1]) return "";
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function WorkspaceStatusBanner({
  error,
  unauthorized,
  onRefresh,
  onLogout,
}: {
  error: unknown;
  unauthorized: boolean;
  onRefresh: () => void;
  onLogout: () => void;
}) {
  return (
    <section className="rounded-[var(--radius)] border border-[var(--warning-border)] bg-[var(--warning-bg)] px-4 py-3">
      <div className="flex w-full min-w-0 flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-center gap-3">
          <span className="grid size-7 shrink-0 place-items-center text-[var(--warning)]">
            <AlertTriangle className="size-4" />
          </span>
          <div className="min-w-0">
            <p className="text-sm text-[var(--ink)]">
              <strong className="font-semibold">
                {unauthorized ? "访问凭证需要更新" : "工作台数据暂时不可用"}
              </strong>
              <span className="ml-2 text-[var(--muted-strong)]">
                {unauthorized
                  ? "当前访问凭证已失效或权限不足。请重新进入工作台。"
                  : dashboardErrorMessage(error)}
              </span>
            </p>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
          <Button type="button" variant="secondary" onClick={onRefresh}>
            <RefreshCw className="size-4" />
            重试
          </Button>
          {unauthorized && (
            <Button type="button" variant="primary" onClick={onLogout}>
              <LogOut className="size-4" />
              重新进入
            </Button>
          )}
        </div>
      </div>
    </section>
  );
}

function readSidebarCollapsed() {
  if (typeof localStorage === "undefined") return false;
  return localStorage.getItem(SIDEBAR_COLLAPSED_KEY) === "true";
}

function writeSidebarCollapsed(value: boolean) {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(SIDEBAR_COLLAPSED_KEY, String(value));
}
