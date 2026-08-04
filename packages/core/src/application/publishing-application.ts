import { JobType, PublicationBatchStatus, WorkspaceKind } from "@trendpublish/contracts";
import {
  PublicationRunner,
  type ChannelAccount as PublishingChannelAccount,
  type PublicationDestination as PublishingDestination,
} from "@trendpublish/publishing";
import {
  createJob,
  describeUnknown,
  finishJob,
  fingerprint,
  JobClaimKind,
  JobStatus,
  TaskRunner,
  type JobClaim,
  type JobRecord,
  type JobStore,
  type RuntimeEventPublisher,
  type RunManager,
  type TaskStore,
} from "@trendpublish/runtime";
import {
  createWorkspaceEntity,
  type ChannelAccount as WorkspaceChannelAccount,
  type StoredPublication,
} from "../workspace/domain.ts";
import type { PublicationDestinationSelection } from "@trendpublish/contracts";
import type { WorkspaceRepository } from "../workspace/repository.ts";
import { saveFinalArtifact } from "./artifact-persistence.ts";

export interface PublishContentInput {
  packageId: string;
  destinations: PublicationDestinationSelection[];
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
  runs?: Pick<RunManager, "onTaskActivity">;
}

export class PublishingApplication {
  private readonly taskRunner: TaskRunner;
  private readonly now: () => Date;

  constructor(private readonly options: PublishingApplicationOptions) {
    this.now = options.now ?? (() => new Date());
    this.taskRunner = new TaskRunner(options.tasks, {
      now: this.now,
      events: options.events,
      activities: options.runs,
    });
  }

  async publish(
    input: PublishContentInput,
  ): Promise<JobRecord<PublishContentInput, PublishJobOutput>> {
    const job = await this.createPublishJob(input);
    return await this.resume(job.id);
  }

  createPublishJob(
    input: PublishContentInput,
    options: { jobId?: string; runId?: string; sessionId?: string; parentJobId?: string } = {},
  ): Promise<JobRecord<PublishContentInput, PublishJobOutput>> {
    const job = createJob<PublishContentInput, PublishJobOutput>(
      JobType.PublishContent,
      input,
      this.now(),
      { runId: options.runId, sessionId: options.sessionId, parentJobId: options.parentJobId },
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
      const accountIds = [...new Set(job.input.destinations.map((item) => item.accountId))];
      const accounts = await Promise.all(
        accountIds.map((id) => this.options.workspace.get(WorkspaceKind.ChannelAccount, id)),
      );
      if (accounts.some((account) => !account)) throw new Error("发布账号不存在");
      if (accounts.some((account) => account!.enabled === false)) throw new Error("发布账号已停用");
      const destinations = await Promise.all(
        job.input.destinations.map(async (selection) => {
          const account = accounts.find((item) => item!.id === selection.accountId)!;
          return await toPublishingDestination(selection, account);
        }),
      );
      const batch = await this.options.publishing.publish(
        {
          contentPackage: storedPackage.contentPackage,
          destinations,
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
            error: status === JobStatus.Succeeded ? undefined : "部分或全部发布目的地未成功",
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

async function toPublishingDestination(
  selection: PublicationDestinationSelection,
  account: WorkspaceChannelAccount,
): Promise<PublishingDestination> {
  const identity = {
    accountId: account.id,
    channel: account.channel,
    publicationType: selection.publicationType,
    options: selection.options ?? {},
  };
  const checksum = await fingerprint(identity);
  return {
    id: `destination_${checksum.slice(0, 24)}`,
    channel: account.channel,
    accountId: account.id,
    publicationType: selection.publicationType,
    options: selection.options,
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
    publisher: account.publisher,
  };
}
