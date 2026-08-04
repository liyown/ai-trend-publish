import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import {
  WorkspaceKind,
  JobType,
  RunStatus,
  type ChannelPublicationPreview,
  type ContentAsset,
  type ModelStreamEvent,
  type PreparedPublicationInput,
  type RunActivity,
  type RunSession,
} from "@trendpublish/contracts";
import type { JobRecord, RuntimeEvent } from "@trendpublish/runtime";
import type { PublishContentInput } from "@trendpublish/core/application";
import { type AppVariables, factory } from "../deps.ts";
import { HttpError, jsonValidator } from "../middleware/errors.ts";
import { paginate, parsePage } from "./workspace-route-helpers.ts";

const runParam = z.object({ runId: z.string().min(1) });
const sessionParam = z.object({ runId: z.string().min(1), sessionId: z.string().min(1) });
const destinationParam = z.object({ runId: z.string().min(1), destinationId: z.string().min(1) });

const listRuns = factory.createHandlers(async (c) => {
  const { page, pageSize } = parsePage(c.req.queries());
  const runtime = await c.var.deps.getRuntime();
  const all = await runtime.runs.store.listRuns(
    {
      planId: c.req.query("planId") || undefined,
      kind: runKind(c.req.query("kind")),
      status: runStatus(c.req.query("status")),
    },
    50_000,
  );
  return c.json(paginate(all, page, pageSize));
});

const getRun = factory.createHandlers(zValidator("param", runParam, jsonValidator), async (c) => {
  const detail = await (await c.var.deps.getRuntime()).runs.getDetail(c.req.valid("param").runId);
  if (!detail) throw new HttpError("运行不存在", 404);
  return c.json(detail);
});

const listActivities = factory.createHandlers(
  zValidator("param", runParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const runId = c.req.valid("param").runId;
    if (!(await runtime.runs.store.getRun(runId))) throw new HttpError("运行不存在", 404);
    const afterSequence = nonNegativeInteger(c.req.query("afterSequence"));
    const activities = await runtime.runs.store.listActivities(
      runId,
      c.req.query("sessionId") || undefined,
      afterSequence,
    );
    return c.json({ activities, afterSequence });
  },
);

const getSessionPreview = factory.createHandlers(
  zValidator("param", sessionParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const { runId, sessionId } = c.req.valid("param");
    const detail = await runtime.runs.getDetail(runId);
    if (!detail) throw new HttpError("运行不存在", 404);
    const session = detail.sessions.find((item) => item.id === sessionId);
    if (!session || session.kind !== "publication" || !session.destination) {
      throw new HttpError("发布会话不存在", 404);
    }
    const prepared = await resolvePreparedPublication(runtime, session);
    if (!prepared) throw new HttpError("渠道内容尚未准备完成", 409);
    return c.json(toChannelPublicationPreview(session, prepared));
  },
);

const streamRunActivities = factory.createHandlers(
  zValidator("param", runParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const runId = c.req.valid("param").runId;
    if (!(await runtime.runs.store.getRun(runId))) throw new HttpError("运行不存在", 404);
    const headerSequence = nonNegativeInteger(c.req.header("Last-Event-ID"));
    const querySequence = nonNegativeInteger(c.req.query("afterSequence"));
    const afterSequence = Math.max(headerSequence, querySequence);
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    const body = new ReadableStream<Uint8Array>({
      async start(controller) {
        let closed = false;
        let replaying = true;
        const pending: RunActivity[] = [];
        const delivered = new Set<number>();
        const write = (value: string) => {
          if (!closed) controller.enqueue(encoder.encode(value));
        };
        const deliver = (activity: RunActivity) => {
          if (closed || delivered.has(activity.sequence) || activity.sequence <= afterSequence)
            return;
          delivered.add(activity.sequence);
          write(formatSse(activity.sequence, "activity", activity));
        };
        unsubscribe = runtime.events.subscribe(
          (event) => {
            if (event.type !== "run.activity" || !isRunActivity(event.data)) return;
            if (replaying) pending.push(event.data);
            else deliver(event.data);
          },
          { runId },
        );
        for (const activity of await runtime.runs.store.listActivities(
          runId,
          undefined,
          afterSequence,
        )) {
          deliver(activity);
        }
        replaying = false;
        for (const activity of pending) deliver(activity);
        heartbeat = setInterval(() => write(": heartbeat\n\n"), 15_000);
      },
      cancel() {
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
      },
    });
    return eventStreamResponse(body);
  },
);

const streamModelOutput = factory.createHandlers(
  zValidator("param", runParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const runId = c.req.valid("param").runId;
    const detail = await runtime.runs.getDetail(runId);
    if (!detail) throw new HttpError("运行不存在", 404);
    const jobs = (await runtime.jobs.list(undefined, 50_000)).filter((job) => job.runId === runId);
    const jobsById = new Map(jobs.map((job) => [job.id, job]));
    const encoder = new TextEncoder();
    let unsubscribe = () => {};
    let heartbeat: ReturnType<typeof setInterval> | undefined;
    let sequence = 0;
    let closed = false;
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const write = (value: string) => {
          if (!closed) controller.enqueue(encoder.encode(value));
        };
        unsubscribe = runtime.events.subscribe((event) => {
          if (!event.jobId || !isModelRuntimeEvent(event)) return;
          void (async () => {
            const cached = jobsById.get(event.jobId!);
            const job = cached ?? (await runtime.jobs.get(event.jobId!));
            if (!job || job.runId !== runId || closed) return;
            jobsById.set(job.id, job);
            const sessionId = sessionIdForEvent(runId, job, event);
            const modelEvent: ModelStreamEvent = {
              id: `model-${++sequence}`,
              runId,
              sessionId,
              jobId: job.id,
              ...(event.taskId ? { taskId: event.taskId } : {}),
              type: modelEventType(event.type),
              occurredAt: event.occurredAt,
              data: jsonValue(event.data),
            };
            write(formatSse(modelEvent.id, "model", modelEvent));
          })();
        });
        write(": stream-open replayable=false\n\n");
        heartbeat = setInterval(() => write(": heartbeat\n\n"), 15_000);
      },
      cancel() {
        closed = true;
        unsubscribe();
        if (heartbeat) clearInterval(heartbeat);
      },
    });
    return eventStreamResponse(body);
  },
);

const resumeRun = factory.createHandlers(
  zValidator("param", runParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const runId = c.req.valid("param").runId;
    if (!(await runtime.runs.store.getRun(runId))) throw new HttpError("运行不存在", 404);
    const jobs = (await runtime.jobs.list(undefined, 50_000)).filter((job) => job.runId === runId);
    const candidates = jobs
      .filter((item) => item.status === "failed" || item.status === "needs_attention")
      .sort(
        (left, right) => Number(Boolean(right.parentJobId)) - Number(Boolean(left.parentJobId)),
      );
    runtime.background.start(`run-recovery:${runId}`, async () => {
      for (const job of candidates) {
        // An unknown publication outcome must remain checkpoint-blocked until it is reconciled.
        if (job.type === JobType.PublishContent && job.status === "needs_attention") continue;
        await resumeJobNow(runtime, job);
      }
    });
    return c.json((await runtime.runs.getDetail(runId))!, 202);
  },
);

const retryDestination = factory.createHandlers(
  zValidator("param", destinationParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const { runId, destinationId } = c.req.valid("param");
    const detail = await runtime.runs.getDetail(runId);
    if (!detail) throw new HttpError("运行不存在", 404);
    const session = detail.sessions.find(
      (item) => item.destination?.destinationId === destinationId,
    );
    if (!session) throw new HttpError("发布目的地运行不存在", 404);
    if (session.status === RunStatus.NeedsAttention) {
      throw new HttpError("该目的地存在未确认外部副作用，不能自动重试", 409);
    }
    const sourceJobs = await Promise.all(session.jobIds.map((id) => runtime.jobs.get(id)));
    const source = sourceJobs.find((job) => job?.type === JobType.PublishContent) as
      | JobRecord<PublishContentInput>
      | undefined;
    const selection = source?.input.destinations.find(
      (item) =>
        item.accountId === session.destination?.accountId &&
        item.publicationType === session.destination?.publicationType,
    );
    if (!source || !selection || !detail.run.packageId) {
      throw new HttpError("无法恢复该发布目的地的输入", 409);
    }
    await runtime.runs.store.updateSession({
      ...session,
      status: RunStatus.Queued,
      attempt: session.attempt + 1,
      error: undefined,
      finishedAt: undefined,
      updatedAt: new Date().toISOString(),
    });
    const job = await runtime.publishing.createPublishJob(
      { packageId: detail.run.packageId, destinations: [selection] },
      { runId, sessionId: session.id, parentJobId: source.id },
    );
    runtime.background.start(`publication:${job.id}`, () => runtime.publishing.resume(job.id));
    return c.json({ job, run: (await runtime.runs.getDetail(runId))!.run }, 202);
  },
);

export const runRoutes = new Hono<{ Variables: AppVariables }>()
  .get("/api/runs", ...listRuns)
  .get("/api/runs/:runId", ...getRun)
  .get("/api/runs/:runId/sessions/:sessionId/preview", ...getSessionPreview)
  .get("/api/runs/:runId/activities", ...listActivities)
  .get("/api/runs/:runId/events", ...streamRunActivities)
  .get("/api/runs/:runId/model-stream", ...streamModelOutput)
  .post("/api/runs/:runId/resume", ...resumeRun)
  .post("/api/runs/:runId/destinations/:destinationId/retry", ...retryDestination);

async function resumeJobNow(
  runtime: Awaited<ReturnType<AppVariables["deps"]["getRuntime"]>>,
  job: JobRecord,
): Promise<void> {
  if (job.type === JobType.GenerateArticle) {
    await runtime.articles.resume(job.id);
  } else if (job.type === JobType.PublishContent) {
    await runtime.publishing.resume(job.id);
  } else if (job.type === JobType.RunAutomation) {
    await runtime.automations.resume(job.id);
  }
}

function isModelRuntimeEvent(event: RuntimeEvent): boolean {
  return [
    "agent.response.started",
    "agent.response.delta",
    "agent.tool_call.delta",
    "agent.response.completed",
  ].includes(event.type);
}

function modelEventType(type: string): ModelStreamEvent["type"] {
  if (type === "agent.response.started") return "response.started";
  if (type === "agent.response.delta") return "response.delta";
  if (type === "agent.tool_call.delta") return "response.tool_delta";
  return "response.completed";
}

function sessionIdForEvent(runId: string, job: JobRecord, event: RuntimeEvent): string {
  const destinationId = /(?:^|\/)destination:([^/]+)/.exec(event.taskId ?? "")?.[1];
  return destinationId
    ? `${runId}:destination:${destinationId}`
    : (job.sessionId ?? `${runId}:main`);
}

function eventStreamResponse(body: ReadableStream<Uint8Array>): Response {
  return new Response(body, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  });
}

function formatSse(id: string | number, event: string, data: unknown): string {
  return `id: ${id}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

function nonNegativeInteger(value: string | undefined): number {
  const parsed = Number(value ?? 0);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : 0;
}

function runKind(value: string | undefined): "content" | "publication" | undefined {
  return value === "content" || value === "publication" ? value : undefined;
}

function runStatus(value: string | undefined): RunStatus | undefined {
  return Object.values(RunStatus).includes(value as RunStatus) ? (value as RunStatus) : undefined;
}

function isRunActivity(value: unknown): value is RunActivity {
  return Boolean(value) && typeof value === "object" && "sequence" in value! && "runId" in value!;
}

function jsonValue(value: unknown): ModelStreamEvent["data"] {
  return value === undefined ? null : (structuredClone(value) as ModelStreamEvent["data"]);
}

async function resolvePreparedPublication(
  runtime: Awaited<ReturnType<AppVariables["deps"]["getRuntime"]>>,
  session: RunSession,
): Promise<PreparedPublicationInput | null> {
  const destinationId = session.destination?.destinationId;
  if (!destinationId) return null;
  const jobIds = [...session.jobIds].reverse();
  const publications = await runtime.workspace.list(WorkspaceKind.Publication);
  for (const jobId of jobIds) {
    const prepared = publications
      .find((publication) => publication.jobId === jobId)
      ?.batch.destinations.find((item) => item.destinationId === destinationId)?.prepared;
    if (prepared) return prepared;
  }
  for (const jobId of jobIds) {
    const task = await runtime.tasks.get(jobId, `destination:${destinationId}/prepare`);
    if (
      (task?.status === "succeeded" || task?.status === "degraded") &&
      isPreparedPublicationInput(task.output)
    ) {
      return task.output;
    }
  }
  return null;
}

function toChannelPublicationPreview(
  session: RunSession,
  prepared: PreparedPublicationInput,
): ChannelPublicationPreview {
  const destination = session.destination!;
  const coverAssetId =
    typeof prepared.metadata?.coverAssetId === "string"
      ? prepared.metadata.coverAssetId
      : undefined;
  const coverAsset = coverAssetId
    ? prepared.assets.find((asset) => asset.id === coverAssetId)
    : undefined;
  const coverSource = coverAsset ? safePreviewImageSource(coverAsset.source.uri) : undefined;
  return {
    destinationId: destination.destinationId,
    channel: destination.channel,
    publicationType: destination.publicationType,
    title: prepared.title,
    digest: prepared.digest,
    body: {
      format: prepared.body.format,
      content: resolvePreviewAssetUris(prepared.body.content, prepared.assets),
    },
    ...(coverAsset && coverSource
      ? {
          cover: {
            assetId: coverAsset.id,
            source: coverSource,
            ...(coverAsset.mimeType ? { mimeType: coverAsset.mimeType } : {}),
            ...(coverAsset.alt ? { alt: coverAsset.alt } : {}),
            ...(coverAsset.width !== undefined ? { width: coverAsset.width } : {}),
            ...(coverAsset.height !== undefined ? { height: coverAsset.height } : {}),
          },
        }
      : {}),
  };
}

function resolvePreviewAssetUris(content: string, assets: ContentAsset[]): string {
  let resolved = content;
  for (const asset of assets) {
    const source = safePreviewImageSource(asset.source.uri);
    if (!source) continue;
    resolved = resolved
      .split(`asset://${encodeURIComponent(asset.id)}`)
      .join(escapeHtmlAttribute(source));
  }
  return resolved;
}

function safePreviewImageSource(value: string): string | undefined {
  const source = value.trim();
  return /^(https?:|data:image\/[a-z0-9.+-]+;base64,)/i.test(source) ? source : undefined;
}

function escapeHtmlAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;");
}

function isPreparedPublicationInput(value: unknown): value is PreparedPublicationInput {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<PreparedPublicationInput>;
  return (
    typeof candidate.title === "string" &&
    typeof candidate.digest === "string" &&
    Boolean(candidate.body) &&
    typeof candidate.body?.format === "string" &&
    typeof candidate.body.content === "string" &&
    Array.isArray(candidate.assets) &&
    candidate.assets.every(isContentAsset)
  );
}

function isContentAsset(value: unknown): value is ContentAsset {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ContentAsset>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.mediaType === "string" &&
    Boolean(candidate.source) &&
    typeof candidate.source?.uri === "string" &&
    typeof candidate.checksum === "string"
  );
}
