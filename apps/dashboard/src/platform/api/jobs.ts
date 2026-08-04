import { apiJson, mutation } from "./http.ts";
import { sessionAuthStore } from "../storage/session-auth-store.ts";
import { DashboardApiError, DashboardEventStreamError } from "./dashboard-errors.ts";
import { consumeSse, isEventStreamContentType } from "./sse.ts";
import type { JobRecord, TaskRecord, RuntimeEvent } from "./types.ts";
import { JobType } from "@trendpublish/contracts";

export const listJobs = (page = 1, pageSize = 20) =>
  apiJson<{ items: JobRecord[]; total: number; page: number; pageSize: number }>(
    `/api/jobs?page=${page}&pageSize=${pageSize}`,
  );

export const getJob = (jobId: string) =>
  apiJson<{ job: JobRecord; tasks: TaskRecord[] }>(`/api/jobs/${encodeURIComponent(jobId)}`);

export const resumeJob = (job: Pick<JobRecord, "id" | "type">) => {
  if (job.type === JobType.RunAutomation)
    return mutation(`/api/automation-runs/${encodeURIComponent(job.id)}/resume`, "POST");
  if (job.type === JobType.PublishContent)
    return mutation(`/api/publications/${encodeURIComponent(job.id)}/resume`, "POST");
  if (job.type === JobType.GenerateArticle || job.type === JobType.CompleteArticle)
    return mutation(`/api/articles/${encodeURIComponent(job.id)}/resume`, "POST");
  throw new Error(`任务类型 ${job.type} 不支持继续执行`);
};

export async function streamJobEvents(
  jobId: string,
  options: {
    signal: AbortSignal;
    lastEventId?: string;
    onOpen(): void;
    onEvent(event: RuntimeEvent): void;
  },
): Promise<void> {
  const apiKey = sessionAuthStore.read();
  const headers = new Headers({ Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" });
  if (options.lastEventId) headers.set("Last-Event-ID", options.lastEventId);

  const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}/events`, {
    headers,
    signal: options.signal,
  });

  if (!response.ok) {
    throw new DashboardApiError({
      message: `${response.status}`,
      status: response.status,
      statusText: response.statusText,
      path: response.url,
    });
  }

  if (!isEventStreamContentType(response.headers.get("content-type"))) {
    throw new DashboardEventStreamError("实时事件接口返回了无效的 Content-Type", false);
  }

  if (!response.body) {
    throw new DashboardEventStreamError("浏览器没有提供 SSE 响应流", false);
  }

  options.onOpen();
  await consumeSse(response.body, (data) => {
    options.onEvent(parseRuntimeEvent(data));
  });
}

function parseRuntimeEvent(data: string): RuntimeEvent {
  return JSON.parse(data) as RuntimeEvent;
}
