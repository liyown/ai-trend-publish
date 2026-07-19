import { useState } from "react";
import { JobStatus, TaskStatus } from "@trendpublish/contracts";
import { ChevronDown, ChevronRight, Clock3 } from "lucide-react";
import type { JobRecord, RuntimeEvent, TaskRecord } from "#platform/api/types.ts";
import { Badge } from "#components/ui/badge.tsx";
import { cn } from "#lib/utils.ts";
import { FormError } from "#components/product/form-error.tsx";
import { jobStatusTone } from "../../jobs/-job-presentation.ts";
import {
  sortStepsByStart,
  stepDefaultsOpen,
  stepLabel,
  stepModelMetrics,
  stepModelText,
  stepSummary,
} from "./-pipeline-step-activity.ts";

export function PipelineRunDetail({
  data,
  loading,
  error,
  runtimeEvents,
  streamError,
}: {
  data?: {
    job: JobRecord;
    tasks: TaskRecord[];
  };
  loading: boolean;
  error: unknown;
  runtimeEvents: RuntimeEvent[];
  streamError?: string;
}) {
  const stages = data ? pipelineStages(data.tasks, Date.now()) : [];
  const [selectedStage, setSelectedStage] = useState<PipelineStageId | null>(null);
  const active = data
    ? data.job.status === JobStatus.Queued || data.job.status === JobStatus.Running
    : false;
  const selected =
    (selectedStage ? stages.find((stage) => stage.id === selectedStage) : undefined) ??
    (selectedStage ? undefined : defaultStage(stages)) ??
    stages[0];

  return (
    <section className="min-h-[420px] rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface)] p-4 lg:flex lg:h-[calc(100dvh-10rem)] lg:flex-col">
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5">
        <h2 className="text-sm font-semibold">流水线详情</h2>
        <p className="text-xs text-[var(--muted)]">
          按固定阶段查看耗时、重试、输入输出和失败信息。
        </p>
      </div>
      {error ? <FormError error={error} /> : null}
      {loading ? <div className="mt-5 h-32 animate-pulse rounded bg-[var(--surface-2)]" /> : null}
      {!loading && !data ? (
        <div className="grid min-h-72 place-items-center text-sm text-[var(--muted)]">
          选择或启动一次运行
        </div>
      ) : null}
      {data ? (
        <div className="mt-4 flex flex-1 flex-col gap-4 min-h-0">
          {data.job.error ? <FormError error={new Error(data.job.error)} /> : null}
          {active && streamError ? (
            <p className="rounded-[var(--radius-sm)] border border-[var(--warning-border)] bg-[var(--warning-bg)] px-3 py-2 text-[11px] leading-5 text-[var(--warning)]">
              实时连接不可用，正在通过任务快照更新。{streamError}
            </p>
          ) : null}
          <div className="flex-1 min-h-0 grid overflow-hidden rounded-[var(--radius)] border border-[var(--border)] lg:min-h-[360px] lg:grid-cols-[220px_minmax(0,1fr)]">
            <ol className="divide-y divide-[var(--border)] border-b border-[var(--border)] lg:overflow-y-auto lg:border-r lg:border-b-0">
              {stages.map((stage) => (
                <li key={stage.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedStage(stage.id)}
                    className={cn(
                      "grid w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-3 py-3 text-left transition-colors duration-[var(--motion-base)]",
                      selected?.id === stage.id && "bg-[var(--surface-2)]",
                    )}
                  >
                    <span className="min-w-0">
                      <strong className="block text-sm font-medium">{stage.name}</strong>
                      <span className="mt-0.5 flex items-center gap-1 text-[11px] text-[var(--muted)]">
                        <Clock3 className="size-3" />
                        {stage.duration ?? "尚未执行"}
                      </span>
                    </span>
                    <span className="flex items-center gap-1.5">
                      <Badge tone={jobStatusTone(stage.status)}>{stageStatusLabel(stage)}</Badge>
                      <ChevronRight className="size-3.5 text-[var(--muted)]" />
                    </span>
                  </button>
                </li>
              ))}
            </ol>
            {selected ? <StageDetail stage={selected} events={runtimeEvents} /> : null}
          </div>
        </div>
      ) : null}
    </section>
  );
}

type PipelineStageId = "research" | "compose" | "quality" | "build";

interface PipelineStage {
  id: PipelineStageId;
  name: string;
  description: string;
  tasks: TaskRecord[];
  status: TaskRecord["status"] | "pending";
  duration?: string;
}

const pipelineStageDefinitions: Array<Omit<PipelineStage, "tasks" | "status" | "duration">> = [
  {
    id: "research",
    name: "研究与规划",
    description: "搜索和抓取材料，形成选题、证据、论点与文章结构",
  },
  {
    id: "compose",
    name: "写作与处理",
    description: "根据研究简报生成文章来源，并运行内容 Transformer",
  },
  {
    id: "quality",
    name: "审查与修订",
    description: "执行质量评估，并按需补充证据和定向修订",
  },
  {
    id: "build",
    name: "编译与打包",
    description: "生产资源、编译 ArticleDocument 并冻结 ContentPackage",
  },
];

function pipelineStages(tasks: TaskRecord[], now: number): PipelineStage[] {
  return pipelineStageDefinitions.map((definition) => {
    const stageTasks = tasks.filter((task) => pipelineStageForTask(task.taskId) === definition.id);
    return {
      ...definition,
      tasks: stageTasks,
      status: stageStatus(stageTasks),
      duration: stageDuration(stageTasks, now),
    };
  });
}

/**
 * Picks which stage to open before the user has clicked one: the stage currently running, else the
 * last stage that has produced any task (where the run got to), else the first stage.
 */
function defaultStage(stages: PipelineStage[]): PipelineStage | undefined {
  const running = stages.find((stage) => stage.status === TaskStatus.Running);
  if (running) return running;
  const lastWithTasks = [...stages].reverse().find((stage) => stage.tasks.length > 0);
  return lastWithTasks ?? stages[0];
}

export function pipelineStageForTask(taskId: string): PipelineStageId | undefined {
  const segments = taskId.toLowerCase().split("/");
  const root = segments[0];
  if (root === "research") return "research";
  if (root === "compose" || root === "transform" || root === "generation") return "compose";
  if (root === "quality") return "quality";
  if (root === "build" || root === "finalization") return "build";
  if (segments[0] === "processing") {
    return segments.some((segment) =>
      ["review", "revise", "supplement", "evaluate"].includes(segment),
    )
      ? "quality"
      : "compose";
  }
  return undefined;
}

/**
 * Rolls a stage's tasks up to a single status.
 *
 * The rollup reflects only the stage's governing (top-level) tasks — the shallowest taskId depth in
 * the stage, e.g. the `research` / `compose` wrapper or the depth-2 `quality/review-request`. Deeper
 * leaves such as an individual `research/internal/fetch/…` are intentionally excluded: the pipeline
 * tolerates a single fetch/search connection failing (it records the failure and continues with the
 * remaining materials), so one failed sub-step must not flip the whole stage to 失败 while its
 * governing task actually succeeded. A genuine stage failure surfaces because the wrapper task
 * itself fails, and it is at the shallowest depth.
 */
export function stageStatus(tasks: TaskRecord[]): PipelineStage["status"] {
  if (!tasks.length) return "pending";
  const minDepth = Math.min(...tasks.map((task) => task.taskId.split("/").length));
  const governing = tasks.filter((task) => task.taskId.split("/").length === minDepth);
  for (const status of [
    TaskStatus.Failed,
    TaskStatus.Unknown,
    TaskStatus.Running,
    TaskStatus.Degraded,
    TaskStatus.Succeeded,
  ])
    if (governing.some((task) => task.status === status)) return status;
  return "pending";
}

export function stageDuration(tasks: TaskRecord[], now = Date.now()): string | undefined {
  if (!tasks.length) return undefined;
  const startedAt = Math.min(...tasks.map((task) => new Date(task.startedAt).getTime()));
  const finishedAt = Math.max(
    ...tasks.map((task) =>
      task.status === TaskStatus.Running
        ? now
        : new Date(task.finishedAt ?? task.updatedAt).getTime(),
    ),
  );
  const milliseconds = Math.max(0, finishedAt - startedAt);
  return milliseconds < 1000 ? `${milliseconds} ms` : `${(milliseconds / 1000).toFixed(1)} s`;
}

function stageStatusLabel(stage: PipelineStage): string {
  if (stage.status === "pending") return "未运行";
  const labels: Record<TaskRecord["status"], string> = {
    running: "运行中",
    succeeded: "完成",
    degraded: "降级完成",
    failed: "失败",
    unknown: "待确认",
  };
  return labels[stage.status];
}

function StageDetail({ stage, events }: { stage: PipelineStage; events: RuntimeEvent[] }) {
  const steps = sortStepsByStart(stage.tasks);
  const stepIds = steps.map((task) => task.taskId);
  return (
    <div className="min-w-0 p-4 lg:flex lg:min-h-0 lg:flex-col lg:overflow-hidden">
      {steps.length ? (
        <ol className="divide-y divide-[var(--border)] lg:min-h-0 lg:flex-1 lg:overflow-y-auto lg:pr-2">
          {steps.map((task) => (
            <StepRow key={task.taskId} task={task} events={events} stepIds={stepIds} />
          ))}
        </ol>
      ) : (
        <div className="grid min-h-36 place-items-center text-xs text-[var(--muted)]">尚未执行</div>
      )}
    </div>
  );
}

function StepRow({
  task,
  events,
  stepIds,
}: {
  task: TaskRecord;
  events: RuntimeEvent[];
  stepIds: string[];
}) {
  const [open, setOpen] = useState<boolean | null>(null);
  const expanded = open ?? stepDefaultsOpen(task.status);
  const metrics = stepModelMetrics(task.taskId, events, stepIds);
  const running = task.status === TaskStatus.Running;
  // While a step is still running its result is not committed yet, so stream the model text live;
  // once it settles, the recorded output/error is the source of truth.
  const liveText = running ? stepModelText(task.taskId, events, stepIds) : "";
  const hasDetail = task.error !== undefined || task.output !== undefined || liveText.length > 0;

  return (
    <li>
      <button
        type="button"
        onClick={() => setOpen(!expanded)}
        disabled={!hasDetail}
        className={cn(
          "grid w-full grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 py-2.5 text-left",
          hasDetail &&
            "transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-2)]",
        )}
      >
        <span className="grid size-4 place-items-center text-[var(--muted)]">
          {hasDetail ? (
            expanded ? (
              <ChevronDown className="size-3.5" />
            ) : (
              <ChevronRight className="size-3.5" />
            )
          ) : null}
        </span>
        <span className="min-w-0">
          <span className="flex items-center gap-1.5">
            <span className="truncate text-xs font-medium" title={task.taskId}>
              {stepLabel(task.taskId)}
            </span>
            <Badge tone={stepStatusTone(task.status)}>{stepStatusLabel(task.status)}</Badge>
          </span>
          {stepSummary(task) ? (
            <span className="mt-0.5 block truncate text-[11px] leading-4 text-[var(--muted)]">
              {stepSummary(task)}
            </span>
          ) : null}
        </span>
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-[var(--muted)]">
          {metrics ? (
            <span className={cn("tabular-nums", running && "text-[var(--accent)]")}>
              {metrics.outputTokens !== undefined
                ? `${metrics.outputTokens.toLocaleString()} tokens`
                : `${metrics.characters.toLocaleString()} 字符`}
            </span>
          ) : null}
          <span className="tabular-nums">{stepTimeLabel(task, metrics?.occurredAt)}</span>
        </span>
      </button>
      {expanded && hasDetail ? (
        <div className="grid gap-2 pb-3 pl-6">
          <span className="text-[11px] text-[var(--muted)]">
            版本 {task.version} · 尝试 {task.attempt}
          </span>
          {task.error ? (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 font-mono text-[11px] leading-5 text-[var(--danger)]">
              {task.error}
            </pre>
          ) : null}
          {task.output !== undefined ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 text-[11px] leading-5 text-[var(--muted-strong)]">
              {summarizeValue(task.output)}
            </pre>
          ) : task.error === undefined && liveText ? (
            <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-[var(--radius-sm)] bg-[var(--surface-2)] p-3 text-[11px] leading-5 text-[var(--muted-strong)]">
              {liveText}
              <span className="ml-0.5 inline-block h-3 w-1 animate-pulse bg-[var(--accent)] align-middle" />
            </pre>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

function stepStatusTone(
  status: TaskRecord["status"],
): "success" | "danger" | "warning" | "neutral" {
  if (status === TaskStatus.Succeeded) return "success";
  if (status === TaskStatus.Failed || status === TaskStatus.Unknown) return "danger";
  if (status === TaskStatus.Running || status === TaskStatus.Degraded) return "warning";
  return "neutral";
}

function stepStatusLabel(status: TaskRecord["status"]): string {
  const labels: Record<TaskRecord["status"], string> = {
    running: "运行中",
    succeeded: "完成",
    degraded: "降级完成",
    failed: "失败",
    unknown: "待确认",
  };
  return labels[status];
}

function stepTimeLabel(task: TaskRecord, modelOccurredAt?: string): string {
  const timestamp = modelOccurredAt ?? task.finishedAt ?? task.updatedAt;
  return new Date(timestamp).toLocaleTimeString();
}

function summarizeValue(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "无输出";
  return text.length > 3000 ? `${text.slice(0, 3000)}\n…` : text;
}
