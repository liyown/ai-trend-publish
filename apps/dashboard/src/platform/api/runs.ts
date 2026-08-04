import type {
  ChannelPublicationPreview,
  ModelStreamEvent,
  RunActivity,
  RunDetail,
  RunRecord,
} from "./types.ts";
import { apiJson, mutation } from "./http.ts";
import { sessionAuthStore } from "../storage/session-auth-store.ts";
import { DashboardApiError, DashboardEventStreamError } from "./dashboard-errors.ts";
import { consumeSse, isEventStreamContentType } from "./sse.ts";

export interface RunPage {
  items: RunRecord[];
  total: number;
  page: number;
  pageSize: number;
}

export const listRuns = (page = 1, pageSize = 20, planId?: string) => {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (planId) query.set("planId", planId);
  return apiJson<RunPage>(`/api/runs?${query}`);
};

export const getRun = (runId: string) =>
  apiJson<RunDetail>(`/api/runs/${encodeURIComponent(runId)}`);

export const channelPublicationPreviewKey = (runId: string | null, sessionId: string | undefined) =>
  ["runs", runId, "sessions", sessionId, "preview"] as const;

export const getChannelPublicationPreview = (runId: string, sessionId: string) =>
  apiJson<ChannelPublicationPreview>(
    `/api/runs/${encodeURIComponent(runId)}/sessions/${encodeURIComponent(sessionId)}/preview`,
  );

export const listRunActivities = (runId: string, afterSequence = 0) =>
  apiJson<{ activities: RunActivity[]; afterSequence: number }>(
    `/api/runs/${encodeURIComponent(runId)}/activities?afterSequence=${afterSequence}`,
  );

export const resumeRun = (runId: string) =>
  mutation<RunDetail>(`/api/runs/${encodeURIComponent(runId)}/resume`, "POST");

export const retryRunDestination = (runId: string, destinationId: string) =>
  mutation<{ run: RunRecord }>(
    `/api/runs/${encodeURIComponent(runId)}/destinations/${encodeURIComponent(destinationId)}/retry`,
    "POST",
  );

export async function streamRunActivities(
  runId: string,
  options: StreamOptions<RunActivity> & { afterSequence?: number },
): Promise<void> {
  await streamJson(
    `/api/runs/${encodeURIComponent(runId)}/events?afterSequence=${options.afterSequence ?? 0}`,
    options,
  );
}

export async function streamRunModelOutput(
  runId: string,
  options: StreamOptions<ModelStreamEvent>,
): Promise<void> {
  await streamJson(`/api/runs/${encodeURIComponent(runId)}/model-stream`, options);
}

interface StreamOptions<T> {
  signal: AbortSignal;
  lastEventId?: string;
  onOpen(): void;
  onEvent(event: T): void;
}

async function streamJson<T>(path: string, options: StreamOptions<T>): Promise<void> {
  const apiKey = sessionAuthStore.read();
  const headers = new Headers({ Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" });
  if (options.lastEventId) headers.set("Last-Event-ID", options.lastEventId);
  const response = await fetch(path, { headers, signal: options.signal });
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
  if (!response.body) throw new DashboardEventStreamError("浏览器没有提供 SSE 响应流", false);
  options.onOpen();
  await consumeSse(response.body, (data) => options.onEvent(JSON.parse(data) as T));
}
