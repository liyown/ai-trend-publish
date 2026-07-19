type ValueOf<T> = T[keyof T];

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

export const TaskClaimKind = {
  Claimed: "claimed",
  Replay: "replay",
  Conflict: "conflict",
  Busy: "busy",
  Unknown: "unknown",
} as const;
export type TaskClaimKind = ValueOf<typeof TaskClaimKind>;
