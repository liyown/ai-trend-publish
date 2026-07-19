import { test } from "vite-plus/test";
import {
  createJob,
  EventedJobStore,
  finishJob,
  MemoryJobStore,
  RuntimeEventHub,
  startJob,
} from "@trendpublish/runtime";
import { assertEquals } from "../test/assert.ts";
import { createWorkspaceEntity, type ContentPlan, type Automation } from "../workspace/domain.ts";
import { MemoryWorkspaceRepository } from "../workspace/repository.ts";
import type { ArticleApplication } from "./article-application.ts";
import { AutomationApplication } from "./automation-application.ts";
import type { PublishingApplication } from "./publishing-application.ts";

test("automation run generates content and publishes configured targets", async () => {
  const now = () => new Date("2026-07-14T10:00:00.000Z");
  const automation = createWorkspaceEntity(
    {
      id: "automation-daily",
      name: "每日 AI 趋势",
      enabled: true,
      contentPlanId: "plan-ai",
      instructions: "关注基础设施变化",
      keywords: ["AI Agent"],
      trigger: { type: "manual" },
    } satisfies Omit<Automation, "revision" | "createdAt" | "updatedAt">,
    now(),
  );
  const plan = createWorkspaceEntity(
    {
      id: "plan-ai",
      name: "AI 趋势方案",
      enabled: true,
      identityId: "identity-ai",
      knowledgeBaseIds: [],
      sourceCollectionIds: [],
      plugins: [],
      connections: { chat: "chat-main" },
      publishing: { mode: "publish", targetIds: ["target-weixin"] },
    } satisfies Omit<ContentPlan, "revision" | "createdAt" | "updatedAt">,
    now(),
  );
  const workspace = new MemoryWorkspaceRepository({
    automations: [automation],
    contentPlans: [plan],
  });
  const jobs = new MemoryJobStore();
  const articleJob = finishJob(
    startJob(createJob("article.generate", { planId: "plan-ai" }, now()), now()),
    "succeeded",
    { output: { resultKind: "content-package" as const, artifactId: "package-1" } },
    now(),
  );
  const publicationJob = finishJob(
    startJob(createJob("content.publish", { packageId: "package-1" }, now()), now()),
    "succeeded",
    { output: { publicationId: "publication-1", status: "succeeded" as const } },
    now(),
  );
  const articleInputs: unknown[] = [];
  const publishInputs: unknown[] = [];
  const application = new AutomationApplication({
    workspace,
    jobs,
    now,
    articles: {
      createGenerateJob: (input: unknown) => {
        articleInputs.push(input);
        return Promise.resolve(articleJob);
      },
      resume: () => Promise.resolve(articleJob),
    } as unknown as ArticleApplication,
    publishing: {
      createPublishJob: (input: unknown) => {
        publishInputs.push(input);
        return Promise.resolve(publicationJob);
      },
      resume: () => Promise.resolve(publicationJob),
    } as unknown as PublishingApplication,
  });

  const result = await application.run({ automationId: automation.id });

  assertEquals(result.status, "succeeded");
  assertEquals(result.output?.articleJobId, articleJob.id);
  assertEquals(result.output?.publicationJobId, publicationJob.id);
  assertEquals(articleInputs.length, 1);
  assertEquals(publishInputs, [{ packageId: "package-1", targetIds: ["target-weixin"] }]);
});

test("disabled automation stops before generating content", async () => {
  const automation = createWorkspaceEntity({
    id: "automation-disabled",
    name: "已停用任务",
    enabled: false,
    contentPlanId: "plan-ai",
    keywords: [],
    trigger: { type: "manual" },
  } satisfies Omit<Automation, "revision" | "createdAt" | "updatedAt">);
  const application = new AutomationApplication({
    workspace: new MemoryWorkspaceRepository({ automations: [automation] }),
    jobs: new MemoryJobStore(),
    articles: {} as ArticleApplication,
    publishing: {} as PublishingApplication,
  });

  const result = await application.run({ automationId: automation.id });

  assertEquals(result.status, "failed");
  assertEquals(result.error, "自动化任务不存在或已停用");
});

test("automation treats no content as a successful skip and never starts publication", async () => {
  const automation = createWorkspaceEntity({
    id: "automation-quiet-day",
    name: "每日资讯",
    enabled: true,
    contentPlanId: "plan-quiet-day",
    keywords: [],
    trigger: { type: "manual" },
  } satisfies Omit<Automation, "revision" | "createdAt" | "updatedAt">);
  const plan = createWorkspaceEntity({
    id: "plan-quiet-day",
    name: "每日资讯方案",
    enabled: true,
    identityId: "identity-ai",
    knowledgeBaseIds: [],
    sourceCollectionIds: [],
    plugins: [],
    connections: { chat: "chat-main" },
    publishing: { mode: "publish", targetIds: ["target-weixin"] },
  } satisfies Omit<ContentPlan, "revision" | "createdAt" | "updatedAt">);
  const now = () => new Date("2026-07-18T08:00:00.000Z");
  const articleJob = finishJob(
    startJob(createJob("article.generate", { planId: plan.id }, now()), now()),
    "succeeded",
    { output: { resultKind: "no-content" as const, reason: "没有值得发布的变化" } },
    now(),
  );
  let published = false;
  const application = new AutomationApplication({
    workspace: new MemoryWorkspaceRepository({ automations: [automation], contentPlans: [plan] }),
    jobs: new MemoryJobStore(),
    now,
    articles: {
      createGenerateJob: () => Promise.resolve(articleJob),
      resume: () => Promise.resolve(articleJob),
    } as unknown as ArticleApplication,
    publishing: {
      createPublishJob: () => {
        published = true;
        throw new Error("should not publish");
      },
    } as unknown as PublishingApplication,
  });

  const result = await application.run({ automationId: automation.id });

  assertEquals(result.status, "succeeded");
  assertEquals(result.output?.articleResultKind, "no-content");
  assertEquals(result.output?.noContentReason, "没有值得发布的变化");
  assertEquals(published, false);
});

test("automation forwards child activity to its outer job without losing or retaining subscriptions", async () => {
  const now = () => new Date("2026-07-18T09:00:00.000Z");
  const automation = createWorkspaceEntity(
    {
      id: "automation-observable",
      name: "可观测自动化",
      enabled: true,
      contentPlanId: "plan-observable",
      keywords: [],
      trigger: { type: "manual" },
    } satisfies Omit<Automation, "revision" | "createdAt" | "updatedAt">,
    now(),
  );
  const plan = createWorkspaceEntity(
    {
      id: "plan-observable",
      name: "可观测方案",
      enabled: true,
      identityId: "identity-ai",
      knowledgeBaseIds: [],
      sourceCollectionIds: [],
      plugins: [],
      connections: { chat: "chat-main" },
      publishing: { mode: "publish", targetIds: ["target-weixin"] },
    } satisfies Omit<ContentPlan, "revision" | "createdAt" | "updatedAt">,
    now(),
  );
  const events = new RuntimeEventHub({ now });
  const jobs = new EventedJobStore(new MemoryJobStore(), events);
  let articleJobId = "";
  let publicationJobId = "";
  const application = new AutomationApplication({
    workspace: new MemoryWorkspaceRepository({ automations: [automation], contentPlans: [plan] }),
    jobs,
    events,
    now,
    articles: {
      async createGenerateJob(input: unknown) {
        const created = await jobs.create(createJob("article.generate", input, now()));
        articleJobId = created.id;
        return created;
      },
      async resume(jobId: string) {
        const claim = await jobs.claim({
          id: jobId,
          type: "article.generate",
          now: now().toISOString(),
        });
        events.publish({
          type: "task.started",
          jobId,
          taskId: "research",
          data: { version: "1" },
        });
        events.publish({
          type: "model.response.delta",
          jobId,
          taskId: "research",
          data: { delta: "实时内容" },
        });
        return await jobs.update(
          finishJob(
            claim.record,
            "succeeded",
            { output: { resultKind: "content-package" as const, artifactId: "package-1" } },
            now(),
          ),
        );
      },
    } as unknown as ArticleApplication,
    publishing: {
      async createPublishJob(input: unknown) {
        const created = await jobs.create(createJob("content.publish", input, now()));
        publicationJobId = created.id;
        return created;
      },
      async resume(jobId: string) {
        const claim = await jobs.claim({
          id: jobId,
          type: "content.publish",
          now: now().toISOString(),
        });
        events.publish({
          type: "connector.operation.started",
          jobId,
          taskId: "target/1",
          data: { connectorId: "weixin" },
        });
        return await jobs.update(
          finishJob(
            claim.record,
            "succeeded",
            { output: { publicationId: "publication-1", status: "succeeded" as const } },
            now(),
          ),
        );
      },
    } as unknown as PublishingApplication,
  });

  const result = await application.run({ automationId: automation.id });
  const outerEvents = events.recent({ jobId: result.id });
  const articleDelta = outerEvents.find((event) => event.type === "model.response.delta");
  const publicationConnector = outerEvents.find(
    (event) => event.type === "connector.operation.started",
  );

  assertEquals(articleDelta?.taskId, "article/research");
  assertEquals(articleDelta?.data, {
    delta: "实时内容",
    sourceJobId: articleJobId,
    sourceJobType: "article.generate",
  });
  assertEquals(publicationConnector?.taskId, "publication/target/1");
  assertEquals(publicationConnector?.data, {
    connectorId: "weixin",
    sourceJobId: publicationJobId,
    sourceJobType: "content.publish",
  });
  const forwardedArticleCreation = outerEvents.filter(
    (event) =>
      event.type === "job.created" &&
      (event.data as { sourceJobId?: string } | undefined)?.sourceJobId === articleJobId,
  );
  assertEquals(forwardedArticleCreation.length, 1);
  assertEquals(
    forwardedArticleCreation[0]?.data as
      | {
          type?: string;
          status?: string;
          previousStatus?: string;
          updatedAt?: string;
          sourceJobId?: string;
          sourceJobType?: string;
        }
      | undefined,
    {
      type: "article.generate",
      status: "queued",
      previousStatus: undefined,
      updatedAt: now().toISOString(),
      sourceJobId: articleJobId,
      sourceJobType: "article.generate",
    },
  );
  assertEquals(outerEvents.filter((event) => event.type === "automation.child.started").length, 2);
  assertEquals(
    outerEvents.filter((event) => event.type === "automation.child.completed").length,
    2,
  );
  assertEquals(
    events.recent({ jobId: articleJobId }).find((event) => event.type === "task.started")?.taskId,
    "research",
  );

  const outerCount = outerEvents.length;
  events.publish({ type: "task.started", jobId: articleJobId, taskId: "late" });
  assertEquals(events.recent({ jobId: result.id }).length, outerCount);
});

test("automation preserves a needs-attention publication and does not execute it again on resume", async () => {
  const scenario = recoverableAutomationScenario(["needs_attention"]);

  const first = await scenario.application.run({ automationId: scenario.automationId });
  const resumed = await scenario.application.resume(first.id);

  assertEquals(first.status, "needs_attention");
  assertEquals(resumed.status, "needs_attention");
  assertEquals(first.output?.publicationJobId, `${first.id}:publication`);
  assertEquals(first.checkpoint, {
    version: 1,
    articleJobId: `${first.id}:article`,
    publicationJobId: `${first.id}:publication`,
  });
  assertEquals(scenario.calls, {
    articleCreates: 1,
    articleResumes: 1,
    publicationCreates: 1,
    publicationResumes: 1,
  });
  assertEquals((await scenario.jobs.list("article.generate")).length, 1);
  assertEquals((await scenario.jobs.list("content.publish")).length, 1);
});

test("automation propagates a degraded publication as terminal without retrying successful targets", async () => {
  const scenario = recoverableAutomationScenario(["degraded"]);

  const first = await scenario.application.run({ automationId: scenario.automationId });
  const replayed = await scenario.application.resume(first.id);

  assertEquals(first.status, "degraded");
  assertEquals(replayed, first);
  assertEquals(first.output?.publicationJobId, `${first.id}:publication`);
  assertEquals(scenario.calls, {
    articleCreates: 1,
    articleResumes: 1,
    publicationCreates: 1,
    publicationResumes: 1,
  });
});

test("automation retries a known publication failure through the same child job", async () => {
  const scenario = recoverableAutomationScenario(["failed", "succeeded"]);

  const failed = await scenario.application.run({ automationId: scenario.automationId });
  const resumed = await scenario.application.resume(failed.id);

  assertEquals(failed.status, "failed");
  assertEquals(resumed.status, "succeeded");
  assertEquals(failed.output?.publicationJobId, `${failed.id}:publication`);
  assertEquals(resumed.output?.publicationJobId, failed.output?.publicationJobId);
  assertEquals(scenario.calls, {
    articleCreates: 1,
    articleResumes: 1,
    publicationCreates: 1,
    publicationResumes: 2,
  });
  assertEquals((await scenario.jobs.list("article.generate")).length, 1);
  assertEquals((await scenario.jobs.list("content.publish")).length, 1);
});

function recoverableAutomationScenario(
  publicationStatuses: Array<"succeeded" | "degraded" | "failed" | "needs_attention">,
) {
  const now = () => new Date("2026-07-18T11:00:00.000Z");
  const automation = createWorkspaceEntity(
    {
      id: `automation-recovery-${publicationStatuses[0]}`,
      name: "可恢复自动化",
      enabled: true,
      contentPlanId: "plan-recovery",
      keywords: [],
      trigger: { type: "manual" },
    } satisfies Omit<Automation, "revision" | "createdAt" | "updatedAt">,
    now(),
  );
  const plan = createWorkspaceEntity(
    {
      id: "plan-recovery",
      name: "可恢复方案",
      enabled: true,
      identityId: "identity-ai",
      knowledgeBaseIds: [],
      sourceCollectionIds: [],
      plugins: [],
      connections: { chat: "chat-main" },
      publishing: { mode: "publish", targetIds: ["target-weixin"] },
    } satisfies Omit<ContentPlan, "revision" | "createdAt" | "updatedAt">,
    now(),
  );
  const jobs = new MemoryJobStore();
  const calls = {
    articleCreates: 0,
    articleResumes: 0,
    publicationCreates: 0,
    publicationResumes: 0,
  };
  const application = new AutomationApplication({
    workspace: new MemoryWorkspaceRepository({ automations: [automation], contentPlans: [plan] }),
    jobs,
    now,
    articles: {
      async createGenerateJob(input: unknown, options?: { jobId?: string }) {
        calls.articleCreates += 1;
        const created = createJob("article.generate", input, now());
        return await jobs.create(options?.jobId ? { ...created, id: options.jobId } : created);
      },
      async resume(jobId: string) {
        calls.articleResumes += 1;
        const claim = await jobs.claim({
          id: jobId,
          type: "article.generate",
          now: now().toISOString(),
        });
        if (claim.kind !== "claimed") return claim.record;
        return await jobs.update(
          finishJob(
            claim.record,
            "succeeded",
            { output: { resultKind: "content-package" as const, artifactId: "package-1" } },
            now(),
          ),
        );
      },
    } as unknown as ArticleApplication,
    publishing: {
      async createPublishJob(input: unknown, options?: { jobId?: string }) {
        calls.publicationCreates += 1;
        const created = createJob("content.publish", input, now());
        return await jobs.create(options?.jobId ? { ...created, id: options.jobId } : created);
      },
      async resume(jobId: string) {
        const attempt = calls.publicationResumes;
        calls.publicationResumes += 1;
        const claim = await jobs.claim({
          id: jobId,
          type: "content.publish",
          now: now().toISOString(),
        });
        if (claim.kind !== "claimed") return claim.record;
        const status = publicationStatuses[Math.min(attempt, publicationStatuses.length - 1)]!;
        const publicationStatus = status === "degraded" ? "partial" : status;
        return await jobs.update(
          finishJob(
            claim.record,
            status,
            {
              output: { publicationId: "publication-1", status: publicationStatus },
              ...(status === "succeeded" ? {} : { error: `publication ${status}` }),
            },
            now(),
          ),
        );
      },
    } as unknown as PublishingApplication,
  });
  return { application, automationId: automation.id, calls, jobs };
}
