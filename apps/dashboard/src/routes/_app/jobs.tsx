import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { listJobs, resumeJob } from "#platform/api/jobs.ts";
import type { JobRecord } from "#platform/api/types.ts";
import { useState } from "react";
import { JobStatus, TaskStatus } from "@trendpublish/contracts";
import { RotateCcw } from "lucide-react";
import { useJobMonitor } from "#platform/api/use-job-monitor.ts";
import { Button } from "#components/ui/button.tsx";
import { AppDialog } from "#components/product/app-dialog.tsx";
import { Badge } from "#components/ui/badge.tsx";
import { EntityList, EntityRow } from "#components/product/entity-list.tsx";
import { Pagination } from "#components/ui/pagination.tsx";
import { FormError } from "#components/product/form-error.tsx";
import { PageGrid } from "#components/product/page-grid.tsx";
import { isResumableJob, jobStatusTone, jobTypeLabel } from "./jobs/-job-presentation.ts";
import { JobActivityView } from "./jobs/-job-activity-view.tsx";

const PAGE_SIZE = 20;

export const jobsKey = () => ["jobs"] as const;
export const jobKey = (id: string) => ["jobs", id] as const;

export function useJobs(page = 1) {
  return useQuery({
    queryKey: [...jobsKey(), page] as const,
    queryFn: () => listJobs(page, PAGE_SIZE),
  });
}

export function useResumeJob() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (job: Pick<JobRecord, "id" | "type">) => resumeJob(job),
    onSuccess: () => qc.invalidateQueries({ queryKey: jobsKey() }),
  });
}

export const Route = createFileRoute("/_app/jobs")({
  validateSearch: (search: Record<string, unknown>) => ({
    page: Number(search["page"] ?? 1) || 1,
  }),
  component: JobsPage,
});

function JobsPage() {
  const { page } = Route.useSearch();
  const navigate = Route.useNavigate();
  const { data } = useJobs(page);
  const [selected, setSelected] = useState<string | null>(null);
  const jobs = data?.items ?? [];
  return (
    <PageGrid>
      <EntityList
        title="运行记录"
        description="打开任务可查看真实检查点、尝试次数和副作用类型。"
        empty={!jobs.length}
        pagination={
          <Pagination
            page={page}
            pageSize={PAGE_SIZE}
            total={data?.total ?? 0}
            onChange={(p) => navigate({ search: (previous) => ({ ...previous, page: p }) })}
          />
        }
      >
        {jobs.map((job) => (
          <EntityRow
            key={job.id}
            title={jobTypeLabel(job.type)}
            description={job.error || new Date(job.createdAt).toLocaleString()}
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
          >
            <Button onClick={() => setSelected(job.id)}>查看</Button>
          </EntityRow>
        ))}
      </EntityList>
      <JobDialog jobId={selected} onOpenChange={(open) => !open && setSelected(null)} />
    </PageGrid>
  );
}

function JobDialog({
  jobId,
  onOpenChange,
}: {
  jobId: string | null;
  onOpenChange(open: boolean): void;
}) {
  const { data, error, runtimeEvents, streamState, streamError } = useJobMonitor(jobId);
  const resume = useResumeJob();
  return (
    <AppDialog
      open={Boolean(jobId)}
      onOpenChange={onOpenChange}
      title="运行详情"
      description={data?.job.id ?? jobId ?? ""}
      size="wide"
    >
      <div className="grid gap-5">
        {error ? <FormError error={error} /> : null}
        {data ? (
          <>
            <div className="flex flex-wrap items-center gap-2">
              <Badge>{jobTypeLabel(data.job.type)}</Badge>
              <Badge tone={jobStatusTone(data.job.status)}>{data.job.status}</Badge>
              <span className="text-xs text-[var(--muted)]">
                {new Date(data.job.createdAt).toLocaleString()}
              </span>
              {isResumableJob(data.job) &&
              (data.job.status === JobStatus.Failed ||
                data.job.status === JobStatus.NeedsAttention) ? (
                <Button
                  className="ml-auto"
                  loading={resume.isPending}
                  onClick={() => resume.mutate(data.job)}
                >
                  <RotateCcw className="size-4" />
                  继续任务
                </Button>
              ) : null}
            </div>
            {data.job.error ? <FormError error={new Error(data.job.error)} /> : null}
            <JobActivityView
              events={runtimeEvents}
              tasks={data.tasks}
              jobStatus={data.job.status}
              streamState={streamState}
              streamError={streamError}
            />
            <section className="divide-y divide-[var(--border)] border-y border-[var(--border)]">
              {data.tasks.map((task) => (
                <div
                  key={task.taskId}
                  className="grid gap-2 py-3 md:grid-cols-[minmax(0,1fr)_120px_100px_100px]"
                >
                  <span className="truncate font-mono text-xs">{task.taskId}</span>
                  <Badge>{task.effect}</Badge>
                  <Badge
                    tone={
                      task.status === TaskStatus.Succeeded
                        ? "success"
                        : task.status === TaskStatus.Unknown || task.status === TaskStatus.Failed
                          ? "danger"
                          : "warning"
                    }
                  >
                    {task.status}
                  </Badge>
                  <span className="text-xs">尝试 {task.attempt}</span>
                  {task.error ? (
                    <p className="text-xs text-[var(--danger)] md:col-span-4">{task.error}</p>
                  ) : null}
                </div>
              ))}
            </section>
          </>
        ) : (
          <div className="h-32 animate-pulse rounded bg-[var(--surface-2)]" />
        )}
      </div>
    </AppDialog>
  );
}
