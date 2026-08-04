import { useEffect } from "react";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listRuns } from "#platform/api/runs.ts";
import { Badge } from "#components/ui/badge.tsx";
import { EmptyState } from "#components/product/empty-state.tsx";
import { FormError } from "#components/product/form-error.tsx";
import { cn } from "#lib/utils.ts";
import { RunDetailView } from "../../jobs/-run-detail-view.tsx";
import { runInstanceTitle, runStatusLabel, runStatusTone } from "../../jobs/-run-presentation.ts";
import { Route as AppRoute } from "../../../_app.tsx";

export function PlanRunHistoryView({
  planId,
  startedRunId,
  runError,
}: {
  planId?: string;
  startedRunId: string | null;
  runError: unknown;
}) {
  const navigate = useNavigate();
  const search = AppRoute.useSearch();
  const { data } = useQuery({
    queryKey: ["runs", "plan", planId],
    queryFn: () => listRuns(1, 100, planId),
    enabled: Boolean(planId),
    refetchInterval: 2_000,
  });
  const runs = data?.items ?? [];
  const selected =
    typeof search.run === "string" && runs.some((run) => run.id === search.run)
      ? search.run
      : (runs[0]?.id ?? null);
  useEffect(() => {
    if (!startedRunId) return;
    void navigate({
      to: ".",
      search: (previous) => ({ ...previous, run: startedRunId }),
      replace: true,
      resetScroll: false,
    });
  }, [navigate, startedRunId]);
  if (!planId)
    return (
      <EmptyState
        className="min-h-[420px] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
        title="保存后显示运行记录"
        description="运行记录会按内容方案过滤。"
      />
    );
  return (
    <div className="grid min-h-0 gap-2 lg:h-full lg:grid-cols-[250px_minmax(0,1fr)] lg:overflow-hidden">
      <section className="flex min-h-0 flex-col overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]">
        <div className="border-b border-[var(--border)] px-4 py-3.5">
          <h2 className="text-sm font-semibold">运行记录</h2>
          <p className="mt-1 text-xs text-[var(--muted-strong)]">主会话与发布会话统一归档。</p>
        </div>
        {runs.length ? (
          <div className="scrollbar-stable min-h-0 flex-1 divide-y divide-[var(--border)] lg:overflow-y-auto lg:overscroll-contain">
            {runs.map((run) => (
              <button
                key={run.id}
                type="button"
                onClick={() =>
                  void navigate({
                    to: ".",
                    search: (previous) => ({ ...previous, run: run.id }),
                    resetScroll: false,
                  })
                }
                className={cn(
                  "flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left hover:bg-[var(--surface-2)]",
                  selected === run.id && "bg-[var(--surface-2)]",
                )}
              >
                <strong className="min-w-0 flex-1 truncate text-xs font-medium">
                  {runInstanceTitle(run)}
                </strong>
                <Badge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Badge>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            className="min-h-64"
            title="还没有运行记录"
            description="运行内容方案后会显示在这里。"
          />
        )}
      </section>
      <div className="flex min-h-0 flex-col overflow-hidden">
        <FormError error={runError} />
        <RunDetailView className="min-h-0 flex-1" runId={selected} planScoped />
      </div>
    </div>
  );
}
