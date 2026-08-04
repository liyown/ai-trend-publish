import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { JobType, RunKind, RunTriggerKind, WorkspaceKind } from "@trendpublish/contracts";
import { fingerprint, JobClaimKind, JobStatus, type RuntimeEvent } from "@trendpublish/runtime";
import type { GenerateArticleInput } from "@trendpublish/article/application";
import type { PublishContentInput, RunAutomationInput } from "@trendpublish/core/application";
import { type AppVariables, factory } from "../deps.ts";
import { HttpError, jsonValidator } from "../middleware/errors.ts";
import {
  generateArticleSchema,
  jobIdParam,
  objectIdParam,
  publishContentSchema,
  runAutomationSchema,
} from "../schemas/studio.ts";

import { paginate, parsePage } from "./workspace-route-helpers.ts";

const listJobs = factory.createHandlers(async (c) => {
  const { page, pageSize } = parsePage(c.req.queries());
  const all = await (await c.var.deps.getRuntime()).jobs.list(undefined, 50000);
  return c.json(paginate(all, page, pageSize));
});

const getJob = factory.createHandlers(zValidator("param", jobIdParam, jsonValidator), async (c) => {
  const runtime = await c.var.deps.getRuntime();
  const { jobId } = c.req.valid("param");
  const job = await runtime.jobs.get(jobId);
  if (!job) throw new HttpError("任务不存在", 404);
  return c.json({ job, tasks: await runtime.tasks.list(jobId) });
});

const streamJobEvents = factory.createHandlers(
  zValidator("param", jobIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const { jobId } = c.req.valid("param");
    const job = await runtime.jobs.get(jobId);
    if (!job) throw new HttpError("任务不存在", 404);
    const afterId = c.req.header("Last-Event-ID") || undefined;
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        let closed = false;
        let replaying = true;
        const pending: RuntimeEvent[] = [];
        const delivered = new Set<string>();
        const stop = () => {
          unsubscribe();
          if (heartbeat) clearInterval(heartbeat);
        };
        const write = (value: string) => {
          if (closed) return;
          try {
            controller.enqueue(encoder.encode(value));
          } catch {
            closed = true;
            stop();
          }
        };
        const close = () => {
          if (closed) return;
          closed = true;
          stop();
          controller.close();
        };
        const deliver = (event: RuntimeEvent) => {
          if (closed || delivered.has(event.id)) return;
          delivered.add(event.id);
          write(formatSseEvent(event));
          if (isTerminalJobEvent(event)) close();
        };
        unsubscribe = runtime.events.subscribe(
          (event) => {
            if (replaying) pending.push(event);
            else deliver(event);
          },
          { jobId },
        );
        const replay = runtime.events.recent({ jobId, afterId });
        for (const event of replay) deliver(event);
        replaying = false;
        for (const event of pending) deliver(event);
        if (closed) return;
        if (isTerminalJobStatus(job.status)) return close();
        heartbeat = setInterval(() => write(": heartbeat\n\n"), 15_000);
      },
      cancel() {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
      },
    });
    return new Response(body, {
      headers: {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
      },
    });
  },
);

const startArticleGeneration = factory.createHandlers(
  zValidator("json", generateArticleSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const input = c.req.valid("json") as GenerateArticleInput;
    const plan = await runtime.workspace.get(WorkspaceKind.ContentPlan, input.planId);
    if (!plan || !plan.enabled) throw new HttpError("内容方案不存在或已停用", 400);
    const run = await runtime.runs.createRun({
      kind: RunKind.Content,
      trigger: { kind: RunTriggerKind.Debug },
      planId: plan.id,
      planRevision: plan.revision,
      planName: plan.name,
      requestedTopic: input.requestedTopic,
    });
    await runtime.runs.createMainSession(run.id);
    await createPublicationSessions(runtime, run.id, plan.publishing.destinations);
    const job = await runtime.automations.createRunJob(
      {
        contentPlanId: plan.id,
        requestedTopic: input.requestedTopic,
        metadata: input.metadata,
      },
      {
        runId: run.id,
      },
    );
    runtime.background.start(`content-plan:${job.id}`, () => runtime.automations.resume(job.id));
    return c.json({ job, run: (await runtime.runs.getDetail(run.id))!.run }, 202);
  },
);

const resumeArticle = factory.createHandlers(
  zValidator("param", jobIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const { jobId } = c.req.valid("param");
    const job = await runtime.jobs.get(jobId);
    if (!job) throw new HttpError("任务不存在", 404);

    if (job.type === JobType.GenerateArticle) {
      const claim = await runtime.articles.claimGenerateJob(jobId);
      if (claim.kind === JobClaimKind.Claimed) {
        runtime.background.start(`article:${claim.record.id}`, () =>
          runtime.articles.executeClaimedGenerate(claim.record),
        );
      }
      return c.json({ job: claim.record }, 202);
    }

    if (job.type === JobType.RunAutomation) {
      const claim = await runtime.automations.claimRunJob(jobId);
      if (claim.kind === JobClaimKind.Claimed) {
        runtime.background.start(`content-plan:${claim.record.id}`, () =>
          runtime.automations.executeClaimedRun(claim.record),
        );
      }
      return c.json({ job: claim.record }, 202);
    }

    throw new HttpError(`任务类型 ${job.type} 不能通过文章接口继续执行`, 400);
  },
);

const startPublication = factory.createHandlers(
  zValidator("json", publishContentSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const input = c.req.valid("json") as PublishContentInput;
    const storedPackage = await runtime.workspace.get(
      WorkspaceKind.ContentPackage,
      input.packageId,
    );
    if (!storedPackage) throw new HttpError("内容包不存在", 404);
    const originJob = await runtime.jobs.get(storedPackage.jobId);
    const plan = await runtime.workspace.get(WorkspaceKind.ContentPlan, storedPackage.planId);
    const run = await runtime.runs.createRun({
      kind: RunKind.Publication,
      trigger: { kind: RunTriggerKind.Manual },
      packageId: input.packageId,
      originRunId: originJob?.runId,
      planId: plan?.id,
      planRevision: plan?.revision,
      planName: plan?.name,
    });
    const publicationSessions = await createPublicationSessions(
      runtime,
      run.id,
      input.destinations,
    );
    const job = await runtime.publishing.createPublishJob(input, { runId: run.id });
    await Promise.all(
      publicationSessions.map((session) => runtime.runs.attachJob(run.id, session.id, job.id)),
    );
    runtime.background.start(`publication:${job.id}`, () => runtime.publishing.resume(job.id));
    return c.json({ job, run: (await runtime.runs.getDetail(run.id))!.run }, 202);
  },
);

const resumePublication = factory.createHandlers(
  zValidator("param", jobIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const claim = await runtime.publishing.claimPublishJob(c.req.valid("param").jobId);
    if (claim.kind === JobClaimKind.Claimed) {
      runtime.background.start(`publication:${claim.record.id}`, () =>
        runtime.publishing.executeClaimedPublish(claim.record),
      );
    }
    return c.json({ job: claim.record }, 202);
  },
);

const startAutomationRun = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  zValidator("json", runAutomationSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const automationId = c.req.valid("param").id;
    const automation = await runtime.workspace.get(WorkspaceKind.Automation, automationId);
    if (!automation) throw new HttpError("自动化任务不存在", 404);
    const plan = await runtime.workspace.get(WorkspaceKind.ContentPlan, automation.contentPlanId);
    if (!plan) throw new HttpError("自动化任务绑定的内容方案不存在", 400);
    const input = {
      automationId: c.req.valid("param").id,
      ...c.req.valid("json"),
    } as RunAutomationInput;
    const run = await runtime.runs.createRun({
      kind: RunKind.Content,
      trigger: { kind: RunTriggerKind.Automation, automationId },
      planId: plan.id,
      planRevision: plan.revision,
      planName: plan.name,
      requestedTopic: input.requestedTopic,
    });
    await runtime.runs.createMainSession(run.id);
    await createPublicationSessions(runtime, run.id, plan.publishing.destinations);
    const job = await runtime.automations.createRunJob(input, { runId: run.id });
    runtime.background.start(`automation:${job.id}`, () => runtime.automations.resume(job.id));
    return c.json({ job, run: (await runtime.runs.getDetail(run.id))!.run }, 202);
  },
);

const resumeAutomationRun = factory.createHandlers(
  zValidator("param", jobIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const claim = await runtime.automations.claimRunJob(c.req.valid("param").jobId);
    if (claim.kind === JobClaimKind.Claimed) {
      runtime.background.start(`automation:${claim.record.id}`, () =>
        runtime.automations.executeClaimedRun(claim.record),
      );
    }
    return c.json({ job: claim.record }, 202);
  },
);

export const executionRoutes = new Hono<{ Variables: AppVariables }>()
  .get("/api/jobs", ...listJobs)
  .get("/api/jobs/:jobId", ...getJob)
  .get("/api/jobs/:jobId/events", ...streamJobEvents)
  .post("/api/articles", ...startArticleGeneration)
  .post("/api/articles/:jobId/resume", ...resumeArticle)
  .post("/api/publications", ...startPublication)
  .post("/api/publications/:jobId/resume", ...resumePublication)
  .post("/api/automations/:id/run", ...startAutomationRun)
  .post("/api/automation-runs/:jobId/resume", ...resumeAutomationRun);

function formatSseEvent(event: RuntimeEvent): string {
  return `id: ${event.id}\nevent: runtime\ndata: ${JSON.stringify(event)}\n\n`;
}

function isTerminalJobEvent(event: RuntimeEvent): boolean {
  if (event.type !== "job.status.changed" || !event.data || typeof event.data !== "object") {
    return false;
  }
  const data = event.data as { sourceJobId?: unknown; status?: unknown };
  if (typeof data.sourceJobId === "string" && data.sourceJobId) return false;
  return isTerminalJobStatus(data.status);
}

function isTerminalJobStatus(status: unknown): boolean {
  return (
    status === JobStatus.Succeeded ||
    status === JobStatus.Degraded ||
    status === JobStatus.Failed ||
    status === JobStatus.NeedsAttention
  );
}

async function createPublicationSessions(
  runtime: Awaited<ReturnType<AppVariables["deps"]["getRuntime"]>>,
  runId: string,
  destinations: PublishContentInput["destinations"],
) {
  return await Promise.all(
    destinations.map(async (selection) => {
      const account = await runtime.workspace.get(
        WorkspaceKind.ChannelAccount,
        selection.accountId,
      );
      const channel = account?.channel ?? "unknown";
      const checksum = await fingerprint({
        accountId: selection.accountId,
        channel,
        publicationType: selection.publicationType,
        options: selection.options ?? {},
      });
      return await runtime.runs.ensurePublicationSession(runId, {
        destinationId: `destination_${checksum.slice(0, 24)}`,
        accountId: selection.accountId,
        accountName: account?.name ?? "发布账号",
        channel,
        publicationType: selection.publicationType,
        options: selection.options,
      });
    }),
  );
}
