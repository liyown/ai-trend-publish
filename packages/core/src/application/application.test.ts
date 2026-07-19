import { test } from "vite-plus/test";
import type {
  ArticleEvaluator,
  EditorialBrief,
  ArticleExecutionPlan,
  WorkingArticle,
} from "@trendpublish/article";
import { ArticleSourceFormat } from "@trendpublish/contracts";
import {
  ChannelAdapterRegistry,
  PublicationRunner,
  type ChannelAdapter,
} from "@trendpublish/publishing";
import {
  MemoryJobStore,
  MemoryTaskStore,
  type JobClaim,
  type JobClaimInput,
  type JobRecord,
  type JobStore,
} from "@trendpublish/runtime";
import { assert, assertEquals } from "../test/assert.ts";
import { createWorkspaceEntity, reviseWorkspaceEntity } from "../workspace/domain.ts";
import { MemoryWorkspaceRepository } from "../workspace/repository.ts";
import { ArticleApplication } from "./article-application.ts";
import { PublishingApplication } from "./publishing-application.ts";

test("content generation and multi-target publication form one recoverable vertical slice", async () => {
  const { workspace, plan } = await workspaceFixture();
  const jobs = new MemoryJobStore();
  const tasks = new MemoryTaskStore();
  const articles = new ArticleApplication({
    workspace,
    jobs,
    tasks,
    planResolver: { resolve: async () => successfulPlan(plan.id, plan.revision) },
  });

  const articleJob = await articles.generate({ planId: plan.id });
  assertEquals(articleJob.status, "succeeded");
  if (articleJob.output?.resultKind !== "content-package") {
    throw new Error("article package was not ready");
  }
  const packageId = articleJob.output.artifactId;
  assert(await workspace.get("content-package", packageId));

  for (const accountId of ["account-a", "account-b"]) {
    await workspace.save(
      "channel-account",
      createWorkspaceEntity({
        id: accountId,
        name: accountId,
        channel: "test-channel",
        connectionId: `connection-${accountId}`,
        settings: {},
      }),
    );
    await workspace.save(
      "publish-target",
      createWorkspaceEntity({
        id: `target-${accountId}`,
        name: `目标 ${accountId}`,
        channelAccountId: accountId,
        settings: {},
      }),
    );
  }

  const publishing = new PublishingApplication({
    workspace,
    jobs,
    tasks,
    publishing: new PublicationRunner(new ChannelAdapterRegistry([successfulChannelAdapter()])),
  });
  const publishJob = await publishing.publish({
    packageId,
    targetIds: ["target-account-a", "target-account-b"],
  });
  assertEquals(publishJob.status, "succeeded");
  assertEquals(publishJob.output?.status, "succeeded");
  const publications = await workspace.list("publication");
  assertEquals(publications.length, 1);
  assertEquals(publications[0].batch.targets.length, 2);
});

test("article generation job can be created before execution starts", async () => {
  const { workspace, plan } = await workspaceFixture();
  const jobs = new MemoryJobStore();
  const articles = new ArticleApplication({
    workspace,
    jobs,
    tasks: new MemoryTaskStore(),
    planResolver: { resolve: async () => successfulPlan(plan.id, plan.revision) },
  });

  const queued = await articles.createGenerateJob({ planId: plan.id });

  assertEquals(queued.status, "queued");
  assertEquals((await jobs.get(queued.id))?.status, "queued");
  assertEquals((await workspace.list("content-package")).length, 0);
});

test("concurrent article resumes execute a claimed job only once", async () => {
  const { workspace, plan } = await workspaceFixture();
  const jobs = new MemoryJobStore();
  let compileCalls = 0;
  const articles = new ArticleApplication({
    workspace,
    jobs,
    tasks: new MemoryTaskStore(),
    planResolver: {
      resolve: async () => {
        compileCalls += 1;
        await Promise.resolve();
        return successfulPlan(plan.id, plan.revision);
      },
    },
  });
  const queued = await articles.createGenerateJob({ planId: plan.id });

  await Promise.all([articles.resume(queued.id), articles.resume(queued.id)]);

  assertEquals(compileCalls, 1);
  assertEquals((await jobs.get(queued.id))?.status, "succeeded");
  assertEquals((await workspace.list("content-package")).length, 1);
});

test("content diagnostics create a review request without changing execution status", async () => {
  const { workspace, plan } = await workspaceFixture();
  const articles = new ArticleApplication({
    workspace,
    jobs: new MemoryJobStore(),
    tasks: new MemoryTaskStore(),
    planResolver: {
      resolve: async () => ({
        ...successfulPlan(plan.id, plan.revision),
        evaluators: [blockingEvaluator()],
        reviser: undefined,
      }),
    },
  });

  const job = await articles.generate({ planId: plan.id });

  assertEquals(job.status, "succeeded");
  assertEquals(job.output?.resultKind, "review-request");
  assertEquals((await workspace.list("review-request")).length, 1);
});

test("article resume reuses an identical content package saved before the job checkpoint", async () => {
  const { workspace, plan } = await workspaceFixture();
  const jobs = new FailOnceOnSuccessfulUpdateJobStore();
  const articles = new ArticleApplication({
    workspace,
    jobs,
    tasks: new MemoryTaskStore(),
    planResolver: { resolve: async () => successfulPlan(plan.id, plan.revision) },
  });

  const interrupted = await articles.generate({ planId: plan.id });
  assertEquals(interrupted.status, "failed");
  const saved = await workspace.list("content-package");
  assertEquals(saved.length, 1);

  const resumed = await articles.resume(interrupted.id);

  assertEquals(resumed.status, "succeeded");
  if (resumed.output?.resultKind !== "content-package") {
    throw new Error("content package was not recovered");
  }
  assertEquals(resumed.output.artifactId, saved[0].id);
  assertEquals((await workspace.list("content-package")).length, 1);
});

test("article resume keeps revision conflicts for a changed content package", async () => {
  const { workspace, plan } = await workspaceFixture();
  const jobs = new FailOnceOnSuccessfulUpdateJobStore();
  const articles = new ArticleApplication({
    workspace,
    jobs,
    tasks: new MemoryTaskStore(),
    planResolver: { resolve: async () => successfulPlan(plan.id, plan.revision) },
  });

  const interrupted = await articles.generate({ planId: plan.id });
  const [saved] = await workspace.list("content-package");
  await workspace.save(
    "content-package",
    reviseWorkspaceEntity(
      saved,
      {
        jobId: saved.jobId,
        planId: "different-plan",
        contentPackage: saved.contentPackage,
      },
      new Date("2026-07-18T01:00:00.000Z"),
    ),
  );

  const resumed = await articles.resume(interrupted.id);

  assertEquals(resumed.status, "failed");
  assert(resumed.error?.includes("已更新"));
  assertEquals((await workspace.get("content-package", saved.id))?.planId, "different-plan");
});

test("article resume reuses an identical review request saved before the job checkpoint", async () => {
  const { workspace, plan } = await workspaceFixture();
  const jobs = new FailOnceOnSuccessfulUpdateJobStore();
  const articles = new ArticleApplication({
    workspace,
    jobs,
    tasks: new MemoryTaskStore(),
    planResolver: {
      resolve: async () => ({
        ...successfulPlan(plan.id, plan.revision),
        evaluators: [blockingEvaluator()],
        reviser: undefined,
      }),
    },
  });

  const interrupted = await articles.generate({ planId: plan.id });
  assertEquals(interrupted.status, "failed");
  const saved = await workspace.list("review-request");
  assertEquals(saved.length, 1);

  const resumed = await articles.resume(interrupted.id);

  assertEquals(resumed.status, "succeeded");
  if (resumed.output?.resultKind !== "review-request") {
    throw new Error("review request was not recovered");
  }
  assertEquals(resumed.output.artifactId, saved[0].id);
  assertEquals((await workspace.list("review-request")).length, 1);
});

test("no content is a successful business outcome and creates no artifact", async () => {
  const { workspace, plan } = await workspaceFixture();
  const prepared = successfulPlan(plan.id, plan.revision);
  prepared.researcher = {
    id: "no-content-researcher",
    version: "1",
    async research() {
      return { kind: "no-content", noContent: { reason: "今天没有值得发布的变化" } };
    },
  };
  const articles = new ArticleApplication({
    workspace,
    jobs: new MemoryJobStore(),
    tasks: new MemoryTaskStore(),
    planResolver: { resolve: async () => prepared },
  });

  const job = await articles.generate({ planId: plan.id });

  assertEquals(job.status, "succeeded");
  assertEquals(job.output?.resultKind, "no-content");
  assertEquals((await workspace.list("content-package")).length, 0);
  assertEquals((await workspace.list("review-request")).length, 0);
});

test("manual completion reuses review evidence and accepts edited resource requests", async () => {
  const { workspace, plan } = await workspaceFixture();
  const evaluator: ArticleEvaluator = {
    id: "manual-check",
    version: "1",
    async evaluate({ article, view }) {
      return {
        diagnostics: article.source.bodyMarkdown.includes("待修")
          ? [
              {
                sourceHash: view.sourceHash,
                code: "manual.required",
                severity: "blocker",
                scope: "body",
                message: "正文仍待修订",
              },
            ]
          : [],
        evidenceNeeds: [],
      };
    },
  };
  const prepared = {
    ...successfulPlan(plan.id, plan.revision),
    writer: {
      id: "review-writer",
      version: "1",
      async compose() {
        return {
          ...article("待修内容。[来源](evidence://evidence-1)"),
          assetRequests: [
            {
              id: "unsupported-cover",
              type: "cover",
              necessity: "essential",
              brief: "一张当前没有 provider 可以生成的封面",
            },
          ],
        };
      },
    },
    evaluators: [evaluator],
    reviser: undefined,
  } satisfies ArticleExecutionPlan;
  const articles = new ArticleApplication({
    workspace,
    jobs: new MemoryJobStore(),
    tasks: new MemoryTaskStore(),
    planResolver: { resolve: async () => prepared },
  });
  const generated = await articles.generate({ planId: plan.id });
  if (generated.output?.resultKind !== "review-request") throw new Error("review expected");

  const completed = await articles.completeEditedSource({
    planId: plan.id,
    reviewRequestId: generated.output.artifactId,
    source: {
      format: ArticleSourceFormat.Markdown,
      title: "人工完成的文章",
      digest: "人工已经修正正文，但仍沿用原研究证据和质量流程。",
      bodyMarkdown: "已修内容。[来源](evidence://evidence-1)",
    },
    assetRequests: [],
  });

  assertEquals(completed.status, "succeeded");
  assertEquals(completed.output?.resultKind, "content-package");
  assertEquals(
    (await workspace.get("review-request", generated.output.artifactId))?.status,
    "resolved",
  );
});

test("publication resume reuses an identical publication saved before the job checkpoint", async () => {
  const now = () => new Date("2026-07-18T00:00:00.000Z");
  const { workspace, plan } = await workspaceFixture();
  const articles = new ArticleApplication({
    workspace,
    jobs: new MemoryJobStore(),
    tasks: new MemoryTaskStore(),
    planResolver: { resolve: async () => successfulPlan(plan.id, plan.revision) },
    now,
  });
  const articleJob = await articles.generate({ planId: plan.id });
  if (articleJob.output?.resultKind !== "content-package") {
    throw new Error("article package was not ready");
  }
  await addPublishingTarget(workspace, "account-replay");

  const jobs = new FailOnceOnSuccessfulUpdateJobStore();
  const publishing = new PublishingApplication({
    workspace,
    jobs,
    tasks: new MemoryTaskStore(),
    publishing: new PublicationRunner(new ChannelAdapterRegistry([successfulChannelAdapter()]), {
      now,
    }),
    now,
  });
  const interrupted = await publishing.publish({
    packageId: articleJob.output.artifactId,
    targetIds: ["target-account-replay"],
  });
  assertEquals(interrupted.status, "failed");
  const saved = await workspace.list("publication");
  assertEquals(saved.length, 1);

  const resumed = await publishing.resume(interrupted.id);

  assertEquals(resumed.status, "succeeded");
  assertEquals(resumed.output?.publicationId, saved[0].id);
  assertEquals((await workspace.list("publication")).length, 1);
});

function successfulPlan(id: string, revision: number): ArticleExecutionPlan {
  return {
    id,
    revision,
    researcher: {
      id: "test-researcher",
      version: "1",
      async research() {
        return { kind: "brief", brief: editorialBrief() };
      },
    },
    writer: {
      id: "test-writer",
      version: "1",
      async compose() {
        return article("正文内容。[来源](evidence://evidence-1)");
      },
    },
  };
}

function editorialBrief(): EditorialBrief {
  return {
    topic: "Runtime release",
    angle: "检查点一致性",
    rationale: "这会影响内容生产任务的可靠性",
    thesis: "新的运行时改善了检查点一致性",
    outline: ["变化", "影响"],
    materials: [
      {
        id: "material-1",
        mediaType: "document",
        title: "Runtime release",
        content: "A runtime release improves checkpoint consistency.",
        retrievedAt: "2026-07-18T00:00:00.000Z",
        contentHash: "material-hash-1",
      },
    ],
    evidence: [
      {
        id: "evidence-1",
        statement: "The release improves checkpoint consistency.",
        materialId: "material-1",
        locator: { type: "text", excerpt: "improves checkpoint consistency" },
      },
    ],
    gaps: [],
  };
}

function article(bodyMarkdown: string): WorkingArticle {
  return {
    source: {
      format: ArticleSourceFormat.Markdown,
      title: "检查点让内容服务更可靠",
      digest: "这是一篇用于验证模块化内容生成和独立多目标发布的完整应用级测试文章摘要。",
      bodyMarkdown,
    },
    assetRequests: [],
  };
}

function blockingEvaluator(): ArticleEvaluator {
  return {
    id: "blocking-evaluator",
    version: "1",
    async evaluate({ view }) {
      return {
        diagnostics: [
          {
            sourceHash: view.sourceHash,
            code: "editorial.needs-review",
            severity: "blocker",
            scope: "article",
            message: "文章需要人工审阅",
          },
        ],
        evidenceNeeds: [],
      };
    },
  };
}

async function workspaceFixture() {
  const workspace = new MemoryWorkspaceRepository();
  const identity = createWorkspaceEntity({
    id: "identity-tech",
    name: "技术编辑",
    enabled: true,
    positioning: "解释重要技术变化",
    audience: "软件工程师",
    tone: "清晰克制",
    forbiddenTopics: [],
  });
  const plan = createWorkspaceEntity({
    id: "plan-daily",
    name: "日常编辑",
    enabled: true,
    identityId: identity.id,
    knowledgeBaseIds: [],
    sourceCollectionIds: [],
    plugins: [],
    connections: {},
    publishing: { mode: "content_only" as const, targetIds: [] },
  });
  await workspace.save("identity", identity);
  await workspace.save("content-plan", plan);
  return { workspace, plan };
}

async function addPublishingTarget(
  workspace: MemoryWorkspaceRepository,
  accountId: string,
): Promise<void> {
  await workspace.save(
    "channel-account",
    createWorkspaceEntity({
      id: accountId,
      name: accountId,
      channel: "test-channel",
      connectionId: `connection-${accountId}`,
      settings: {},
    }),
  );
  await workspace.save(
    "publish-target",
    createWorkspaceEntity({
      id: `target-${accountId}`,
      name: `目标 ${accountId}`,
      channelAccountId: accountId,
      settings: {},
    }),
  );
}

class FailOnceOnSuccessfulUpdateJobStore implements JobStore {
  private readonly delegate = new MemoryJobStore();
  private shouldFail = true;

  create<TInput, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>> {
    return this.delegate.create(job);
  }

  get<TInput = unknown, TOutput = unknown>(id: string): Promise<JobRecord<TInput, TOutput> | null> {
    return this.delegate.get(id);
  }

  list(type?: string, limit?: number): Promise<JobRecord[]> {
    return this.delegate.list(type, limit);
  }

  claim<TInput = unknown, TOutput = unknown>(
    input: JobClaimInput,
  ): Promise<JobClaim<TInput, TOutput>> {
    return this.delegate.claim(input);
  }

  update<TInput = unknown, TOutput = unknown>(
    job: JobRecord<TInput, TOutput>,
  ): Promise<JobRecord<TInput, TOutput>> {
    if (this.shouldFail && job.status === "succeeded") {
      this.shouldFail = false;
      return Promise.reject(new Error("simulated crash before job checkpoint"));
    }
    return this.delegate.update(job);
  }
}

function successfulChannelAdapter(): ChannelAdapter {
  return {
    id: "test-channel",
    version: "1",
    channel: "test-channel",
    async prepare(contentPackage) {
      return {
        title: contentPackage.document.title,
        digest: contentPackage.document.digest,
        body: { format: "html", content: `<p>${contentPackage.document.title}</p>` },
        assets: [],
      };
    },
    async publish(_prepared, account, context) {
      return {
        status: "succeeded",
        externalId: `${account.id}-${context.idempotencyKey.slice(0, 8)}`,
        publishedAt: context.now().toISOString(),
      };
    },
  };
}
