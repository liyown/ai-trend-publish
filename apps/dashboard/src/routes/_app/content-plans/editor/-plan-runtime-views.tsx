import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Bug } from "lucide-react";
import type { JobRecord } from "#platform/api/types.ts";
import { startArticleGeneration } from "#platform/api/articles.ts";
import { useJobMonitor } from "#platform/api/use-job-monitor.ts";
import { useWorkspaceRefresh } from "#platform/api/use-workspace-snapshot.ts";
import { Button } from "#components/ui/button.tsx";
import { Badge } from "#components/ui/badge.tsx";
import { Textarea } from "#components/ui/textarea.tsx";
import { EmptyState } from "#components/product/empty-state.tsx";
import { FormField } from "#components/product/form-field.tsx";
import { cn } from "#lib/utils.ts";
import { FormError } from "#components/product/form-error.tsx";
import { jobStatusTone, jobTypeLabel } from "../../jobs/-job-presentation.ts";
import { PipelineRunDetail } from "./-pipeline-run-detail.tsx";

export function ContentPlanDebugView({ planId, dirty }: { planId?: string; dirty: boolean }) {
  const refresh = useWorkspaceRefresh();
  const [topic, setTopic] = useState("");
  const [jobId, setJobId] = useState<string | null>(null);
  const run = useMutation({
    mutationFn: () =>
      startArticleGeneration({
        planId: planId!,
        requestedTopic: topic.trim() || undefined,
      }),
    onSuccess: (data: { job: { id: string } }) => {
      setJobId(data.job.id);
      refresh();
    },
  });
  const detail = useJobMonitor(jobId);
  if (!planId)
    return (
      <EmptyState
        className="min-h-[420px] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
        title="保存后可以调试"
        description="调试会使用已保存的内容方案真实运行一次生成流程。"
      />
    );
  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(320px,0.8fr)_minmax(0,1.2fr)]">
      <section className="self-start rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-5">
        <h2 className="text-sm font-semibold">运行调试</h2>
        <p className="mt-1 text-xs leading-5 text-[var(--muted-strong)]">
          使用当前已保存配置运行完整生成流程，只生成内容，不执行发布。
        </p>
        <FormField label="指定主题" helper="留空时由固定流程根据抓取来源完成选题" className="mt-5">
          <Textarea
            className="min-h-28"
            value={topic}
            onChange={(event) => setTopic(event.target.value)}
            placeholder="例如：本周 AI 基础设施的重要变化"
          />
        </FormField>
        {dirty ? (
          <p className="mt-3 text-xs text-[var(--warning)]">
            当前有未保存修改，保存后才能调试最新配置。
          </p>
        ) : null}
        <FormError error={run.error} />
        <Button
          className="mt-4"
          variant="primary"
          loading={run.isPending}
          disabled={dirty}
          onClick={() => run.mutate()}
        >
          <Bug className="size-4" />
          开始调试
        </Button>
      </section>
      <PipelineRunDetail
        data={detail.data}
        loading={Boolean(jobId) && detail.isLoading}
        error={detail.error}
        runtimeEvents={detail.runtimeEvents}
        streamError={detail.streamError}
      />
    </div>
  );
}

export function PlanRunHistoryView({ planId, jobs }: { planId?: string; jobs: JobRecord[] }) {
  const related = planId ? jobs.filter((job) => jobPlanId(job) === planId) : [];
  const [selected, setSelected] = useState<string | null>(null);
  const detail = useJobMonitor(selected);
  if (!planId)
    return (
      <EmptyState
        className="min-h-[420px] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)]"
        title="保存后显示运行记录"
        description="运行记录会按内容方案过滤，只展示与当前方案有关的执行记录。"
      />
    );
  return (
    <div className="grid gap-4 lg:grid-cols-[220px_minmax(0,1fr)] xl:grid-cols-[240px_minmax(0,1fr)]">
      <section className="overflow-hidden rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] lg:flex lg:max-h-[calc(100dvh-10rem)] lg:flex-col lg:self-start">
        <div className="shrink-0 border-b border-[var(--border)] px-4 py-3.5">
          <h2 className="text-sm font-semibold">运行记录</h2>
          <p className="mt-1 text-xs text-[var(--muted-strong)]">当前内容方案的生成与修订记录。</p>
        </div>
        {related.length ? (
          <div className="divide-y divide-[var(--border)] lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {related.map((job) => (
              <button
                key={job.id}
                type="button"
                onClick={() => setSelected(job.id)}
                className={cn(
                  "grid w-full gap-2 px-4 py-3 text-left transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)]",
                  selected === job.id && "bg-[var(--surface-2)]",
                )}
              >
                <span className="flex items-center justify-between gap-3">
                  <strong className="text-sm font-medium">{jobTypeLabel(job.type)}</strong>
                  <Badge tone={jobStatusTone(job.status)}>{job.status}</Badge>
                </span>
                <span className="text-xs text-[var(--muted)]">
                  {new Date(job.createdAt).toLocaleString()}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState
            className="min-h-64"
            title="还没有运行记录"
            description="完成一次调试或任务运行后会显示在这里。"
          />
        )}
      </section>
      <PipelineRunDetail
        data={detail.data}
        loading={Boolean(selected) && detail.isLoading}
        error={detail.error}
        runtimeEvents={detail.runtimeEvents}
        streamError={detail.streamError}
      />
    </div>
  );
}

function jobPlanId(job: JobRecord): string | undefined {
  if (!job.input || typeof job.input !== "object" || Array.isArray(job.input)) return undefined;
  const value = (job.input as Record<string, unknown>).planId;
  return typeof value === "string" ? value : undefined;
}
