import { JobType } from "@trendpublish/contracts";
import type { ApiErrorPayload, RuntimeEvent, WorkspaceSnapshot } from "./types.ts";
import type { DashboardApi } from "./dashboard-api.ts";
import { DashboardApiError, DashboardEventStreamError } from "./dashboard-errors.ts";
import { consumeSse, isEventStreamContentType } from "./sse.ts";

async function parseApiError(response: Response) {
  const text = await response.text();
  if (!text) return `${response.status} ${response.statusText}`;
  try {
    const parsed = JSON.parse(text) as ApiErrorPayload;
    const base = parsed.error ?? "请求失败";
    const issues = parsed.issues
      ?.map((issue) => [issue.path, issue.message].filter(Boolean).join(": "))
      .filter(Boolean);
    return issues?.length ? `${base}：${issues.join("；")}` : base;
  } catch {
    return text;
  }
}

async function apiJson<T>(path: string, apiKey: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", "application/json");
  headers.set("Authorization", `Bearer ${apiKey}`);
  const response = await fetch(path, { ...init, headers });
  if (!response.ok) {
    throw new DashboardApiError({
      message: await parseApiError(response),
      status: response.status,
      statusText: response.statusText,
      path,
    });
  }
  return (await response.json()) as T;
}

const mutation = <T>(path: string, apiKey: string, method: string, body?: unknown) =>
  apiJson<T>(path, apiKey, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export const httpDashboardApi: DashboardApi = {
  async getWorkspace(apiKey) {
    const data = await apiJson<{ workspace: WorkspaceSnapshot }>("/api/workspace", apiKey);
    assertWorkspace(data.workspace);
    return data.workspace;
  },
  getHealth: (apiKey) => apiJson("/api/health", apiKey),
  getJob: (apiKey, id) => apiJson(`/api/jobs/${encodeURIComponent(id)}`, apiKey),
  async streamJobEvents(apiKey, id, options) {
    const headers = new Headers({ Authorization: `Bearer ${apiKey}`, Accept: "text/event-stream" });
    if (options.lastEventId) headers.set("Last-Event-ID", options.lastEventId);
    const response = await fetch(`/api/jobs/${encodeURIComponent(id)}/events`, {
      headers,
      signal: options.signal,
    });
    if (!response.ok) {
      throw new DashboardApiError({
        message: await parseApiError(response),
        status: response.status,
        statusText: response.statusText,
        path: response.url,
      });
    }
    if (!isEventStreamContentType(response.headers.get("content-type"))) {
      throw new DashboardEventStreamError(
        `实时事件接口返回了无效的 Content-Type：${response.headers.get("content-type") ?? "未提供"}`,
        false,
      );
    }
    if (!response.body) {
      throw new DashboardEventStreamError("浏览器没有提供 SSE 响应流", false);
    }
    options.onOpen();
    await consumeSse(response.body, (data) => {
      options.onEvent(parseRuntimeEvent(data));
    });
  },
  listConnections: (apiKey) => apiJson("/api/connections", apiKey),
  createConnection: (apiKey, body) => mutation("/api/connections", apiKey, "POST", body),
  updateConnection: (apiKey, id, body) =>
    mutation(`/api/connections/${encodeURIComponent(id)}`, apiKey, "PATCH", body),
  deleteConnection: (apiKey, id) =>
    mutation(`/api/connections/${encodeURIComponent(id)}`, apiKey, "DELETE"),
  testConnection: (apiKey, body) => mutation("/api/connections/test", apiKey, "POST", body),
  createIdentity: (apiKey, body) => mutation("/api/identities", apiKey, "POST", body),
  updateIdentity: (apiKey, id, body) =>
    mutation(`/api/identities/${encodeURIComponent(id)}`, apiKey, "PATCH", body),
  deleteIdentity: (apiKey, id) =>
    mutation(`/api/identities/${encodeURIComponent(id)}`, apiKey, "DELETE"),
  createKnowledgeBase: (apiKey, body) => mutation("/api/knowledge-bases", apiKey, "POST", body),
  updateKnowledgeBase: (apiKey, id, body) =>
    mutation(`/api/knowledge-bases/${encodeURIComponent(id)}`, apiKey, "PATCH", body),
  deleteKnowledgeBase: (apiKey, id) =>
    mutation(`/api/knowledge-bases/${encodeURIComponent(id)}`, apiKey, "DELETE"),
  createSourceCollection: (apiKey, body) =>
    mutation("/api/source-collections", apiKey, "POST", body),
  updateSourceCollection: (apiKey, id, body) =>
    mutation(`/api/source-collections/${encodeURIComponent(id)}`, apiKey, "PATCH", body),
  deleteSourceCollection: (apiKey, id) =>
    mutation(`/api/source-collections/${encodeURIComponent(id)}`, apiKey, "DELETE"),
  createContentPlan: (apiKey, body) => mutation("/api/content-plans", apiKey, "POST", body),
  updateContentPlan: (apiKey, id, body) =>
    mutation(`/api/content-plans/${encodeURIComponent(id)}`, apiKey, "PATCH", body),
  deleteContentPlan: (apiKey, id) =>
    mutation(`/api/content-plans/${encodeURIComponent(id)}`, apiKey, "DELETE"),
  createChannelAccount: (apiKey, body) => mutation("/api/channel-accounts", apiKey, "POST", body),
  updateChannelAccount: (apiKey, id, body) =>
    mutation(`/api/channel-accounts/${encodeURIComponent(id)}`, apiKey, "PATCH", body),
  deleteChannelAccount: (apiKey, id) =>
    mutation(`/api/channel-accounts/${encodeURIComponent(id)}`, apiKey, "DELETE"),
  createPublishTarget: (apiKey, body) => mutation("/api/publish-targets", apiKey, "POST", body),
  updatePublishTarget: (apiKey, id, body) =>
    mutation(`/api/publish-targets/${encodeURIComponent(id)}`, apiKey, "PATCH", body),
  deletePublishTarget: (apiKey, id) =>
    mutation(`/api/publish-targets/${encodeURIComponent(id)}`, apiKey, "DELETE"),
  createAutomation: (apiKey, body) => mutation("/api/automations", apiKey, "POST", body),
  updateAutomation: (apiKey, id, body) =>
    mutation(`/api/automations/${encodeURIComponent(id)}`, apiKey, "PATCH", body),
  deleteAutomation: (apiKey, id) =>
    mutation(`/api/automations/${encodeURIComponent(id)}`, apiKey, "DELETE"),
  startAutomationRun: (apiKey, id, body) =>
    mutation(`/api/automations/${encodeURIComponent(id)}/run`, apiKey, "POST", body),
  startArticleGeneration: (apiKey, body) => mutation("/api/articles", apiKey, "POST", body),
  submitEditedArticle: (apiKey, body) => mutation("/api/articles/complete", apiKey, "POST", body),
  startPublication: (apiKey, body) => mutation("/api/publications", apiKey, "POST", body),
  resumeJob(apiKey, job) {
    if (job.type === JobType.RunAutomation) {
      return mutation(`/api/automation-runs/${encodeURIComponent(job.id)}/resume`, apiKey, "POST");
    }
    if (job.type === JobType.PublishContent) {
      return mutation(`/api/publications/${encodeURIComponent(job.id)}/resume`, apiKey, "POST");
    }
    if (job.type === JobType.GenerateArticle || job.type === JobType.CompleteArticle) {
      return mutation(`/api/articles/${encodeURIComponent(job.id)}/resume`, apiKey, "POST");
    }
    throw new Error(`任务类型 ${job.type} 不支持继续执行`);
  },
};

function parseRuntimeEvent(data: string): RuntimeEvent {
  let value: unknown;
  try {
    value = JSON.parse(data);
  } catch {
    throw new DashboardEventStreamError("实时事件接口返回了无效的 JSON", false);
  }
  if (
    !value ||
    typeof value !== "object" ||
    Array.isArray(value) ||
    typeof (value as Partial<RuntimeEvent>).id !== "string" ||
    typeof (value as Partial<RuntimeEvent>).type !== "string" ||
    typeof (value as Partial<RuntimeEvent>).occurredAt !== "string"
  ) {
    throw new DashboardEventStreamError("实时事件接口返回了无效的事件结构", false);
  }
  return value as RuntimeEvent;
}

function assertWorkspace(workspace: WorkspaceSnapshot): void {
  const required = [
    "automations",
    "identities",
    "knowledgeBases",
    "sourceCollections",
    "contentPlans",
    "channelAccounts",
    "publishTargets",
    "contentPackages",
    "reviewRequests",
    "publications",
    "jobs",
    "connections",
    "connectorDefinitions",
  ] as const;
  const missing = required.filter((key) => !Array.isArray(workspace[key]));
  if (missing.length) throw new Error(`Dashboard 与 API 版本不一致：缺少 ${missing.join(", ")}`);
}
