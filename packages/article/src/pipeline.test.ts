import { expect, test } from "vite-plus/test";
import { ArticleSourceFormat } from "@trendpublish/contracts";
import { MemoryTaskStore, TaskFingerprintConflictError, TaskRunner } from "@trendpublish/runtime";
import type {
  ArticleEvidenceSupplementer,
  ArticleEvaluator,
  ArticleResearcher,
  ArticleReviser,
  ArticleTransformer,
  ArticleWriter,
} from "./extensions.ts";
import { ArticlePipeline, type ArticleExecutionPlan } from "./pipeline.ts";
import type { ArticleInput, EditorialBrief } from "./domain.ts";

const equal = (actual: unknown, expected: unknown): void => expect(actual).toBe(expected);
const ok = (value: unknown): void => expect(value).toBe(true);

const input: ArticleInput = {
  identity: {
    id: "identity-1",
    name: "技术观察",
    positioning: "解释基础设施变化",
    audience: "软件工程师",
    tone: "冷静专业",
    revision: 1,
  },
  requestedAt: "2026-07-18T00:00:00.000Z",
};

const brief: EditorialBrief = {
  topic: "公开测试",
  angle: "分析真实变化",
  rationale: "读者需要理解影响",
  thesis: "公开测试降低了采用门槛",
  outline: ["发生了什么", "为什么重要"],
  materials: [
    {
      id: "material-1",
      mediaType: "webpage",
      title: "资料",
      content: "产品已经进入公开测试阶段。",
      retrievedAt: "2026-07-18T00:00:00.000Z",
      contentHash: "material-hash",
    },
  ],
  evidence: [
    {
      id: "evidence-1",
      statement: "产品已经进入公开测试阶段",
      materialId: "material-1",
      locator: { type: "text", excerpt: "产品已经进入公开测试阶段" },
    },
  ],
  gaps: [],
};

test("pipeline checkpoints the fixed flow and omits failed enhancement assets", async () => {
  const store = new MemoryTaskStore();
  const pipeline = new ArticlePipeline({ now: fixedNow, idFactory: sequentialIds() });
  const result = await pipeline.run({
    input,
    plan: plan({
      transformers: [titleTransformer],
      writer: writer("enhancement"),
    }),
    task: new TaskRunner(store, { now: fixedNow }).forJob("article-happy"),
  });

  equal(result.kind, "content-package");
  if (result.kind !== "content-package") return;
  equal(result.contentPackage.schemaVersion, "content-package.v5");
  equal(result.contentPackage.source.title, "标题｜完整解读");
  equal(result.contentPackage.document.title, "标题｜完整解读");
  equal(result.contentPackage.assets.length, 0);
  ok(
    result.contentPackage.quality.warnings.some(
      (diagnostic) => diagnostic.code === "asset.request_unsupported",
    ),
  );
  ok(result.contentPackage.id.startsWith("content_"));
  equal(result.contentPackage.checksum.length, 64);

  const taskIds = (await store.list("article-happy")).map((record) => record.taskId);
  ok(taskIds.includes("research"));
  ok(taskIds.includes("compose"));
  ok(taskIds.includes("transform/1-title-style"));
  ok(taskIds.includes("build/compiler"));
  ok(taskIds.includes("build/package"));
});

test("an unresolved essential asset becomes a review request instead of a failed job", async () => {
  const pipeline = new ArticlePipeline({ now: fixedNow, idFactory: sequentialIds() });
  const result = await pipeline.run({
    input,
    plan: plan({ writer: writer("essential") }),
    task: new TaskRunner(new MemoryTaskStore(), { now: fixedNow }).forJob("article-essential"),
  });

  equal(result.kind, "review-request");
  if (result.kind !== "review-request") return;
  ok(
    result.reviewRequest.quality.diagnostics.some(
      (diagnostic) =>
        diagnostic.location?.assetRequestId === "diagram-1" && diagnostic.severity === "blocker",
    ),
  );
});

test("the unified reviser fixes compiler diagnostics inside a bounded quality loop", async () => {
  let revisionCalls = 0;
  const reviser: ArticleReviser = {
    id: "reviser",
    version: "1",
    async revise({ article }) {
      revisionCalls += 1;
      return { ...article, source: { ...article.source, digest: "修复后的摘要" } };
    },
  };
  const brokenWriter: ArticleWriter = {
    ...writer("enhancement"),
    async compose() {
      const article = await writer("enhancement").compose({} as never, {} as never);
      return { ...article, source: { ...article.source, digest: "" } };
    },
  };
  const result = await new ArticlePipeline({ now: fixedNow, idFactory: sequentialIds() }).run({
    input,
    plan: plan({ writer: brokenWriter, reviser }),
    task: new TaskRunner(new MemoryTaskStore(), { now: fixedNow }).forJob("article-revise"),
  });

  equal(result.kind, "content-package");
  equal(revisionCalls, 1);
  if (result.kind === "content-package") {
    equal(result.contentPackage.source.digest, "修复后的摘要");
  }
});

test("evidence supplementation and revision share the existing quality round", async () => {
  const store = new MemoryTaskStore();
  const events: string[] = [];
  let evaluationCalls = 0;
  const evaluator: ArticleEvaluator = {
    id: "evidence-quality",
    version: "1",
    async evaluate({ view }) {
      evaluationCalls += 1;
      events.push(`evaluate-${evaluationCalls}`);
      if (evaluationCalls > 1) return { diagnostics: [], evidenceNeeds: [] };
      return {
        diagnostics: [
          {
            sourceHash: view.sourceHash,
            code: "evidence.impact_missing",
            severity: "blocker",
            scope: "evidence",
            message: "缺少采用影响的论据",
          },
        ],
        evidenceNeeds: [
          {
            id: "need-impact",
            diagnosticCode: "evidence.impact_missing",
            question: "公开测试对采用门槛产生了什么影响？",
          },
        ],
      };
    },
  };
  const supplementer: ArticleEvidenceSupplementer = {
    id: "evidence-supplementer",
    version: "1",
    async supplement({ needs }) {
      events.push("supplement-1");
      expect(needs.map((need) => need.id)).toEqual(["need-impact"]);
      return {
        materials: [
          {
            id: "material-2",
            mediaType: "webpage",
            title: "采用说明",
            content: "公开测试允许个人开发者无需申请即可试用。",
            retrievedAt: "2026-07-18T00:00:00.000Z",
            contentHash: "material-hash-2",
          },
        ],
        evidence: [
          {
            id: "evidence-2",
            statement: "个人开发者无需申请即可试用",
            materialId: "material-2",
            locator: { type: "text", excerpt: "个人开发者无需申请即可试用" },
          },
        ],
      };
    },
  };
  const reviser: ArticleReviser = {
    id: "reviser",
    version: "1",
    async revise({ article, brief: revisedBrief, addedEvidenceIds }) {
      events.push("revise-1");
      expect(addedEvidenceIds).toEqual(["evidence-2"]);
      expect(revisedBrief.evidence.some((item) => item.id === "evidence-2")).toBe(true);
      return {
        ...article,
        source: {
          ...article.source,
          bodyMarkdown: `${article.source.bodyMarkdown}\n\n个人开发者无需申请即可试用。[来源](evidence://evidence-2)`,
        },
      };
    },
  };

  const result = await new ArticlePipeline({ now: fixedNow, idFactory: sequentialIds() }).run({
    input,
    plan: plan({ evaluators: [evaluator], evidenceSupplementer: supplementer, reviser }),
    task: new TaskRunner(store, { now: fixedNow }).forJob("article-supplement"),
  });

  expect(result.kind).toBe("content-package");
  expect(evaluationCalls).toBe(2);
  expect(events).toEqual(["evaluate-1", "supplement-1", "revise-1", "evaluate-2"]);
  if (result.kind === "content-package") {
    expect(result.contentPackage.evidence.some((item) => item.id === "evidence-2")).toBe(true);
    expect(result.contentPackage.materials.some((item) => item.id === "material-2")).toBe(true);
  }
  const qualityTasks = new Set(
    (await store.list("article-supplement"))
      .map((record) => record.taskId)
      .filter((taskId) => taskId.startsWith("quality/")),
  );
  expect(qualityTasks.has("quality/evaluate/1/1-evidence-quality")).toBe(true);
  expect(qualityTasks.has("quality/supplement/1-evidence-supplementer")).toBe(true);
  expect(qualityTasks.has("quality/revise/1")).toBe(true);
  expect(qualityTasks.has("quality/evaluate/2/1-evidence-quality")).toBe(true);
});

test("no-content is a normal research outcome", async () => {
  const researcher: ArticleResearcher = {
    id: "researcher",
    version: "1",
    research: async () => ({ kind: "no-content", noContent: { reason: "没有新信息" } }),
  };
  const result = await new ArticlePipeline({ now: fixedNow }).run({
    input,
    plan: plan({ researcher }),
    task: new TaskRunner(new MemoryTaskStore(), { now: fixedNow }).forJob("article-empty"),
  });
  equal(result.kind, "no-content");
});

test("complete resumes an edited working article without research, compose or transformers", async () => {
  let forbiddenCalls = 0;
  const forbiddenResearcher: ArticleResearcher = {
    id: "forbidden-researcher",
    version: "1",
    async research() {
      forbiddenCalls += 1;
      throw new Error("research must not run");
    },
  };
  const forbiddenWriter: ArticleWriter = {
    id: "forbidden-writer",
    version: "1",
    async compose() {
      forbiddenCalls += 1;
      throw new Error("compose must not run");
    },
  };
  const forbiddenTransformer: ArticleTransformer = {
    id: "forbidden-transformer",
    version: "1",
    async transform() {
      forbiddenCalls += 1;
      throw new Error("transform must not run");
    },
  };
  const store = new MemoryTaskStore();
  const result = await new ArticlePipeline({ now: fixedNow, idFactory: sequentialIds() }).complete({
    input,
    brief,
    article: {
      source: {
        format: ArticleSourceFormat.Markdown,
        title: "人工标题",
        digest: "人工摘要",
        bodyMarkdown: "人工正文。[来源](evidence://evidence-1)",
      },
      assetRequests: [],
    },
    plan: plan({
      researcher: forbiddenResearcher,
      writer: forbiddenWriter,
      transformers: [forbiddenTransformer],
    }),
    task: new TaskRunner(store, { now: fixedNow }).forJob("article-complete"),
  });

  equal(result.kind, "content-package");
  equal(forbiddenCalls, 0);
  const taskIds = (await store.list("article-complete")).map((record) => record.taskId);
  equal(taskIds.includes("research"), false);
  equal(taskIds.includes("compose"), false);
  equal(
    taskIds.some((id) => id.startsWith("transform/")),
    false,
  );
});

test("complete restores and upgrades channel-required assets before package construction", async () => {
  const pipeline = new ArticlePipeline({ now: fixedNow, idFactory: sequentialIds() });
  const result = await pipeline.complete({
    input,
    brief,
    article: {
      source: {
        format: ArticleSourceFormat.Markdown,
        title: "人工标题",
        digest: "人工摘要",
        bodyMarkdown: "人工正文。[来源](evidence://evidence-1)",
      },
      assetRequests: [
        {
          id: "manual-cover",
          type: "cover",
          necessity: "enhancement",
          brief: "人工降级的封面",
        },
      ],
    },
    plan: plan({ requiredAssetTypes: ["cover"] }),
    task: new TaskRunner(new MemoryTaskStore(), { now: fixedNow }).forJob(
      "article-complete-required-cover",
    ),
  });

  equal(result.kind, "review-request");
  if (result.kind !== "review-request") return;
  const cover = result.reviewRequest.article.assetRequests.find(
    (request) => request.type === "cover",
  );
  equal(cover?.id, "manual-cover");
  equal(cover?.necessity, "essential");

  const deleted = await pipeline.complete({
    input,
    brief,
    article: {
      source: result.reviewRequest.article.source,
      assetRequests: [],
    },
    plan: plan({ requiredAssetTypes: ["cover"] }),
    task: new TaskRunner(new MemoryTaskStore(), { now: fixedNow }).forJob(
      "article-complete-deleted-cover",
    ),
  });
  equal(deleted.kind, "review-request");
  if (deleted.kind === "review-request") {
    const restored = deleted.reviewRequest.article.assetRequests.find(
      (request) => request.type === "cover",
    );
    equal(restored?.id, "required-cover");
    equal(restored?.necessity, "essential");
  }
});

test("plan revision participates in every pipeline checkpoint fingerprint", async () => {
  const store = new MemoryTaskStore();
  const pipeline = new ArticlePipeline({ now: fixedNow, idFactory: sequentialIds() });
  const task = new TaskRunner(store, { now: fixedNow }).forJob("article-plan-revision");
  await pipeline.run({ input, plan: plan(), task });

  await expect(
    pipeline.run({ input, plan: { ...plan(), revision: 2 }, task }),
  ).rejects.toBeInstanceOf(TaskFingerprintConflictError);
});

test("an unavailable evaluator is retried and becomes a review blocker", async () => {
  let calls = 0;
  const evaluator: ArticleEvaluator = {
    id: "remote-quality",
    version: "1",
    async evaluate() {
      calls += 1;
      throw new Error("quality service unavailable");
    },
  };
  const result = await new ArticlePipeline({ now: fixedNow, idFactory: sequentialIds() }).run({
    input,
    plan: plan({
      evaluators: [evaluator],
      quality: { maxQualityRounds: 2 },
    }),
    task: new TaskRunner(new MemoryTaskStore(), { now: fixedNow }).forJob(
      "article-evaluator-unavailable",
    ),
  });

  expect(calls).toBe(3);
  expect(result.kind).toBe("review-request");
  if (result.kind === "review-request") {
    expect(
      result.reviewRequest.quality.diagnostics.some(
        (diagnostic) => diagnostic.code === "evaluator.remote-quality.unavailable",
      ),
    ).toBe(true);
  }
});

test("a failed transformer cannot leak mutations into its fallback article", async () => {
  const mutatingTransformer: ArticleTransformer = {
    id: "mutating-transformer",
    version: "1",
    async transform({ article }) {
      const mutable = article as {
        source: { title: string; bodyMarkdown: string };
        assetRequests: Array<unknown>;
      };
      mutable.source.title = "被失败插件污染的标题";
      mutable.source.bodyMarkdown = "被失败插件污染且没有证据引用的正文";
      mutable.assetRequests.push({
        id: "leaked-essential-asset",
        type: "diagram",
        necessity: "essential",
        brief: "不应泄漏",
      });
      throw new Error("transformer failed after mutation");
    },
  };

  const result = await new ArticlePipeline({ now: fixedNow, idFactory: sequentialIds() }).run({
    input,
    plan: plan({ transformers: [mutatingTransformer] }),
    task: new TaskRunner(new MemoryTaskStore(), { now: fixedNow }).forJob(
      "article-transformer-isolation",
    ),
  });

  expect(result.kind).toBe("content-package");
  if (result.kind === "content-package") {
    expect(result.contentPackage.source.title).toBe("标题");
    expect(result.contentPackage.source.bodyMarkdown).toContain("evidence://evidence-1");
    expect(
      result.contentPackage.quality.warnings.some(
        (diagnostic) => diagnostic.code === "transformer.mutating-transformer.unavailable",
      ),
    ).toBe(true);
  }
});

const baseResearcher: ArticleResearcher = {
  id: "researcher",
  version: "1",
  research: async () => ({ kind: "brief", brief }),
};

const baseEvaluator: ArticleEvaluator = {
  id: "quality",
  version: "1",
  evaluate: async () => ({ diagnostics: [], evidenceNeeds: [] }),
};

const titleTransformer: ArticleTransformer = {
  id: "title-style",
  version: "1",
  async transform({ article }) {
    return {
      ...article,
      source: { ...article.source, title: `${article.source.title}｜完整解读` },
    };
  },
};

function writer(necessity: "enhancement" | "essential"): ArticleWriter {
  return {
    id: "writer",
    version: "1",
    async compose() {
      return {
        source: {
          format: ArticleSourceFormat.Markdown,
          title: "标题",
          digest: "摘要",
          bodyMarkdown:
            "产品已经进入公开测试阶段。[来源](evidence://evidence-1)\n\n![结构图](asset-request://diagram-1)",
        },
        assetRequests: [
          {
            id: "diagram-1",
            type: "diagram",
            necessity,
            brief: "结构图",
          },
        ],
      };
    },
  };
}

function plan(overrides: Partial<ArticleExecutionPlan> = {}): ArticleExecutionPlan {
  return {
    id: "plan-1",
    revision: 1,
    researcher: baseResearcher,
    writer: writer("enhancement"),
    evaluators: [baseEvaluator],
    ...overrides,
  };
}

function fixedNow(): Date {
  return new Date("2026-07-18T00:00:00.000Z");
}

function sequentialIds(): () => string {
  let value = 0;
  return () => `00000000-0000-4000-8000-${String((value += 1)).padStart(12, "0")}`;
}
