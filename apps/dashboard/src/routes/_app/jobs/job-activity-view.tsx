import { JobStatus, type JobStatus as JobStatusValue } from "@trendpublish/contracts";
import type { JobEventStreamState } from "#platform/api/use-job-monitor.ts";
import type { RuntimeEvent, TaskRecord } from "#platform/api/types.ts";
import { cn } from "#lib/utils.ts";
import {
  compactActivityPreview,
  describeRuntimeEvent,
  runningTaskActivity,
  streamStateLabel,
  waitingActivity,
} from "./job-activity.ts";

export function JobActivityView({
  events,
  tasks = [],
  jobStatus,
  streamState,
  streamError,
  className,
}: {
  events: RuntimeEvent[];
  tasks?: TaskRecord[];
  jobStatus: JobStatusValue;
  streamState: JobEventStreamState;
  streamError?: string;
  className?: string;
}) {
  const latest = events.at(-1);
  const current = latest
    ? describeRuntimeEvent(latest, events)
    : (runningTaskActivity(tasks) ?? waitingActivity(jobStatus, streamState));
  const recent = events
    .filter((event) => event.id !== latest?.id && event.type !== "model.response.delta")
    .slice(-5)
    .reverse();
  const active = jobStatus === JobStatus.Queued || jobStatus === JobStatus.Running;
  if (!current && !events.length && !streamError) return null;

  return (
    <section
      className={cn(
        "rounded-[var(--radius)] border border-[var(--border)] bg-[var(--surface-2)]",
        className,
      )}
    >
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--border)] px-3 py-2.5">
        <strong className="text-xs font-semibold">运行动态</strong>
        {active ? (
          <span className="text-[11px] text-[var(--muted)]">{streamStateLabel(streamState)}</span>
        ) : null}
      </div>
      {current ? (
        <div className="px-3 py-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <strong className="text-xs font-medium">{current.label}</strong>
            {current.occurredAt ? (
              <time className="text-[11px] text-[var(--muted)]">
                {new Date(current.occurredAt).toLocaleTimeString()}
              </time>
            ) : null}
          </div>
          {current.detail ? (
            <p className="mt-1 break-words text-xs leading-5 text-[var(--muted-strong)]">
              {current.detail}
            </p>
          ) : null}
          {current.preview ? (
            <pre className="mt-2 max-h-28 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-[var(--muted)]">
              {current.preview}
            </pre>
          ) : null}
        </div>
      ) : null}
      {streamError ? (
        <p className="border-t border-[var(--border)] px-3 py-2 text-[11px] leading-5 text-[var(--warning)]">
          {active
            ? "实时连接不可用，正在通过任务快照更新。"
            : "历史运行事件不可用，以下信息来自任务快照。"}
          {streamError}
        </p>
      ) : null}
      {recent.length ? (
        <ol className="divide-y divide-[var(--border)] border-t border-[var(--border)] px-3">
          {recent.map((event) => {
            const activity = describeRuntimeEvent(event, events);
            const preview = compactActivityPreview(activity.preview);
            return (
              <li key={event.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-4 py-2">
                <div className="min-w-0 text-[11px] leading-5 text-[var(--muted-strong)]">
                  <div className="break-words">
                    <strong className="font-medium text-[var(--foreground)]">
                      {activity.label}
                    </strong>
                    {activity.detail ? ` · ${activity.detail}` : ""}
                  </div>
                  {preview ? (
                    <pre className="mt-1 whitespace-pre-wrap break-all font-mono text-[10px] leading-4 text-[var(--muted)]">
                      {preview}
                    </pre>
                  ) : null}
                </div>
                <time className="shrink-0 text-[10px] leading-5 text-[var(--muted)]">
                  {activity.occurredAt ? new Date(activity.occurredAt).toLocaleTimeString() : ""}
                </time>
              </li>
            );
          })}
        </ol>
      ) : null}
    </section>
  );
}
