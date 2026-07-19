import { JobStatus, JobType } from "@trendpublish/contracts";
import { ListTodo } from "lucide-react";
import { useWorkspaceSnapshot } from "#platform/api/use-workspace-snapshot.ts";
import { Button } from "#components/ui/button.tsx";
import { Badge } from "#components/ui/badge.tsx";
import { EntityList, EntityRow, FormError, StudioPage } from "./common.tsx";

export function WorkspacePage() {
  const { data: workspace, isLoading, error } = useWorkspaceSnapshot();
  if (isLoading) return <div className="h-48 animate-pulse rounded bg-[var(--surface-2)]" />;
  if (error || !workspace) return <FormError error={error ?? new Error("工作台不可用")} />;

  return (
    <StudioPage>
      <EntityList
        title="最近运行"
        description="查看自动化任务、内容生成和发布的最近执行结果。"
        action={
          <Button onClick={() => (window.location.href = "/dashboard/automations")}>
            <ListTodo className="size-4" />
            查看任务
          </Button>
        }
        empty={!workspace.jobs.length}
      >
        {workspace.jobs.slice(0, 8).map((job) => (
          <EntityRow
            key={job.id}
            title={
              job.type === JobType.RunAutomation
                ? "自动化任务运行"
                : job.type === JobType.GenerateArticle
                  ? "文章生成"
                  : job.type === JobType.PublishContent
                    ? "内容发布"
                    : job.type
            }
            description={job.error || `创建于 ${new Date(job.createdAt).toLocaleString()}`}
            status={
              job.status === JobStatus.Succeeded
                ? "ready"
                : job.status === JobStatus.Failed ||
                    job.status === JobStatus.NeedsAttention ||
                    job.status === JobStatus.Degraded
                  ? "warning"
                  : "disabled"
            }
            meta={<Badge>{job.status}</Badge>}
          />
        ))}
      </EntityList>
    </StudioPage>
  );
}
