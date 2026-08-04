import { expect, test } from "vite-plus/test";
import { MemoryJobStore, createJob, finishJob, startJob } from "./job.ts";
import { RuntimeEventHub } from "./events.ts";
import { MemoryRunStore, RunKind, RunManager, RunStatus, RunTriggerKind } from "./run.ts";

test("run manager persists task activity before publishing it", async () => {
  const store = new MemoryRunStore();
  const jobs = new MemoryJobStore();
  const events = new RuntimeEventHub();
  const manager = new RunManager(store, jobs, events, () => new Date("2026-08-04T12:00:00Z"));
  const appendActivity = store.appendActivity.bind(store);
  let persisted = false;
  store.appendActivity = async (activity) => {
    const saved = await appendActivity(activity);
    persisted = true;
    return saved;
  };
  const run = await manager.createRun({
    kind: RunKind.Content,
    trigger: { kind: RunTriggerKind.Debug },
    planId: "plan-1",
  });
  const session = await manager.createMainSession(run.id);
  const job = await jobs.create(
    createJob("article.generate", { planId: "plan-1" }, new Date("2026-08-04T12:00:00Z"), {
      runId: run.id,
      sessionId: session.id,
    }),
  );
  let persistedWhenPublished = false;
  events.subscribe((event) => {
    if (event.type !== "run.activity") return;
    persistedWhenPublished = persisted;
  });

  await manager.onTaskActivity({
    jobId: job.id,
    taskId: "react/agent/tool/1/1-search_sources",
    attempt: 1,
    effect: "pure",
    input: { query: "AI", apiKey: "must-not-leak" },
    status: "running",
    occurredAt: "2026-08-04T12:00:01Z",
  });

  const activity = (await store.listActivities(run.id))[0]!;
  expect(persistedWhenPublished).toBe(true);
  expect(activity.kind).toBe("tool_call");
  expect(JSON.stringify(activity.input)).not.toContain("must-not-leak");
});

test("content run becomes partial when generation succeeds and a publication fails", async () => {
  const store = new MemoryRunStore();
  const jobs = new MemoryJobStore();
  const manager = new RunManager(store, jobs, new RuntimeEventHub());
  const run = await manager.createRun({
    kind: RunKind.Content,
    trigger: { kind: RunTriggerKind.Automation, automationId: "automation-1" },
  });
  const main = await manager.createMainSession(run.id);
  await store.updateSession({
    ...main,
    status: RunStatus.Succeeded,
    updatedAt: new Date().toISOString(),
  });
  const publication = await manager.ensurePublicationSession(run.id, {
    destinationId: "destination-1",
    accountId: "account-1",
    accountName: "公众号",
    channel: "weixin",
    publicationType: "article",
  });
  await store.updateSession({
    ...publication,
    status: RunStatus.Failed,
    updatedAt: new Date().toISOString(),
  });
  const outer = await jobs.create(createJob("automation.run", {}, new Date(), { runId: run.id }));
  await manager.onJobChanged({ ...outer, status: "degraded", updatedAt: new Date().toISOString() });

  expect((await store.getRun(run.id))?.status).toBe(RunStatus.Partial);
});

test("model turn activity keeps lifecycle state without persisting raw model payload", async () => {
  const store = new MemoryRunStore();
  const jobs = new MemoryJobStore();
  const manager = new RunManager(store, jobs, new RuntimeEventHub());
  const run = await manager.createRun({
    kind: RunKind.Content,
    trigger: { kind: RunTriggerKind.Debug },
  });
  const session = await manager.createMainSession(run.id);
  const job = await jobs.create(
    createJob("article.generate", {}, new Date(), { runId: run.id, sessionId: session.id }),
  );

  await manager.onTaskActivity({
    jobId: job.id,
    taskId: "react/agent/turn/1",
    attempt: 1,
    effect: "idempotent",
    input: { messages: [{ role: "user", content: "private prompt" }] },
    status: "running",
    occurredAt: "2026-08-04T12:00:00.000Z",
  });
  await manager.onTaskActivity({
    jobId: job.id,
    taskId: "react/agent/turn/1",
    attempt: 1,
    effect: "idempotent",
    output: { content: "raw assistant text", toolCalls: [{ arguments: "secret args" }] },
    status: "succeeded",
    occurredAt: "2026-08-04T12:00:01.000Z",
  });

  const activity = (await store.listActivities(run.id))[0]!;
  expect(activity.kind).toBe("model_turn");
  expect(activity.status).toBe("succeeded");
  expect(activity.input).toBeUndefined();
  expect(activity.output).toBeUndefined();
  expect(JSON.stringify(activity)).not.toContain("raw assistant text");
  expect(JSON.stringify(activity)).not.toContain("secret args");
});

test("interrupted jobs close model activities that were left running", async () => {
  const store = new MemoryRunStore();
  const jobs = new MemoryJobStore();
  const events = new RuntimeEventHub();
  const manager = new RunManager(store, jobs, events);
  const run = await manager.createRun({
    kind: RunKind.Content,
    trigger: { kind: RunTriggerKind.Manual },
  });
  const session = await manager.createMainSession(run.id);
  const job = await jobs.create(
    createJob("article.generate", {}, new Date("2026-08-04T12:00:00Z"), {
      runId: run.id,
      sessionId: session.id,
    }),
  );
  await manager.onTaskActivity({
    jobId: job.id,
    taskId: "react/agent/turn/2",
    attempt: 1,
    effect: "idempotent",
    status: "running",
    occurredAt: "2026-08-04T12:00:01.000Z",
  });

  await manager.onJobChanged(
    finishJob(
      job,
      "needs_attention",
      { error: "本地服务在任务执行期间重启" },
      new Date("2026-08-04T12:00:02Z"),
    ),
  );

  const activity = (await store.listActivities(run.id))[0]!;
  expect(activity.status).toBe("needs_attention");
  expect(activity.finishedAt).toBe("2026-08-04T12:00:02.000Z");
  expect(activity.error).toBe("服务重启，本轮执行已中断");
});

test("startup reconciliation repairs stale interrupted activities", async () => {
  const store = new MemoryRunStore();
  const jobs = new MemoryJobStore();
  const manager = new RunManager(store, jobs, new RuntimeEventHub());
  const run = await manager.createRun({
    kind: RunKind.Content,
    trigger: { kind: RunTriggerKind.Manual },
  });
  const session = await manager.createMainSession(run.id);
  const job = await jobs.create(
    createJob("article.generate", {}, new Date(), { runId: run.id, sessionId: session.id }),
  );
  await manager.onTaskActivity({
    jobId: job.id,
    taskId: "react/agent/turn/1",
    attempt: 1,
    effect: "idempotent",
    status: "running",
    occurredAt: "2026-08-04T12:00:01.000Z",
  });
  await store.updateSession({
    ...(await store.getSession(session.id))!,
    status: RunStatus.NeedsAttention,
    finishedAt: "2026-08-04T12:00:03.000Z",
    updatedAt: "2026-08-04T12:00:03.000Z",
  });

  await manager.reconcileInterruptedActivities();

  expect((await store.listActivities(run.id))[0]).toMatchObject({
    status: "needs_attention",
    finishedAt: "2026-08-04T12:00:03.000Z",
  });
});

test("resuming an interrupted job clears stale run and session errors", async () => {
  const store = new MemoryRunStore();
  const jobs = new MemoryJobStore();
  const manager = new RunManager(store, jobs, new RuntimeEventHub());
  const run = await manager.createRun({
    kind: RunKind.Content,
    trigger: { kind: RunTriggerKind.Manual },
  });
  const session = await manager.createMainSession(run.id);
  const job = await jobs.create(
    createJob("article.generate", {}, new Date("2026-08-04T12:00:00Z"), {
      runId: run.id,
      sessionId: session.id,
    }),
  );
  const interrupted = finishJob(
    job,
    "needs_attention",
    { error: "本地服务在任务执行期间重启" },
    new Date("2026-08-04T12:00:01Z"),
  );
  await manager.onJobChanged(interrupted);

  await manager.onJobChanged(startJob(interrupted, new Date("2026-08-04T12:00:02Z")));

  expect(await store.getRun(run.id)).toMatchObject({ status: RunStatus.Running });
  expect((await store.getRun(run.id))?.error).toBeUndefined();
  expect((await store.getSession(session.id))?.error).toBeUndefined();
});
