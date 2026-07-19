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
import type { CloudflareD1Database } from "./cloudflare-bindings.ts";

export class D1WorkspaceRepository implements WorkspaceRepository {
  constructor(private readonly db: CloudflareD1Database) {}

  ensureSchema(): Promise<void> {
    return Promise.resolve();
  }

  async list<K extends WorkspaceDocumentKind>(kind: K): Promise<WorkspaceDocumentMap[K][]> {
    const result = await this.db
      .prepare(
        "SELECT document_json FROM workspace_documents WHERE kind = ? ORDER BY updated_at DESC",
      )
      .bind(kind)
      .all<{ document_json: string }>();
    return result.results.map((row) => parseJson<WorkspaceDocumentMap[K]>(row.document_json));
  }

  async get<K extends WorkspaceDocumentKind>(
    kind: K,
    id: string,
  ): Promise<WorkspaceDocumentMap[K] | null> {
    const row = await this.db
      .prepare("SELECT document_json FROM workspace_documents WHERE kind = ? AND id = ?")
      .bind(kind, id)
      .first<{ document_json: string }>();
    return row ? parseJson(row.document_json) : null;
  }

  async save<K extends WorkspaceDocumentKind>(
    kind: K,
    value: WorkspaceDocumentMap[K],
  ): Promise<WorkspaceDocumentMap[K]> {
    const existing = await this.get(kind, value.id);
    if (existing && value.revision <= existing.revision)
      throw new Error(`对象 ${kind}/${value.id} 已更新`);
    await this.db
      .prepare(
        `INSERT INTO workspace_documents(kind, id, revision, document_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind, id) DO UPDATE SET
           revision = excluded.revision,
           document_json = excluded.document_json,
           updated_at = excluded.updated_at
         WHERE workspace_documents.revision < excluded.revision`,
      )
      .bind(kind, value.id, value.revision, JSON.stringify(value), value.createdAt, value.updatedAt)
      .run();
    const saved = await this.get(kind, value.id);
    if (!saved || saved.revision !== value.revision)
      throw new Error(`对象 ${kind}/${value.id} 写入冲突`);
    return saved;
  }

  async remove(kind: WorkspaceDocumentKind, id: string): Promise<boolean> {
    const existing = await this.get(kind, id);
    if (!existing) return false;
    await this.db
      .prepare("DELETE FROM workspace_documents WHERE kind = ? AND id = ?")
      .bind(kind, id)
      .run();
    return true;
  }
}

export class D1ConnectionStore implements ConnectionStore {
  constructor(private readonly db: CloudflareD1Database) {}

  async list(): Promise<ConnectionRecord[]> {
    const result = await this.db
      .prepare("SELECT connection_json FROM connector_connections ORDER BY updated_at DESC")
      .all<{ connection_json: string }>();
    return result.results.map((row) => parseJson<ConnectionRecord>(row.connection_json));
  }

  async get(id: string): Promise<ConnectionRecord | null> {
    const row = await this.db
      .prepare("SELECT connection_json FROM connector_connections WHERE id = ?")
      .bind(id)
      .first<{ connection_json: string }>();
    return row ? parseJson(row.connection_json) : null;
  }

  async save(connection: ConnectionRecord): Promise<ConnectionRecord> {
    await this.db
      .prepare(
        `INSERT INTO connector_connections(id, revision, connection_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           revision = excluded.revision,
           connection_json = excluded.connection_json,
           updated_at = excluded.updated_at
         WHERE connector_connections.revision < excluded.revision`,
      )
      .bind(
        connection.id,
        connection.revision,
        JSON.stringify(connection),
        connection.createdAt,
        connection.updatedAt,
      )
      .run();
    const saved = await this.get(connection.id);
    if (!saved || JSON.stringify(saved) !== JSON.stringify(connection))
      throw new Error(`连接 ${connection.id} 写入冲突`);
    return saved;
  }

  async remove(id: string): Promise<void> {
    await this.db.prepare("DELETE FROM connector_connections WHERE id = ?").bind(id).run();
  }
}

export class D1CredentialStore implements CredentialStore {
  constructor(private readonly db: CloudflareD1Database) {}

  async get(ref: string): Promise<JsonObject | null> {
    const row = await this.db
      .prepare("SELECT credentials_json FROM connector_credentials WHERE credential_ref = ?")
      .bind(ref)
      .first<{ credentials_json: string }>();
    return row ? parseJson(row.credentials_json) : null;
  }

  async set(ref: string, credentials: JsonObject): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO connector_credentials(credential_ref, credentials_json, updated_at)
         VALUES (?, ?, ?)
         ON CONFLICT(credential_ref) DO UPDATE SET
           credentials_json = excluded.credentials_json,
           updated_at = excluded.updated_at`,
      )
      .bind(ref, JSON.stringify(credentials), new Date().toISOString())
      .run();
  }

  async remove(ref: string): Promise<void> {
    await this.db
      .prepare("DELETE FROM connector_credentials WHERE credential_ref = ?")
      .bind(ref)
      .run();
  }
}

export class D1JobStore implements JobStore {
  constructor(private readonly db: CloudflareD1Database) {}

  async create<TInput, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>> {
    await this.db
      .prepare(
        "INSERT INTO runtime_jobs(id, type, status, job_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .bind(job.id, job.type, job.status, JSON.stringify(job), job.createdAt, job.updatedAt)
      .run();
    return structuredClone(job);
  }

  async get<TInput = unknown, TOutput = unknown>(
    id: string,
  ): Promise<JobRecord<TInput, TOutput> | null> {
    const row = await this.db
      .prepare("SELECT job_json FROM runtime_jobs WHERE id = ?")
      .bind(id)
      .first<{ job_json: string }>();
    return row ? parseJson(row.job_json) : null;
  }

  async list(type?: string, limit = 100): Promise<JobRecord[]> {
    const result = type
      ? await this.db
          .prepare(
            "SELECT job_json FROM runtime_jobs WHERE type = ? ORDER BY created_at DESC LIMIT ?",
          )
          .bind(type, limit)
          .all<{ job_json: string }>()
      : await this.db
          .prepare("SELECT job_json FROM runtime_jobs ORDER BY created_at DESC LIMIT ?")
          .bind(limit)
          .all<{ job_json: string }>();
    return result.results.map((row) => parseJson<JobRecord>(row.job_json));
  }

  async claim<TInput = unknown, TOutput = unknown>(
    input: JobClaimInput,
  ): Promise<JobClaim<TInput, TOutput>> {
    const current = await this.get<TInput, TOutput>(input.id);
    if (!current) throw new Error(`任务不存在：${input.id}`);
    const claim = decideJobClaim(current, input);
    if (claim.kind !== "claimed") return claim;

    const result = await this.db
      .prepare(
        `UPDATE runtime_jobs SET status = ?, job_json = ?, updated_at = ?
         WHERE id = ? AND type = ? AND status = ?`,
      )
      .bind(
        claim.record.status,
        JSON.stringify(claim.record),
        claim.record.updatedAt,
        input.id,
        input.type,
        claim.previousStatus,
      )
      .run();
    if ((result.meta as { changes?: number }).changes === 0) {
      const latest = await this.get<TInput, TOutput>(input.id);
      if (!latest) throw new Error(`任务不存在：${input.id}`);
      return decideJobClaim(latest, input);
    }
    return claim;
  }

  async update<TInput = unknown, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>> {
    await this.db
      .prepare("UPDATE runtime_jobs SET status = ?, job_json = ?, updated_at = ? WHERE id = ?")
      .bind(job.status, JSON.stringify(job), job.updatedAt, job.id)
      .run();
    return structuredClone(job);
  }
}

export class D1TaskStore implements TaskStore {
  constructor(private readonly db: CloudflareD1Database) {}

  async claim<T = unknown>(input: TaskClaimInput): Promise<TaskClaim<T>> {
    const current = await this.get<T>(input.jobId, input.taskId);
    const decision = decideClaim(current, input);
    if (
      decision.kind === TaskClaimKind.Unknown &&
      current?.status === TaskStatus.Running &&
      current.effect === TaskEffect.Unsafe
    ) {
      const record = await this.finish<T>(input.jobId, input.taskId, {
        status: TaskStatus.Unknown,
        error: "执行器失联，无法确认外部副作用是否已经发生",
        now: input.now,
      });
      return { kind: TaskClaimKind.Unknown, record };
    }
    if (decision.kind !== TaskClaimKind.Claimed) return decision;

    if (!current) {
      await this.db
        .prepare(
          `INSERT OR IGNORE INTO runtime_tasks
           (job_id, task_id, status, fingerprint, task_json, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          input.jobId,
          input.taskId,
          TaskStatus.Running,
          input.fingerprint,
          JSON.stringify(decision.record),
          input.now,
        )
        .run();
    } else {
      await this.db
        .prepare(
          `UPDATE runtime_tasks SET status = ?, fingerprint = ?, task_json = ?, updated_at = ?
           WHERE job_id = ? AND task_id = ? AND fingerprint = ?
             AND status IN ('failed', 'running') AND task_json = ?`,
        )
        .bind(
          TaskStatus.Running,
          input.fingerprint,
          JSON.stringify(decision.record),
          input.now,
          input.jobId,
          input.taskId,
          input.fingerprint,
          JSON.stringify(current),
        )
        .run();
    }
    const stored = await this.get<T>(input.jobId, input.taskId);
    if (
      stored?.status === TaskStatus.Running &&
      stored.fingerprint === input.fingerprint &&
      stored.attempt === decision.record.attempt
    ) {
      return { kind: TaskClaimKind.Claimed, record: stored };
    }
    return decideClaim(stored, input);
  }

  succeed<T>(jobId: string, taskId: string, output: T, now: string): Promise<TaskRecord<T>> {
    return this.finish(jobId, taskId, { status: TaskStatus.Succeeded, output, now });
  }

  degrade<T>(
    jobId: string,
    taskId: string,
    output: T,
    error: string,
    now: string,
  ): Promise<TaskRecord<T>> {
    return this.finish(jobId, taskId, { status: TaskStatus.Degraded, output, error, now });
  }

  fail(jobId: string, taskId: string, error: string, now: string): Promise<TaskRecord> {
    return this.finish(jobId, taskId, { status: TaskStatus.Failed, error, now });
  }

  markUnknown(jobId: string, taskId: string, error: string, now: string): Promise<TaskRecord> {
    return this.finish(jobId, taskId, { status: TaskStatus.Unknown, error, now });
  }

  async get<T = unknown>(jobId: string, taskId: string): Promise<TaskRecord<T> | null> {
    const row = await this.db
      .prepare("SELECT task_json FROM runtime_tasks WHERE job_id = ? AND task_id = ?")
      .bind(jobId, taskId)
      .first<{ task_json: string }>();
    return row ? parseJson(row.task_json) : null;
  }

  async list(jobId: string): Promise<TaskRecord[]> {
    const result = await this.db
      .prepare("SELECT task_json FROM runtime_tasks WHERE job_id = ? ORDER BY updated_at ASC")
      .bind(jobId)
      .all<{ task_json: string }>();
    return result.results.map((row) => parseJson<TaskRecord>(row.task_json));
  }

  private async finish<T>(
    jobId: string,
    taskId: string,
    change: { status: TaskRecord["status"]; output?: T; error?: string; now: string },
  ): Promise<TaskRecord<T>> {
    const current = await this.get<T>(jobId, taskId);
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
    await this.db
      .prepare(
        `UPDATE runtime_tasks SET status = ?, task_json = ?, updated_at = ?
         WHERE job_id = ? AND task_id = ? AND task_json = ?`,
      )
      .bind(
        next.status,
        JSON.stringify(next),
        next.updatedAt,
        jobId,
        taskId,
        JSON.stringify(current),
      )
      .run();
    const stored = await this.get<T>(jobId, taskId);
    if (!stored || JSON.stringify(stored) !== JSON.stringify(next)) {
      throw new Error(`任务检查点并发更新冲突：${jobId}/${taskId}`);
    }
    return stored;
  }
}

function decideClaim<T>(current: TaskRecord<T> | null, input: TaskClaimInput): TaskClaim<T> {
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
    return { kind: TaskClaimKind.Unknown, record: current };
  }
  return {
    kind: TaskClaimKind.Claimed,
    record: {
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
    },
  };
}

function parseJson<T>(value: string): T {
  return JSON.parse(value) as T;
}
