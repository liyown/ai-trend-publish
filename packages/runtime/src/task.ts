import { TaskClaimKind, type TaskEffect, type TaskStatus } from "./constants.ts";

export { TaskEffect, TaskStatus } from "./constants.ts";

export interface TaskRecord<T = unknown> {
  jobId: string;
  taskId: string;
  fingerprint: string;
  version: string;
  effect: TaskEffect;
  status: TaskStatus;
  attempt: number;
  output?: T;
  error?: string;
  startedAt: string;
  updatedAt: string;
  finishedAt?: string;
  leaseExpiresAt?: string;
}

export interface TaskClaimInput {
  jobId: string;
  taskId: string;
  fingerprint: string;
  version: string;
  effect: TaskEffect;
  leaseMs: number;
  now: string;
}

export type TaskClaim<T = unknown> =
  | { kind: typeof TaskClaimKind.Claimed; record: TaskRecord<T> }
  | { kind: typeof TaskClaimKind.Replay; record: TaskRecord<T> }
  | { kind: typeof TaskClaimKind.Conflict; record: TaskRecord<T> }
  | { kind: typeof TaskClaimKind.Busy; record: TaskRecord<T> }
  | { kind: typeof TaskClaimKind.Unknown; record: TaskRecord<T> };

export interface TaskStore {
  claim<T = unknown>(input: TaskClaimInput): Promise<TaskClaim<T>>;
  succeed<T>(jobId: string, taskId: string, output: T, now: string): Promise<TaskRecord<T>>;
  degrade<T>(
    jobId: string,
    taskId: string,
    output: T,
    error: string,
    now: string,
  ): Promise<TaskRecord<T>>;
  fail(jobId: string, taskId: string, error: string, now: string): Promise<TaskRecord>;
  markUnknown(jobId: string, taskId: string, error: string, now: string): Promise<TaskRecord>;
  get<T = unknown>(jobId: string, taskId: string): Promise<TaskRecord<T> | null>;
  list(jobId: string): Promise<TaskRecord[]>;
}

export interface TaskSpec<T> {
  id: string;
  version: string;
  input: unknown;
  effect?: TaskEffect;
  optional?: boolean;
  fallback?: (error: unknown) => T | Promise<T>;
}

export interface TaskContext {
  readonly jobId: string;
  readonly taskId?: string;
  run<T>(
    spec: TaskSpec<T>,
    execute: (signal: AbortSignal, task: TaskContext) => Promise<T>,
  ): Promise<T>;
  scope(prefix: string): TaskContext;
  emit<T = unknown>(type: string, data?: T): void;
}

export class TaskFingerprintConflictError extends Error {
  constructor(
    readonly jobId: string,
    readonly taskId: string,
  ) {
    super(`任务 ${jobId}/${taskId} 的输入或实现版本已改变，不能复用旧检查点`);
    this.name = "TaskFingerprintConflictError";
  }
}

export class TaskBusyError extends Error {
  constructor(
    readonly jobId: string,
    readonly taskId: string,
  ) {
    super(`任务 ${jobId}/${taskId} 正在由其他执行器处理`);
    this.name = "TaskBusyError";
  }
}

export class UnknownTaskOutcomeError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "UnknownTaskOutcomeError";
  }
}

export class TaskNeedsAttentionError extends Error {
  constructor(
    readonly jobId: string,
    readonly taskId: string,
    message: string,
  ) {
    super(message);
    this.name = "TaskNeedsAttentionError";
  }
}
