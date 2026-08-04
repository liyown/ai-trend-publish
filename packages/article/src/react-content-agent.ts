import { ReactAgent, type AgentTool, type AgentToolContext } from "@trendpublish/agent";
import type { ChatClient } from "@trendpublish/connectors";
import {
  ArticleSchemaVersion,
  ArticleSourceFormat,
  DiagnosticCode,
  type JsonObject,
  type JsonValue,
  type MasterContent,
} from "@trendpublish/contracts";
import type {
  ArticleInput,
  EditorialBrief,
  EvidenceLocator,
  EvidenceUnit,
  MaterialSnapshot,
  WorkingArticle,
} from "./domain.ts";
import type { ConfiguredResearchSeed, ResearchTool } from "./extensions.ts";
import type { TaskContext } from "@trendpublish/runtime";
import { ArticleCompiler } from "./compiler.ts";
import { isBlockingDiagnostic } from "./domain.ts";
import { EvidenceDiagnosticCode } from "./evidence.ts";

export interface ContentReactAgentResult {
  master: MasterContent;
  brief: EditorialBrief;
  article: WorkingArticle;
}

export interface ContentReactAgentOptions {
  model: ChatClient;
  modelConnectionId: string;
  strategyId: string;
  strategyInstructions: string;
  tools?: ResearchTool[];
  seeds?: ConfiguredResearchSeed[];
  enhancementToolIds?: string[];
  budget?: { maxTurns?: number };
}

/** One shared ReAct session owns research, evidence selection, writing and optional enhancement. */
export class ContentReactAgent {
  constructor(private readonly options: ContentReactAgentOptions) {}

  async produce(input: ArticleInput, task: TaskContext): Promise<ContentReactAgentResult> {
    const materials = deduplicateMaterials(structuredClone(input.materials ?? []));
    const tools = this.createTools(materials);
    return await new ReactAgent(this.options.model).run({
      system: this.systemPrompt(input),
      user: JSON.stringify({
        requestedTopic: input.requestedTopic,
        requestedAt: input.requestedAt,
        instructions: input.metadata?.instructions,
        keywords: input.metadata?.keywords,
        configuredSources: this.options.seeds ?? [],
        initialMaterialIds: materials.map((material) => material.id),
      }),
      tools,
      terminal: {
        name: "submit_master_content",
        description: "提交最终共享语义内容。只有内容、证据引用和 Markdown 正文完整后才能调用。",
        inputSchema: masterContentSchema,
        repair: {
          name: "repair_master_content",
          description:
            "修补上一次未通过校验的候选稿。只提交出错证据的替换字段；正文引用有误时可提交 bodyMarkdown。系统保留标题和其他已通过内容。",
          inputSchema: masterContentRepairSchema,
          apply: applyMasterContentRepair,
        },
        parse: async (value) => {
          const result = parseMasterContent(value, input, materials, this.options);
          const inspection = await new ArticleCompiler().inspect({
            article: result.article,
            evidence: result.brief.evidence,
            materials: result.brief.materials,
          });
          const failures = inspection.diagnostics.filter(
            (diagnostic) =>
              isBlockingDiagnostic(diagnostic) ||
              diagnostic.code === DiagnosticCode.EvidenceReferenceMissing ||
              (result.brief.materials.length > 0 &&
                diagnostic.code === EvidenceDiagnosticCode.CitationMissing),
          );
          if (failures.length) {
            throw new Error(
              failures
                .map((diagnostic) =>
                  diagnostic.code === EvidenceDiagnosticCode.CitationMissing
                    ? "正文必须至少引用一条有效证据，请在对应陈述后添加 [来源](evidence://证据ID)"
                    : diagnostic.message,
                )
                .join("；"),
            );
          }
          return result;
        },
      },
      task,
      budget: this.options.budget,
    });
  }

  private createTools(materials: MaterialSnapshot[]): AgentTool[] {
    const tools: AgentTool[] = [
      {
        name: "locate_material_quotes",
        version: "1",
        description:
          "批量定位冻结素材中的逐字原文。提交文本证据前调用一次，并把返回的 source、start、end 原样放入对应 evidence locator；不要重新抄写 excerpt。",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["requests"],
          properties: {
            requests: {
              type: "array",
              minItems: 1,
              maxItems: 20,
              items: {
                type: "object",
                additionalProperties: false,
                required: ["key", "materialId", "query"],
                properties: {
                  key: { type: "string", minLength: 1 },
                  materialId: { type: "string", minLength: 1 },
                  query: { type: "string", minLength: 1 },
                },
              },
            },
          },
        },
        execute: async (value) => ({
          results: requiredArray(value.requests, "证据定位请求").map((item, index) => {
            const request = jsonObject(item, `证据定位请求 ${index + 1}`);
            const materialId = requiredText(request.materialId, `证据定位请求 ${index + 1}材料`);
            const material = materials.find((candidate) => candidate.id === materialId);
            if (!material) throw new Error(`材料不存在：${materialId}`);
            const candidates = locateQuoteCandidates(
              material,
              requiredText(request.query, `证据定位请求 ${index + 1}查询`),
            );
            if (!candidates.length) {
              throw new Error(`材料 ${materialId} 中没有找到与查询足够相关的原文`);
            }
            return {
              key: requiredText(request.key, `证据定位请求 ${index + 1}标识`),
              materialId,
              candidates,
            };
          }),
        }),
      },
      {
        name: "read_material_content",
        version: "1",
        description:
          "按材料 ID 阅读冻结素材的完整正文或转录，用于理解上下文。证据定位必须使用 locate_material_quotes，不要从这里手抄 excerpt。",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["materialId"],
          properties: { materialId: { type: "string", minLength: 1 } },
        },
        execute: async (value) => {
          const materialId = requiredText(value.materialId, "材料 ID");
          const material = materials.find((item) => item.id === materialId);
          if (!material) throw new Error(`材料不存在：${materialId}`);
          return materialForAgent(material);
        },
      },
    ];
    if (materials.length) {
      tools.push({
        name: "read_workspace_materials",
        version: "1",
        description: "读取内容方案授权的知识库材料。",
        inputSchema: {
          type: "object",
          additionalProperties: false,
          properties: { query: { type: "string" } },
        },
        execute: async (value) => {
          const query = typeof value.query === "string" ? value.query.trim().toLowerCase() : "";
          return materials
            .filter((material) =>
              query
                ? `${material.title}\n${material.content ?? ""}`.toLowerCase().includes(query)
                : true,
            )
            .slice(0, 20)
            .map(materialForAgent) as JsonValue;
        },
      });
    }
    for (const [index, researchTool] of (this.options.tools ?? []).entries()) {
      if (researchTool.capability === "search") {
        tools.push({
          name: `search_sources_${index + 1}`,
          version: researchTool.version,
          description: `使用授权连接 ${researchTool.id} 搜索新闻、来源和证据候选 URL。搜索摘要不能直接作为证据。`,
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["query"],
            properties: { query: { type: "string", minLength: 1 } },
          },
          execute: async (value, context) =>
            (
              await researchTool.search(requiredText(value.query, "搜索词"), operation(context))
            ).map((candidate) => ({
              id: candidate.id,
              title: candidate.title,
              url: candidate.url,
              snippet: candidate.snippet ?? null,
              publishedAt: candidate.publishedAt ?? null,
              author: candidate.author ?? null,
              sourceName: candidate.sourceName ?? null,
            })),
        });
      } else {
        tools.push({
          name: `fetch_source_${index + 1}`,
          version: researchTool.version,
          description: `使用授权连接 ${researchTool.id} 抓取 URL 正文，返回可用于证据定位的冻结材料。`,
          inputSchema: {
            type: "object",
            additionalProperties: false,
            required: ["url"],
            properties: { url: { type: "string", minLength: 1 } },
          },
          execute: async (value, context) => {
            const fetched = await researchTool.fetch(
              requiredText(value.url, "来源 URL"),
              operation(context),
            );
            materials.splice(
              0,
              materials.length,
              ...deduplicateMaterials([...materials, ...fetched]),
            );
            return fetched.map(materialForAgent) as JsonValue;
          },
        });
      }
    }
    for (const enhancementId of this.options.enhancementToolIds ?? []) {
      const prompt =
        enhancementId === "remove-ai-tone"
          ? "消除机械、模板化和刻意总结式表达，保留事实、引用和原意。"
          : "根据内容身份优化结构、节奏和表达，保留事实、引用和原意。";
      tools.push({
        name: enhancementId === "remove-ai-tone" ? "remove_ai_tone" : "optimize_style",
        version: "1",
        description: `${prompt} 输入和输出均为 Markdown。`,
        inputSchema: {
          type: "object",
          additionalProperties: false,
          required: ["markdown"],
          properties: { markdown: { type: "string", minLength: 1 } },
        },
        execute: async (value, context) => {
          const output = await this.options.model.complete(
            {
              messages: [
                { role: "system", content: prompt },
                { role: "user", content: requiredText(value.markdown, "待增强内容") },
              ],
            },
            {
              signal: context.signal,
              traceId: context.task.jobId,
              taskId: context.task.taskId,
            },
          );
          return { markdown: output.content };
        },
      });
    }
    return tools;
  }

  private systemPrompt(input: ArticleInput): string {
    return [
      "你是内容生产 ReAct Agent。自主决定研究、抓取、证据核验、写作和增强的顺序，不遵循固定流水线。",
      "搜索摘要不能作为证据；具体外部事实必须引用抓取材料中的可定位证据。没有证据时可以写分析框架和行动建议，但不得虚构事实。",
      "不要输出隐藏推理。通过工具获取 observation，完成后调用 submit_master_content。",
      "submit_master_content 中 claims、evidence、outline 必须是数组。每条 claim 必须有非空且唯一的 id、statement 和 evidenceIds。",
      "每条 evidence 必须有非空且唯一的 id、statement、materialId 和 locator；materialId 必须原样使用抓取工具返回的材料 ID，禁止留空或自行编造。",
      '正文引用格式必须是 [来源](evidence://证据ID)，其中证据 ID 必须与 evidence 数组中的 id 完全一致。提交文本证据前，把所有 evidence 的 materialId 和待核验陈述批量传给 locate_material_quotes；locator 使用返回的 {type:"text",source,start,end}，不要抄写 excerpt。',
      "首次完整提交失败后，候选稿会被保留。证据定位失败时使用 locate_material_quotes 批量定位并只修补对应 locator；正文引用缺失或错误时只提交修正后的 bodyMarkdown。不要重新生成标题、摘要和全部证据，也不要再次完整提交。",
      `策略：${this.options.strategyInstructions}`,
      `内容身份：${JSON.stringify(input.identity)}`,
    ].join("\n");
  }
}

const masterContentSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  required: [
    "topic",
    "angle",
    "synopsis",
    "thesis",
    "outline",
    "title",
    "digest",
    "bodyMarkdown",
    "claims",
    "evidence",
  ],
  properties: {
    topic: { type: "string", minLength: 1 },
    angle: { type: "string", minLength: 1 },
    synopsis: { type: "string", minLength: 1 },
    thesis: { type: "string", minLength: 1 },
    outline: {
      type: "array",
      minItems: 1,
      items: { type: "string", minLength: 1 },
      description: "非空文章结构列表。",
    },
    title: { type: "string", minLength: 1 },
    digest: { type: "string", minLength: 1 },
    bodyMarkdown: { type: "string", minLength: 1 },
    claims: {
      type: "array",
      minItems: 1,
      description: "核心论点。evidenceIds 只能引用 evidence 数组中的非空 ID。",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement", "evidenceIds"],
        properties: {
          id: { type: "string", minLength: 1, description: "唯一论点 ID，例如 claim-1。" },
          statement: { type: "string", minLength: 1 },
          evidenceIds: {
            type: "array",
            uniqueItems: true,
            items: { type: "string", minLength: 1 },
          },
        },
      },
    },
    evidence: {
      type: "array",
      description: "可定位证据。没有外部事实时可以为空数组；任何字段都不能使用空字符串。",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id", "statement", "materialId", "locator"],
        properties: {
          id: { type: "string", minLength: 1, description: "唯一证据 ID，例如 evidence-1。" },
          statement: { type: "string", minLength: 1, description: "该证据直接支持的陈述。" },
          materialId: {
            type: "string",
            minLength: 1,
            description: "抓取工具返回的材料 ID，必须原样使用。",
          },
          locator: {
            type: "object",
            additionalProperties: false,
            required: ["type"],
            properties: {
              type: { type: "string", enum: ["text", "time-range", "page"] },
              source: { type: "string", enum: ["content", "transcript"] },
              start: { type: "integer", minimum: 0 },
              end: { type: "integer", minimum: 1 },
              excerpt: { type: "string", minLength: 1 },
              startMs: { type: "number", minimum: 0 },
              endMs: { type: "number", minimum: 0 },
              transcript: { type: "string" },
              page: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
  },
};

const masterContentRepairSchema: JsonObject = {
  type: "object",
  additionalProperties: false,
  properties: {
    evidence: {
      type: "array",
      minItems: 1,
      description: "只包含需要修补的证据；未列出的证据和其他候选稿字段保持不变。",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["id"],
        properties: {
          id: { type: "string", minLength: 1 },
          statement: { type: "string", minLength: 1 },
          materialId: { type: "string", minLength: 1 },
          locator: {
            type: "object",
            additionalProperties: false,
            required: ["type"],
            properties: {
              type: { type: "string", enum: ["text", "time-range", "page"] },
              source: { type: "string", enum: ["content", "transcript"] },
              start: { type: "integer", minimum: 0 },
              end: { type: "integer", minimum: 1 },
              excerpt: { type: "string", minLength: 1 },
              startMs: { type: "number", minimum: 0 },
              endMs: { type: "number", minimum: 0 },
              transcript: { type: "string" },
              page: { type: "integer", minimum: 1 },
            },
          },
        },
      },
    },
    bodyMarkdown: {
      type: "string",
      minLength: 1,
      description: "仅当证据 ID 变化导致正文引用也必须变化时才提交完整替换正文。",
    },
  },
};

function applyMasterContentRepair(candidate: JsonObject, patch: JsonObject): JsonObject {
  if (patch.evidence === undefined && patch.bodyMarkdown === undefined) {
    throw new Error("结构化内容修补至少需要 evidence 或 bodyMarkdown");
  }
  const evidence = requiredArray(candidate.evidence, "候选稿证据").map((item, index) =>
    structuredClone(jsonObject(item, `候选稿证据 ${index + 1}`)),
  );
  for (const [index, item] of array(patch.evidence).entries()) {
    const repair = jsonObject(item, `证据修补 ${index + 1}`);
    const id = requiredText(repair.id, `证据修补 ${index + 1} ID`);
    const target = evidence.findIndex((current) => current.id === id);
    if (target < 0) throw new Error(`证据修补引用了候选稿中不存在的证据 ${id}`);
    evidence[target] = {
      ...evidence[target]!,
      ...(repair.statement !== undefined
        ? { statement: requiredText(repair.statement, `证据 ${id}陈述`) }
        : {}),
      ...(repair.materialId !== undefined
        ? { materialId: requiredText(repair.materialId, `证据 ${id}材料`) }
        : {}),
      ...(repair.locator !== undefined
        ? { locator: structuredClone(jsonObject(repair.locator, `证据 ${id}定位`)) }
        : {}),
    };
  }
  return {
    ...structuredClone(candidate),
    evidence,
    ...(patch.bodyMarkdown !== undefined
      ? { bodyMarkdown: requiredText(patch.bodyMarkdown, "正文") }
      : {}),
  };
}

function parseMasterContent(
  value: JsonObject,
  input: ArticleInput,
  materials: MaterialSnapshot[],
  options: ContentReactAgentOptions,
): ContentReactAgentResult {
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const evidence = requiredArray(value.evidence, "证据").map((item, index) =>
    parseEvidence(item, index, materialById),
  );
  assertUniqueIds(evidence, "证据");
  const materialIds = new Set(materials.map((material) => material.id));
  for (const item of evidence) {
    if (!materialIds.has(item.materialId)) {
      throw new Error(`证据 ${item.id} 引用了 Agent 未抓取的材料 ${item.materialId}`);
    }
  }
  const title = requiredText(value.title, "标题");
  const digest = requiredText(value.digest, "摘要");
  const bodyMarkdown = requiredText(value.bodyMarkdown, "正文");
  const topic = requiredText(value.topic, "主题");
  const angle = requiredText(value.angle, "角度");
  const synopsis = requiredText(value.synopsis, "内容概要");
  const claims = requiredArray(value.claims, "论点").map((claim, index) => {
    const object = jsonObject(claim, `论点 ${index + 1}`);
    return {
      id: requiredText(object.id, `论点 ${index + 1} ID`),
      statement: requiredText(object.statement, `论点 ${index + 1}`),
      evidenceIds: requiredTextArray(object.evidenceIds, `论点 ${index + 1}证据 ID`),
    };
  });
  if (!claims.length) throw new Error("论点不能为空");
  assertUniqueIds(claims, "论点");
  const evidenceIds = new Set(evidence.map((item) => item.id));
  for (const claim of claims) {
    for (const evidenceId of claim.evidenceIds) {
      if (!evidenceIds.has(evidenceId)) {
        throw new Error(`论点 ${claim.id} 引用了不存在的证据 ${evidenceId}`);
      }
    }
  }
  const article: WorkingArticle = {
    source: { format: ArticleSourceFormat.Markdown, title, digest, bodyMarkdown },
    assetRequests: [],
  };
  return {
    master: {
      schemaVersion: ArticleSchemaVersion.MasterContent,
      topic,
      angle,
      synopsis,
      narrativeMarkdown: bodyMarkdown,
      claims,
      requestedModalities: [],
      agent: {
        strategyId: options.strategyId,
        modelConnectionId: options.modelConnectionId,
        maxTurns: options.budget?.maxTurns ?? 24,
      },
    },
    brief: {
      topic,
      angle,
      rationale: synopsis,
      thesis: requiredText(value.thesis, "核心论点"),
      outline: requiredNonEmptyTextArray(value.outline, "文章结构"),
      materials: structuredClone(materials),
      evidence,
      gaps: [],
    },
    article,
  };
}

function parseEvidence(
  value: JsonValue,
  index: number,
  materialById: Map<string, MaterialSnapshot>,
): EvidenceUnit {
  const object = jsonObject(value, `证据 ${index + 1}`);
  const materialId = requiredText(object.materialId, `证据 ${index + 1}材料`);
  return {
    id: requiredText(object.id, `证据 ${index + 1} ID`),
    statement: requiredText(object.statement, `证据 ${index + 1}陈述`),
    materialId,
    locator: parseLocator(
      jsonObject(object.locator, `证据 ${index + 1}定位`),
      materialById.get(materialId),
    ),
  };
}

function parseLocator(value: JsonObject, material?: MaterialSnapshot): EvidenceLocator {
  if (value.type === "text") {
    if (value.start !== undefined || value.end !== undefined || value.source !== undefined) {
      const source = value.source;
      if (source !== "content" && source !== "transcript") {
        throw new Error("文本证据位置 source 必须是 content 或 transcript");
      }
      const start = requiredInteger(value.start, "文本证据起点");
      const end = requiredInteger(value.end, "文本证据终点");
      const text = material?.[source];
      if (typeof text !== "string") throw new Error(`素材没有可用的 ${source} 文本`);
      if (start < 0 || end <= start || end > text.length) {
        throw new Error(`文本证据位置超出素材范围：${start}-${end}`);
      }
      return { type: "text", excerpt: text.slice(start, end) };
    }
    return { type: "text", excerpt: requiredText(value.excerpt, "证据摘录") };
  }
  if (value.type === "time-range") {
    const startMs = requiredNumber(value.startMs, "时间起点");
    return {
      type: "time-range",
      startMs,
      ...(typeof value.endMs === "number" ? { endMs: value.endMs } : {}),
      ...(typeof value.transcript === "string" ? { transcript: value.transcript } : {}),
    };
  }
  if (value.type === "page") {
    return {
      type: "page",
      page: requiredNumber(value.page, "页码"),
      ...(typeof value.excerpt === "string" ? { excerpt: value.excerpt } : {}),
    };
  }
  throw new Error("证据 locator.type 必须是 text、time-range 或 page");
}

function operation(context: AgentToolContext) {
  return { task: context.task, signal: context.signal, now: () => new Date() };
}

function materialForAgent(material: MaterialSnapshot): JsonObject {
  return {
    id: material.id,
    mediaType: material.mediaType,
    title: material.title,
    content: material.content ?? null,
    transcript: material.transcript ?? null,
    sourceUrl: material.sourceUrl ?? null,
    publishedAt: material.publishedAt ?? null,
    sourceName: material.sourceName ?? null,
  };
}

function locateQuoteCandidates(
  material: MaterialSnapshot,
  query: string,
): Array<{ source: "content" | "transcript"; start: number; end: number; excerpt: string }> {
  const scored = (["content", "transcript"] as const).flatMap((source) => {
    const text = material[source];
    if (!text) return [];
    return quoteSegments(text).map((segment) => ({
      source,
      ...segment,
      score: quoteSimilarity(query, segment.excerpt),
    }));
  });
  const best = Math.max(0, ...scored.map((item) => item.score));
  if (best < 0.08) return [];
  return scored
    .filter((item) => item.score >= Math.max(0.08, best * 0.55))
    .sort((left, right) => right.score - left.score || left.start - right.start)
    .slice(0, 5)
    .map(({ source, start, end, excerpt }) => ({ source, start, end, excerpt }));
}

function quoteSegments(text: string): Array<{ start: number; end: number; excerpt: string }> {
  const result: Array<{ start: number; end: number; excerpt: string }> = [];
  const pattern = /[^\n.!?。！？]+[.!?。！？]?/gu;
  for (const match of text.matchAll(pattern)) {
    const raw = match[0];
    const leading = raw.length - raw.trimStart().length;
    const excerpt = raw.trim();
    if (excerpt.length < 8) continue;
    const start = (match.index ?? 0) + leading;
    result.push({ start, end: start + excerpt.length, excerpt });
  }
  return result;
}

function quoteSimilarity(query: string, excerpt: string): number {
  const left = characterBigrams(normalizeQuoteText(query));
  const right = characterBigrams(normalizeQuoteText(excerpt));
  if (!left.size || !right.size) return 0;
  let overlap = 0;
  for (const value of left) if (right.has(value)) overlap += 1;
  return (2 * overlap) / (left.size + right.size);
}

function normalizeQuoteText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "");
}

function characterBigrams(value: string): Set<string> {
  if (value.length < 2) return new Set(value ? [value] : []);
  const result = new Set<string>();
  for (let index = 0; index < value.length - 1; index += 1) {
    result.add(value.slice(index, index + 2));
  }
  return result;
}

function deduplicateMaterials(materials: MaterialSnapshot[]): MaterialSnapshot[] {
  return [...new Map(materials.map((material) => [material.id, material])).values()];
}

function jsonObject(value: unknown, label: string): JsonObject {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label}必须是对象`);
  return value as JsonObject;
}

function requiredText(value: unknown, label: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`${label}不能为空`);
  return value.trim();
}

function requiredNumber(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new Error(`${label}必须是数字`);
  return value;
}

function requiredInteger(value: unknown, label: string): number {
  const number = requiredNumber(value, label);
  if (!Number.isInteger(number)) throw new Error(`${label}必须是整数`);
  return number;
}

function array(value: unknown): JsonValue[] {
  return Array.isArray(value) ? value : [];
}

function requiredArray(value: unknown, label: string): JsonValue[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`);
  return value;
}

function requiredTextArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${label}必须是数组`);
  return value.map((item, index) => requiredText(item, `${label} ${index + 1}`));
}

function requiredNonEmptyTextArray(value: unknown, label: string): string[] {
  const values = requiredTextArray(value, label);
  if (!values.length) throw new Error(`${label}不能为空`);
  return values;
}

function assertUniqueIds(values: Array<{ id: string }>, label: string): void {
  const ids = new Set<string>();
  for (const value of values) {
    if (ids.has(value.id)) throw new Error(`${label} ID重复：${value.id}`);
    ids.add(value.id);
  }
}
