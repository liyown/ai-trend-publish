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

export function createHttpDashboardApi(apiKey: string): DashboardApi {
  async function apiJson<T>(path: string, init?: RequestInit): Promise<T> {
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

  const mutation = <T>(path: string, method: string, body?: unknown) =>
    apiJson<T>(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

  return {
    async getWorkspace() {
      const data = await apiJson<{ workspace: WorkspaceSnapshot }>("/api/workspace");
      assertWorkspace(data.workspace);
      return data.workspace;
    },
    getHealth: () => apiJson("/api/health"),
    getJob: (id) => apiJson(`/api/jobs/${encodeURIComponent(id)}`),
    async streamJobEvents(id, options) {
      const headers = new Headers({
        Authorization: `Bearer ${apiKey}`,
        Accept: "text/event-stream",
      });
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
    listConnections: () => apiJson("/api/connections"),
    createConnection: (body) => mutation("/api/connections", "POST", body),
    updateConnection: (id, body) =>
      mutation(`/api/connections/${encodeURIComponent(id)}`, "PATCH", body),
    deleteConnection: (id) => mutation(`/api/connections/${encodeURIComponent(id)}`, "DELETE"),
    testConnection: (body) => mutation("/api/connections/test", "POST", body),
    createIdentity: (body) => mutation("/api/identities", "POST", body),
    updateIdentity: (id, body) =>
      mutation(`/api/identities/${encodeURIComponent(id)}`, "PATCH", body),
    deleteIdentity: (id) => mutation(`/api/identities/${encodeURIComponent(id)}`, "DELETE"),
    createKnowledgeBase: (body) => mutation("/api/knowledge-bases", "POST", body),
    updateKnowledgeBase: (id, body) =>
      mutation(`/api/knowledge-bases/${encodeURIComponent(id)}`, "PATCH", body),
    deleteKnowledgeBase: (id) =>
      mutation(`/api/knowledge-bases/${encodeURIComponent(id)}`, "DELETE"),
    createSourceCollection: (body) => mutation("/api/source-collections", "POST", body),
    updateSourceCollection: (id, body) =>
      mutation(`/api/source-collections/${encodeURIComponent(id)}`, "PATCH", body),
    deleteSourceCollection: (id) =>
      mutation(`/api/source-collections/${encodeURIComponent(id)}`, "DELETE"),
    createContentPlan: (body) => mutation("/api/content-plans", "POST", body),
    updateContentPlan: (id, body) =>
      mutation(`/api/content-plans/${encodeURIComponent(id)}`, "PATCH", body),
    deleteContentPlan: (id) => mutation(`/api/content-plans/${encodeURIComponent(id)}`, "DELETE"),
    createChannelAccount: (body) => mutation("/api/channel-accounts", "POST", body),
    updateChannelAccount: (id, body) =>
      mutation(`/api/channel-accounts/${encodeURIComponent(id)}`, "PATCH", body),
    deleteChannelAccount: (id) =>
      mutation(`/api/channel-accounts/${encodeURIComponent(id)}`, "DELETE"),
    createPublishTarget: (body) => mutation("/api/publish-targets", "POST", body),
    updatePublishTarget: (id, body) =>
      mutation(`/api/publish-targets/${encodeURIComponent(id)}`, "PATCH", body),
    deletePublishTarget: (id) =>
      mutation(`/api/publish-targets/${encodeURIComponent(id)}`, "DELETE"),
    createAutomation: (body) => mutation("/api/automations", "POST", body),
    updateAutomation: (id, body) =>
      mutation(`/api/automations/${encodeURIComponent(id)}`, "PATCH", body),
    deleteAutomation: (id) => mutation(`/api/automations/${encodeURIComponent(id)}`, "DELETE"),
    startAutomationRun: (id, body) =>
      mutation(`/api/automations/${encodeURIComponent(id)}/run`, "POST", body),
    startArticleGeneration: (body) => mutation("/api/articles", "POST", body),
    submitEditedArticle: (body) => mutation("/api/articles/complete", "POST", body),
    startPublication: (body) => mutation("/api/publications", "POST", body),
    resumeJob(job) {
      if (job.type === JobType.RunAutomation) {
        return mutation(`/api/automation-runs/${encodeURIComponent(job.id)}/resume`, "POST");
      }
      if (job.type === JobType.PublishContent) {
        return mutation(`/api/publications/${encodeURIComponent(job.id)}/resume`, "POST");
      }
      if (job.type === JobType.GenerateArticle || job.type === JobType.CompleteArticle) {
        return mutation(`/api/articles/${encodeURIComponent(job.id)}/resume`, "POST");
      }
      throw new Error(`任务类型 ${job.type} 不支持继续执行`);
    },
  };
}

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
