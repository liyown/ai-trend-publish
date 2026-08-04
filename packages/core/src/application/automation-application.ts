import { JobType, WorkspaceKind } from "@trendpublish/contracts";
import {
  createJob,
  describeUnknown,
  finishJob,
  JobClaimKind,
  JobStatus,
  TaskNeedsAttentionError,
  type JobClaim,
  type JobRecord,
  type JobStore,
  type RuntimeEvent,
  type RuntimeEventSource,
} from "@trendpublish/runtime";
import type {
  ArticleApplication,
  ArticleJobOutput,
  GenerateArticleInput,
} from "@trendpublish/article/application";
import type { ArticleMetadataValue } from "@trendpublish/article";
import type {
  PublishingApplication,
  PublishContentInput,
  PublishJobOutput,
} from "./publishing-application.ts";
import type { WorkspaceRepository } from "../workspace/repository.ts";

export interface RunAutomationInput {
  automationId?: string;
  /** Internal manual-run entrypoint; public automation requests continue to use automationId. */
  contentPlanId?: string;
  requestedTopic?: string;
  metadata?: Record<string, ArticleMetadataValue>;
}

export interface AutomationRunOutput {
  automationId?: string;
  articleJobId: string;
  articleResultKind: ArticleJobOutput["resultKind"];
  packageId?: string;
  publicationJobId?: string;
}

interface AutomationRunCheckpoint {
  version: 1;
  articleJobId?: string;
  publicationJobId?: string;
}

export interface AutomationApplicationOptions {
  workspace: WorkspaceRepository;
  jobs: JobStore;
  articles: ArticleApplication;
  publishing: PublishingApplication;
  events?: RuntimeEventSource;
  now?: () => Date;
}

export class AutomationApplication {
  private readonly now: () => Date;

  constructor(private readonly options: AutomationApplicationOptions) {
    this.now = options.now ?? (() => new Date());
  }

  async run(
    input: RunAutomationInput,
  ): Promise<JobRecord<RunAutomationInput, AutomationRunOutput>> {
    const job = await this.createRunJob(input);
    return await this.resume(job.id);
  }

  createRunJob(
    input: RunAutomationInput,
    options: { runId?: string } = {},
  ): Promise<JobRecord<RunAutomationInput, AutomationRunOutput>> {
    return this.options.jobs.create(
      createJob<RunAutomationInput, AutomationRunOutput>(JobType.RunAutomation, input, this.now(), {
        runId: options.runId,
      }),
    );
  }

  async resume(jobId: string): Promise<JobRecord<RunAutomationInput, AutomationRunOutput>> {
    const claim = await this.claimRunJob(jobId);
    if (claim.kind !== JobClaimKind.Claimed) return claim.record;
    return await this.executeClaimedRun(claim.record);
  }

  claimRunJob(jobId: string): Promise<JobClaim<RunAutomationInput, AutomationRunOutput>> {
    return this.options.jobs.claim({
      id: jobId,
      type: JobType.RunAutomation,
      now: this.now().toISOString(),
    });
  }

  executeClaimedRun(
    job: JobRecord<RunAutomationInput, AutomationRunOutput>,
  ): Promise<JobRecord<RunAutomationInput, AutomationRunOutput>> {
    if (job.type !== JobType.RunAutomation || job.status !== JobStatus.Running) {
      throw new Error(`任务 ${job.id} 未取得执行权`);
    }
    return this.execute(job);
  }

  private async execute(
    job: JobRecord<RunAutomationInput, AutomationRunOutput>,
  ): Promise<JobRecord<RunAutomationInput, AutomationRunOutput>> {
    const input = job.input;
    let running = job;
    try {
      const automation = input.automationId
        ? await this.options.workspace.get(WorkspaceKind.Automation, input.automationId)
        : undefined;
      if (input.automationId && (!automation || !automation.enabled)) {
        throw new Error("自动化任务不存在或已停用");
      }
      const contentPlanId = automation?.contentPlanId ?? input.contentPlanId;
      if (!contentPlanId) throw new Error("运行没有绑定内容方案");
      const plan = await this.options.workspace.get(WorkspaceKind.ContentPlan, contentPlanId);
      if (!plan || !plan.enabled) throw new Error("内容方案不存在或已停用");

      const articleInput: GenerateArticleInput = {
        planId: contentPlanId,
        requestedTopic: input.requestedTopic,
        metadata: {
          ...input.metadata,
          ...(automation
            ? {
                automationId: automation.id,
                instructions: automation.instructions,
                keywords: automation.keywords,
              }
            : {}),
        },
      };
      const preparedArticle = await this.prepareChildJob<GenerateArticleInput, ArticleJobOutput>(
        running,
        "articleJobId",
        JobType.GenerateArticle,
        (jobId) =>
          this.options.articles.createGenerateJob(articleInput, {
            jobId,
            runId: running.runId,
            sessionId: running.runId ? `${running.runId}:main` : undefined,
            parentJobId: running.id,
          }),
      );
      running = preparedArticle.outerJob;
      const articleJob = preparedArticle.childJob;
      const completedArticleJob = await this.runChildJob(running, articleJob, "article", () =>
        this.options.articles.resume(articleJob.id),
      );
      const output = automationOutputFromArticle(automation?.id, completedArticleJob);
      if (completedArticleJob.status !== JobStatus.Succeeded) {
        return await this.finishFromChild(running, completedArticleJob, "内容生成", output);
      }
      if (!output || !completedArticleJob.output) throw new Error("内容生成未返回有效结果");
      if (!output.packageId) throw new Error("内容生成未返回内容包");
      if (plan.publishing.destinations.length) {
        const publicationInput: PublishContentInput = {
          packageId: output.packageId,
          destinations: plan.publishing.destinations,
        };
        const preparedPublication = await this.prepareChildJob<
          PublishContentInput,
          PublishJobOutput
        >(running, "publicationJobId", JobType.PublishContent, (jobId) =>
          this.options.publishing.createPublishJob(publicationInput, {
            jobId,
            runId: running.runId,
            parentJobId: running.id,
          }),
        );
        running = preparedPublication.outerJob;
        const publicationJob = preparedPublication.childJob;
        const completedPublicationJob = await this.runChildJob(
          running,
          publicationJob,
          "publication",
          () => this.options.publishing.resume(publicationJob.id),
        );
        output.publicationJobId = completedPublicationJob.id;
        if (completedPublicationJob.status !== JobStatus.Succeeded) {
          return await this.finishFromChild(running, completedPublicationJob, "内容发布", output);
        }
      }

      return await this.options.jobs.update(
        finishJob(running, JobStatus.Succeeded, { output }, this.now()),
      );
    } catch (error) {
      return await this.options.jobs.update(
        finishJob(
          running,
          error instanceof TaskNeedsAttentionError ? JobStatus.NeedsAttention : JobStatus.Failed,
          { error: describeUnknown(error) },
          this.now(),
        ),
      );
    }
  }

  private async prepareChildJob<TInput, TOutput>(
    outerJob: JobRecord<RunAutomationInput, AutomationRunOutput>,
    checkpointKey: "articleJobId" | "publicationJobId",
    expectedType: string,
    create: (jobId: string) => Promise<JobRecord<TInput, TOutput>>,
  ): Promise<{
    outerJob: JobRecord<RunAutomationInput, AutomationRunOutput>;
    childJob: JobRecord<TInput, TOutput>;
  }> {
    const checkpoint = automationCheckpoint(outerJob);
    const checkpointJobId = checkpoint[checkpointKey];
    const stableJobId = automationChildJobId(outerJob.id, checkpointKey);
    const childJobId = checkpointJobId ?? stableJobId;
    let childJob = await this.options.jobs.get<TInput, TOutput>(childJobId);

    if (!childJob && checkpointJobId) {
      throw new TaskNeedsAttentionError(
        outerJob.id,
        checkpointKey,
        `自动化已记录的子任务不存在：${checkpointJobId}`,
      );
    }
    if (!childJob) {
      try {
        childJob = await create(stableJobId);
      } catch (error) {
        // The child may have been committed immediately before a process interruption.
        childJob = await this.options.jobs.get<TInput, TOutput>(stableJobId);
        if (!childJob) throw error;
      }
    }
    if (childJob.type !== expectedType) {
      throw new TaskNeedsAttentionError(
        outerJob.id,
        checkpointKey,
        `自动化子任务类型不匹配：期望 ${expectedType}，实际 ${childJob.type}`,
      );
    }

    const persistedOuter = await this.persistChildCheckpoint(outerJob, checkpointKey, childJob.id);
    return { outerJob: persistedOuter, childJob };
  }

  private async persistChildCheckpoint(
    outerJob: JobRecord<RunAutomationInput, AutomationRunOutput>,
    checkpointKey: "articleJobId" | "publicationJobId",
    childJobId: string,
  ): Promise<JobRecord<RunAutomationInput, AutomationRunOutput>> {
    const checkpoint = automationCheckpoint(outerJob);
    if (checkpoint[checkpointKey] === childJobId) return outerJob;
    return await this.options.jobs.update({
      ...outerJob,
      checkpoint: { ...checkpoint, version: 1, [checkpointKey]: childJobId },
      updatedAt: this.now().toISOString(),
    });
  }

  private async finishFromChild<TInput, TOutput>(
    outerJob: JobRecord<RunAutomationInput, AutomationRunOutput>,
    childJob: JobRecord<TInput, TOutput>,
    label: string,
    output?: AutomationRunOutput,
  ): Promise<JobRecord<RunAutomationInput, AutomationRunOutput>> {
    return await this.options.jobs.update(
      finishJob(
        outerJob,
        outerStatusFromChild(childJob.status),
        {
          output,
          error: childJob.error || childStatusMessage(label, childJob.status),
        },
        this.now(),
      ),
    );
  }

  private async runChildJob<TInput, TOutput>(
    outerJob: JobRecord<RunAutomationInput, AutomationRunOutput>,
    childJob: JobRecord<TInput, TOutput>,
    taskPrefix: string,
    resume: () => Promise<JobRecord<TInput, TOutput>>,
  ): Promise<JobRecord<TInput, TOutput>> {
    const stopBridge = this.bridgeChildEvents(outerJob.id, childJob, taskPrefix);
    this.publishChildBoundary("automation.child.started", outerJob.id, childJob);
    try {
      const completed = isSettledChildStatus(childJob.status) ? childJob : await resume();
      this.publishChildBoundary("automation.child.completed", outerJob.id, completed);
      return completed;
    } catch (error) {
      this.publishChildBoundary("automation.child.completed", outerJob.id, childJob, {
        status: JobStatus.Failed,
        error: describeUnknown(error),
      });
      throw error;
    } finally {
      stopBridge();
    }
  }

  private bridgeChildEvents(
    outerJobId: string,
    childJob: JobRecord,
    taskPrefix: string,
  ): () => void {
    const events = this.options.events;
    if (!events || childJob.id === outerJobId) return () => undefined;

    const forwardedIds = new Set<string>();
    const forward = (event: RuntimeEvent): void => {
      if (
        event.jobId !== childJob.id ||
        forwardedIds.has(event.id) ||
        !isObservableChildEvent(event.type)
      ) {
        return;
      }
      forwardedIds.add(event.id);
      events.publish({
        type: event.type,
        jobId: outerJobId,
        ...(event.taskId ? { taskId: `${taskPrefix}/${event.taskId}` } : {}),
        data: childEventData(event, childJob),
      });
    };

    const unsubscribe = events.subscribe(forward, { jobId: childJob.id });
    for (const event of events.recent({ jobId: childJob.id })) forward(event);
    return unsubscribe;
  }

  private publishChildBoundary(
    type: "automation.child.started" | "automation.child.completed",
    outerJobId: string,
    childJob: JobRecord,
    override: { status?: JobStatus; error?: string } = {},
  ): void {
    this.options.events?.publish({
      type,
      jobId: outerJobId,
      data: {
        sourceJobId: childJob.id,
        sourceJobType: childJob.type,
        status: override.status ?? childJob.status,
        ...((override.error ?? childJob.error) ? { error: override.error ?? childJob.error } : {}),
      },
    });
  }
}

function isObservableChildEvent(type: string): boolean {
  return ["task.", "model.", "connector.", "job."].some((prefix) => type.startsWith(prefix));
}

function automationCheckpoint(
  job: JobRecord<RunAutomationInput, AutomationRunOutput>,
): AutomationRunCheckpoint {
  if (!isRecord(job.checkpoint)) return { version: 1 };
  return {
    version: 1,
    ...(typeof job.checkpoint.articleJobId === "string"
      ? { articleJobId: job.checkpoint.articleJobId }
      : {}),
    ...(typeof job.checkpoint.publicationJobId === "string"
      ? { publicationJobId: job.checkpoint.publicationJobId }
      : {}),
  };
}

function automationChildJobId(
  outerJobId: string,
  checkpointKey: "articleJobId" | "publicationJobId",
): string {
  return `${outerJobId}:${checkpointKey === "articleJobId" ? "article" : "publication"}`;
}

function automationOutputFromArticle(
  automationId: string | undefined,
  articleJob: JobRecord<unknown, ArticleJobOutput>,
): AutomationRunOutput | undefined {
  const article = articleJob.output;
  if (!article) return undefined;
  const output: AutomationRunOutput = {
    ...(automationId ? { automationId } : {}),
    articleJobId: articleJob.id,
    articleResultKind: article.resultKind,
  };
  output.packageId = article.artifactId;
  return output;
}

function isSettledChildStatus(status: JobRecord["status"]): boolean {
  return (
    status === JobStatus.Succeeded ||
    status === JobStatus.Degraded ||
    status === JobStatus.NeedsAttention
  );
}

function outerStatusFromChild(
  status: JobRecord["status"],
): typeof JobStatus.Failed | typeof JobStatus.Degraded | typeof JobStatus.NeedsAttention {
  if (status === JobStatus.Degraded) return JobStatus.Degraded;
  if (
    status === JobStatus.NeedsAttention ||
    status === JobStatus.Queued ||
    status === JobStatus.Running
  ) {
    return JobStatus.NeedsAttention;
  }
  return JobStatus.Failed;
}

function childStatusMessage(label: string, status: JobRecord["status"]): string {
  if (status === JobStatus.Degraded) return `${label}仅部分完成`;
  if (status === JobStatus.NeedsAttention) return `${label}需要人工确认`;
  if (status === JobStatus.Running || status === JobStatus.Queued) {
    return `${label}子任务仍在执行，未重复启动`;
  }
  return `${label}未完成`;
}

function childEventData(event: RuntimeEvent, childJob: JobRecord): Record<string, unknown> {
  const source = {
    sourceJobId: childJob.id,
    sourceJobType: childJob.type,
  };
  if (isRecord(event.data)) return { ...event.data, ...source };
  if (event.data === undefined) return source;
  return { ...source, sourceData: event.data };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
