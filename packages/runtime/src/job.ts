import { JobStatus } from "./constants.ts";
import type { RuntimeEventPublisher } from "./events.ts";

export { JobStatus } from "./constants.ts";

export interface JobRecord<TInput = unknown, TOutput = unknown> {
  id: string;
  type: string;
  status: JobStatus;
  input: TInput;
  /** Durable execution state that survives retries while output remains the final public result. */
  checkpoint?: unknown;
  output?: TOutput;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
  updatedAt: string;
}

export interface JobStore {
  create<TInput, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>>;
  get<TInput = unknown, TOutput = unknown>(id: string): Promise<JobRecord<TInput, TOutput> | null>;
  list(type?: string, limit?: number): Promise<JobRecord[]>;
  /** Atomically grants the right to execute a resumable job. */
  claim<TInput = unknown, TOutput = unknown>(
    input: JobClaimInput,
  ): Promise<JobClaim<TInput, TOutput>>;
  update<TInput = unknown, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>>;
}

export const JobClaimKind = {
  Claimed: "claimed",
  Active: "active",
  Terminal: "terminal",
} as const;
export type JobClaimKind = (typeof JobClaimKind)[keyof typeof JobClaimKind];

export interface JobClaimInput {
  id: string;
  type: string;
  now: string;
}

export interface JobClaim<TInput = unknown, TOutput = unknown> {
  kind: JobClaimKind;
  record: JobRecord<TInput, TOutput>;
  previousStatus?: JobStatus;
}

/** Publishes job lifecycle changes without coupling application services to event transport. */
export class EventedJobStore implements JobStore {
  constructor(
    private readonly store: JobStore,
    private readonly events: RuntimeEventPublisher,
  ) {}

  async create<TInput, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>> {
    const created = await this.store.create(job);
    this.publish("job.created", created);
    return created;
  }

  get<TInput = unknown, TOutput = unknown>(id: string): Promise<JobRecord<TInput, TOutput> | null> {
    return this.store.get(id);
  }

  list(type?: string, limit?: number): Promise<JobRecord[]> {
    return this.store.list(type, limit);
  }

  async claim<TInput = unknown, TOutput = unknown>(
    input: JobClaimInput,
  ): Promise<JobClaim<TInput, TOutput>> {
    const claim = await this.store.claim<TInput, TOutput>(input);
    if (claim.kind === JobClaimKind.Claimed) {
      this.publish("job.status.changed", claim.record, {
        previousStatus: claim.previousStatus,
      });
    }
    return claim;
  }

  async update<TInput = unknown, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>> {
    const previous = await this.store.get(job.id);
    const updated = await this.store.update(job);
    this.publish(
      previous?.status === updated.status ? "job.updated" : "job.status.changed",
      updated,
      {
        previousStatus: previous?.status,
      },
    );
    return updated;
  }

  private publish(type: string, job: JobRecord, extra: { previousStatus?: JobStatus } = {}): void {
    this.events.publish({
      type,
      jobId: job.id,
      data: {
        type: job.type,
        status: job.status,
        previousStatus: extra.previousStatus,
        updatedAt: job.updatedAt,
      },
    });
  }
}

export class MemoryJobStore implements JobStore {
  private readonly jobs = new Map<string, JobRecord>();

  constructor(initial: JobRecord[] = []) {
    for (const job of initial) this.jobs.set(job.id, structuredClone(job));
  }

  create<TInput, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>> {
    if (this.jobs.has(job.id)) throw new Error(`任务已存在：${job.id}`);
    this.jobs.set(job.id, structuredClone(job));
    return Promise.resolve(structuredClone(job));
  }

  get<TInput = unknown, TOutput = unknown>(id: string): Promise<JobRecord<TInput, TOutput> | null> {
    const job = this.jobs.get(id);
    return Promise.resolve(job ? (structuredClone(job) as JobRecord<TInput, TOutput>) : null);
  }

  list(type?: string, limit = 100): Promise<JobRecord[]> {
    return Promise.resolve(
      [...this.jobs.values()]
        .filter((job) => !type || job.type === type)
        .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
        .slice(0, limit)
        .map((job) => structuredClone(job)),
    );
  }

  claim<TInput = unknown, TOutput = unknown>(
    input: JobClaimInput,
  ): Promise<JobClaim<TInput, TOutput>> {
    const current = this.jobs.get(input.id);
    if (!current) throw new Error(`任务不存在：${input.id}`);
    const claim = decideJobClaim<TInput, TOutput>(
      structuredClone(current) as JobRecord<TInput, TOutput>,
      input,
    );
    if (claim.kind === JobClaimKind.Claimed) {
      this.jobs.set(input.id, structuredClone(claim.record));
    }
    return Promise.resolve(structuredClone(claim));
  }

  update<TInput = unknown, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>> {
    if (!this.jobs.has(job.id)) throw new Error(`任务不存在：${job.id}`);
    this.jobs.set(job.id, structuredClone(job));
    return Promise.resolve(structuredClone(job));
  }
}

export function createJob<TInput, TOutput = unknown>(
  type: string,
  input: TInput,
  now = new Date(),
): JobRecord<TInput, TOutput> {
  const timestamp = now.toISOString();
  return {
    id: `job-${crypto.randomUUID()}`,
    type,
    status: JobStatus.Queued,
    input: structuredClone(input),
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

export function startJob<TInput, TOutput>(
  job: JobRecord<TInput, TOutput>,
  now = new Date(),
): JobRecord<TInput, TOutput> {
  const timestamp = now.toISOString();
  return {
    ...job,
    status: JobStatus.Running,
    output: undefined,
    error: undefined,
    startedAt: timestamp,
    finishedAt: undefined,
    updatedAt: timestamp,
  };
}

export function decideJobClaim<TInput = unknown, TOutput = unknown>(
  current: JobRecord<TInput, TOutput>,
  input: JobClaimInput,
): JobClaim<TInput, TOutput> {
  if (current.type !== input.type) {
    throw new Error(`任务类型不匹配：期望 ${input.type}，实际 ${current.type}`);
  }
  if (current.status === JobStatus.Running) {
    return { kind: JobClaimKind.Active, record: current };
  }
  if (current.status === JobStatus.Succeeded || current.status === JobStatus.Degraded) {
    return { kind: JobClaimKind.Terminal, record: current };
  }
  return {
    kind: JobClaimKind.Claimed,
    record: startJob(current, new Date(input.now)),
    previousStatus: current.status,
  };
}

export function finishJob<TInput, TOutput>(
  job: JobRecord<TInput, TOutput>,
  status: Extract<
    JobStatus,
    | typeof JobStatus.Succeeded
    | typeof JobStatus.Degraded
    | typeof JobStatus.Failed
    | typeof JobStatus.NeedsAttention
  >,
  options: { output?: TOutput; error?: string } = {},
  now = new Date(),
): JobRecord<TInput, TOutput> {
  const timestamp = now.toISOString();
  return {
    ...job,
    status,
    output: options.output,
    error: options.error,
    finishedAt: timestamp,
    updatedAt: timestamp,
  };
}
