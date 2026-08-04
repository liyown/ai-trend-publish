import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { listRuns } from "#platform/api/runs.ts";
import { Button } from "#components/ui/button.tsx";
import { Badge } from "#components/ui/badge.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { Pagination } from "#components/ui/pagination.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";
import { runStatusLabel, runStatusTone, runSummary, runTitle } from "./jobs/-run-presentation.ts";

const PAGE_SIZE = 20;
export const runsKey = () => ["runs"] as const;

export const Route = createFileRoute("/_app/jobs")({
  validateSearch: (search: Record<string, unknown>) => ({ page: Number(search.page ?? 1) || 1 }),
  component: RunsPage,
});

function RunsPage() {
  const { page } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data } = useQuery({
    queryKey: [...runsKey(), page],
    queryFn: () => listRuns(page, PAGE_SIZE),
    refetchInterval: 2_000,
  });
  const runs = data?.items ?? [];
  return (
    <PageGrid>
      <EntityList
        title="运行记录"
        description="每条记录包含一个动态主会话和独立的多渠道发布会话。"
        empty={!runs.length}
        emptyTitle="还没有运行记录"
        emptyDescription="运行内容方案、自动任务或手动发布后会显示在这里。"
        pagination={
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={data?.total ?? 0}
            onChange={(next) => navigate({ search: { page: next } })}
          />
        }
      >
        {runs.map((run) => (
          <EntityRow
            key={run.id}
            title={runTitle(run)}
            description={`${run.planName ?? (run.kind === "publication" ? "独立发布" : "内容方案")} · ${runSummary(run)} · ${new Date(run.createdAt).toLocaleString()}`}
            status={
              run.status === "succeeded"
                ? "ready"
                : run.status === "failed" ||
                    run.status === "partial" ||
                    run.status === "needs_attention"
                  ? "warning"
                  : "disabled"
            }
            meta={<Badge tone={runStatusTone(run.status)}>{runStatusLabel(run.status)}</Badge>}
          >
            <Button onClick={() => navigate({ to: "/jobs/$runId", params: { runId: run.id } })}>
              查看
            </Button>
          </EntityRow>
        ))}
      </EntityList>
    </PageGrid>
  );
}
