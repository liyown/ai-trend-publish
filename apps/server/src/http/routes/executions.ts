import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { JobType, type ArticleSource, type AssetRequest } from "@trendpublish/contracts";
import { JobClaimKind, JobStatus, type RuntimeEvent } from "@trendpublish/runtime";
import type {
  CompleteArticleInput,
  GenerateArticleInput,
  PublishContentInput,
  RunAutomationInput,
} from "@trendpublish/core/application";
import { factory, type AppVariables } from "../deps.ts";
import { HttpError, jsonValidator } from "../middleware/errors.ts";
import {
  completeArticleSchema,
  generateArticleSchema,
  jobIdParam,
  objectIdParam,
  publishContentSchema,
  runAutomationSchema,
} from "../schemas/studio.ts";

const listJobs = factory.createHandlers(async (c) => {
  const jobs = await (await c.var.deps.getRuntime()).jobs.list(undefined, 200);
  return c.json({ jobs });
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
    const job = await runtime.articles.createGenerateJob(
      c.req.valid("json") as GenerateArticleInput,
    );
    runtime.background.start(`article:${job.id}`, () => runtime.articles.resume(job.id));
    return c.json({ job }, 202);
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

    if (job.type === JobType.CompleteArticle) {
      const claim = await runtime.articles.claimCompletionJob(jobId);
      if (claim.kind === JobClaimKind.Claimed) {
        runtime.background.start(`article-completion:${claim.record.id}`, () =>
          runtime.articles.executeClaimedCompletion(claim.record),
        );
      }
      return c.json({ job: claim.record }, 202);
    }

    throw new HttpError(`任务类型 ${job.type} 不能通过文章接口继续执行`, 400);
  },
);

const startArticleCompletion = factory.createHandlers(
  zValidator("json", completeArticleSchema, jsonValidator),
  async (c) => {
    const body = c.req.valid("json");
    const input: CompleteArticleInput = {
      planId: body.planId,
      source: body.source as ArticleSource,
      assetRequests: body.assetRequests as AssetRequest[],
      reviewRequestId: body.reviewRequestId,
    };
    const runtime = await c.var.deps.getRuntime();
    const job = await runtime.articles.createCompletionJob(input);
    runtime.background.start(`article-completion:${job.id}`, () =>
      runtime.articles.resumeCompletion(job.id),
    );
    return c.json({ job }, 202);
  },
);

const startPublication = factory.createHandlers(
  zValidator("json", publishContentSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const job = await runtime.publishing.createPublishJob(
      c.req.valid("json") as PublishContentInput,
    );
    runtime.background.start(`publication:${job.id}`, () => runtime.publishing.resume(job.id));
    return c.json({ job }, 202);
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
    const job = await runtime.automations.createRunJob({
      automationId: c.req.valid("param").id,
      ...c.req.valid("json"),
    } as RunAutomationInput);
    runtime.background.start(`automation:${job.id}`, () => runtime.automations.resume(job.id));
    return c.json({ job }, 202);
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
  .post("/api/articles/complete", ...startArticleCompletion)
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
