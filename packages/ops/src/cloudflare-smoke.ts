import { JobStatus } from "@trendpublish/runtime";
import { initializeAppConfig, parseConfigArgs } from "@trendpublish/core/config";

interface SmokeArgs {
  url: string;
  apiKey: string;
  timeoutMs: number;
  intervalMs: number;
  planId?: string;
  requestedTopic?: string;
}

interface WorkspaceResponse {
  workspace?: {
    contentPlans?: Array<{ id: string; name: string; enabled: boolean }>;
  };
  error?: string;
}

interface JobResponse {
  job?: { id: string; status: string; error?: string; output?: unknown };
  tasks?: Array<{ taskId: string; status: string; error?: string }>;
  error?: string;
}

export async function main(argv = process.argv.slice(2)): Promise<void> {
  const { configPath, args } = parseConfigArgs(argv);
  await runSmoke(await parseSmokeArgs(args, configPath));
}

if (import.meta.main) await main();

async function runSmoke(options: SmokeArgs): Promise<void> {
  const baseUrl = options.url.replace(/\/+$/, "");
  console.log(`Cloudflare smoke target: ${baseUrl}`);
  const health = await requestJson<{ ok?: boolean }>(`${baseUrl}/api/health`, {
    method: "GET",
    apiKey: options.apiKey,
  });
  if (!health.ok) throw new Error("Cloudflare health check failed");
  console.log("Health check OK");

  const snapshot = await requestJson<WorkspaceResponse>(`${baseUrl}/api/workspace`, {
    method: "GET",
    apiKey: options.apiKey,
  });
  const plan = options.planId
    ? snapshot.workspace?.contentPlans?.find((item) => item.id === options.planId)
    : snapshot.workspace?.contentPlans?.find((item) => item.enabled);
  if (!plan) throw new Error("Cloudflare smoke requires an enabled article plan");

  const created = await requestJson<JobResponse>(`${baseUrl}/api/articles`, {
    method: "POST",
    apiKey: options.apiKey,
    body: { planId: plan.id, requestedTopic: options.requestedTopic },
  });
  if (!created.job?.id) throw new Error(created.error ?? "Article job was not created");
  console.log(`Created article job ${created.job.id} with plan ${plan.name}`);

  const deadline = Date.now() + options.timeoutMs;
  while (Date.now() < deadline) {
    const detail = await requestJson<JobResponse>(
      `${baseUrl}/api/jobs/${encodeURIComponent(created.job.id)}`,
      { method: "GET", apiKey: options.apiKey },
    );
    if (!detail.job) throw new Error(detail.error ?? "Article job was not returned");
    const taskSummary = detail.tasks?.map((task) => `${task.taskId}:${task.status}`).join(", ");
    console.log(`${detail.job.status}${taskSummary ? ` | ${taskSummary}` : ""}`);
    if (detail.job.status === JobStatus.Succeeded || detail.job.status === JobStatus.Degraded)
      return;
    if (detail.job.status === JobStatus.Failed || detail.job.status === JobStatus.NeedsAttention) {
      throw new Error(detail.job.error ?? `Article job ${detail.job.status}`);
    }
    await delay(options.intervalMs);
  }
  throw new Error(`Article job did not finish within ${options.timeoutMs}ms`);
}

async function requestJson<T>(
  url: string,
  options: { method: "GET" | "POST"; apiKey: string; body?: unknown },
): Promise<T> {
  const response = await fetch(url, {
    method: options.method,
    headers: { Authorization: `Bearer ${options.apiKey}`, "Content-Type": "application/json" },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  let json: unknown;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    throw new Error(`HTTP ${response.status}: non-JSON response: ${text.slice(0, 500)}`);
  }
  if (!response.ok) throw new Error(`HTTP ${response.status}: ${JSON.stringify(json)}`);
  return json as T;
}

async function parseSmokeArgs(args: string[], configPath?: string): Promise<SmokeArgs> {
  const values = new Map<string, string>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (!arg.startsWith("--")) continue;
    const [key, inlineValue] = arg.slice(2).split("=", 2);
    if (inlineValue !== undefined) values.set(key, inlineValue);
    else if (args[index + 1] && !args[index + 1].startsWith("--")) values.set(key, args[++index]);
    else values.set(key, "true");
  }
  const url = values.get("url") ?? process.env.TRENDPUBLISH_CF_URL ?? "";
  const apiKey =
    values.get("api-key") ??
    process.env.TRENDPUBLISH_API_KEY ??
    process.env.SERVER_API_KEY ??
    (await readApiKeyFromConfig(configPath));
  if (!url) throw new Error("缺少 Cloudflare Worker URL。使用 --url 或 TRENDPUBLISH_CF_URL。");
  if (!apiKey) throw new Error("缺少 API Key。使用 --api-key 或 SERVER_API_KEY。");
  return {
    url,
    apiKey,
    timeoutMs: Number(values.get("timeout-ms") ?? 10 * 60 * 1000),
    intervalMs: Number(values.get("interval-ms") ?? 5000),
    planId: values.get("plan-id"),
    requestedTopic: values.get("topic"),
  };
}

async function readApiKeyFromConfig(configPath?: string): Promise<string> {
  try {
    return (await initializeAppConfig({ configPath })).server.apiKey;
  } catch {
    return "";
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
