import { JobType, PublicationBatchStatus, WorkspaceKind } from "@trendpublish/contracts";
import {
  PublicationRunner,
  type ChannelAccount as PublishingChannelAccount,
  type PublishTarget as PublishingTarget,
} from "@trendpublish/publishing";
import {
  createJob,
  describeUnknown,
  finishJob,
  JobClaimKind,
  JobStatus,
  TaskRunner,
  type JobClaim,
  type JobRecord,
  type JobStore,
  type RuntimeEventPublisher,
  type TaskStore,
} from "@trendpublish/runtime";
import {
  createWorkspaceEntity,
  type ChannelAccount as WorkspaceChannelAccount,
  type PublishTarget as WorkspacePublishTarget,
  type StoredPublication,
} from "../workspace/domain.ts";
import type { WorkspaceRepository } from "../workspace/repository.ts";
import { saveFinalArtifact } from "./artifact-persistence.ts";

export interface PublishContentInput {
  packageId: string;
  targetIds: string[];
}

export interface PublishJobOutput {
  publicationId: string;
  status: StoredPublication["batch"]["status"];
}

export interface PublishingApplicationOptions {
  workspace: WorkspaceRepository;
  jobs: JobStore;
  tasks: TaskStore;
  publishing: PublicationRunner;
  now?: () => Date;
  events?: RuntimeEventPublisher;
}

export class PublishingApplication {
  private readonly taskRunner: TaskRunner;
  private readonly now: () => Date;

  constructor(private readonly options: PublishingApplicationOptions) {
    this.now = options.now ?? (() => new Date());
    this.taskRunner = new TaskRunner(options.tasks, { now: this.now, events: options.events });
  }

  async publish(
    input: PublishContentInput,
  ): Promise<JobRecord<PublishContentInput, PublishJobOutput>> {
    const job = await this.createPublishJob(input);
    return await this.resume(job.id);
  }

  createPublishJob(
    input: PublishContentInput,
    options: { jobId?: string } = {},
  ): Promise<JobRecord<PublishContentInput, PublishJobOutput>> {
    const job = createJob<PublishContentInput, PublishJobOutput>(
      JobType.PublishContent,
      input,
      this.now(),
    );
    return this.options.jobs.create(options.jobId ? { ...job, id: options.jobId } : job);
  }

  async resume(jobId: string): Promise<JobRecord<PublishContentInput, PublishJobOutput>> {
    const claim = await this.claimPublishJob(jobId);
    if (claim.kind !== JobClaimKind.Claimed) return claim.record;
    return await this.executeClaimedPublish(claim.record);
  }

  claimPublishJob(jobId: string): Promise<JobClaim<PublishContentInput, PublishJobOutput>> {
    return this.options.jobs.claim({
      id: jobId,
      type: JobType.PublishContent,
      now: this.now().toISOString(),
    });
  }

  executeClaimedPublish(
    job: JobRecord<PublishContentInput, PublishJobOutput>,
  ): Promise<JobRecord<PublishContentInput, PublishJobOutput>> {
    if (job.type !== JobType.PublishContent || job.status !== JobStatus.Running) {
      throw new Error(`任务 ${job.id} 未取得执行权`);
    }
    return this.run(job);
  }

  private async run(
    job: JobRecord<PublishContentInput, PublishJobOutput>,
  ): Promise<JobRecord<PublishContentInput, PublishJobOutput>> {
    const running = job;
    try {
      const storedPackage = await this.options.workspace.get(
        WorkspaceKind.ContentPackage,
        job.input.packageId,
      );
      if (!storedPackage) throw new Error("内容包不存在");
      const targets = await Promise.all(
        job.input.targetIds.map((id) =>
          this.options.workspace.get(WorkspaceKind.PublishTarget, id),
        ),
      );
      if (targets.some((target) => !target)) throw new Error("发布目标不存在");
      const accounts = await Promise.all(
        [...new Set(targets.map((target) => target!.channelAccountId))].map((id) =>
          this.options.workspace.get(WorkspaceKind.ChannelAccount, id),
        ),
      );
      if (accounts.some((account) => !account)) throw new Error("发布目标绑定的渠道账号不存在");
      const batch = await this.options.publishing.publish(
        {
          contentPackage: storedPackage.contentPackage,
          targets: targets.map((target) =>
            toPublishingTarget(
              target!,
              accounts.find((account) => account!.id === target!.channelAccountId)!,
            ),
          ),
          accounts: accounts.map(toPublishingAccount),
        },
        this.taskRunner.forJob(job.id),
      );
      const publication = createWorkspaceEntity<
        Omit<StoredPublication, "revision" | "createdAt" | "updatedAt">
      >(
        {
          id: `publication-${batch.requestId.slice(0, 24)}`,
          jobId: job.id,
          packageId: storedPackage.id,
          batch,
        },
        this.now(),
      );
      await saveFinalArtifact(this.options.workspace, WorkspaceKind.Publication, publication);
      const status =
        batch.status === PublicationBatchStatus.Succeeded
          ? JobStatus.Succeeded
          : batch.status === PublicationBatchStatus.NeedsAttention
            ? JobStatus.NeedsAttention
            : batch.status === PublicationBatchStatus.Partial
              ? JobStatus.Degraded
              : JobStatus.Failed;
      return await this.options.jobs.update(
        finishJob(
          running,
          status,
          {
            output: { publicationId: publication.id, status: batch.status },
            error: status === JobStatus.Succeeded ? undefined : "部分或全部发布目标未成功",
          },
          this.now(),
        ),
      );
    } catch (error) {
      return await this.options.jobs.update(
        finishJob(running, JobStatus.Failed, { error: describeUnknown(error) }, this.now()),
      );
    }
  }
}

function toPublishingTarget(
  target: WorkspacePublishTarget,
  account: WorkspaceChannelAccount,
): PublishingTarget {
  return {
    id: target.id,
    name: target.name,
    channel: account.channel,
    channelAccountId: target.channelAccountId,
    revision: target.revision,
    config: target.settings,
  };
}

function toPublishingAccount(account: WorkspaceChannelAccount): PublishingChannelAccount {
  return {
    id: account.id,
    channel: account.channel,
    name: account.name,
    connectionId: account.connectionId,
    revision: account.revision,
    config: account.settings,
  };
}
