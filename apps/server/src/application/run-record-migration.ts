import {
  JobType,
  RunKind,
  RunStatus,
  RunTriggerKind,
  WorkspaceKind,
  type JsonObject,
  type PublicationDestinationSelection,
  type RunRecord,
} from "@trendpublish/contracts";
import type { ApplicationRuntime } from "./runtime.ts";
import { fingerprint, type JobRecord } from "@trendpublish/runtime";

type RunMigrationRuntime = Pick<ApplicationRuntime, "workspace" | "jobs" | "tasks" | "runs">;
const RUN_SCHEMA_KEY = "react-run-records";
const RUN_SCHEMA_VERSION = "1";

/** Idempotently projects legacy Job/Task history into the user-facing run model. */
export async function migrateRunRecords(runtime: RunMigrationRuntime): Promise<void> {
  if ((await runtime.runs.store.getSchemaVersion?.(RUN_SCHEMA_KEY)) === RUN_SCHEMA_VERSION) return;
  const jobs = await runtime.jobs.list(undefined, 50_000);
  const claimedChildren = new Set<string>();

  for (const automation of jobs.filter((job) => job.type === JobType.RunAutomation)) {
    const childIds = automationChildIds(automation.checkpoint);
    childIds.forEach((id) => claimedChildren.add(id));
    const run = await ensureLegacyRun(runtime, automation, RunKind.Content, {
      kind: RunTriggerKind.Automation,
      automationId: stringField(automation.input, "automationId"),
    });
    const main = await runtime.runs.createMainSession(run.id);
    await attachLegacyJob(runtime, automation, run.id);
    for (const childId of childIds) {
      const child = jobs.find((job) => job.id === childId);
      if (!child) continue;
      await attachLegacyJob(
        runtime,
        child,
        run.id,
        child.type === JobType.GenerateArticle ? main.id : undefined,
        automation.id,
      );
    }
  }

  for (const job of jobs) {
    if (job.runId || job.type === JobType.RunAutomation || claimedChildren.has(job.id)) continue;
    const kind = job.type === JobType.PublishContent ? RunKind.Publication : RunKind.Content;
    const packageId = stringField(job.input, "packageId");
    const planId = stringField(job.input, "planId");
    const storedPackage = packageId
      ? await runtime.workspace.get(WorkspaceKind.ContentPackage, packageId)
      : undefined;
    const originJob = storedPackage ? await runtime.jobs.get(storedPackage.jobId) : undefined;
    const run = await ensureLegacyRun(
      runtime,
      job,
      kind,
      { kind: RunTriggerKind.Migration },
      {
        planId: planId ?? storedPackage?.planId,
        packageId,
        originRunId: originJob?.runId,
      },
    );
    const session =
      kind === RunKind.Content ? await runtime.runs.createMainSession(run.id) : undefined;
    await attachLegacyJob(runtime, job, run.id, session?.id);
  }
  await runtime.runs.store.setSchemaVersion?.(
    RUN_SCHEMA_KEY,
    RUN_SCHEMA_VERSION,
    new Date().toISOString(),
  );
}

async function ensureLegacyRun(
  runtime: RunMigrationRuntime,
  job: JobRecord,
  kind: RunRecord["kind"],
  trigger: RunRecord["trigger"],
  extra: Pick<RunRecord, "planId" | "packageId" | "originRunId"> = {},
): Promise<RunRecord> {
  const id = `run-legacy-${job.id}`;
  const existing = await runtime.runs.store.getRun(id);
  if (existing) return existing;
  const planId = extra.planId ?? stringField(job.input, "planId");
  const plan = planId ? await runtime.workspace.get(WorkspaceKind.ContentPlan, planId) : undefined;
  const run: RunRecord = {
    id,
    kind,
    status: RunStatus.Queued,
    trigger,
    ...(planId ? { planId } : {}),
    ...(plan ? { planRevision: plan.revision, planName: plan.name } : {}),
    ...(extra.packageId ? { packageId: extra.packageId } : {}),
    ...(extra.originRunId ? { originRunId: extra.originRunId } : {}),
    ...(stringField(job.input, "requestedTopic")
      ? { requestedTopic: stringField(job.input, "requestedTopic") }
      : {}),
    subsequentRunIds: [],
    publicationSummary: {
      total: 0,
      queued: 0,
      running: 0,
      succeeded: 0,
      failed: 0,
      needsAttention: 0,
    },
    createdAt: job.createdAt,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    updatedAt: job.updatedAt,
  };
  return await runtime.runs.store.createRun(run);
}

async function attachLegacyJob(
  runtime: RunMigrationRuntime,
  job: JobRecord,
  runId: string,
  sessionId?: string,
  parentJobId?: string,
): Promise<void> {
  const publicationSessions =
    job.type === JobType.PublishContent
      ? await ensureLegacyPublicationSessions(runtime, runId, job.input)
      : [];
  const updated = await runtime.jobs.update({
    ...job,
    runId,
    ...(sessionId ? { sessionId } : {}),
    ...(parentJobId ? { parentJobId } : {}),
  });
  await Promise.all(
    publicationSessions.map((session) => runtime.runs.attachJob(runId, session.id, updated.id)),
  );
  for (const task of await runtime.tasks.list(job.id)) {
    await runtime.runs.onTaskActivity({
      jobId: updated.id,
      taskId: task.taskId,
      attempt: task.attempt,
      effect: task.effect,
      output: task.output,
      error: task.error,
      status:
        task.status === "unknown"
          ? "needs_attention"
          : task.status === "failed"
            ? "failed"
            : task.status === "running"
              ? "running"
              : "succeeded",
      occurredAt: task.updatedAt,
      historical: true,
    });
  }
  await runtime.runs.onJobChanged(updated);
}

async function ensureLegacyPublicationSessions(
  runtime: RunMigrationRuntime,
  runId: string,
  input: unknown,
) {
  const destinations = publicationDestinations(input);
  return await Promise.all(
    destinations.map(async (destination) => {
      const account = await runtime.workspace.get(
        WorkspaceKind.ChannelAccount,
        destination.accountId,
      );
      const channel = account?.channel ?? "unknown";
      const checksum = await fingerprint({
        accountId: destination.accountId,
        channel,
        publicationType: destination.publicationType,
        options: destination.options ?? {},
      });
      return await runtime.runs.ensurePublicationSession(runId, {
        destinationId: `destination_${checksum.slice(0, 24)}`,
        accountId: destination.accountId,
        accountName: account?.name ?? "历史发布账号",
        channel,
        publicationType: destination.publicationType,
        options: destination.options,
      });
    }),
  );
}

function publicationDestinations(input: unknown): PublicationDestinationSelection[] {
  if (!input || typeof input !== "object" || Array.isArray(input)) return [];
  const values = (input as Record<string, unknown>)["destinations"];
  if (!Array.isArray(values)) return [];
  return values.flatMap((value) => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return [];
    const destination = value as Record<string, unknown>;
    const accountId = destination["accountId"];
    const publicationType = destination["publicationType"];
    if (typeof accountId !== "string" || typeof publicationType !== "string") return [];
    const options = destination["options"];
    return [
      {
        accountId,
        publicationType,
        ...(options && typeof options === "object" && !Array.isArray(options)
          ? { options: structuredClone(options as JsonObject) }
          : {}),
      },
    ];
  });
}

function automationChildIds(checkpoint: unknown): string[] {
  if (!checkpoint || typeof checkpoint !== "object" || Array.isArray(checkpoint)) return [];
  return [
    stringField(checkpoint, "articleJobId"),
    stringField(checkpoint, "publicationJobId"),
  ].filter((value): value is string => Boolean(value));
}

function stringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const field = (value as Record<string, unknown>)[key];
  return typeof field === "string" && field ? field : undefined;
}
