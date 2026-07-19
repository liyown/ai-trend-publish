import {
  ArticlePipeline,
  type ArticlePipelineResult,
  type ArticleInput,
  type ArticleMetadataValue,
  type ArticleSource,
  type AssetRequest,
  type MaterialSnapshot,
  type ArticleExecutionPlan,
} from "@trendpublish/article";
import {
  ArticleResultKind,
  JobType,
  MaterialMediaType,
  WorkspaceKind,
} from "@trendpublish/contracts";
import {
  createJob,
  describeUnknown,
  fingerprint,
  finishJob,
  JobClaimKind,
  JobStatus,
  TaskNeedsAttentionError,
  TaskRunner,
  type JobClaim,
  type JobRecord,
  type JobStore,
  type RuntimeEventPublisher,
  type TaskStore,
} from "@trendpublish/runtime";
import {
  createWorkspaceEntity,
  reviseWorkspaceEntity,
  type ContentPlan,
  type StoredContentPackage,
  type StoredReviewRequest,
} from "../workspace/domain.ts";
import type { WorkspaceRepository } from "../workspace/repository.ts";
import { saveFinalArtifact } from "./artifact-persistence.ts";

export interface ContentPlanResolver {
  resolve(plan: ContentPlan): Promise<ArticleExecutionPlan>;
}

export interface GenerateArticleInput {
  planId: string;
  requestedTopic?: string;
  metadata?: Record<string, ArticleMetadataValue>;
}

export interface CompleteArticleInput {
  planId: string;
  source: ArticleSource;
  assetRequests: AssetRequest[];
  reviewRequestId: string;
}

export type ArticleJobOutput =
  | { resultKind: typeof ArticleResultKind.ContentPackage; artifactId: string }
  | { resultKind: typeof ArticleResultKind.ReviewRequest; artifactId: string }
  | {
      resultKind: typeof ArticleResultKind.NoContent;
      reason: string;
      details?: Record<string, ArticleMetadataValue>;
    };

export interface ArticleApplicationOptions {
  workspace: WorkspaceRepository;
  jobs: JobStore;
  tasks: TaskStore;
  planResolver: ContentPlanResolver;
  pipeline?: ArticlePipeline;
  now?: () => Date;
  events?: RuntimeEventPublisher;
}

export class ArticleApplication {
  private readonly pipeline: ArticlePipeline;
  private readonly now: () => Date;
  private readonly taskRunner: TaskRunner;

  constructor(private readonly options: ArticleApplicationOptions) {
    this.now = options.now ?? (() => new Date());
    this.pipeline = options.pipeline ?? new ArticlePipeline({ now: this.now });
    this.taskRunner = new TaskRunner(options.tasks, { now: this.now, events: options.events });
  }

  async generate(
    input: GenerateArticleInput,
  ): Promise<JobRecord<GenerateArticleInput, ArticleJobOutput>> {
    const job = await this.createGenerateJob(input);
    return await this.resume(job.id);
  }

  createGenerateJob(
    input: GenerateArticleInput,
    options: { jobId?: string } = {},
  ): Promise<JobRecord<GenerateArticleInput, ArticleJobOutput>> {
    const job = createJob<GenerateArticleInput, ArticleJobOutput>(
      JobType.GenerateArticle,
      input,
      this.now(),
    );
    return this.options.jobs.create(options.jobId ? { ...job, id: options.jobId } : job);
  }

  async resume(jobId: string): Promise<JobRecord<GenerateArticleInput, ArticleJobOutput>> {
    const claim = await this.claimGenerateJob(jobId);
    if (claim.kind !== JobClaimKind.Claimed) return claim.record;
    return await this.executeClaimedGenerate(claim.record);
  }

  claimGenerateJob(jobId: string): Promise<JobClaim<GenerateArticleInput, ArticleJobOutput>> {
    return this.options.jobs.claim({
      id: jobId,
      type: JobType.GenerateArticle,
      now: this.now().toISOString(),
    });
  }

  executeClaimedGenerate(
    job: JobRecord<GenerateArticleInput, ArticleJobOutput>,
  ): Promise<JobRecord<GenerateArticleInput, ArticleJobOutput>> {
    this.assertClaimed(job, JobType.GenerateArticle);
    return this.runGenerate(job);
  }

  async completeEditedSource(
    input: CompleteArticleInput,
  ): Promise<JobRecord<CompleteArticleInput, ArticleJobOutput>> {
    const job = await this.createCompletionJob(input);
    return await this.resumeCompletion(job.id);
  }

  createCompletionJob(
    input: CompleteArticleInput,
  ): Promise<JobRecord<CompleteArticleInput, ArticleJobOutput>> {
    return this.options.jobs.create(
      createJob<CompleteArticleInput, ArticleJobOutput>(JobType.CompleteArticle, input, this.now()),
    );
  }

  async resumeCompletion(
    jobId: string,
  ): Promise<JobRecord<CompleteArticleInput, ArticleJobOutput>> {
    const claim = await this.claimCompletionJob(jobId);
    if (claim.kind !== JobClaimKind.Claimed) return claim.record;
    return await this.executeClaimedCompletion(claim.record);
  }

  claimCompletionJob(jobId: string): Promise<JobClaim<CompleteArticleInput, ArticleJobOutput>> {
    return this.options.jobs.claim({
      id: jobId,
      type: JobType.CompleteArticle,
      now: this.now().toISOString(),
    });
  }

  executeClaimedCompletion(
    job: JobRecord<CompleteArticleInput, ArticleJobOutput>,
  ): Promise<JobRecord<CompleteArticleInput, ArticleJobOutput>> {
    this.assertClaimed(job, JobType.CompleteArticle);
    return this.runComplete(job);
  }

  private async runComplete(
    job: JobRecord<CompleteArticleInput, ArticleJobOutput>,
  ): Promise<JobRecord<CompleteArticleInput, ArticleJobOutput>> {
    const input = job.input;
    const running = job;
    try {
      const plan = await this.requirePlan(input.planId);
      const storedReview = await this.options.workspace.get(
        WorkspaceKind.ReviewRequest,
        input.reviewRequestId,
      );
      if (!storedReview || storedReview.status !== "open") {
        throw new Error("待审请求不存在或已经处理");
      }
      if (storedReview.planId !== plan.id) throw new Error("待审请求不属于当前内容方案");
      const executionPlan = await this.options.planResolver.resolve(plan);
      const result = await this.pipeline.complete({
        input: {
          identity: storedReview.request.identity,
          materials: storedReview.request.brief.materials,
          requestedAt: job.createdAt,
          metadata: { reviewRequestId: storedReview.id },
        },
        brief: storedReview.request.brief,
        article: {
          source: structuredClone(input.source),
          assetRequests: structuredClone(input.assetRequests),
        },
        plan: executionPlan,
        task: this.taskRunner.forJob(job.id),
      });
      return await this.finishArticleJob(running, plan, result, storedReview.id);
    } catch (error) {
      return await this.failArticleJob(running, error);
    }
  }

  private async runGenerate(
    job: JobRecord<GenerateArticleInput, ArticleJobOutput>,
  ): Promise<JobRecord<GenerateArticleInput, ArticleJobOutput>> {
    const running = job;
    try {
      const plan = await this.requirePlan(job.input.planId);
      const identity = await this.options.workspace.get(WorkspaceKind.Identity, plan.identityId);
      if (!identity || !identity.enabled) throw new Error("内容方案绑定的内容身份不存在或已禁用");
      const executionPlan = await this.options.planResolver.resolve(plan);
      const materials = await this.loadKnowledgeMaterials(plan);
      const articleInput: ArticleInput = {
        identity: {
          id: identity.id,
          name: identity.name,
          positioning: identity.positioning,
          audience: identity.audience,
          tone: identity.tone,
          forbiddenTopics: identity.forbiddenTopics,
          revision: identity.revision,
        },
        sourceSetId: [...(plan.knowledgeBaseIds ?? []), ...plan.sourceCollectionIds].join(","),
        materials,
        requestedTopic: job.input.requestedTopic,
        requestedAt: job.createdAt,
        metadata: job.input.metadata,
      };
      const result = await this.pipeline.run({
        input: articleInput,
        plan: executionPlan,
        task: this.taskRunner.forJob(job.id),
      });
      return await this.finishArticleJob(running, plan, result);
    } catch (error) {
      return await this.failArticleJob(running, error);
    }
  }

  private assertClaimed(job: JobRecord, type: string): void {
    if (job.type !== type || job.status !== JobStatus.Running) {
      throw new Error(`任务 ${job.id} 未取得执行权`);
    }
  }

  private async finishArticleJob<TInput>(
    running: JobRecord<TInput, ArticleJobOutput>,
    plan: ContentPlan,
    result: ArticlePipelineResult,
    previousReviewRequestId?: string,
  ): Promise<JobRecord<TInput, ArticleJobOutput>> {
    if (result.kind === ArticleResultKind.NoContent) {
      return await this.options.jobs.update(
        finishJob(
          running,
          JobStatus.Succeeded,
          {
            output: {
              resultKind: ArticleResultKind.NoContent,
              reason: result.noContent.reason,
              details: result.noContent.details,
            },
          },
          this.now(),
        ),
      );
    }

    if (result.kind === ArticleResultKind.ReviewRequest) {
      const stored = createWorkspaceEntity<
        Omit<StoredReviewRequest, "revision" | "createdAt" | "updatedAt">
      >(
        {
          id: result.reviewRequest.id,
          jobId: running.id,
          planId: plan.id,
          status: "open",
          request: result.reviewRequest,
        },
        this.now(),
      );
      await saveFinalArtifact(this.options.workspace, WorkspaceKind.ReviewRequest, stored);
      if (previousReviewRequestId && previousReviewRequestId !== stored.id) {
        await this.updateReviewStatus(previousReviewRequestId, "dismissed");
      }
      return await this.options.jobs.update(
        finishJob(
          running,
          JobStatus.Succeeded,
          {
            output: {
              resultKind: ArticleResultKind.ReviewRequest,
              artifactId: stored.id,
            },
          },
          this.now(),
        ),
      );
    }

    const stored = createWorkspaceEntity<
      Omit<StoredContentPackage, "revision" | "createdAt" | "updatedAt">
    >(
      {
        id: result.contentPackage.id,
        jobId: running.id,
        planId: plan.id,
        contentPackage: result.contentPackage,
      },
      this.now(),
    );
    await saveFinalArtifact(this.options.workspace, WorkspaceKind.ContentPackage, stored);
    if (previousReviewRequestId) {
      await this.updateReviewStatus(previousReviewRequestId, "resolved", stored.id);
    }
    return await this.options.jobs.update(
      finishJob(
        running,
        JobStatus.Succeeded,
        { output: { resultKind: ArticleResultKind.ContentPackage, artifactId: stored.id } },
        this.now(),
      ),
    );
  }

  private async updateReviewStatus(
    reviewRequestId: string,
    status: "resolved" | "dismissed",
    resolvedPackageId?: string,
  ): Promise<void> {
    const review = await this.options.workspace.get(WorkspaceKind.ReviewRequest, reviewRequestId);
    if (!review || review.status !== "open") return;
    await this.options.workspace.save(
      WorkspaceKind.ReviewRequest,
      reviseWorkspaceEntity(
        review,
        {
          jobId: review.jobId,
          planId: review.planId,
          status,
          request: review.request,
          ...(resolvedPackageId ? { resolvedPackageId } : {}),
        },
        this.now(),
      ),
    );
  }

  private async loadKnowledgeMaterials(plan: ContentPlan): Promise<MaterialSnapshot[]> {
    const knowledgeBases = await Promise.all(
      (plan.knowledgeBaseIds ?? []).map((id) =>
        this.options.workspace.get(WorkspaceKind.KnowledgeBase, id),
      ),
    );
    const missingKnowledgeBase = (plan.knowledgeBaseIds ?? []).find(
      (_, index) => !knowledgeBases[index],
    );
    if (missingKnowledgeBase) {
      throw new Error(`内容方案绑定的知识库不存在：${missingKnowledgeBase}`);
    }
    const materials: MaterialSnapshot[] = [];
    for (const knowledgeBase of knowledgeBases.filter((value) => value?.enabled)) {
      for (const document of knowledgeBase!.documents.filter((value) => value.content.trim())) {
        materials.push({
          id: `knowledge:${knowledgeBase!.id}:${document.id}`,
          mediaType: knowledgeMaterialType(document.mediaType),
          title: document.title,
          content: document.content,
          sourceName: knowledgeBase!.name,
          retrievedAt: knowledgeBase!.updatedAt,
          contentHash: await fingerprint({
            title: document.title,
            content: document.content,
            mediaType: document.mediaType,
          }),
          snapshotRef: `workspace:knowledge-base:${knowledgeBase!.id}@${knowledgeBase!.revision}:${document.id}`,
          metadata: {
            knowledgeBaseId: knowledgeBase!.id,
            fileName: document.fileName ?? null,
          },
        });
      }
    }
    return materials;
  }

  private async failArticleJob<TInput>(
    running: JobRecord<TInput, ArticleJobOutput>,
    error: unknown,
  ): Promise<JobRecord<TInput, ArticleJobOutput>> {
    const status =
      error instanceof TaskNeedsAttentionError ? JobStatus.NeedsAttention : JobStatus.Failed;
    return await this.options.jobs.update(
      finishJob(running, status, { error: describeUnknown(error) }, this.now()),
    );
  }

  private async requirePlan(id: string): Promise<ContentPlan> {
    const plan = await this.options.workspace.get(WorkspaceKind.ContentPlan, id);
    if (!plan || !plan.enabled) throw new Error("内容方案不存在或已禁用");
    return plan;
  }
}

function knowledgeMaterialType(mediaType?: string): MaterialSnapshot["mediaType"] {
  if (mediaType?.startsWith("image/")) return MaterialMediaType.Image;
  if (mediaType?.startsWith("video/")) return MaterialMediaType.Video;
  if (mediaType?.startsWith("audio/")) return MaterialMediaType.Audio;
  return MaterialMediaType.Document;
}
