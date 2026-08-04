import { JobStatus, TaskStatus, type JobStatus as JobStatusValue } from "@trendpublish/contracts";
import type { JobEventStreamState } from "#platform/api/use-job-monitor.ts";
import type { RuntimeEvent, TaskRecord } from "#platform/api/types.ts";

export interface JobActivityItem {
  label: string;
  detail?: string;
  preview?: string;
  occurredAt?: string;
}

export function describeRuntimeEvent(
  event: RuntimeEvent,
  events: RuntimeEvent[] = [event],
): JobActivityItem {
  const data = eventData(event);
  if (event.type === "model.response.delta") {
    const eventIndex = events.findIndex((candidate) => candidate.id === event.id);
    const endIndex = eventIndex === -1 ? events.length - 1 : eventIndex;
    const startIndex = lastModelResponseStartIndex(events, event.taskId, endIndex);
    const preview = events
      .slice(startIndex, endIndex + 1)
      .filter(
        (candidate) =>
          candidate.taskId === event.taskId && candidate.type === "model.response.delta",
      )
      .map((candidate) => eventData(candidate).delta)
      .filter((value): value is string => typeof value === "string")
      .join("")
      .slice(-800);
    const accumulated =
      typeof data.accumulatedCharacters === "number" ? data.accumulatedCharacters : preview.length;
    return {
      label: "正在接收模型输出",
      detail: `${accumulated.toLocaleString()} 个字符${event.taskId ? ` · ${event.taskId}` : ""}`,
      ...(preview ? { preview } : {}),
      occurredAt: event.occurredAt,
    };
  }
  if (event.type === "model.response.started") {
    return {
      label: "模型正在生成",
      detail: joinDetails(stringValue(data.model), event.taskId),
      occurredAt: event.occurredAt,
    };
  }
  if (event.type === "model.response.completed") {
    const usage = isRecord(data.usage) ? data.usage : undefined;
    const detail =
      typeof usage?.outputTokens === "number"
        ? `输出 ${usage.outputTokens.toLocaleString()} tokens`
        : typeof data.accumulatedCharacters === "number"
          ? `${data.accumulatedCharacters.toLocaleString()} 个字符`
          : event.taskId;
    return {
      label: "模型输出完成，正在处理结果",
      detail,
      occurredAt: event.occurredAt,
    };
  }
  if (event.type === "connector.operation.started") {
    return {
      label: "正在请求外部服务",
      detail: connectorDetail(data, event.taskId),
      occurredAt: event.occurredAt,
    };
  }
  if (event.type === "connector.operation.completed") {
    return {
      label: data.success === false ? "外部服务请求失败" : "外部服务请求完成",
      detail: connectorDetail(data, event.taskId),
      occurredAt: event.occurredAt,
    };
  }
  if (event.type === "job.created") {
    return {
      label: "任务已创建",
      detail: statusDetail(data.status),
      occurredAt: event.occurredAt,
    };
  }
  if (event.type === "job.status.changed") {
    const sourceJobType = stringValue(data.sourceJobType);
    return {
      label: sourceJobType
        ? childJobStatusEventLabel(sourceJobType, data.status)
        : jobStatusEventLabel(data.status),
      detail: joinDetails(statusDetail(data.status), event.taskId),
      occurredAt: event.occurredAt,
    };
  }
  if (event.type === "job.updated") {
    return {
      label: "任务信息已更新",
      detail: statusDetail(data.status),
      occurredAt: event.occurredAt,
    };
  }
  const labels: Record<string, string> = {
    "automation.child.started": "子任务开始执行",
    "automation.child.completed": "子任务执行完成",
    "job.started": "任务开始执行",
    "job.succeeded": "任务已完成",
    "job.degraded": "任务已降级完成",
    "job.failed": "任务执行失败",
    "job.needs_attention": "任务需要处理",
    "task.started": "步骤开始执行",
    "task.succeeded": "步骤已完成",
    "task.degraded": "步骤已降级完成",
    "task.failed": "步骤执行失败",
    "task.unknown": "步骤结果需要确认",
  };
  return {
    // Runtime events are intentionally open-ended. Unknown types remain visible by their stable
    // protocol name and a compact data preview instead of disappearing from the Dashboard.
    label: labels[event.type] ?? event.type,
    detail: event.taskId,
    ...(!labels[event.type] && event.data !== undefined
      ? { preview: summarizeData(event.data) }
      : {}),
    occurredAt: event.occurredAt,
  };
}

export function compactActivityPreview(
  preview: string | undefined,
  maxLength = 240,
): string | undefined {
  if (!preview) return undefined;
  return preview.length > maxLength ? `${preview.slice(0, maxLength)}\n…` : preview;
}

export function runningTaskActivity(tasks: TaskRecord[]): JobActivityItem | null {
  const running = tasks.findLast((task) => task.status === TaskStatus.Running);
  return running
    ? {
        label: "正在执行",
        detail: running.taskId,
        occurredAt: running.updatedAt,
      }
    : null;
}

export function waitingActivity(
  status: JobStatusValue,
  streamState: JobEventStreamState,
): JobActivityItem | null {
  if (status !== JobStatus.Queued && status !== JobStatus.Running) return null;
  return {
    label: status === JobStatus.Queued ? "等待执行" : "等待新的运行事件",
    detail:
      streamState === "live"
        ? "实时连接已建立"
        : streamState === "unavailable"
          ? "正在通过任务快照更新"
          : "正在建立实时连接",
  };
}

export function streamStateLabel(state: JobEventStreamState): string {
  if (state === "live") return "实时更新中";
  if (state === "retrying") return "正在恢复实时连接";
  if (state === "unavailable") return "快照更新中";
  if (state === "connecting") return "正在连接实时状态";
  return "等待实时状态";
}

function lastModelResponseStartIndex(
  events: RuntimeEvent[],
  taskId: string | undefined,
  endIndex: number,
): number {
  for (let index = endIndex; index >= 0; index -= 1) {
    const candidate = events[index];
    if (candidate?.taskId === taskId && candidate.type === "model.response.started") {
      return index + 1;
    }
  }
  return 0;
}

function childJobStatusEventLabel(sourceJobType: string, status: unknown): string {
  const subjects: Record<string, string> = {
    "article.generate": "文章子任务",
    "article.complete": "文章修订子任务",
    "content.publish": "发布子任务",
    "automation.run": "自动化子任务",
  };
  const subject = subjects[sourceJobType] ?? "子任务";
  if (status === JobStatus.Running) return `${subject}开始执行`;
  if (status === JobStatus.Succeeded) return `${subject}已完成`;
  if (status === JobStatus.Degraded) return `${subject}已降级完成`;
  if (status === JobStatus.Failed) return `${subject}执行失败`;
  if (status === JobStatus.NeedsAttention) return `${subject}需要处理`;
  if (status === JobStatus.Queued) return `${subject}等待执行`;
  return `${subject}状态已更新`;
}

function jobStatusEventLabel(status: unknown): string {
  if (status === JobStatus.Running) return "任务开始执行";
  if (status === JobStatus.Succeeded) return "任务已完成";
  if (status === JobStatus.Degraded) return "任务已降级完成";
  if (status === JobStatus.Failed) return "任务执行失败";
  if (status === JobStatus.NeedsAttention) return "任务需要处理";
  if (status === JobStatus.Queued) return "任务等待执行";
  return "任务状态已更新";
}

function statusDetail(status: unknown): string | undefined {
  const labels: Record<string, string> = {
    queued: "等待执行",
    running: "运行中",
    succeeded: "已完成",
    degraded: "已降级完成",
    failed: "失败",
    needs_attention: "需要处理",
  };
  return typeof status === "string" ? `状态：${labels[status] ?? status}` : undefined;
}

function connectorDetail(data: Record<string, unknown>, taskId?: string): string | undefined {
  const operation = isRecord(data.operation) ? data.operation : undefined;
  const operationName = stringValue(operation?.name) ?? stringValue(operation?.kind);
  const connector = stringValue(data.connectorId);
  return joinDetails(operationName, connector, taskId);
}

function joinDetails(...values: Array<string | undefined>): string | undefined {
  const detail = values.filter((value): value is string => Boolean(value)).join(" · ");
  return detail || undefined;
}

function eventData(event: RuntimeEvent): Record<string, unknown> {
  return isRecord(event.data) ? event.data : {};
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}

function summarizeData(value: unknown): string {
  const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
  if (!text) return "";
  return text.length > 800 ? `${text.slice(0, 800)}\n…` : text;
}
