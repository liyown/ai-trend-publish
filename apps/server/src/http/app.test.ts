import { Hono } from "hono";
import { test } from "vite-plus/test";
import {
  ConnectorManager,
  ConnectorClientResolver,
  MemoryConnectionStore,
  MemoryCredentialStore,
  createBuiltInConnectorRegistry,
} from "@trendpublish/connectors";
import { ArticlePluginId, ChannelId } from "@trendpublish/contracts";
import { assert, assertEquals } from "@trendpublish/core/test";
import { createWorkspaceEntity, MemoryWorkspaceRepository } from "@trendpublish/core/workspace";
import {
  EventedJobStore,
  MemoryJobStore,
  MemoryTaskStore,
  RuntimeEventHub,
  createJob,
  finishJob,
  startJob,
} from "@trendpublish/runtime";
import { createHttpApp } from "./app.ts";
import { InProcessBackgroundTasks } from "@trendpublish/core/application";
import type { ApplicationRuntime } from "../application/runtime.ts";
import type { AppVariables, HttpDeps } from "./deps.ts";

const API_KEY = "test-key-12345";

function buildTestDeps(overrides: Partial<ApplicationRuntime> = {}): HttpDeps {
  const dashboardApp = new Hono<{ Variables: AppVariables }>()
    .get("/dashboard", (c) => c.html("<!doctype html><title>Dashboard</title>"))
    .get("/dashboard/*", (c) => c.html("<!doctype html><title>Dashboard</title>"));
  const workspace = new MemoryWorkspaceRepository();
  const jobs = new MemoryJobStore();
  const tasks = new MemoryTaskStore();
  const events = new RuntimeEventHub();
  const registry = createBuiltInConnectorRegistry();
  const connections = new MemoryConnectionStore();
  const credentials = new MemoryCredentialStore();
  const connectors = new ConnectorClientResolver({ registry, connections, credentials });
  const connectionManager = new ConnectorManager(connectors, registry, connections, credentials);
  const runtime = {
    workspace,
    jobs,
    tasks,
    events,
    connectors,
    connectionManager,
    articles: {} as never,
    publishing: {} as never,
    automations: {} as never,
    background: new InProcessBackgroundTasks(),
    ...overrides,
  };
  return {
    mode: "local",
    dashboardApp,
    getApiKey: async () => API_KEY,
    getRuntime: async () => runtime,
  };
}

const auth = { Authorization: `Bearer ${API_KEY}` };

test("API requires bearer authentication", async () => {
  const response = await createHttpApp(buildTestDeps()).request("/api/health");
  assertEquals(response.status, 401);
  const body = (await response.json()) as { error: string };
  assertEquals(body.error, "未授权的访问");
});

test("article generation returns a queued job before background execution", async () => {
  const jobs = new MemoryJobStore();
  const scheduled: Array<() => Promise<unknown>> = [];
  const deps = buildTestDeps({
    jobs,
    articles: {
      createGenerateJob: (input: unknown) =>
        jobs.create(createJob("article.generate", input, new Date("2026-07-18T12:00:00.000Z"))),
      resume: () => Promise.resolve(undefined),
    } as never,
    background: {
      start(_name, task) {
        scheduled.push(task);
      },
    },
  });

  const response = await createHttpApp(deps).request("/api/articles", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({ planId: "plan-live" }),
  });
  const body = (await response.json()) as { job: { status: string; id: string } };

  assertEquals(response.status, 202);
  assertEquals(body.job.status, "queued");
  assertEquals(scheduled.length, 1);
  assertEquals((await jobs.get(body.job.id))?.status, "queued");
});

test("article resume returns the claimed running job before background execution", async () => {
  const jobs = new MemoryJobStore();
  const queued = await jobs.create(createJob("article.generate", { planId: "plan-live" }));
  const failed = await jobs.update(finishJob(startJob(queued), "failed", { error: "retry me" }));
  const scheduled: Array<() => Promise<unknown>> = [];
  const deps = buildTestDeps({
    jobs,
    articles: {
      claimGenerateJob: (jobId: string) =>
        jobs.claim({
          id: jobId,
          type: "article.generate",
          now: "2026-07-18T12:00:00.000Z",
        }),
      executeClaimedGenerate: (job: unknown) => Promise.resolve(job),
    } as never,
    background: {
      start(_name, task) {
        scheduled.push(task);
      },
    },
  });

  const response = await createHttpApp(deps).request(`/api/articles/${failed.id}/resume`, {
    method: "POST",
    headers: auth,
  });
  const body = (await response.json()) as {
    job: { status: string; error?: string; finishedAt?: string };
  };

  assertEquals(response.status, 202);
  assertEquals(body.job.status, "running");
  assertEquals(body.job.error, undefined);
  assertEquals(body.job.finishedAt, undefined);
  assertEquals(scheduled.length, 1);
  assertEquals((await jobs.get(failed.id))?.status, "running");
});

test("article resume dispatches completion jobs to the completion workflow", async () => {
  const jobs = new MemoryJobStore();
  const queued = await jobs.create(
    createJob("article.complete", {
      planId: "plan-live",
      reviewRequestId: "review-1",
      source: { format: "article-markdown.v1", title: "Revised", body: "Body" },
      assetRequests: [],
    }),
  );
  const failed = await jobs.update(
    finishJob(startJob(queued), "failed", { error: "retry completion" }),
  );
  const scheduled: Array<() => Promise<unknown>> = [];
  const deps = buildTestDeps({
    jobs,
    articles: {
      claimCompletionJob: (jobId: string) =>
        jobs.claim({
          id: jobId,
          type: "article.complete",
          now: "2026-07-18T12:00:00.000Z",
        }),
      executeClaimedCompletion: (job: unknown) => Promise.resolve(job),
    } as never,
    background: {
      start(_name, task) {
        scheduled.push(task);
      },
    },
  });

  const response = await createHttpApp(deps).request(`/api/articles/${failed.id}/resume`, {
    method: "POST",
    headers: auth,
  });
  const body = (await response.json()) as { job: { status: string; error?: string } };

  assertEquals(response.status, 202);
  assertEquals(body.job.status, "running");
  assertEquals(body.job.error, undefined);
  assertEquals(scheduled.length, 1);
  assertEquals((await jobs.get(failed.id))?.status, "running");
});

test("automation resume returns the same claimed run before background execution", async () => {
  const jobs = new MemoryJobStore();
  const queued = await jobs.create(createJob("automation.run", { automationId: "automation-1" }));
  const failed = await jobs.update(
    finishJob(startJob(queued), "failed", { error: "retry automation" }),
  );
  const scheduled: Array<() => Promise<unknown>> = [];
  const deps = buildTestDeps({
    jobs,
    automations: {
      claimRunJob: (jobId: string) =>
        jobs.claim({
          id: jobId,
          type: "automation.run",
          now: "2026-07-18T12:00:00.000Z",
        }),
      executeClaimedRun: (job: unknown) => Promise.resolve(job),
    } as never,
    background: {
      start(_name, task) {
        scheduled.push(task);
      },
    },
  });

  const response = await createHttpApp(deps).request(`/api/automation-runs/${failed.id}/resume`, {
    method: "POST",
    headers: auth,
  });
  const body = (await response.json()) as { job: { id: string; status: string } };

  assertEquals(response.status, 202);
  assertEquals(body.job.id, failed.id);
  assertEquals(body.job.status, "running");
  assertEquals(scheduled.length, 1);
  assertEquals((await jobs.get(failed.id))?.status, "running");
});

test("job event endpoint streams replayable runtime events as SSE", async () => {
  const deps = buildTestDeps();
  const runtime = await deps.getRuntime();
  const job = await runtime.jobs.create({
    id: "job-events",
    type: "test",
    status: "running",
    input: {},
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
  });
  runtime.events.publish({
    type: "model.response.delta",
    jobId: job.id,
    taskId: "compose",
    data: { delta: "hello", accumulatedCharacters: 5 },
  });
  const response = await createHttpApp(deps).request(`/api/jobs/${job.id}/events`, {
    headers: auth,
  });
  assertEquals(response.status, 200);
  assertEquals(response.headers.get("content-type"), "text/event-stream; charset=utf-8");
  const reader = response.body!.getReader();
  const first = await reader.read();
  await reader.cancel();
  const frame = new TextDecoder().decode(first.value);
  assert(frame.includes("event: runtime"));
  assert(frame.includes('"type":"model.response.delta"'));
  assert(frame.includes('"taskId":"compose"'));
});

test("job event stream subscribes before replay without duplicating event IDs", async () => {
  const hub = new RuntimeEventHub();
  const jobs = new MemoryJobStore();
  const job = await jobs.create({
    id: "job-replay-boundary",
    type: "test",
    status: "running",
    input: {},
    createdAt: "2026-07-18T12:00:00.000Z",
    updatedAt: "2026-07-18T12:00:00.000Z",
  });
  hub.publish({ type: "task.started", jobId: job.id, taskId: "research" });
  let injected = false;
  const events: ApplicationRuntime["events"] = {
    publish: (event) => hub.publish(event),
    subscribe: (listener, filter) => hub.subscribe(listener, filter),
    recent(filter) {
      const replay = hub.recent(filter);
      if (!injected) {
        injected = true;
        hub.publish({
          type: "model.response.delta",
          jobId: job.id,
          taskId: "research",
          data: { delta: "during replay" },
        });
      }
      return replay;
    },
  };
  const response = await createHttpApp(buildTestDeps({ jobs, events })).request(
    `/api/jobs/${job.id}/events`,
    { headers: auth },
  );
  const reader = response.body!.getReader();
  const decoder = new TextDecoder();
  const first = decoder.decode((await reader.read()).value);
  const second = decoder.decode((await reader.read()).value);
  await reader.cancel();
  const frames = first + second;

  assertEquals(frames.match(/"type":"task.started"/g)?.length, 1);
  assertEquals(frames.match(/during replay/g)?.length, 1);
});

test("job event stream closes after a terminal job status event", async () => {
  const events = new RuntimeEventHub();
  const jobs = new EventedJobStore(new MemoryJobStore(), events);
  const deps = buildTestDeps({ jobs, events });
  const queued = await jobs.create(
    createJob("article.generate", { planId: "plan" }, new Date("2026-07-18T12:00:00.000Z")),
  );
  const running = await jobs.update(startJob(queued, new Date("2026-07-18T12:00:01.000Z")));
  const response = await createHttpApp(deps).request(`/api/jobs/${running.id}/events`, {
    headers: auth,
  });
  const reader = response.body!.getReader();
  await reader.read();
  await reader.read();

  await jobs.update(finishJob(running, "succeeded", {}, new Date("2026-07-18T12:00:02.000Z")));

  const terminal = await reader.read();
  const closed = await reader.read();
  assert(new TextDecoder().decode(terminal.value).includes('"status":"succeeded"'));
  assertEquals(closed.done, true);
});

test("job event stream stays open for a bridged child terminal transition", async () => {
  const events = new RuntimeEventHub();
  const jobs = new EventedJobStore(new MemoryJobStore(), events);
  const deps = buildTestDeps({ jobs, events });
  const queued = await jobs.create(
    createJob(
      "automation.run",
      { automationId: "automation-1" },
      new Date("2026-07-18T12:00:00.000Z"),
    ),
  );
  const running = await jobs.update(startJob(queued, new Date("2026-07-18T12:00:01.000Z")));
  const response = await createHttpApp(deps).request(`/api/jobs/${running.id}/events`, {
    headers: auth,
  });
  const reader = response.body!.getReader();
  await reader.read();
  await reader.read();

  events.publish({
    type: "job.status.changed",
    jobId: running.id,
    data: {
      type: "article.generate",
      status: "succeeded",
      sourceJobId: "job-child-article",
      sourceJobType: "article.generate",
    },
  });
  const childTerminal = await reader.read();
  assert(
    new TextDecoder().decode(childTerminal.value).includes('"sourceJobId":"job-child-article"'),
  );

  events.publish({
    type: "model.response.delta",
    jobId: running.id,
    taskId: "publication/write",
    data: { delta: "still running" },
  });
  const activityAfterChild = await reader.read();
  assert(new TextDecoder().decode(activityAfterChild.value).includes("still running"));

  await jobs.update(finishJob(running, "succeeded", {}, new Date("2026-07-18T12:00:02.000Z")));
  const outerTerminal = await reader.read();
  const closed = await reader.read();
  assert(new TextDecoder().decode(outerTerminal.value).includes('"status":"succeeded"'));
  assertEquals(closed.done, true);
});

test("job event stream closes when a terminal transition is already in replay", async () => {
  const events = new RuntimeEventHub();
  const storedJobs = new MemoryJobStore();
  const jobs = new EventedJobStore(storedJobs, events);
  const deps = buildTestDeps({ jobs, events });
  const queued = await jobs.create(
    createJob("article.generate", { planId: "plan" }, new Date("2026-07-18T12:00:00.000Z")),
  );
  const running = await jobs.update(startJob(queued, new Date("2026-07-18T12:00:01.000Z")));
  await jobs.update(finishJob(running, "succeeded", {}, new Date("2026-07-18T12:00:02.000Z")));

  const response = await createHttpApp(deps).request(`/api/jobs/${running.id}/events`, {
    headers: auth,
  });
  const body = await response.text();

  assert(body.includes('"status":"succeeded"'));
});

test("health verifies the modular application runtime", async () => {
  const response = await createHttpApp(buildTestDeps()).request("/api/health", {
    headers: auth,
  });
  assertEquals(response.status, 200);
  const body = (await response.json()) as { ok: boolean; checks: Record<string, unknown> };
  assert(body.ok);
  assert("runtime" in body.checks);
  assert("storage" in body.checks);
});

test("connections are web-managed and never return credentials", async () => {
  const app = createHttpApp(buildTestDeps());
  const response = await app.request("/api/connections", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      connectorId: "openai-compatible",
      name: "Default model",
      enabled: true,
      settings: { baseUrl: "https://api.example.com/v1", model: "example-chat" },
      credentials: { apiKey: "super-secret" },
      overrides: { body: { temperature: 0.7 } },
    }),
  });
  assertEquals(response.status, 201);
  const body = (await response.json()) as { connection: Record<string, unknown> };
  assertEquals(body.connection.connectorId, "openai-compatible");
  assertEquals("credentials" in body.connection, false);
  assertEquals((body.connection.credentialState as Record<string, boolean>).apiKey, true);
});

test("content identities use optimistic revisions", async () => {
  const app = createHttpApp(buildTestDeps());
  const createResponse = await app.request("/api/identities", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "技术编辑",
      enabled: true,
      positioning: "解释技术趋势",
      audience: "软件工程师",
      tone: "清晰克制",
      forbiddenTopics: [],
    }),
  });
  assertEquals(createResponse.status, 201);
  const created = (await createResponse.json()) as { identity: { id: string } };

  const staleResponse = await app.request(`/api/identities/${created.identity.id}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      revision: 99,
      name: "技术编辑",
      enabled: true,
      positioning: "解释技术趋势",
      audience: "软件工程师",
      tone: "清晰克制",
      forbiddenTopics: [],
    }),
  });
  assertEquals(staleResponse.status, 409);
});

test("source collections store URL and query inputs without connector routing", async () => {
  const app = createHttpApp(buildTestDeps());
  const accepted = await app.request("/api/source-collections", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      name: "Search and fetch sources",
      enabled: true,
      sources: [
        {
          kind: "query",
          query: "AI release",
          enabled: true,
        },
        {
          kind: "url",
          url: "https://example.com",
          enabled: true,
        },
      ],
    }),
  });
  assertEquals(accepted.status, 201);
  const body = (await accepted.json()) as {
    sourceCollection: { sources: Array<{ kind: string }> };
  };
  assertEquals(
    body.sourceCollection.sources.map((source) => source.kind),
    ["query", "url"],
  );
});

test("Weixin publish plans reject impossible cover configurations", async () => {
  const deps = buildTestDeps();
  const runtime = await deps.getRuntime();
  await runtime.workspace.save(
    "identity",
    createWorkspaceEntity({
      id: "identity-weixin-plan",
      name: "编辑",
      enabled: true,
      positioning: "解释技术变化",
      audience: "工程师",
      tone: "克制",
      forbiddenTopics: [],
    }),
  );
  await runtime.workspace.save(
    "channel-account",
    createWorkspaceEntity({
      id: "account-weixin-plan",
      name: "公众号",
      channel: ChannelId.WeixinOfficialAccount,
      connectionId: "weixin-main",
      settings: {},
    }),
  );
  await runtime.workspace.save(
    "publish-target",
    createWorkspaceEntity({
      id: "target-weixin-plan",
      name: "微信草稿",
      channelAccountId: "account-weixin-plan",
      settings: {},
    }),
  );
  await runtime.connectionManager.save({
    id: "chat-plan",
    connectorId: "openai-compatible",
    name: "Chat",
    enabled: true,
    settings: { baseUrl: "https://api.example.com/v1", model: "test" },
    credentials: { apiKey: "test-key" },
  });
  await runtime.connectionManager.save({
    id: "image-plan",
    connectorId: "dashscope",
    name: "Image",
    enabled: true,
    settings: { apiHost: "https://dashscope.aliyuncs.com", model: "test" },
    credentials: { apiKey: "test-key" },
  });
  const app = createHttpApp(deps);
  const base = {
    name: "微信方案",
    enabled: true,
    identityId: "identity-weixin-plan",
    knowledgeBaseIds: [],
    sourceCollectionIds: [],
    connections: { chat: "chat-plan", image: "image-plan" },
    publishing: { mode: "publish", targetIds: ["target-weixin-plan"] },
  };
  const save = (body: unknown) =>
    app.request("/api/content-plans", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const missingPlugin = await save({ ...base, plugins: [] });
  assertEquals(missingPlugin.status, 400);
  assert(((await missingPlugin.json()) as { error: string }).error.includes("必须启用封面"));

  const enhancement = await save({
    ...base,
    plugins: [
      {
        pluginId: ArticlePluginId.CoverImage,
        enabled: true,
        config: { necessity: "enhancement" },
      },
    ],
  });
  assertEquals(enhancement.status, 400);
  assert(((await enhancement.json()) as { error: string }).error.includes("必要资源"));

  const missingImage = await save({
    ...base,
    connections: { chat: "chat-plan" },
    plugins: [
      {
        pluginId: ArticlePluginId.CoverImage,
        enabled: true,
        config: { necessity: "essential" },
      },
    ],
  });
  assertEquals(missingImage.status, 400);
  assert(((await missingImage.json()) as { error: string }).error.includes("图片连接"));

  const valid = await save({
    ...base,
    plugins: [
      {
        pluginId: ArticlePluginId.CoverImage,
        enabled: true,
        config: { necessity: "essential" },
      },
    ],
  });
  assertEquals(valid.status, 201);
  const validBody = (await valid.json()) as {
    contentPlan?: { id: string; name: string; revision: number };
    plan?: unknown;
  };
  assert(validBody.contentPlan);
  assertEquals(validBody.contentPlan.name, "微信方案");
  assertEquals(validBody.plan, undefined);

  const updated = await app.request(`/api/content-plans/${validBody.contentPlan.id}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...base,
      name: "微信方案 2",
      revision: validBody.contentPlan.revision,
      plugins: [
        {
          pluginId: ArticlePluginId.CoverImage,
          enabled: true,
          config: { necessity: "essential" },
        },
      ],
    }),
  });
  assertEquals(updated.status, 200);
  const updatedBody = (await updated.json()) as {
    contentPlan?: { name: string; revision: number };
    plan?: unknown;
  };
  assert(updatedBody.contentPlan);
  assertEquals(updatedBody.contentPlan.name, "微信方案 2");
  assertEquals(updatedBody.contentPlan.revision, validBody.contentPlan.revision + 1);
  assertEquals(updatedBody.plan, undefined);
});

test("unknown routes return the current REST error envelope", async () => {
  const response = await createHttpApp(buildTestDeps()).request("/unknown", {
    headers: auth,
  });
  assertEquals(response.status, 404);
  const body = (await response.json()) as { error: string };
  assertEquals(body.error, "无效的 API 路径");
});

test("request ids are returned for correlation", async () => {
  const response = await createHttpApp(buildTestDeps()).request("/api/health", {
    headers: { ...auth, "X-Request-Id": "trace-xyz" },
  });
  assertEquals(response.headers.get("X-Request-Id"), "trace-xyz");
});
