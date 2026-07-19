import { TaskClaimKind, TaskEffect, TaskStatus } from "./constants.ts";
import type { TaskClaim, TaskClaimInput, TaskRecord, TaskStore } from "./task.ts";

export class MemoryTaskStore implements TaskStore {
  private readonly records = new Map<string, TaskRecord>();

  async claim<T = unknown>(input: TaskClaimInput): Promise<TaskClaim<T>> {
    const key = taskKey(input.jobId, input.taskId);
    const existing = this.records.get(key) as TaskRecord<T> | undefined;
    if (existing) {
      if (existing.fingerprint !== input.fingerprint) {
        return { kind: TaskClaimKind.Conflict, record: clone(existing) };
      }
      if (existing.status === TaskStatus.Succeeded || existing.status === TaskStatus.Degraded) {
        return { kind: TaskClaimKind.Replay, record: clone(existing) };
      }
      if (existing.status === TaskStatus.Unknown) {
        return { kind: TaskClaimKind.Unknown, record: clone(existing) };
      }
      if (existing.status === TaskStatus.Running && !leaseExpired(existing, input.now)) {
        return { kind: TaskClaimKind.Busy, record: clone(existing) };
      }
      if (existing.status === TaskStatus.Running && existing.effect === TaskEffect.Unsafe) {
        const unknown = finish(existing, TaskStatus.Unknown, input.now, {
          error: "执行器失联，无法确认外部副作用是否已经发生",
        });
        this.records.set(key, unknown);
        return { kind: TaskClaimKind.Unknown, record: clone(unknown as TaskRecord<T>) };
      }
    }

    const record: TaskRecord<T> = {
      jobId: input.jobId,
      taskId: input.taskId,
      fingerprint: input.fingerprint,
      version: input.version,
      effect: input.effect,
      status: TaskStatus.Running,
      attempt: (existing?.attempt ?? 0) + 1,
      startedAt: input.now,
      updatedAt: input.now,
      leaseExpiresAt: new Date(Date.parse(input.now) + input.leaseMs).toISOString(),
    };
    this.records.set(key, clone(record));
    return { kind: TaskClaimKind.Claimed, record };
  }

  succeed<T>(jobId: string, taskId: string, output: T, now: string): Promise<TaskRecord<T>> {
    return Promise.resolve(this.complete(jobId, taskId, TaskStatus.Succeeded, now, { output }));
  }

  degrade<T>(
    jobId: string,
    taskId: string,
    output: T,
    error: string,
    now: string,
  ): Promise<TaskRecord<T>> {
    return Promise.resolve(
      this.complete(jobId, taskId, TaskStatus.Degraded, now, { output, error }),
    );
  }

  fail(jobId: string, taskId: string, error: string, now: string): Promise<TaskRecord> {
    return Promise.resolve(this.complete(jobId, taskId, TaskStatus.Failed, now, { error }));
  }

  markUnknown(jobId: string, taskId: string, error: string, now: string): Promise<TaskRecord> {
    return Promise.resolve(this.complete(jobId, taskId, TaskStatus.Unknown, now, { error }));
  }

  get<T = unknown>(jobId: string, taskId: string): Promise<TaskRecord<T> | null> {
    const record = this.records.get(taskKey(jobId, taskId));
    return Promise.resolve(record ? clone(record as TaskRecord<T>) : null);
  }

  list(jobId: string): Promise<TaskRecord[]> {
    return Promise.resolve(
      [...this.records.values()]
        .filter((record) => record.jobId === jobId)
        .map((record) => clone(record))
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt) || a.taskId.localeCompare(b.taskId)),
    );
  }

  seed(record: TaskRecord): void {
    this.records.set(taskKey(record.jobId, record.taskId), clone(record));
  }

  private complete<T>(
    jobId: string,
    taskId: string,
    status: Exclude<TaskStatus, typeof TaskStatus.Running>,
    now: string,
    patch: { output?: T; error?: string },
  ): TaskRecord<T> {
    const key = taskKey(jobId, taskId);
    const existing = this.records.get(key) as TaskRecord<T> | undefined;
    if (!existing || existing.status !== TaskStatus.Running) {
      throw new Error(`任务 ${jobId}/${taskId} 没有处于运行状态`);
    }
    const record = finish(existing, status, now, patch);
    this.records.set(key, clone(record));
    return record;
  }
}

function finish<T>(
  record: TaskRecord<T>,
  status: Exclude<TaskStatus, typeof TaskStatus.Running>,
  now: string,
  patch: { output?: T; error?: string },
): TaskRecord<T> {
  return {
    ...record,
    ...patch,
    status,
    updatedAt: now,
    finishedAt: now,
    leaseExpiresAt: undefined,
  };
}

function leaseExpired(record: TaskRecord, now: string): boolean {
  return !record.leaseExpiresAt || Date.parse(record.leaseExpiresAt) <= Date.parse(now);
}

function taskKey(jobId: string, taskId: string): string {
  return `${jobId}\u0000${taskId}`;
}

function clone<T>(value: T): T {
  return structuredClone(value);
}
