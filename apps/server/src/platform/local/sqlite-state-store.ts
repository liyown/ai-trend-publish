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
} from "@trendpublish/runtime";

const SCHEMA_FILE = resolve(
  import.meta.dirname,
  "../../../../../migrations/0001_modular_runtime.sql",
);

export class SQLiteStateStore implements WorkspaceRepository {
  private readonly db: Database;

  constructor(databasePath: string) {
    mkdirSync(dirname(databasePath), { recursive: true });
    this.db = new Database(databasePath);
    this.db.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
  }

  ensureSchema(): Promise<void> {
    this.db.exec(readFileSync(SCHEMA_FILE, "utf8"));
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

  listJobs(type?: string, limit = 100): Promise<JobRecord[]> {
    const rows = type
      ? (this.db
          .prepare(
            "SELECT job_json FROM runtime_jobs WHERE type = ? ORDER BY created_at DESC LIMIT ?",
          )
          .all(type, limit) as Array<{ job_json: string }>)
      : (this.db
          .prepare("SELECT job_json FROM runtime_jobs ORDER BY created_at DESC LIMIT ?")
          .all(limit) as Array<{ job_json: string }>);
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
    list: (type, limit) => store.listJobs(type, limit),
    claim: (input) => store.claimJob(input),
    update: (job) => store.updateJob(job),
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
