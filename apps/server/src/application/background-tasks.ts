import { Logger } from "@trendpublish/core/logging";
import { JobStatus, finishJob, type JobStore } from "@trendpublish/runtime";

export interface BackgroundTasks {
  start(name: string, task: () => Promise<unknown>): void;
}

/** Keeps local Node work alive after the HTTP request has returned. */
export class InProcessBackgroundTasks implements BackgroundTasks {
  private readonly active = new Map<string, Promise<unknown>>();

  constructor(private readonly logger = new Logger("background-tasks")) {}

  start(name: string, task: () => Promise<unknown>): void {
    if (this.active.has(name)) return;
    const execution = Promise.resolve()
      .then(task)
      .catch((error: unknown) => {
        this.logger.error(`后台任务 ${name} 异常退出`, { error });
      })
      .finally(() => {
        if (this.active.get(name) === execution) this.active.delete(name);
      });
    this.active.set(name, execution);
  }

  async waitForIdle(): Promise<void> {
    while (this.active.size > 0) {
      await Promise.allSettled(this.active.values());
    }
  }
}

export interface RecoverBackgroundJobsOptions {
  jobs: JobStore;
  background: BackgroundTasks;
  resumers: Readonly<Record<string, (jobId: string) => Promise<unknown>>>;
  now?: () => Date;
}

/** Reconciles durable jobs before the local runtime starts accepting requests. */
export async function recoverBackgroundJobs(options: RecoverBackgroundJobsOptions): Promise<void> {
  const now = options.now ?? (() => new Date());
  const jobs = await options.jobs.list(undefined, 10_000);
  for (const job of jobs) {
    if (job.status === JobStatus.Running) {
      await options.jobs.update(
        finishJob(
          job,
          JobStatus.NeedsAttention,
          { error: "本地服务在任务执行期间重启，已停止自动续跑；请确认外部副作用后手动恢复" },
          now(),
        ),
      );
      continue;
    }
    if (job.status !== JobStatus.Queued) continue;
    const resume = options.resumers[job.type];
    if (resume) {
      options.background.start(`recovery:${job.id}`, () => resume(job.id));
      continue;
    }
    await options.jobs.update(
      finishJob(
        job,
        JobStatus.NeedsAttention,
        { error: `没有可恢复任务类型 ${job.type} 的执行器` },
        now(),
      ),
    );
  }
}
