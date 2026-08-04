import { Hono } from "hono";
import { test } from "vite-plus/test";
import {
  ConnectorManager,
  ConnectorClientResolver,
  MemoryConnectionStore,
  MemoryCredentialStore,
  createBuiltInConnectorRegistry,
} from "@trendpublish/connectors";
import { ChannelId, ContentPlanTemplateId, WorkspaceKind } from "@trendpublish/contracts";
import { assert, assertEquals } from "@trendpublish/core/test";
import { createWorkspaceEntity, MemoryWorkspaceRepository } from "@trendpublish/core/workspace";
import {
  EventedJobStore,
  MemoryJobStore,
  MemoryTaskStore,
  RuntimeEventHub,
  MemoryRunStore,
  RunManager,
  createJob,
  finishJob,
  startJob,
} from "@trendpublish/runtime";
import { createHttpApp } from "./app.ts";
import { InProcessBackgroundTasks } from "@trendpublish/core/application";
import {
  ChannelRegistry,
  WEIXIN_ARTICLE_PROFILE,
  WEIXIN_CHANNEL_DEFINITION,
  type ChannelAdapter,
} from "@trendpublish/publishing";
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
  const runs = new RunManager(new MemoryRunStore(), jobs, events);
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
    runs,
    connectors,
    connectionManager,
    channels: testChannels(),
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
  const workspace = new MemoryWorkspaceRepository();
  await workspace.save(
    WorkspaceKind.ChannelAccount,
    createWorkspaceEntity({
      id: "account-plan-live",
      name: "公众号",
      enabled: true,
      channel: ChannelId.WeixinOfficialAccount,
      connectionId: "weixin-plan-live",
      settings: {},
    }),
  );
  await workspace.save(
    WorkspaceKind.ContentPlan,
    createWorkspaceEntity({
      id: "plan-live",
      name: "可发布方案",
      enabled: true,
      templateId: ContentPlanTemplateId.DailyBrief,
      identityId: "identity-live",
      knowledgeBaseIds: [],
      sourceCollectionIds: [],
      connections: { chat: "chat-live" },
      publishing: {
        destinations: [{ accountId: "account-plan-live", publicationType: "article" }],
      },
    }),
  );
  const scheduled: Array<() => Promise<unknown>> = [];
  const deps = buildTestDeps({
    workspace,
    jobs,
    automations: {
      createRunJob: (input: unknown, options: { runId?: string }) =>
        jobs.create(
          createJob("automation.run", input, new Date("2026-07-18T12:00:00.000Z"), {
            runId: options.runId,
          }),
        ),
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
  const body = (await response.json()) as {
    job: { status: string; id: string };
    run: { id: string; status: string };
  };

  assertEquals(response.status, 202);
  assertEquals(body.job.status, "queued");
  assert(body.run.id.startsWith("run-"));
  assertEquals(body.run.status, "queued");
  assertEquals(scheduled.length, 1);
  assertEquals((await jobs.get(body.job.id))?.status, "queued");
  const detail = await (await deps.getRuntime()).runs.getDetail(body.run.id);
  assertEquals(detail?.sessions.map((session) => session.kind).sort(), ["main", "publication"]);
});

test("run endpoints replay durable activities and keep raw model output transient", async () => {
  const deps = buildTestDeps();
  const runtime = await deps.getRuntime();
  const run = await runtime.runs.createRun({
    kind: "content",
    trigger: { kind: "debug" },
    planId: "plan-live",
  });
  const session = await runtime.runs.createMainSession(run.id);
  const job = await runtime.jobs.create(
    createJob("article.generate", { planId: "plan-live" }, new Date(), {
      runId: run.id,
      sessionId: session.id,
    }),
  );
  await runtime.runs.onTaskActivity({
    jobId: job.id,
    taskId: "react/agent/tool/1/1-search_sources",
    attempt: 1,
    effect: "pure",
    input: { query: "AI" },
    status: "running",
    occurredAt: "2026-08-04T12:00:00.000Z",
  });

  const detailResponse = await createHttpApp(deps).request(`/api/runs/${run.id}`, {
    headers: auth,
  });
  const detail = (await detailResponse.json()) as { run: { id: string }; sessions: unknown[] };
  assertEquals(detailResponse.status, 200);
  assertEquals(detail.run.id, run.id);
  assertEquals(detail.sessions.length, 1);

  const activityResponse = await createHttpApp(deps).request(`/api/runs/${run.id}/events`, {
    headers: auth,
  });
  const activityReader = activityResponse.body!.getReader();
  const activityFrame = new TextDecoder().decode((await activityReader.read()).value);
  assert(activityFrame.includes("event: activity"));
  assert(activityFrame.includes("search sources"));
  await runtime.runs.onTaskActivity({
    jobId: job.id,
    taskId: "react/agent/tool/1/1-search_sources",
    attempt: 1,
    effect: "pure",
    output: { count: 2 },
    status: "succeeded",
    occurredAt: "2026-08-04T12:00:01.000Z",
  });
  const completedActivityFrame = new TextDecoder().decode((await activityReader.read()).value);
  await activityReader.cancel();
  assert(completedActivityFrame.includes('"status":"succeeded"'));
  assert(completedActivityFrame.includes("id: 2"));

  const modelResponse = await createHttpApp(deps).request(`/api/runs/${run.id}/model-stream`, {
    headers: auth,
  });
  const modelReader = modelResponse.body!.getReader();
  await modelReader.read();
  const lateJob = await runtime.jobs.create(
    createJob("article.generate", { planId: "plan-live" }, new Date(), {
      runId: run.id,
      sessionId: session.id,
    }),
  );
  runtime.events.publish({
    type: "agent.response.delta",
    jobId: lateJob.id,
    taskId: "react/agent/turn/1",
    data: { turn: 1, delta: "raw-live-only", accumulatedCharacters: 13 },
  });
  const modelFrame = new TextDecoder().decode((await modelReader.read()).value);
  await modelReader.cancel();
  assert(modelFrame.includes("raw-live-only"));
  assertEquals((await runtime.runs.store.listActivities(run.id)).length, 1);
});

test("run recovery accepts interrupted needs-attention jobs", async () => {
  const jobs = new MemoryJobStore();
  const runs = new RunManager(new MemoryRunStore(), jobs, new RuntimeEventHub());
  const run = await runs.createRun({ kind: "content", trigger: { kind: "manual" } });
  const session = await runs.createMainSession(run.id);
  const interrupted = finishJob(
    createJob("article.generate", { planId: "plan-live" }, new Date(), {
      runId: run.id,
      sessionId: session.id,
    }),
    "needs_attention",
    { error: "服务重启" },
  );
  await jobs.create(interrupted);
  const scheduled: Array<() => Promise<unknown>> = [];
  const deps = buildTestDeps({
    jobs,
    runs,
    articles: {
      async resume(jobId: string) {
        const claim = await jobs.claim({
          id: jobId,
          type: "article.generate",
          now: new Date().toISOString(),
        });
        if (claim.kind !== "claimed") return claim.record;
        return await jobs.update(finishJob(claim.record, "succeeded"));
      },
    } as never,
    background: {
      start(_name, task) {
        scheduled.push(task);
      },
    },
  });

  const response = await createHttpApp(deps).request(`/api/runs/${run.id}/resume`, {
    method: "POST",
    headers: auth,
  });

  assertEquals(response.status, 202);
  assertEquals(scheduled.length, 1);
  await scheduled[0]!();
  assertEquals((await jobs.get(interrupted.id))?.status, "succeeded");
});

test("publication session preview exposes complete safe HTML and its selected cover", async () => {
  const deps = buildTestDeps();
  const runtime = await deps.getRuntime();
  const run = await runtime.runs.createRun({
    kind: "publication",
    trigger: { kind: "manual" },
    packageId: "package-preview",
  });
  const destinationId = "destination-preview";
  const session = await runtime.runs.ensurePublicationSession(run.id, {
    destinationId,
    accountId: "account-preview",
    accountName: "预览公众号",
    channel: ChannelId.WeixinOfficialAccount,
    publicationType: "article",
  });
  const job = await runtime.jobs.create(
    createJob("content.publish", { packageId: "package-preview", destinations: [] }, new Date(), {
      runId: run.id,
    }),
  );
  await runtime.runs.attachJob(run.id, session.id, job.id);
  const taskId = `destination:${destinationId}/prepare`;
  await runtime.tasks.claim({
    jobId: job.id,
    taskId,
    fingerprint: "preview-fingerprint",
    version: "1",
    effect: "pure",
    leaseMs: 60_000,
    now: "2026-08-04T12:00:00.000Z",
  });
  const fullHtml = `<section>${"完整微信正文".repeat(180)}<img src="asset://cover-image"></section>`;
  const coverSource = "data:image/png;base64,aW1hZ2U=";
  await runtime.tasks.succeed(
    job.id,
    taskId,
    {
      title: "微信渠道稿",
      digest: "渠道摘要",
      body: { format: "html", content: fullHtml },
      assets: [
        {
          id: "cover-image",
          mediaType: "image",
          source: { uri: coverSource },
          mimeType: "image/png",
          checksum: "cover-checksum",
          alt: "渠道封面",
        },
      ],
      metadata: {
        coverAssetId: "cover-image",
        connectorConfig: "must-not-leak",
      },
    },
    "2026-08-04T12:00:01.000Z",
  );

  const response = await createHttpApp(deps).request(
    `/api/runs/${run.id}/sessions/${encodeURIComponent(session.id)}/preview`,
    { headers: auth },
  );
  const body = (await response.json()) as {
    body: { content: string };
    cover: { assetId: string; source: string; mimeType: string; alt: string };
  };

  assertEquals(response.status, 200);
  assert(body.body.content.includes("完整微信正文".repeat(180)));
  assert(body.body.content.includes(coverSource));
  assertEquals(body.cover, {
    source: coverSource,
    alt: "渠道封面",
    assetId: "cover-image",
    mimeType: "image/png",
  });
  assert(!JSON.stringify(body).includes("must-not-leak"));
});

test("content package context resolves its generation run and later publication runs", async () => {
  const deps = buildTestDeps();
  const runtime = await deps.getRuntime();
  const generationRun = await runtime.runs.createRun({
    kind: "content",
    trigger: { kind: "manual" },
    planId: "plan-context",
  });
  const generationJob = await runtime.jobs.create(
    createJob("article.generate", { planId: "plan-context" }, new Date(), {
      runId: generationRun.id,
    }),
  );
  await runtime.runs.completeContent(generationRun.id, {
    packageId: "package-context",
    title: "已生成文章",
  });
  await runtime.workspace.save(
    "content-package",
    createWorkspaceEntity({
      id: "package-context",
      jobId: generationJob.id,
      planId: "plan-context",
      contentPackage: { schemaVersion: "content-package.v5" },
    }) as never,
  );
  const publicationRun = await runtime.runs.createRun({
    kind: "publication",
    trigger: { kind: "manual" },
    packageId: "package-context",
    originRunId: generationRun.id,
  });

  const response = await createHttpApp(deps).request(
    "/api/content-packages/package-context/run-context",
    { headers: auth },
  );
  const body = (await response.json()) as {
    generationRun?: { id: string };
    publicationRuns: Array<{ id: string }>;
    contentPackage: { id: string };
  };

  assertEquals(response.status, 200);
  assertEquals(body.contentPackage.id, "package-context");
  assertEquals(body.generationRun?.id, generationRun.id);
  assertEquals(
    body.publicationRuns.map((run) => run.id),
    [publicationRun.id],
  );
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

test("article resume rejects retired manual-completion jobs", async () => {
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
  assertEquals(response.status, 400);
  assertEquals(scheduled.length, 0);
  assertEquals((await jobs.get(failed.id))?.status, "failed");
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

test("channel account connection tests reuse the managed connection without exposing secrets", async () => {
  const checked: Array<{ id: string; connectorId: string; credentials?: unknown }> = [];
  const deps = buildTestDeps({
    connectionManager: {
      get: async (id: string) =>
        id === "channel-account-test"
          ? { id, connectorId: ChannelId.WeixinOfficialAccount, enabled: true }
          : null,
      check: async (input: { id: string; connectorId: string; credentials?: unknown }) => {
        checked.push(input);
        return {
          success: true,
          message: "连接成功，微信凭证有效",
          latencyMs: 12,
          checkedAt: "2026-08-04T12:00:00.000Z",
        };
      },
    } as never,
  });
  const runtime = await deps.getRuntime();
  await runtime.workspace.save(
    WorkspaceKind.ChannelAccount,
    createWorkspaceEntity({
      id: "account-test",
      name: "公众号",
      enabled: true,
      channel: ChannelId.WeixinOfficialAccount,
      connectionId: "channel-account-test",
      connectorId: ChannelId.WeixinOfficialAccount,
      settings: { baseUrl: "https://api.weixin.qq.com" },
      credentialState: { appId: true, appSecret: true, proxyUrl: false },
    }),
  );

  const response = await createHttpApp(deps).request("/api/channel-accounts/test", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      accountId: "account-test",
      name: "公众号",
      enabled: true,
      channel: ChannelId.WeixinOfficialAccount,
      connectorId: ChannelId.WeixinOfficialAccount,
      settings: { baseUrl: "https://api.weixin.qq.com" },
      credentials: {},
    }),
  });
  const body = (await response.json()) as {
    test: { success: boolean; message: string; latencyMs: number };
  };

  assertEquals(response.status, 200);
  assertEquals(body.test.success, true);
  assertEquals(body.test.latencyMs, 12);
  assertEquals(checked[0]?.id, "channel-account-test");
  assertEquals(checked[0]?.credentials, {});
  assertEquals("credentials" in body.test, false);
});

test("channel accounts reference eligible generic connectors as publisher tools", async () => {
  const deps = buildTestDeps();
  const runtime = await deps.getRuntime();
  await runtime.connectionManager.save({
    id: "publisher-image",
    connectorId: "minimax",
    name: "微信封面生成",
    enabled: true,
    settings: {},
    credentials: { apiKey: "image-key" },
  });
  await runtime.connectionManager.save({
    id: "publisher-chat",
    connectorId: "openai-compatible",
    name: "不兼容的模型连接",
    enabled: true,
    settings: { baseUrl: "https://api.example.com/v1", model: "test" },
    credentials: { apiKey: "chat-key" },
  });
  const app = createHttpApp(deps);
  const accountBody = {
    name: "公众号",
    enabled: true,
    channel: ChannelId.WeixinOfficialAccount,
    connectorId: ChannelId.WeixinOfficialAccount,
    settings: {},
    credentials: { appId: "wx-app", appSecret: "wx-secret" },
  };

  const created = await app.request("/api/channel-accounts", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...accountBody,
      publisher: { toolConnectionIds: ["publisher-image"] },
    }),
  });
  const createdBody = (await created.json()) as {
    channelAccount: { publisher?: { toolConnectionIds: string[] }; credentialState?: unknown };
  };

  assertEquals(created.status, 201);
  assertEquals(createdBody.channelAccount.publisher?.toolConnectionIds, ["publisher-image"]);
  assert(createdBody.channelAccount.credentialState);

  const missingRequired = await app.request("/api/channel-accounts", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify(accountBody),
  });
  assertEquals(missingRequired.status, 400);

  const rejected = await app.request("/api/channel-accounts", {
    method: "POST",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...accountBody,
      publisher: { toolConnectionIds: ["publisher-chat"] },
    }),
  });
  assertEquals(rejected.status, 400);
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

test("Weixin content plans preserve channel-owned publication configuration", async () => {
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
      enabled: true,
      channel: ChannelId.WeixinOfficialAccount,
      connectionId: "weixin-main",
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
  const app = createHttpApp(deps);
  const base = {
    name: "微信方案",
    enabled: true,
    templateId: ContentPlanTemplateId.DailyBrief,
    identityId: "identity-weixin-plan",
    knowledgeBaseIds: [],
    sourceCollectionIds: [],
    connections: { chat: "chat-plan" },
    agent: {
      modelConnectionId: "chat-plan",
      strategyId: ContentPlanTemplateId.DailyBrief,
      toolConnectionIds: [],
      enhancementToolIds: ["remove-ai-tone"],
      budget: { maxTurns: 20 },
    },
    publishing: {
      destinations: [{ accountId: "account-weixin-plan", publicationType: "article" }],
    },
  };
  const save = (body: unknown) =>
    app.request("/api/content-plans", {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

  const valid = await save({ ...base, plugins: [{ pluginId: "legacy", enabled: false }] });
  assertEquals(valid.status, 201);
  const validBody = (await valid.json()) as {
    contentPlan?: {
      id: string;
      name: string;
      revision: number;
      templateId: string;
      plugins?: unknown;
      agent?: { modelConnectionId: string; enhancementToolIds: string[] };
    };
    plan?: unknown;
  };
  assert(validBody.contentPlan);
  assertEquals(validBody.contentPlan.name, "微信方案");
  assertEquals(validBody.contentPlan.templateId, ContentPlanTemplateId.DailyBrief);
  assertEquals(validBody.contentPlan.plugins, undefined);
  assertEquals(validBody.contentPlan.agent?.modelConnectionId, "chat-plan");
  assertEquals(validBody.contentPlan.agent?.enhancementToolIds, ["remove-ai-tone"]);
  assertEquals(validBody.plan, undefined);

  const deletingAgentModel = await app.request("/api/connections/chat-plan", {
    method: "DELETE",
    headers: auth,
  });
  assertEquals(deletingAgentModel.status, 409);

  const updated = await app.request(`/api/content-plans/${validBody.contentPlan.id}`, {
    method: "PATCH",
    headers: { ...auth, "Content-Type": "application/json" },
    body: JSON.stringify({
      ...base,
      name: "微信方案 2",
      revision: validBody.contentPlan.revision,
      templateId: ContentPlanTemplateId.DeepAnalysis,
      agent: { ...base.agent, strategyId: ContentPlanTemplateId.DeepAnalysis },
    }),
  });
  assertEquals(updated.status, 200);
  const updatedBody = (await updated.json()) as {
    contentPlan?: { name: string; revision: number; templateId: string };
    plan?: unknown;
  };
  assert(updatedBody.contentPlan);
  assertEquals(updatedBody.contentPlan.name, "微信方案 2");
  assertEquals(updatedBody.contentPlan.templateId, ContentPlanTemplateId.DeepAnalysis);
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

function testChannels(): ChannelRegistry {
  const adapter: ChannelAdapter = {
    id: "test-weixin",
    version: "1",
    channel: ChannelId.WeixinOfficialAccount,
    publicationType: "article",
    async prepare(contentPackage) {
      return {
        title: contentPackage.document.title,
        digest: contentPackage.document.digest,
        body: { format: "html", content: "<p>test</p>" },
        assets: [],
      };
    },
    async publish(_prepared, _account, context) {
      return { status: "succeeded", publishedAt: context.now().toISOString() };
    },
  };
  return new ChannelRegistry([
    {
      definition: WEIXIN_CHANNEL_DEFINITION,
      profiles: [WEIXIN_ARTICLE_PROFILE],
      adapters: [adapter],
    },
  ]);
}
