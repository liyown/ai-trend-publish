import { TaskClaimKind, TaskEffect } from "./constants.ts";
import type { RuntimeEventDraft, RuntimeEventPublisher } from "./events.ts";
import {
  TaskBusyError,
  TaskFingerprintConflictError,
  TaskNeedsAttentionError,
  UnknownTaskOutcomeError,
  type TaskContext,
  type TaskSpec,
  type TaskStore,
} from "./task.ts";
import { describeUnknown, fingerprint } from "./value.ts";
import type { RunTaskActivityObserver } from "./run.ts";

export interface TaskRunnerOptions {
  leaseMs?: number;
  now?: () => Date;
  createSignal?: (taskId: string) => AbortSignal;
  events?: RuntimeEventPublisher;
  activities?: RunTaskActivityObserver;
}

export class TaskRunner {
  private readonly leaseMs: number;
  private readonly now: () => Date;
  private readonly createSignal: (taskId: string) => AbortSignal;
  private readonly events?: RuntimeEventPublisher;
  private readonly activities?: RunTaskActivityObserver;

  constructor(
    private readonly store: TaskStore,
    options: TaskRunnerOptions = {},
  ) {
    this.leaseMs = options.leaseMs ?? 15 * 60_000;
    this.now = options.now ?? (() => new Date());
    this.createSignal = options.createSignal ?? (() => new AbortController().signal);
    this.events = options.events;
    this.activities = options.activities;
  }

  forJob(jobId: string): TaskContext {
    return this.createContext(jobId, "");
  }

  private createContext(jobId: string, prefix: string): TaskContext {
    return {
      jobId,
      ...(prefix ? { taskId: prefix } : {}),
      run: <T>(
        spec: TaskSpec<T>,
        execute: (signal: AbortSignal, task: TaskContext) => Promise<T>,
      ) => this.run(jobId, prefix, spec, execute),
      scope: (childPrefix: string) =>
        this.createContext(jobId, joinTaskId(prefix, normalizeTaskId(childPrefix))),
      emit: <T>(type: string, data?: T) => {
        this.publish({
          type,
          jobId,
          ...(prefix ? { taskId: prefix } : {}),
          ...(data === undefined ? {} : { data }),
        });
      },
    };
  }

  private async run<T>(
    jobId: string,
    prefix: string,
    spec: TaskSpec<T>,
    execute: (signal: AbortSignal, task: TaskContext) => Promise<T>,
  ): Promise<T> {
    const taskId = joinTaskId(prefix, normalizeTaskId(spec.id));
    if (spec.transient) return await this.runTransient(jobId, taskId, spec, execute);
    const taskFingerprint = await fingerprint({ version: spec.version, input: spec.input });
    const now = this.now().toISOString();
    const claim = await this.store.claim<T>({
      jobId,
      taskId,
      fingerprint: taskFingerprint,
      version: spec.version,
      effect: spec.effect ?? TaskEffect.Pure,
      leaseMs: this.leaseMs,
      now,
    });

    if (claim.kind === TaskClaimKind.Replay) return claim.record.output as T;
    if (claim.kind === TaskClaimKind.Conflict)
      throw new TaskFingerprintConflictError(jobId, taskId);
    if (claim.kind === TaskClaimKind.Busy) throw new TaskBusyError(jobId, taskId);
    if (claim.kind === TaskClaimKind.Unknown) {
      throw new TaskNeedsAttentionError(
        jobId,
        taskId,
        claim.record.error ?? "任务结果未知，需要人工确认",
      );
    }

    this.publish({
      type: "task.started",
      jobId,
      taskId,
      data: { version: spec.version, attempt: claim.record.attempt, effect: claim.record.effect },
    });
    await this.activities?.onTaskActivity({
      jobId,
      taskId,
      attempt: claim.record.attempt,
      effect: claim.record.effect,
      input: spec.input,
      status: "running",
      occurredAt: now,
    });

    try {
      const output = await execute(this.createSignal(taskId), this.createContext(jobId, taskId));
      await this.store.succeed(jobId, taskId, output, this.now().toISOString());
      this.publish({ type: "task.succeeded", jobId, taskId });
      await this.activities?.onTaskActivity({
        jobId,
        taskId,
        attempt: claim.record.attempt,
        effect: claim.record.effect,
        output,
        status: "succeeded",
        occurredAt: this.now().toISOString(),
      });
      return output;
    } catch (error) {
      const message = errorMessage(error);
      if (
        error instanceof UnknownTaskOutcomeError ||
        (spec.effect === TaskEffect.Unsafe && isAbort(error))
      ) {
        await this.store.markUnknown(jobId, taskId, message, this.now().toISOString());
        this.publish({ type: "task.unknown", jobId, taskId, data: { error: message } });
        await this.activities?.onTaskActivity({
          jobId,
          taskId,
          attempt: claim.record.attempt,
          effect: claim.record.effect,
          error: message,
          status: "needs_attention",
          occurredAt: this.now().toISOString(),
        });
        throw new TaskNeedsAttentionError(jobId, taskId, message);
      }
      if (spec.optional && spec.fallback) {
        const output = await spec.fallback(error);
        await this.store.degrade(jobId, taskId, output, message, this.now().toISOString());
        this.publish({ type: "task.degraded", jobId, taskId, data: { error: message } });
        await this.activities?.onTaskActivity({
          jobId,
          taskId,
          attempt: claim.record.attempt,
          effect: claim.record.effect,
          output,
          error: message,
          status: "succeeded",
          occurredAt: this.now().toISOString(),
        });
        return output;
      }
      await this.store.fail(jobId, taskId, message, this.now().toISOString());
      this.publish({ type: "task.failed", jobId, taskId, data: { error: message } });
      await this.activities?.onTaskActivity({
        jobId,
        taskId,
        attempt: claim.record.attempt,
        effect: claim.record.effect,
        error: message,
        status: "failed",
        occurredAt: this.now().toISOString(),
      });
      throw error;
    }
  }

  private async runTransient<T>(
    jobId: string,
    taskId: string,
    spec: TaskSpec<T>,
    execute: (signal: AbortSignal, task: TaskContext) => Promise<T>,
  ): Promise<T> {
    const effect = spec.effect ?? TaskEffect.Pure;
    if (effect === TaskEffect.Unsafe) {
      throw new Error(`临时任务 ${taskId} 不能执行不可安全重试的外部副作用`);
    }
    const attempt = 1;
    const startedAt = this.now().toISOString();
    this.publish({
      type: "task.started",
      jobId,
      taskId,
      data: { version: spec.version, attempt, effect, transient: true },
    });
    await this.activities?.onTaskActivity({
      jobId,
      taskId,
      attempt,
      effect,
      status: "running",
      occurredAt: startedAt,
    });
    try {
      const output = await execute(this.createSignal(taskId), this.createContext(jobId, taskId));
      this.publish({ type: "task.succeeded", jobId, taskId, data: { transient: true } });
      await this.activities?.onTaskActivity({
        jobId,
        taskId,
        attempt,
        effect,
        status: "succeeded",
        occurredAt: this.now().toISOString(),
      });
      return output;
    } catch (error) {
      const message = errorMessage(error);
      if (spec.optional && spec.fallback) {
        const output = await spec.fallback(error);
        this.publish({
          type: "task.degraded",
          jobId,
          taskId,
          data: { error: message, transient: true },
        });
        await this.activities?.onTaskActivity({
          jobId,
          taskId,
          attempt,
          effect,
          error: message,
          status: "succeeded",
          occurredAt: this.now().toISOString(),
        });
        return output;
      }
      this.publish({
        type: "task.failed",
        jobId,
        taskId,
        data: { error: message, transient: true },
      });
      await this.activities?.onTaskActivity({
        jobId,
        taskId,
        attempt,
        effect,
        error: message,
        status: "failed",
        occurredAt: this.now().toISOString(),
      });
      throw error;
    }
  }

  private publish(event: RuntimeEventDraft): void {
    this.events?.publish(event);
  }
}

function normalizeTaskId(value: string): string {
  const normalized = value
    .trim()
    .replace(/[^a-zA-Z0-9._:@/-]+/g, "-")
    .replace(/^\/+|\/+$/g, "");
  if (!normalized) throw new Error("Task id is required");
  return normalized;
}

function joinTaskId(prefix: string, id: string): string {
  return prefix ? `${prefix}/${id}` : id;
}

function errorMessage(error: unknown): string {
  return describeUnknown(error);
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"))
  );
}
