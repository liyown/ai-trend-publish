type ValueOf<T> = T[keyof T];

export const JobType = {
  GenerateArticle: "article.generate",
  CompleteArticle: "article.complete",
  PublishContent: "content.publish",
  RunAutomation: "automation.run",
} as const;
export type JobType = ValueOf<typeof JobType>;

/** Status values exposed by the HTTP execution contract. Runtime owns its internal equivalent. */
export const JobStatus = {
  Queued: "queued",
  Running: "running",
  Succeeded: "succeeded",
  Degraded: "degraded",
  Failed: "failed",
  NeedsAttention: "needs_attention",
} as const;
export type JobStatus = ValueOf<typeof JobStatus>;

export const TaskEffect = {
  Pure: "pure",
  Idempotent: "idempotent",
  Unsafe: "unsafe",
} as const;
export type TaskEffect = ValueOf<typeof TaskEffect>;

export const TaskStatus = {
  Running: "running",
  Succeeded: "succeeded",
  Degraded: "degraded",
  Failed: "failed",
  Unknown: "unknown",
} as const;
export type TaskStatus = ValueOf<typeof TaskStatus>;

/** Durable execution record serialized by the HTTP API. */
export interface JobRecord<TInput = unknown, TOutput = unknown> {
  id: string;
  type: string;
  status: JobStatus;
  input: TInput;
  checkpoint?: unknown;
  output?: TOutput;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

/** Replayable execution step serialized by the HTTP API. */
export interface TaskRecord<TOutput = unknown> {
  jobId: string;
  taskId: string;
  fingerprint: string;
  version: string;
  status: TaskStatus;
  effect: TaskEffect;
  attempt: number;
  output?: TOutput;
  error?: string;
  startedAt: string;
  finishedAt?: string;
  updatedAt: string;
  leaseExpiresAt?: string;
}

export interface RuntimeEvent<TData = unknown> {
  id: string;
  type: string;
  occurredAt: string;
  jobId?: string;
  taskId?: string;
  data?: TData;
}
