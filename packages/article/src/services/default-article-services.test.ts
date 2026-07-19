import { expect, test } from "vite-plus/test";
import { ArticleSourceFormat, TaskStatus } from "@trendpublish/contracts";
import { MemoryTaskStore, TaskRunner } from "@trendpublish/runtime";
import type { ArticleInput, MaterialSnapshot } from "../domain.ts";
import type { LanguageModelRequest } from "../operations/language-model.ts";
import type { ResearchSource, ResearchTool } from "../extensions.ts";
import {
  DefaultArticleResearcher,
  DefaultArticleWriter,
  DefaultEvidenceSupplementer,
} from "./default-article-services.ts";

const input: ArticleInput = {
  identity: {
    id: "identity-1",
    name: "技术观察",
    positioning: "解释真实变化",
    audience: "工程师",
    tone: "冷静专业",
    revision: 1,
  },
  requestedTopic: "Agent 基础设施",
  requestedAt: "2026-07-18T00:00:00.000Z",
};

test("queries use every search tool while URL fetching uses ordered fallback", async () => {
  const calls: Array<{ tool: string; source: ResearchSource }> = [];
  const first = tool("first", calls);
  const exact = tool("exact", calls);
  const researcher = new DefaultArticleResearcher({
    languageModel: {
      async generate(request) {
        if (request.system.includes("检索规划员")) {
          return JSON.stringify({ queries: ["Agent production deployment"] });
        }
        return JSON.stringify({
          publishable: true,
          topic: "Agent 基础设施进入生产阶段",
          angle: "从真实部署分析",
          rationale: "有具体进展",
          thesis: "部署门槛正在下降",
          outline: ["变化", "影响"],
          gaps: [],
          evidence: [
            {
              statement: "产品已经进入公开测试阶段",
              materialId: "material-exact",
              excerpt: "产品已经进入公开测试阶段",
            },
          ],
        });
      },
    },
    tools: [...first, ...exact],
    seeds: [
      {
        id: "official",
        source: { type: "url", url: "https://example.com/official" },
      },
    ],
    maxResearchSources: 3,
    maxPlannedQueries: 1,
  });

  const result = await researcher.research(input, {
    task: new TaskRunner(new MemoryTaskStore(), { now: fixedNow }).forJob("research"),
    signal: new AbortController().signal,
    now: fixedNow,
  });

  expect(result.kind).toBe("brief");
  expect(calls[0]?.tool).toBe("first");
  expect(calls[0]?.source).toEqual({ type: "url", url: "https://example.com/official" });
  expect(calls.some((call) => call.tool === "exact" && call.source.type === "query")).toBe(true);
});

test("query planning degrades instead of failing research when model JSON is invalid", async () => {
  const material = snapshot("material-fallback", "产品已经进入公开测试阶段。");
  let modelCall = 0;
  const researcher = new DefaultArticleResearcher({
    languageModel: {
      async generate() {
        modelCall += 1;
        if (modelCall === 1) return "<think>只返回了思考，没有 JSON";
        return JSON.stringify({
          publishable: true,
          topic: "主题",
          angle: "角度",
          rationale: "理由",
          thesis: "论点",
          outline: ["结构"],
          gaps: [],
          evidence: [
            {
              statement: "产品已经进入公开测试阶段",
              materialId: material.id,
              excerpt: "产品已经进入公开测试阶段",
            },
          ],
        });
      },
    },
    tools: [
      {
        capability: "search",
        id: "source",
        version: "1",
        search: async () => [],
      },
      {
        capability: "fetch",
        id: "source-fetch",
        version: "1",
        fetch: async () => [material],
      },
    ],
    seeds: [{ id: "official", source: { type: "url", url: "https://example.com" } }],
  });
  const store = new MemoryTaskStore();

  const result = await researcher.research(input, {
    task: new TaskRunner(store, { now: fixedNow }).forJob("planner-fallback"),
    signal: new AbortController().signal,
    now: fixedNow,
  });

  expect(result.kind).toBe("brief");
  expect((await store.get("planner-fallback", "plan-queries"))?.status).toBe(TaskStatus.Degraded);
});

test("writer receives the brief without full material bodies", async () => {
  const requests: LanguageModelRequest[] = [];
  const writer = new DefaultArticleWriter({
    languageModel: {
      async generate(request) {
        requests.push(request);
        return JSON.stringify({
          title: "标题",
          digest: "摘要",
          bodyMarkdown: "正文。[来源](evidence://evidence-1)",
          assetRequests: [],
        });
      },
    },
  });
  await writer.compose(
    {
      request: input,
      identity: input.identity,
      brief: {
        topic: "主题",
        angle: "角度",
        rationale: "理由",
        thesis: "论点",
        outline: ["结构"],
        materials: [snapshot("material-1", "不应再次发送给 Writer 的完整素材正文")],
        evidence: [
          {
            id: "evidence-1",
            statement: "事实",
            materialId: "material-1",
            locator: { type: "text", excerpt: "事实" },
          },
        ],
        gaps: [],
      },
    },
    {
      task: new TaskRunner(new MemoryTaskStore()).forJob("writer"),
      signal: new AbortController().signal,
      now: fixedNow,
    },
  );

  expect(requests[0]?.user.includes("不应再次发送给 Writer 的完整素材正文")).toBe(false);
  expect(requests[0]?.user.includes("evidence-1")).toBe(true);
});

test("evidence supplementer reuses a supporting research tool and returns locatable evidence", async () => {
  const collected: ResearchSource[] = [];
  let modelCalls = 0;
  const supplementer = new DefaultEvidenceSupplementer({
    languageModel: {
      async generate() {
        modelCalls += 1;
        if (modelCalls === 1) return JSON.stringify({ queries: ["公开测试 申请 门槛"] });
        return JSON.stringify({
          evidence: [
            {
              statement: "个人开发者无需申请即可试用",
              materialId: "material-supplement",
              excerpt: "个人开发者无需申请即可试用",
            },
          ],
        });
      },
    },
    tools: [
      {
        capability: "search",
        id: "search",
        version: "1",
        async search(query) {
          collected.push({ type: "query", query });
          return [
            {
              id: "candidate-1",
              title: "公开测试说明",
              url: "https://example.com/public-preview",
              snippet: "这个摘要不能直接成为证据",
            },
          ];
        },
      },
      {
        capability: "fetch",
        id: "fetch",
        version: "1",
        async fetch(url) {
          collected.push({ type: "url", url });
          return [snapshot("material-supplement", "公开测试后，个人开发者无需申请即可试用。")];
        },
      },
    ],
  });

  const result = await supplementer.supplement(
    {
      article: {
        source: {
          format: ArticleSourceFormat.Markdown,
          title: "标题",
          digest: "摘要",
          bodyMarkdown: "正文",
        },
        assetRequests: [],
      },
      view: {} as never,
      brief: {
        topic: "公开测试",
        angle: "采用门槛",
        rationale: "解释影响",
        thesis: "公开测试降低采用门槛",
        outline: ["影响"],
        materials: [],
        evidence: [],
        gaps: [],
      },
      identity: input.identity,
      needs: [
        {
          id: "need-impact",
          diagnosticCode: "evidence.impact_missing",
          question: "公开测试对采用门槛产生了什么影响？",
        },
      ],
    },
    {
      task: new TaskRunner(new MemoryTaskStore(), { now: fixedNow }).forJob("supplement"),
      signal: new AbortController().signal,
      now: fixedNow,
    },
  );

  expect(collected).toEqual([
    { type: "query", query: "公开测试 申请 门槛" },
    { type: "url", url: "https://example.com/public-preview" },
  ]);
  expect(result.materials.map((material) => material.id)).toEqual(["material-supplement"]);
  expect(result.evidence).toHaveLength(1);
  expect(result.evidence[0]?.materialId).toBe("material-supplement");
  expect(result.evidence[0]?.locator).toEqual({
    type: "text",
    excerpt: "个人开发者无需申请即可试用",
  });
});

test("one research source failure is a gap when other material is usable", async () => {
  const usable = snapshot("material-existing", "产品已经进入公开测试阶段。");
  const researcher = new DefaultArticleResearcher({
    languageModel: {
      async generate() {
        return JSON.stringify({
          publishable: true,
          topic: "主题",
          angle: "角度",
          rationale: "理由",
          thesis: "论点",
          outline: ["结构"],
          gaps: [],
          evidence: [
            {
              statement: "产品已经进入公开测试阶段",
              materialId: usable.id,
              excerpt: "产品已经进入公开测试阶段",
            },
          ],
        });
      },
    },
    tools: [
      {
        capability: "search",
        id: "failing",
        version: "1",
        search: async () => {
          throw new Error("上游暂时不可用");
        },
      },
    ],
    seeds: [{ id: "failed-seed", source: { type: "query", query: "补充资料" } }],
    maxPlannedQueries: 0,
  });

  const result = await researcher.research(
    { ...input, materials: [usable], requestedTopic: undefined },
    {
      task: new TaskRunner(new MemoryTaskStore(), { now: fixedNow }).forJob("soft-failure"),
      signal: new AbortController().signal,
      now: fixedNow,
    },
  );

  expect(result.kind).toBe("brief");
  if (result.kind === "brief") {
    expect(result.brief.gaps.some((gap) => gap.includes("上游暂时不可用"))).toBe(true);
  }
});

test("search snippets cannot become evidence when no fetch tool is available", async () => {
  const researcher = new DefaultArticleResearcher({
    languageModel: {
      async generate() {
        throw new Error("brief synthesis must not run without fetched material");
      },
    },
    tools: [
      {
        capability: "search",
        id: "search-only",
        version: "1",
        async search() {
          return [
            {
              id: "candidate-1",
              title: "只有搜索摘要",
              url: "https://example.com/candidate",
              snippet: "这段摘要不能成为正式证据",
            },
          ];
        },
      },
    ],
    seeds: [{ id: "query", source: { type: "query", query: "公开测试" } }],
    maxPlannedQueries: 0,
  });

  const result = await researcher.research(
    { ...input, requestedTopic: undefined },
    {
      task: new TaskRunner(new MemoryTaskStore(), { now: fixedNow }).forJob("search-only"),
      signal: new AbortController().signal,
      now: fixedNow,
    },
  );

  expect(result.kind).toBe("no-content");
  if (result.kind === "no-content") {
    expect(result.noContent.reason).toBe("没有获得可验证的研究素材");
    expect(JSON.stringify(result.noContent.details)).toContain("没有可用网页抓取工具");
  }
});

function tool(id: string, calls: Array<{ tool: string; source: ResearchSource }>): ResearchTool[] {
  return [
    {
      capability: "search",
      id: `${id}-search`,
      version: "1",
      async search(query) {
        calls.push({ tool: id, source: { type: "query", query } });
        return [
          {
            id: `candidate-${id}-${query}`,
            title: query,
            url: `https://example.com/${encodeURIComponent(query)}`,
          },
        ];
      },
    },
    {
      capability: "fetch",
      id: `${id}-fetch`,
      version: "1",
      async fetch(url) {
        calls.push({ tool: id, source: { type: "url", url } });
        return [
          snapshot(
            url === "https://example.com/official"
              ? "material-exact"
              : `material-${id}-${calls.length}`,
            "产品已经进入公开测试阶段。",
          ),
        ];
      },
    },
  ];
}

function snapshot(id: string, content: string): MaterialSnapshot {
  return {
    id,
    mediaType: "webpage",
    title: id,
    content,
    retrievedAt: "2026-07-18T00:00:00.000Z",
    contentHash: `hash-${id}`,
  };
}

function fixedNow(): Date {
  return new Date("2026-07-18T00:00:00.000Z");
}
