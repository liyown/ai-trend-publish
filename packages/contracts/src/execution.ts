import type { JsonObject, JsonValue } from "./json.ts";

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
  runId?: string;
  sessionId?: string;
  parentJobId?: string;
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
  runId?: string;
  sessionId?: string;
  data?: TData;
}

export const RunKind = {
  Content: "content",
  Publication: "publication",
} as const;
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

export const RunSessionKind = {
  Main: "main",
  Publication: "publication",
} as const;
export type RunSessionKind = ValueOf<typeof RunSessionKind>;

export interface RunTrigger {
  kind: RunTriggerKind;
  automationId?: string;
}

export interface RunPublicationSummary {
  total: number;
  queued: number;
  running: number;
  succeeded: number;
  failed: number;
  needsAttention: number;
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
  publicationSummary: RunPublicationSummary;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

export interface RunDestinationSnapshot {
  destinationId: string;
  accountId: string;
  accountName: string;
  channel: string;
  publicationType: string;
  options?: JsonObject;
}

export interface RunSession {
  id: string;
  runId: string;
  kind: RunSessionKind;
  status: RunStatus;
  destination?: RunDestinationSnapshot;
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

export interface ModelStreamEvent {
  id: string;
  runId: string;
  sessionId: string;
  jobId: string;
  taskId?: string;
  type: "response.started" | "response.delta" | "response.tool_delta" | "response.completed";
  occurredAt: string;
  data: JsonValue;
}
