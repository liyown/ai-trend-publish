import { mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync as Database } from "node:sqlite";
import type {
  ConnectionRecord,
  ConnectionStore,
  CredentialStore,
  JsonObject,
} from "@trendpublish/connectors";
import type {
  WorkspaceDocumentKind,
  WorkspaceDocumentMap,
  WorkspaceRepository,
} from "@trendpublish/core/workspace";
import {
  TaskClaimKind,
  TaskEffect,
  TaskStatus,
  decideJobClaim,
  type JobClaim,
  type JobClaimInput,
  type JobRecord,
  type JobStore,
  type TaskClaim,
  type TaskClaimInput,
  type TaskRecord,
  type TaskStore,
  type NewRunActivity,
  type RunListFilter,
  type RunStore,
} from "@trendpublish/runtime";
import type { RunActivity, RunRecord, RunSession } from "@trendpublish/contracts";

const SCHEMA_FILES = ["0001_modular_runtime.sql", "0002_react_runs.sql"].map((file) =>
  resolve(import.meta.dirname, "../../../../../migrations", file),
);

export class SQLiteStateStore implements WorkspaceRepository {
  private readonly db: Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }

  ensureSchema(): Promise<void> {
    for (const file of SCHEMA_FILES) this.db.exec(readFileSync(file, "utf8"));
    return Promise.resolve();
  }

  close(): void {
    this.db.close();
  }

  list<K extends WorkspaceDocumentKind>(kind: K): Promise<WorkspaceDocumentMap[K][]> {
    const rows = this.db
      .prepare(
        "SELECT document_json FROM workspace_documents WHERE kind = ? ORDER BY updated_at DESC",
      )
      .all(kind) as Array<{ document_json: string }>;
    return Promise.resolve(
      rows.map((row) => parseJson<WorkspaceDocumentMap[K]>(row.document_json)),
    );
  }

  get<K extends WorkspaceDocumentKind>(
    kind: K,
    id: string,
  ): Promise<WorkspaceDocumentMap[K] | null> {
    const row = this.db
      .prepare("SELECT document_json FROM workspace_documents WHERE kind = ? AND id = ?")
      .get(kind, id) as { document_json: string } | undefined;
    return Promise.resolve(row ? parseJson<WorkspaceDocumentMap[K]>(row.document_json) : null);
  }

  save<K extends WorkspaceDocumentKind>(
    kind: K,
    value: WorkspaceDocumentMap[K],
  ): Promise<WorkspaceDocumentMap[K]> {
    const current = this.db
      .prepare("SELECT revision FROM workspace_documents WHERE kind = ? AND id = ?")
      .get(kind, value.id) as { revision: number } | undefined;
    if (current && value.revision <= current.revision) {
      throw new Error(`对象 ${kind}/${value.id} 已更新`);
    }
    this.db
      .prepare(
        `INSERT INTO workspace_documents(kind, id, revision, document_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind, id) DO UPDATE SET
           revision = excluded.revision,
           document_json = excluded.document_json,
           updated_at = excluded.updated_at`,
      )
      .run(kind, value.id, value.revision, JSON.stringify(value), value.createdAt, value.updatedAt);
    return Promise.resolve(structuredClone(value));
  }

  remove(kind: WorkspaceDocumentKind, id: string): Promise<boolean> {
    const result = this.db
      .prepare("DELETE FROM workspace_documents WHERE kind = ? AND id = ?")
      .run(kind, id);
    return Promise.resolve(result.changes > 0);
  }

  listConnections(): Promise<ConnectionRecord[]> {
    const rows = this.db
      .prepare("SELECT connection_json FROM connector_connections ORDER BY updated_at DESC")
      .all() as Array<{ connection_json: string }>;
    return Promise.resolve(rows.map((row) => parseJson<ConnectionRecord>(row.connection_json)));
  }

  getConnection(id: string): Promise<ConnectionRecord | null> {
    const row = this.db
      .prepare("SELECT connection_json FROM connector_connections WHERE id = ?")
      .get(id) as { connection_json: string } | undefined;
    return Promise.resolve(row ? parseJson<ConnectionRecord>(row.connection_json) : null);
  }

  saveConnection(connection: ConnectionRecord): Promise<ConnectionRecord> {
    this.db
      .prepare(
        `INSERT INTO connector_connections(id, revision, connection_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           revision = excluded.revision,
           connection_json = excluded.connection_json,
           updated_at = excluded.updated_at
         WHERE connector_connections.revision < excluded.revision`,
      )
      .run(
        connection.id,
        connection.revision,
        JSON.stringify(connection),
        connection.createdAt,
        connection.updatedAt,
      );
    const saved = this.db
      .prepare("SELECT connection_json FROM connector_connections WHERE id = ?")
      .get(connection.id) as { connection_json: string } | undefined;
    if (!saved || saved.connection_json !== JSON.stringify(connection)) {
      throw new Error(`连接 ${connection.id} 写入冲突`);
    }
    return Promise.resolve(structuredClone(connection));
  }

  removeConnection(id: string): Promise<void> {
    this.db.prepare("DELETE FROM connector_connections WHERE id = ?").run(id);
    return Promise.resolve();
  }

  getCredential(ref: string): Promise<JsonObject | null> {
    const row = this.db
      .prepare("SELECT credentials_json FROM connector_credentials WHERE credential_ref = ?")
      .get(ref) as { credentials_json: string } | undefined;
    return Promise.resolve(row ? parseJson<JsonObject>(row.credentials_json) : null);
  }

  set(ref: string, credentials: JsonObject): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO connector_credentials(credential_ref, credentials_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(credential_ref) DO UPDATE SET
           credentials_json = excluded.credentials_json,
           updated_at = excluded.updated_at`,
      )
      .run(ref, JSON.stringify(credentials), new Date().toISOString());
    return Promise.resolve();
  }

  removeCredential(ref: string): Promise<void> {
    this.db.prepare("DELETE FROM connector_credentials WHERE credential_ref = ?").run(ref);
    return Promise.resolve();
  }

  getSchemaVersion(key: string): Promise<string | null> {
    const row = this.db
      .prepare("SELECT version FROM internal_schema_versions WHERE name = ?")
      .get(key) as { version: number | string } | undefined;
    return Promise.resolve(row ? String(row.version) : null);
  }

  setSchemaVersion(key: string, version: string, completedAt: string): Promise<void> {
    this.db
      .prepare(
        `INSERT INTO internal_schema_versions(name, version, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET version = excluded.version, updated_at = excluded.updated_at`,
      )
      .run(key, version, completedAt);
    return Promise.resolve();
  }

  createRun(run: RunRecord): Promise<RunRecord> {
    this.db
      .prepare(
        `INSERT INTO runtime_runs(id, kind, status, plan_id, package_id, run_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id,
        run.kind,
        run.status,
        run.planId ?? null,
        run.packageId ?? null,
        JSON.stringify(run),
        run.createdAt,
        run.updatedAt,
      );
    return Promise.resolve(structuredClone(run));
  }

  getRun(id: string): Promise<RunRecord | null> {
    const row = this.db.prepare("SELECT run_json FROM runtime_runs WHERE id = ?").get(id) as
      | { run_json: string }
      | undefined;
    return Promise.resolve(row ? parseJson<RunRecord>(row.run_json) : null);
  }

  listRuns(filter: RunListFilter = {}, limit = 100, offset = 0): Promise<RunRecord[]> {
    const rows = this.db
      .prepare("SELECT run_json FROM runtime_runs ORDER BY created_at DESC LIMIT ? OFFSET ?")
      .all(limit, offset) as Array<{ run_json: string }>;
    return Promise.resolve(
      rows
        .map((row) => parseJson<RunRecord>(row.run_json))
        .filter((run) => !filter.planId || run.planId === filter.planId)
        .filter((run) => !filter.kind || run.kind === filter.kind)
        .filter((run) => !filter.status || run.status === filter.status),
    );
  }

  updateRun(run: RunRecord): Promise<RunRecord> {
    const result = this.db
      .prepare(
        `UPDATE runtime_runs SET status = ?, plan_id = ?, package_id = ?, run_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        run.status,
        run.planId ?? null,
        run.packageId ?? null,
        JSON.stringify(run),
        run.updatedAt,
        run.id,
      );
    if (!result.changes) throw new Error(`运行不存在：${run.id}`);
    return Promise.resolve(structuredClone(run));
  }

  createSession(session: RunSession): Promise<RunSession> {
    this.db
      .prepare(
        `INSERT INTO runtime_run_sessions
         (id, run_id, kind, status, destination_id, session_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        session.id,
        session.runId,
        session.kind,
        session.status,
        session.destination?.destinationId ?? null,
        JSON.stringify(session),
        session.createdAt,
        session.updatedAt,
      );
    return Promise.resolve(structuredClone(session));
  }

  getSession(id: string): Promise<RunSession | null> {
    const row = this.db
      .prepare("SELECT session_json FROM runtime_run_sessions WHERE id = ?")
      .get(id) as { session_json: string } | undefined;
    return Promise.resolve(row ? parseJson<RunSession>(row.session_json) : null);
  }

  listSessions(runId: string): Promise<RunSession[]> {
    const rows = this.db
      .prepare(
        "SELECT session_json FROM runtime_run_sessions WHERE run_id = ? ORDER BY created_at ASC",
      )
      .all(runId) as Array<{ session_json: string }>;
    return Promise.resolve(rows.map((row) => parseJson<RunSession>(row.session_json)));
  }

  updateSession(session: RunSession): Promise<RunSession> {
    const result = this.db
      .prepare(
        `UPDATE runtime_run_sessions SET status = ?, destination_id = ?, session_json = ?, updated_at = ?
         WHERE id = ?`,
      )
      .run(
        session.status,
        session.destination?.destinationId ?? null,
        JSON.stringify(session),
        session.updatedAt,
        session.id,
      );
    if (!result.changes) throw new Error(`运行会话不存在：${session.id}`);
    return Promise.resolve(structuredClone(session));
  }

  appendActivity(input: NewRunActivity): Promise<RunActivity> {
    const key = activityKey(input);
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.db
        .prepare("SELECT id FROM runtime_run_activities WHERE run_id = ? AND activity_key = ?")
        .get(input.runId, key) as { id: string } | undefined;
      const sequence = this.nextActivitySequence(input.runId);
      const activity: RunActivity = {
        ...structuredClone(input),
        id: existing?.id ?? `activity-${input.runId}-${sequence}`,
        sequence,
      };
      if (existing) {
        this.db
          .prepare(
            `UPDATE runtime_run_activities
             SET sequence = ?, kind = ?, status = ?, activity_json = ?, updated_at = ? WHERE id = ?`,
          )
          .run(
            activity.sequence,
            activity.kind,
            activity.status,
            JSON.stringify(activity),
            activity.updatedAt,
            activity.id,
          );
      } else {
        this.db
          .prepare(
            `INSERT INTO runtime_run_activities
             (id, run_id, session_id, sequence, activity_key, kind, status, activity_json, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          )
          .run(
            activity.id,
            activity.runId,
            activity.sessionId,
            activity.sequence,
            key,
            activity.kind,
            activity.status,
            JSON.stringify(activity),
            activity.updatedAt,
          );
      }
      this.db.exec("COMMIT");
      return Promise.resolve(activity);
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  listActivities(runId: string, sessionId?: string, afterSequence = 0): Promise<RunActivity[]> {
    const rows = sessionId
      ? (this.db
          .prepare(
            `SELECT activity_json FROM runtime_run_activities
             WHERE run_id = ? AND session_id = ? AND sequence > ? ORDER BY sequence ASC`,
          )
          .all(runId, sessionId, afterSequence) as Array<{ activity_json: string }>)
      : (this.db
          .prepare(
            `SELECT activity_json FROM runtime_run_activities
             WHERE run_id = ? AND sequence > ? ORDER BY sequence ASC`,
          )
          .all(runId, afterSequence) as Array<{ activity_json: string }>);
    return Promise.resolve(rows.map((row) => parseJson<RunActivity>(row.activity_json)));
  }

  private nextActivitySequence(runId: string): number {
    const row = this.db
      .prepare(
        "SELECT COALESCE(MAX(sequence), 0) AS sequence FROM runtime_run_activities WHERE run_id = ?",
      )
      .get(runId) as { sequence: number };
    return row.sequence + 1;
  }

  createJob<TInput, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>> {
    this.db
      .prepare(
        "INSERT INTO runtime_jobs(id, type, status, job_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(job.id, job.type, job.status, JSON.stringify(job), job.createdAt, job.updatedAt);
    return Promise.resolve(structuredClone(job));
  }

  getJob<TInput = unknown, TOutput = unknown>(
    id: string,
  ): Promise<JobRecord<TInput, TOutput> | null> {
    const row = this.db.prepare("SELECT job_json FROM runtime_jobs WHERE id = ?").get(id) as
      | { job_json: string }
      | undefined;
    return Promise.resolve(row ? parseJson<JobRecord<TInput, TOutput>>(row.job_json) : null);
  }

  listJobs(type?: string, limit = 100, offset = 0): Promise<JobRecord[]> {
    const rows = type
      ? (this.db
          .prepare(
            "SELECT job_json FROM runtime_jobs WHERE type = ? ORDER BY created_at DESC LIMIT ? OFFSET ?",
          )
          .all(type, limit, offset) as Array<{ job_json: string }>)
      : (this.db
          .prepare("SELECT job_json FROM runtime_jobs ORDER BY created_at DESC LIMIT ? OFFSET ?")
          .all(limit, offset) as Array<{ job_json: string }>);
    return Promise.resolve(rows.map((row) => parseJson<JobRecord>(row.job_json)));
  }

  updateJob<TInput = unknown, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>> {
    const result = this.db
      .prepare("UPDATE runtime_jobs SET status = ?, job_json = ?, updated_at = ? WHERE id = ?")
      .run(job.status, JSON.stringify(job), job.updatedAt, job.id);
    if (!result.changes) throw new Error(`任务不存在：${job.id}`);
    return Promise.resolve(structuredClone(job));
  }

  claimJob<TInput = unknown, TOutput = unknown>(
    input: JobClaimInput,
  ): Promise<JobClaim<TInput, TOutput>> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getJobSync<TInput, TOutput>(input.id);
      if (!current) throw new Error(`任务不存在：${input.id}`);
      const claim = decideJobClaim(current, input);
      if (claim.kind === "claimed") {
        this.db
          .prepare(
            `UPDATE runtime_jobs SET status = ?, job_json = ?, updated_at = ?
             WHERE id = ? AND status = ?`,
          )
          .run(
            claim.record.status,
            JSON.stringify(claim.record),
            claim.record.updatedAt,
            input.id,
            claim.previousStatus,
          );
      }
      this.db.exec("COMMIT");
      return Promise.resolve(structuredClone(claim));
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async claimTask<T = unknown>(input: TaskClaimInput): Promise<TaskClaim<T>> {
    this.db.exec("BEGIN IMMEDIATE");
    try {
      const current = this.getTaskSync<T>(input.jobId, input.taskId);
      const claim = decideTaskClaim(current, input);
      if (
        claim.kind === TaskClaimKind.Claimed ||
        (claim.kind === TaskClaimKind.Unknown &&
          current?.status === TaskStatus.Running &&
          current.effect === TaskEffect.Unsafe)
      ) {
        this.putTaskSync(claim.record);
      }
      this.db.exec("COMMIT");
      return claim;
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  succeedTask<T>(jobId: string, taskId: string, output: T, now: string): Promise<TaskRecord<T>> {
    return this.finishTask(jobId, taskId, { status: TaskStatus.Succeeded, output, now });
  }

  degradeTask<T>(
    jobId: string,
    taskId: string,
    output: T,
    error: string,
    now: string,
  ): Promise<TaskRecord<T>> {
    return this.finishTask(jobId, taskId, { status: TaskStatus.Degraded, output, error, now });
  }

  failTask(jobId: string, taskId: string, error: string, now: string): Promise<TaskRecord> {
    return this.finishTask(jobId, taskId, { status: TaskStatus.Failed, error, now });
  }

  markTaskUnknown(jobId: string, taskId: string, error: string, now: string): Promise<TaskRecord> {
    return this.finishTask(jobId, taskId, { status: TaskStatus.Unknown, error, now });
  }

  listTasks(jobId: string): Promise<TaskRecord[]> {
    const rows = this.db
      .prepare("SELECT task_json FROM runtime_tasks WHERE job_id = ? ORDER BY updated_at ASC")
      .all(jobId) as Array<{ task_json: string }>;
    return Promise.resolve(rows.map((row) => parseJson<TaskRecord>(row.task_json)));
  }

  getTask<T = unknown>(jobId: string, taskId: string): Promise<TaskRecord<T> | null> {
    return Promise.resolve(this.getTaskSync<T>(jobId, taskId));
  }

  private finishTask<T>(
    jobId: string,
    taskId: string,
    change: { status: TaskRecord["status"]; output?: T; error?: string; now: string },
  ): Promise<TaskRecord<T>> {
    const current = this.getTaskSync<T>(jobId, taskId);
    if (!current) throw new Error(`任务检查点不存在：${jobId}/${taskId}`);
    const next: TaskRecord<T> = {
      ...current,
      status: change.status,
      output: change.output,
      error: change.error,
      updatedAt: change.now,
      finishedAt: change.now,
      leaseExpiresAt: undefined,
    };
    this.putTaskSync(next);
    return Promise.resolve(structuredClone(next));
  }

  private getTaskSync<T>(jobId: string, taskId: string): TaskRecord<T> | null {
    const row = this.db
      .prepare("SELECT task_json FROM runtime_tasks WHERE job_id = ? AND task_id = ?")
      .get(jobId, taskId) as { task_json: string } | undefined;
    return row ? parseJson<TaskRecord<T>>(row.task_json) : null;
  }

  private getJobSync<TInput, TOutput>(id: string): JobRecord<TInput, TOutput> | null {
    const row = this.db.prepare("SELECT job_json FROM runtime_jobs WHERE id = ?").get(id) as
      | { job_json: string }
      | undefined;
    return row ? parseJson<JobRecord<TInput, TOutput>>(row.job_json) : null;
  }

  private putTaskSync(record: TaskRecord): void {
    this.db
      .prepare(
        `INSERT INTO runtime_tasks(job_id, task_id, status, fingerprint, task_json, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(job_id, task_id) DO UPDATE SET
           status = excluded.status,
           fingerprint = excluded.fingerprint,
           task_json = excluded.task_json,
           updated_at = excluded.updated_at`,
      )
      .run(
        record.jobId,
        record.taskId,
        record.status,
        record.fingerprint,
        JSON.stringify(record),
        record.updatedAt,
      );
  }
}

export function asConnectionStore(store: SQLiteStateStore): ConnectionStore {
  return {
    list: () => store.listConnections(),
    get: (id) => store.getConnection(id),
    save: (connection) => store.saveConnection(connection),
    remove: (id) => store.removeConnection(id),
  };
}

export function asCredentialStore(store: SQLiteStateStore): CredentialStore {
  return {
    get: (ref) => store.getCredential(ref),
    set: (ref, credentials) => store.set(ref, credentials),
    remove: (ref) => store.removeCredential(ref),
  };
}

export function asTaskStore(store: SQLiteStateStore): TaskStore {
  return {
    claim: (input) => store.claimTask(input),
    succeed: (jobId, taskId, output, now) => store.succeedTask(jobId, taskId, output, now),
    degrade: (jobId, taskId, output, error, now) =>
      store.degradeTask(jobId, taskId, output, error, now),
    fail: (jobId, taskId, error, now) => store.failTask(jobId, taskId, error, now),
    markUnknown: (jobId, taskId, error, now) => store.markTaskUnknown(jobId, taskId, error, now),
    get: (jobId, taskId) => store.getTask(jobId, taskId),
    list: (jobId) => store.listTasks(jobId),
  };
}

export function asJobStore(store: SQLiteStateStore): JobStore {
  return {
    create: (job) => store.createJob(job),
    get: (id) => store.getJob(id),
    list: (type, limit, offset) => store.listJobs(type, limit, offset),
    claim: (input) => store.claimJob(input),
    update: (job) => store.updateJob(job),
  };
}

export function asRunStore(store: SQLiteStateStore): RunStore {
  return {
    getSchemaVersion: (key) => store.getSchemaVersion(key),
    setSchemaVersion: (key, version, completedAt) =>
      store.setSchemaVersion(key, version, completedAt),
    createRun: (run) => store.createRun(run),
    getRun: (id) => store.getRun(id),
    listRuns: (filter, limit, offset) => store.listRuns(filter, limit, offset),
    updateRun: (run) => store.updateRun(run),
    createSession: (session) => store.createSession(session),
    getSession: (id) => store.getSession(id),
    listSessions: (runId) => store.listSessions(runId),
    updateSession: (session) => store.updateSession(session),
    appendActivity: (activity) => store.appendActivity(activity),
    listActivities: (runId, sessionId, afterSequence) =>
      store.listActivities(runId, sessionId, afterSequence),
  };
}

function decideTaskClaim<T>(current: TaskRecord<T> | null, input: TaskClaimInput): TaskClaim<T> {
  if (current && (current.fingerprint !== input.fingerprint || current.version !== input.version)) {
    return { kind: TaskClaimKind.Conflict, record: current };
  }
  if (current?.status === TaskStatus.Succeeded || current?.status === TaskStatus.Degraded) {
    return { kind: TaskClaimKind.Replay, record: current };
  }
  if (current?.status === TaskStatus.Unknown) {
    return { kind: TaskClaimKind.Unknown, record: current };
  }
  if (
    current?.status === TaskStatus.Running &&
    current.leaseExpiresAt &&
    current.leaseExpiresAt > input.now
  ) {
    return { kind: TaskClaimKind.Busy, record: current };
  }
  if (current?.status === TaskStatus.Running && current.effect === TaskEffect.Unsafe) {
    const unknown = {
      ...current,
      status: TaskStatus.Unknown,
      error: "执行器失联，无法确认外部副作用是否已经发生",
      updatedAt: input.now,
      finishedAt: input.now,
      leaseExpiresAt: undefined,
    };
    return { kind: TaskClaimKind.Unknown, record: unknown };
  }
  const record: TaskRecord<T> = {
    jobId: input.jobId,
    taskId: input.taskId,
    fingerprint: input.fingerprint,
    version: input.version,
    effect: input.effect,
    status: TaskStatus.Running,
    attempt: (current?.attempt ?? 0) + 1,
    startedAt: input.now,
    updatedAt: input.now,
    leaseExpiresAt: new Date(Date.parse(input.now) + input.leaseMs).toISOString(),
  };
  return { kind: TaskClaimKind.Claimed, record };
}

function parseJson<T = unknown>(value: string): T {
  return JSON.parse(value) as T;
}

function activityKey(activity: NewRunActivity): string {
  return `${activity.sessionId}:${activity.taskId ?? activity.kind}:${activity.attempt ?? 1}`;
}
