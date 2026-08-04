import type { RuntimeEventPublisher } from "./events.ts";
import type { JobRecord, JobStore } from "./job.ts";
import type { TaskEffect } from "./constants.ts";

type ValueOf<T> = T[keyof T];
type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

export const RunKind = { Content: "content", Publication: "publication" } as const;
export type RunKind = ValueOf<typeof RunKind>;

export const RunStatus = {
  Queued: "queued",
  Running: "running",
  Succeeded: "succeeded",
  Partial: "partial",
  Failed: "failed",
  NeedsAttention: "needs_attention",
} as const;
export type RunStatus = ValueOf<typeof RunStatus>;

export const RunTriggerKind = {
  Manual: "manual",
  Debug: "debug",
  Automation: "automation",
  Migration: "migration",
} as const;
export type RunTriggerKind = ValueOf<typeof RunTriggerKind>;

export const RunSessionKind = { Main: "main", Publication: "publication" } as const;
export type RunSessionKind = ValueOf<typeof RunSessionKind>;

export interface RunTrigger {
  kind: RunTriggerKind;
  automationId?: string;
}

export interface RunRecord {
  id: string;
  kind: RunKind;
  status: RunStatus;
  trigger: RunTrigger;
  planId?: string;
  planRevision?: number;
  planName?: string;
  requestedTopic?: string;
  title?: string;
  packageId?: string;
  originRunId?: string;
  subsequentRunIds: string[];
  publicationSummary: {
    total: number;
    queued: number;
    running: number;
    succeeded: number;
    failed: number;
    needsAttention: number;
  };
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

export interface RunSession {
  id: string;
  runId: string;
  kind: RunSessionKind;
  status: RunStatus;
  destination?: {
    destinationId: string;
    accountId: string;
    accountName: string;
    channel: string;
    publicationType: string;
    options?: { [key: string]: JsonValue };
  };
  jobIds: string[];
  attempt: number;
  currentActivity?: string;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

export const RunActivityKind = {
  Session: "session",
  ModelTurn: "model_turn",
  ToolCall: "tool_call",
  Submission: "submission",
  Prepare: "prepare",
  Validate: "validate",
  Upload: "upload",
  Publish: "publish",
  Receipt: "receipt",
  HistoricalTask: "historical_task",
} as const;
export type RunActivityKind = ValueOf<typeof RunActivityKind>;

export const RunActivityStatus = {
  Running: "running",
  Succeeded: "succeeded",
  Failed: "failed",
  NeedsAttention: "needs_attention",
} as const;
export type RunActivityStatus = ValueOf<typeof RunActivityStatus>;

export interface RunActivity {
  id: string;
  runId: string;
  sessionId: string;
  sequence: number;
  kind: RunActivityKind;
  status: RunActivityStatus;
  label: string;
  summary?: string;
  taskId?: string;
  attempt?: number;
  input?: JsonValue;
  output?: JsonValue;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
}

export interface RunDetail {
  run: RunRecord;
  sessions: RunSession[];
}

export interface RunListFilter {
  planId?: string;
  kind?: RunRecord["kind"];
  status?: RunRecord["status"];
}

export type NewRunActivity = Omit<RunActivity, "id" | "sequence">;

export interface RunStore {
  getSchemaVersion?(key: string): Promise<string | null>;
  setSchemaVersion?(key: string, version: string, completedAt: string): Promise<void>;
  createRun(run: RunRecord): Promise<RunRecord>;
  getRun(id: string): Promise<RunRecord | null>;
  listRuns(filter?: RunListFilter, limit?: number, offset?: number): Promise<RunRecord[]>;
  updateRun(run: RunRecord): Promise<RunRecord>;
  createSession(session: RunSession): Promise<RunSession>;
  getSession(id: string): Promise<RunSession | null>;
  listSessions(runId: string): Promise<RunSession[]>;
  updateSession(session: RunSession): Promise<RunSession>;
  appendActivity(activity: NewRunActivity): Promise<RunActivity>;
  listActivities(runId: string, sessionId?: string, afterSequence?: number): Promise<RunActivity[]>;
}

export interface RunTaskActivityInput {
  jobId: string;
  taskId: string;
  attempt: number;
  effect: TaskEffect;
  input?: unknown;
  output?: unknown;
  error?: string;
  status: "running" | "succeeded" | "failed" | "needs_attention";
  occurredAt: string;
  historical?: boolean;
}

export interface RunTaskActivityObserver {
  onTaskActivity(input: RunTaskActivityInput): Promise<void>;
}

const emptyPublicationSummary = () => ({
  total: 0,
  queued: 0,
  running: 0,
  succeeded: 0,
  failed: 0,
  needsAttention: 0,
});

export class RunManager implements RunTaskActivityObserver {
  constructor(
    readonly store: RunStore,
    private readonly jobs: JobStore,
    private readonly events: RuntimeEventPublisher,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createRun(input: {
    kind: RunRecord["kind"];
    trigger: RunTrigger;
    planId?: string;
    planRevision?: number;
    planName?: string;
    requestedTopic?: string;
    packageId?: string;
    originRunId?: string;
  }): Promise<RunRecord> {
    const timestamp = this.now().toISOString();
    const run: RunRecord = {
      id: `run-${crypto.randomUUID()}`,
      kind: input.kind,
      status: RunStatus.Queued,
      trigger: structuredClone(input.trigger),
      ...(input.planId ? { planId: input.planId } : {}),
      ...(input.planRevision !== undefined ? { planRevision: input.planRevision } : {}),
      ...(input.planName ? { planName: input.planName } : {}),
      ...(input.requestedTopic ? { requestedTopic: input.requestedTopic } : {}),
      ...(input.packageId ? { packageId: input.packageId } : {}),
      ...(input.originRunId ? { originRunId: input.originRunId } : {}),
      subsequentRunIds: [],
      publicationSummary: emptyPublicationSummary(),
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const created = await this.store.createRun(run);
    if (created.originRunId) await this.linkSubsequentRun(created.originRunId, created.id);
    return created;
  }

  async createMainSession(runId: string): Promise<RunSession> {
    return await this.ensureSession({
      id: `${runId}:main`,
      runId,
      kind: RunSessionKind.Main,
    });
  }

  async ensurePublicationSession(
    runId: string,
    destination: NonNullable<RunSession["destination"]>,
  ): Promise<RunSession> {
    return await this.ensureSession({
      id: `${runId}:destination:${destination.destinationId}`,
      runId,
      kind: RunSessionKind.Publication,
      destination,
    });
  }

  async attachJob(runId: string, sessionId: string | undefined, jobId: string): Promise<void> {
    if (!sessionId) return;
    const session = await this.store.getSession(sessionId);
    if (!session || session.runId !== runId) throw new Error(`运行会话不存在：${sessionId}`);
    if (session.jobIds.includes(jobId)) return;
    await this.store.updateSession({
      ...session,
      jobIds: [...session.jobIds, jobId],
      updatedAt: this.now().toISOString(),
    });
  }

  async getDetail(runId: string): Promise<RunDetail | null> {
    const run = await this.store.getRun(runId);
    return run ? { run, sessions: await this.store.listSessions(runId) } : null;
  }

  async onJobChanged(job: JobRecord): Promise<void> {
    if (!job.runId) return;
    if (job.sessionId) {
      await this.attachJob(job.runId, job.sessionId, job.id);
      const session = await this.store.getSession(job.sessionId);
      if (session) {
        const status = runStatusFromJob(job.status);
        const updatedSession = await this.store.updateSession({
          ...session,
          status,
          error: job.error,
          startedAt: job.startedAt ?? session.startedAt,
          finishedAt: job.finishedAt,
          updatedAt: job.updatedAt,
        });
        await this.closeInterruptedActivities(updatedSession);
      }
    }
    if (!job.sessionId && job.type === "content.publish" && isTerminalJobStatus(job.status)) {
      const sessions = await this.store.listSessions(job.runId);
      for (const session of sessions.filter(
        (item) =>
          item.kind === RunSessionKind.Publication &&
          (item.status === RunStatus.Queued || item.status === RunStatus.Running),
      )) {
        const updatedSession = await this.store.updateSession({
          ...session,
          status:
            job.status === "succeeded"
              ? RunStatus.Succeeded
              : job.status === "needs_attention"
                ? RunStatus.NeedsAttention
                : RunStatus.Failed,
          error: job.error,
          finishedAt: job.finishedAt ?? job.updatedAt,
          updatedAt: job.updatedAt,
        });
        await this.closeInterruptedActivities(updatedSession);
      }
    }
    await this.reconcileRun(job.runId, job);
  }

  /** Repairs activity lifecycle state left behind by a process interruption. */
  async reconcileInterruptedActivities(): Promise<void> {
    const runs = await this.store.listRuns({}, 10_000);
    for (const run of runs) {
      const sessions = await this.store.listSessions(run.id);
      for (const session of sessions) await this.closeInterruptedActivities(session);
    }
  }

  async onTaskActivity(input: RunTaskActivityInput): Promise<void> {
    const job = await this.jobs.get(input.jobId);
    if (!job?.runId) return;
    const session = await this.resolveTaskSession(job, input.taskId, input.input);
    if (!session) return;
    const presentation = input.historical
      ? {
          kind: RunActivityKind.HistoricalTask,
          label: humanize(input.taskId.split("/").at(-1) ?? input.taskId),
        }
      : taskPresentation(input.taskId);
    const status = activityStatus(input.status);
    const timestamp = input.occurredAt;
    const exposesPayload = presentation.kind !== RunActivityKind.ModelTurn;
    const existing = (await this.store.listActivities(job.runId, session.id)).find(
      (activity) => activity.taskId === input.taskId && activity.attempt === input.attempt,
    );
    const activityInput: NewRunActivity = {
      runId: job.runId,
      sessionId: session.id,
      kind: presentation.kind,
      status,
      label: presentation.label,
      summary: presentation.summary,
      taskId: input.taskId,
      attempt: input.attempt,
      ...(exposesPayload && input.status === "running" ? { input: safePreview(input.input) } : {}),
      ...(exposesPayload && input.status === "succeeded"
        ? { output: safePreview(input.output) }
        : {}),
      ...(input.error ? { error: safeText(input.error, 2_000) } : {}),
      startedAt: existing?.startedAt ?? timestamp,
      ...(input.status === "running" ? {} : { finishedAt: timestamp }),
      updatedAt: timestamp,
    };
    const activity = await this.store.appendActivity(activityInput);
    await this.updateSessionFromActivity(session, activity);
    this.events.publish({
      type: "run.activity",
      runId: job.runId,
      sessionId: session.id,
      jobId: job.id,
      taskId: input.taskId,
      data: activity,
    });
  }

  async completeContent(
    runId: string,
    input: { packageId: string; title?: string },
  ): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) return;
    await this.store.updateRun({
      ...run,
      packageId: input.packageId,
      title: input.title ?? run.title,
      updatedAt: this.now().toISOString(),
    });
  }

  private async ensureSession(input: {
    id: string;
    runId: string;
    kind: RunSession["kind"];
    destination?: RunSession["destination"];
  }): Promise<RunSession> {
    const existing = await this.store.getSession(input.id);
    if (existing) return existing;
    const timestamp = this.now().toISOString();
    return await this.store.createSession({
      id: input.id,
      runId: input.runId,
      kind: input.kind,
      status: RunStatus.Queued,
      ...(input.destination ? { destination: structuredClone(input.destination) } : {}),
      jobIds: [],
      attempt: 1,
      createdAt: timestamp,
      updatedAt: timestamp,
    });
  }

  private async resolveTaskSession(
    job: JobRecord,
    taskId: string,
    taskInput: unknown,
  ): Promise<RunSession | null> {
    const destinationId = /(?:^|\/)destination:([^/]+)/.exec(taskId)?.[1];
    if (destinationId) {
      const existing = await this.store.getSession(`${job.runId}:destination:${destinationId}`);
      if (existing) {
        await this.attachJob(job.runId!, existing.id, job.id);
        return (await this.store.getSession(existing.id)) ?? existing;
      }
      const snapshot = destinationSnapshot(taskInput, destinationId);
      const created = await this.ensurePublicationSession(job.runId!, snapshot);
      await this.attachJob(job.runId!, created.id, job.id);
      return (await this.store.getSession(created.id)) ?? created;
    }
    if (job.sessionId) return await this.store.getSession(job.sessionId);
    if (job.type === "content.publish") return null;
    if (job.runId) return await this.createMainSession(job.runId);
    return null;
  }

  private async updateSessionFromActivity(
    session: RunSession,
    activity: RunActivity,
  ): Promise<void> {
    const nextStatus =
      activity.kind === RunActivityKind.Receipt && activity.status === RunActivityStatus.Succeeded
        ? RunStatus.Succeeded
        : activity.status === RunActivityStatus.Running
          ? RunStatus.Running
          : activity.status === RunActivityStatus.Failed
            ? RunStatus.Failed
            : activity.status === RunActivityStatus.NeedsAttention
              ? RunStatus.NeedsAttention
              : session.status === RunStatus.Queued
                ? RunStatus.Running
                : session.status;
    await this.store.updateSession({
      ...session,
      status: nextStatus,
      currentActivity: activity.label,
      error: activity.error ?? session.error,
      startedAt: session.startedAt ?? activity.startedAt,
      updatedAt: activity.updatedAt,
    });
    await this.reconcileRun(session.runId);
  }

  private async closeInterruptedActivities(session: RunSession): Promise<void> {
    if (session.status !== RunStatus.Failed && session.status !== RunStatus.NeedsAttention) return;
    const activities = await this.store.listActivities(session.runId, session.id);
    for (const current of activities.filter(
      (activity) => activity.status === RunActivityStatus.Running,
    )) {
      const timestamp = session.finishedAt ?? session.updatedAt ?? this.now().toISOString();
      const activity = await this.store.appendActivity({
        runId: current.runId,
        sessionId: current.sessionId,
        kind: current.kind,
        status:
          session.status === RunStatus.NeedsAttention
            ? RunActivityStatus.NeedsAttention
            : RunActivityStatus.Failed,
        label: current.label,
        summary: current.summary,
        taskId: current.taskId,
        attempt: current.attempt,
        input: current.input,
        output: current.output,
        error:
          current.error ??
          (session.status === RunStatus.NeedsAttention
            ? "服务重启，本轮执行已中断"
            : session.error),
        startedAt: current.startedAt,
        finishedAt: timestamp,
        updatedAt: timestamp,
      });
      this.events.publish({
        type: "run.activity",
        runId: session.runId,
        sessionId: session.id,
        taskId: activity.taskId,
        data: activity,
      });
    }
  }

  private async reconcileRun(runId: string, latestJob?: JobRecord): Promise<void> {
    const run = await this.store.getRun(runId);
    if (!run) return;
    const sessions = await this.store.listSessions(runId);
    const main = sessions.find((session) => session.kind === RunSessionKind.Main);
    const publications = sessions.filter((session) => session.kind === RunSessionKind.Publication);
    const publicationSummary = {
      total: publications.length,
      queued: publications.filter((item) => item.status === RunStatus.Queued).length,
      running: publications.filter((item) => item.status === RunStatus.Running).length,
      succeeded: publications.filter((item) => item.status === RunStatus.Succeeded).length,
      failed: publications.filter((item) => item.status === RunStatus.Failed).length,
      needsAttention: publications.filter((item) => item.status === RunStatus.NeedsAttention)
        .length,
    };
    const status = aggregateRunStatus(run.kind, main, publications, latestJob);
    const terminal =
      status === RunStatus.Succeeded ||
      status === RunStatus.Partial ||
      status === RunStatus.Failed ||
      status === RunStatus.NeedsAttention;
    const timestamp = latestJob?.updatedAt ?? this.now().toISOString();
    const error =
      status === RunStatus.Failed ||
      status === RunStatus.Partial ||
      status === RunStatus.NeedsAttention
        ? (main?.error ?? latestJob?.error ?? run.error)
        : undefined;
    await this.store.updateRun({
      ...run,
      status,
      publicationSummary,
      error,
      startedAt: run.startedAt ?? (status === RunStatus.Queued ? undefined : timestamp),
      finishedAt: terminal ? (latestJob?.finishedAt ?? timestamp) : undefined,
      updatedAt: timestamp,
    });
  }

  private async linkSubsequentRun(originRunId: string, runId: string): Promise<void> {
    const origin = await this.store.getRun(originRunId);
    if (!origin || origin.subsequentRunIds.includes(runId)) return;
    await this.store.updateRun({
      ...origin,
      subsequentRunIds: [...origin.subsequentRunIds, runId],
      updatedAt: this.now().toISOString(),
    });
  }
}

export class MemoryRunStore implements RunStore {
  private readonly runs = new Map<string, RunRecord>();
  private readonly sessions = new Map<string, RunSession>();
  private readonly activities = new Map<string, RunActivity[]>();

  createRun(run: RunRecord): Promise<RunRecord> {
    if (this.runs.has(run.id)) throw new Error(`运行已存在：${run.id}`);
    this.runs.set(run.id, structuredClone(run));
    return Promise.resolve(structuredClone(run));
  }
  getRun(id: string): Promise<RunRecord | null> {
    const value = this.runs.get(id);
    return Promise.resolve(value ? structuredClone(value) : null);
  }
  listRuns(filter: RunListFilter = {}, limit = 100, offset = 0): Promise<RunRecord[]> {
    return Promise.resolve(
      [...this.runs.values()]
        .filter((run) => !filter.planId || run.planId === filter.planId)
        .filter((run) => !filter.kind || run.kind === filter.kind)
        .filter((run) => !filter.status || run.status === filter.status)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(offset, offset + limit)
        .map((run) => structuredClone(run)),
    );
  }
  updateRun(run: RunRecord): Promise<RunRecord> {
    if (!this.runs.has(run.id)) throw new Error(`运行不存在：${run.id}`);
    this.runs.set(run.id, structuredClone(run));
    return Promise.resolve(structuredClone(run));
  }
  createSession(session: RunSession): Promise<RunSession> {
    if (this.sessions.has(session.id)) throw new Error(`运行会话已存在：${session.id}`);
    this.sessions.set(session.id, structuredClone(session));
    return Promise.resolve(structuredClone(session));
  }
  getSession(id: string): Promise<RunSession | null> {
    const value = this.sessions.get(id);
    return Promise.resolve(value ? structuredClone(value) : null);
  }
  listSessions(runId: string): Promise<RunSession[]> {
    return Promise.resolve(
      [...this.sessions.values()]
        .filter((session) => session.runId === runId)
        .sort((left, right) => left.createdAt.localeCompare(right.createdAt))
        .map((session) => structuredClone(session)),
    );
  }
  updateSession(session: RunSession): Promise<RunSession> {
    if (!this.sessions.has(session.id)) throw new Error(`运行会话不存在：${session.id}`);
    this.sessions.set(session.id, structuredClone(session));
    return Promise.resolve(structuredClone(session));
  }
  appendActivity(input: NewRunActivity): Promise<RunActivity> {
    const current = this.activities.get(input.runId) ?? [];
    const existing = current.find(
      (item) =>
        item.sessionId === input.sessionId &&
        item.taskId === input.taskId &&
        item.attempt === input.attempt,
    );
    const sequence = Math.max(0, ...current.map((item) => item.sequence)) + 1;
    const activity: RunActivity = {
      ...structuredClone(input),
      id: existing?.id ?? `activity-${input.runId}-${sequence}`,
      sequence,
    };
    const next = existing
      ? current.map((item) => (item.id === existing.id ? activity : item))
      : [...current, activity];
    this.activities.set(input.runId, next);
    return Promise.resolve(structuredClone(activity));
  }
  listActivities(runId: string, sessionId?: string, afterSequence = 0): Promise<RunActivity[]> {
    return Promise.resolve(
      (this.activities.get(runId) ?? [])
        .filter((item) => !sessionId || item.sessionId === sessionId)
        .filter((item) => item.sequence > afterSequence)
        .map((item) => structuredClone(item)),
    );
  }
}

function taskPresentation(taskId: string): {
  kind: RunActivity["kind"];
  label: string;
  summary?: string;
} {
  if (/agent\/turn\/\d+$/.test(taskId))
    return { kind: RunActivityKind.ModelTurn, label: "模型生成" };
  const tool = /agent\/tool\/\d+\/\d+-([^/]+)$/.exec(taskId)?.[1];
  if (tool) return { kind: RunActivityKind.ToolCall, label: `调用工具 ${humanize(tool)}` };
  if (/agent\/submission\//.test(taskId))
    return { kind: RunActivityKind.Submission, label: "提交结构化内容" };
  if (/agent\/repair\//.test(taskId))
    return { kind: RunActivityKind.Submission, label: "修复结构化内容" };
  if (taskId.endsWith("/prepare")) return { kind: RunActivityKind.Prepare, label: "准备渠道内容" };
  if (/upload-cover/.test(taskId)) return { kind: RunActivityKind.Upload, label: "上传封面素材" };
  if (/upload-content-image/.test(taskId))
    return { kind: RunActivityKind.Upload, label: "上传正文素材" };
  if (/create-draft/.test(taskId)) return { kind: RunActivityKind.Publish, label: "创建渠道草稿" };
  if (taskId.endsWith("/receipt")) return { kind: RunActivityKind.Receipt, label: "保存发布回执" };
  if (/compiler|package/.test(taskId))
    return { kind: RunActivityKind.Validate, label: humanize(taskId.split("/").at(-1) ?? taskId) };
  return {
    kind: RunActivityKind.HistoricalTask,
    label: humanize(taskId.split("/").at(-1) ?? taskId),
  };
}

function destinationSnapshot(
  input: unknown,
  destinationId: string,
): NonNullable<RunSession["destination"]> {
  const value = record(input);
  const destination = record(value?.destination);
  const account = record(value?.account);
  return {
    destinationId,
    accountId: stringValue(destination?.accountId) ?? stringValue(account?.id) ?? "unknown",
    accountName: stringValue(account?.name) ?? "发布账号",
    channel: stringValue(destination?.channel) ?? stringValue(account?.channel) ?? "unknown",
    publicationType: stringValue(destination?.publicationType) ?? "unknown",
    ...(record(destination?.options)
      ? { options: safePreview(destination?.options) as Record<string, JsonValue> }
      : {}),
  };
}

function aggregateRunStatus(
  kind: RunRecord["kind"],
  main: RunSession | undefined,
  publications: RunSession[],
  latestJob?: JobRecord,
): RunRecord["status"] {
  if (
    main?.status === RunStatus.NeedsAttention ||
    publications.some((item) => item.status === RunStatus.NeedsAttention)
  )
    return RunStatus.NeedsAttention;
  if (kind === RunKind.Content && main?.status === RunStatus.Failed) return RunStatus.Failed;
  if (latestJob?.status === "running") return RunStatus.Running;
  if (
    main?.status === RunStatus.Running ||
    publications.some((item) => item.status === RunStatus.Running)
  )
    return RunStatus.Running;
  if (kind === RunKind.Content && main?.status === RunStatus.Succeeded) {
    if (publications.some((item) => item.status === RunStatus.Queued)) return RunStatus.Running;
    return publications.some((item) => item.status === RunStatus.Failed)
      ? RunStatus.Partial
      : RunStatus.Succeeded;
  }
  if (
    main?.status === RunStatus.Queued ||
    publications.some((item) => item.status === RunStatus.Queued)
  )
    return RunStatus.Queued;
  if (kind === RunKind.Publication && publications.length) {
    const successes = publications.filter((item) => item.status === RunStatus.Succeeded).length;
    if (successes === publications.length) return RunStatus.Succeeded;
    if (successes > 0) return RunStatus.Partial;
    if (publications.every((item) => item.status === RunStatus.Failed)) return RunStatus.Failed;
  }
  return latestJob ? runStatusFromJob(latestJob.status) : RunStatus.Queued;
}

function runStatusFromJob(status: JobRecord["status"]): RunRecord["status"] {
  if (status === "running") return RunStatus.Running;
  if (status === "succeeded") return RunStatus.Succeeded;
  if (status === "degraded") return RunStatus.Partial;
  if (status === "failed") return RunStatus.Failed;
  if (status === "needs_attention") return RunStatus.NeedsAttention;
  return RunStatus.Queued;
}

function isTerminalJobStatus(status: JobRecord["status"]): boolean {
  return (
    status === "succeeded" ||
    status === "degraded" ||
    status === "failed" ||
    status === "needs_attention"
  );
}

function activityStatus(status: RunTaskActivityInput["status"]): RunActivity["status"] {
  if (status === "running") return RunActivityStatus.Running;
  if (status === "succeeded") return RunActivityStatus.Succeeded;
  if (status === "needs_attention") return RunActivityStatus.NeedsAttention;
  return RunActivityStatus.Failed;
}

function safePreview(value: unknown, depth = 0): JsonValue | undefined {
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (typeof value === "boolean" || typeof value === "number") return value;
  if (typeof value === "string") return safeText(value, 500);
  if (depth >= 3) return "[已省略]";
  if (Array.isArray(value))
    return value.slice(0, 10).map((item) => safePreview(item, depth + 1) ?? null);
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "symbol") return value.description ?? "[symbol]";
  if (typeof value === "function") return "[function]";
  const output: Record<string, JsonValue> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>).slice(0, 30)) {
    output[key] = sensitiveKey(key) ? "[已隐藏]" : (safePreview(item, depth + 1) ?? null);
  }
  return output;
}

function sensitiveKey(key: string): boolean {
  return /authorization|credential|password|secret|api[-_]?key|access[-_]?token|refresh[-_]?token/i.test(
    key,
  );
}

function safeText(value: string, maximum: number): string {
  return value.length > maximum ? `${value.slice(0, maximum)}…` : value;
}

function humanize(value: string): string {
  return value
    .replace(/[-_:]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value ? value : undefined;
}
