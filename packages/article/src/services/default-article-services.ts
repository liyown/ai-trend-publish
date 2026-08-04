import { ArticleSourceFormat } from "@trendpublish/contracts";
import { fingerprint } from "@trendpublish/runtime";
import type {
  ArticleInput,
  AssetNecessity,
  AssetRequest,
  AssetRequestType,
  ContentDiagnostic,
  EditorialBrief,
  EvidenceUnit,
  MaterialSnapshot,
  WorkingArticle,
} from "../domain.ts";
import type {
  ArticleOperationContext,
  ArticleResearcher,
  ArticleWriter,
  ConfiguredResearchSeed,
  ResearchOutcome,
  ResearchSource,
  ResearchTool,
} from "../extensions.ts";
import { parseModelJson, type LanguageModel } from "../operations/language-model.ts";
import { ResearchCollector, type ResearchInstruction } from "./research-collector.ts";

export interface DefaultArticleResearcherOptions {
  languageModel: LanguageModel;
  tools?: ResearchTool[];
  seeds?: ConfiguredResearchSeed[];
  maxResearchSources?: number;
  maxMaterials?: number;
  maxPlannedQueries?: number;
}

/** A small bounded active-research loop; concrete search/fetch behavior is injected. */
export class DefaultArticleResearcher implements ArticleResearcher {
  readonly id = "default-researcher";
  readonly version = "1";

  constructor(private readonly options: DefaultArticleResearcherOptions) {}

  async research(input: ArticleInput, context: ArticleOperationContext): Promise<ResearchOutcome> {
    const sources = (await this.planResearchSources(input, context)).slice(
      0,
      this.options.maxResearchSources ?? 6,
    );
    const { materials, failures } = await new ResearchCollector({
      tools: this.options.tools,
      maxMaterials: this.options.maxMaterials,
    }).collect(sources, input.materials ?? [], context);
    if (!materials.length) {
      return {
        kind: "no-content",
        noContent: {
          reason: "没有获得可验证的研究素材",
          ...(failures.length ? { details: { failures } } : {}),
        },
      };
    }

    const response = parseModelJson<ResearchModelOutput>(
      await this.options.languageModel.generate({
        system: researchSystem(input),
        user: JSON.stringify({
          requestedTopic: input.requestedTopic,
          materials: materials.map(materialForPrompt),
        }),
        temperature: 0.15,
        json: true,
        signal: context.signal,
        events: context.task,
      }),
    );
    if (response.publishable === false) {
      return {
        kind: "no-content",
        noContent: { reason: response.reason?.trim() || "当前素材不足以形成值得发布的文章" },
      };
    }
    const evidence = await normalizeEvidence(response.evidence, materials);
    if (!evidence.length) {
      return {
        kind: "no-content",
        noContent: { reason: "研究结果没有形成可定位的证据" },
      };
    }
    const brief: EditorialBrief = {
      topic: requireText(response.topic, "选题"),
      angle: requireText(response.angle, "选题角度"),
      rationale: requireText(response.rationale, "选题理由"),
      thesis: requireText(response.thesis, "文章论点"),
      outline: textArray(response.outline),
      materials: structuredClone(materials),
      evidence,
      gaps: [...textArray(response.gaps), ...failures],
    };
    if (!brief.outline.length) {
      return { kind: "no-content", noContent: { reason: "研究结果没有形成可执行的文章结构" } };
    }
    return { kind: "brief", brief };
  }

  private async planResearchSources(
    input: ArticleInput,
    context: ArticleOperationContext,
  ): Promise<ResearchInstruction[]> {
    const configured: ResearchInstruction[] = (this.options.seeds ?? []).map((seed) => ({
      source: structuredClone(seed.source),
      seedId: seed.id,
    }));
    const hasSearchTool = (this.options.tools ?? []).some((tool) => tool.capability === "search");
    const direct = directResearchSources(input)
      .filter((source) => source.type === "url" || hasSearchTool)
      .map((source) => ({ source }));
    const maxPlannedQueries = Math.max(0, this.options.maxPlannedQueries ?? 3);
    let planned: ResearchInstruction[] = [];
    if (maxPlannedQueries > 0 && hasSearchTool) {
      const queries = await context.task.run(
        {
          id: "plan-queries",
          version: "1",
          input: {
            requestedTopic: input.requestedTopic,
            keywords: metadataStrings(input.metadata?.keywords),
            seeds: this.options.seeds,
            maxPlannedQueries,
          },
          optional: true,
          fallback: () => Promise.resolve([]),
        },
        async (signal, task) => {
          const result = parseModelJson<{ queries?: string[] }>(
            await this.options.languageModel.generate({
              system:
                "你是研究检索规划员。根据主题、关键词和已有来源，补充少量互不重复、可用于事实核查的搜索查询。不要写 URL。返回 JSON：{queries:string[]}。",
              user: JSON.stringify({
                requestedTopic: input.requestedTopic,
                keywords: metadataStrings(input.metadata?.keywords),
                seeds: this.options.seeds?.map((seed) => ({
                  label: seed.label,
                  source: seed.source,
                })),
                limit: maxPlannedQueries,
              }),
              temperature: 0.2,
              json: true,
              signal,
              events: task,
            }),
          );
          return textArray(result.queries).slice(0, maxPlannedQueries);
        },
      );
      planned = queries.map((query) => ({ source: { type: "query", query } }));
    }
    return deduplicateResearchInstructions([...configured, ...direct, ...planned]);
  }
}

export interface DefaultArticleWriterOptions {
  languageModel: LanguageModel;
}

export class DefaultArticleWriter implements ArticleWriter {
  readonly id = "default-writer";
  readonly version = "1";

  constructor(private readonly options: DefaultArticleWriterOptions) {}

  async compose(
    input: Parameters<ArticleWriter["compose"]>[0],
    context: ArticleOperationContext,
  ): Promise<WorkingArticle> {
    const response = parseModelJson<CompositionModelOutput>(
      await this.options.languageModel.generate({
        system: `${identityPrompt(input.identity)}\n你是成熟的中文内容作者。有证据时只使用 brief 中的证据，事实引用写成 [来源](evidence://证据ID)；没有证据时仍需完成一篇可发布文章，但只能写分析框架、经验判断和行动建议，明确不确定性，不得虚构外部事实、数据或来源。正文使用 Markdown。若需要资源，只能在 assetRequests 中声明，并在对应位置写 ![说明](asset-request://请求ID)。返回 JSON：title、digest、bodyMarkdown、assetRequests。`,
        user: JSON.stringify({
          brief: briefForWriting(input.brief),
          instructions: input.request.metadata?.instructions,
        }),
        temperature: 0.6,
        json: true,
        signal: context.signal,
        events: context.task,
      }),
    );
    return {
      source: {
        format: ArticleSourceFormat.Markdown,
        title: requireText(response.title, "文章标题"),
        digest: requireText(response.digest, "文章摘要"),
        bodyMarkdown: requireText(response.bodyMarkdown, "文章正文"),
      },
      assetRequests: normalizeAssetRequests(response.assetRequests),
    };
  }
}

interface ResearchModelOutput {
  publishable?: boolean;
  reason?: string;
  topic?: string;
  angle?: string;
  rationale?: string;
  thesis?: string;
  outline?: string[];
  gaps?: string[];
  evidence?: Array<{
    statement?: string;
    materialId?: string;
    excerpt?: string;
  }>;
}

interface CompositionModelOutput {
  title?: string;
  digest?: string;
  bodyMarkdown?: string;
  assetRequests?: unknown;
}

function directResearchSources(input: ArticleInput): ResearchSource[] {
  const result: ResearchSource[] = [];
  if (input.requestedTopic?.trim()) {
    result.push({ type: "query", query: input.requestedTopic.trim() });
  }
  for (const keyword of metadataStrings(input.metadata?.keywords)) {
    result.push({ type: "query", query: keyword });
  }
  for (const url of [
    ...metadataStrings(input.metadata?.sourceUrls),
    ...metadataStrings(input.metadata?.urls),
  ]) {
    result.push({ type: "url", url });
  }
  const seen = new Set<string>();
  return result.filter((source) => {
    const key = source.type === "query" ? `query:${source.query}` : `url:${source.url}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function deduplicateResearchInstructions(values: ResearchInstruction[]): ResearchInstruction[] {
  const seen = new Set<string>();
  return values.filter((instruction) => {
    const source = instruction.source;
    const value = source.type === "query" ? source.query.trim() : source.url.trim();
    if (!value) return false;
    const key = `${source.type}:${value}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function briefForWriting(brief: EditorialBrief) {
  return {
    topic: brief.topic,
    angle: brief.angle,
    rationale: brief.rationale,
    thesis: brief.thesis,
    outline: brief.outline,
    evidence: brief.evidence,
    gaps: brief.gaps,
    materials: brief.materials.map((material) => ({
      id: material.id,
      title: material.title,
      sourceUrl: material.sourceUrl,
      publishedAt: material.publishedAt,
    })),
  };
}

function materialForPrompt(material: MaterialSnapshot) {
  return {
    id: material.id,
    title: material.title,
    mediaType: material.mediaType,
    sourceUrl: material.sourceUrl,
    publishedAt: material.publishedAt,
    content: materialText(material).slice(0, 12_000),
  };
}

async function normalizeEvidence(
  values: ResearchModelOutput["evidence"],
  materials: MaterialSnapshot[],
): Promise<EvidenceUnit[]> {
  const materialById = new Map(materials.map((material) => [material.id, material]));
  const result: EvidenceUnit[] = [];
  for (const [index, candidate] of (values ?? []).entries()) {
    const statement = candidate.statement?.trim();
    const materialId = candidate.materialId?.trim();
    const excerpt = candidate.excerpt?.trim();
    if (!statement || !materialId || !excerpt) continue;
    const material = materialById.get(materialId);
    if (!material || !materialText(material).includes(excerpt)) continue;
    const seed = `${materialId}:${statement}:${excerpt}:${index}`;
    result.push({
      id: `evidence-${(await fingerprint(seed)).slice(0, 20)}`,
      statement,
      materialId,
      locator: { type: "text", excerpt },
    });
  }
  return result;
}

function normalizeAssetRequests(value: unknown): AssetRequest[] {
  if (!Array.isArray(value)) return [];
  const types = new Set<AssetRequestType>(["cover", "illustration", "diagram", "chart"]);
  const necessities = new Set<AssetNecessity>(["enhancement", "essential"]);
  const result: AssetRequest[] = [];
  for (const candidate of value) {
    if (!candidate || typeof candidate !== "object") continue;
    const item = candidate as Record<string, unknown>;
    if (
      typeof item.id !== "string" ||
      !item.id.trim() ||
      !types.has(item.type as AssetRequestType) ||
      !necessities.has(item.necessity as AssetNecessity) ||
      typeof item.brief !== "string" ||
      !item.brief.trim()
    ) {
      continue;
    }
    result.push({
      id: item.id.trim(),
      type: item.type as AssetRequestType,
      necessity: item.necessity as AssetNecessity,
      brief: item.brief.trim(),
      ...(typeof item.alt === "string" && item.alt.trim() ? { alt: item.alt.trim() } : {}),
      ...(typeof item.caption === "string" && item.caption.trim()
        ? { caption: item.caption.trim() }
        : {}),
    });
  }
  return result;
}

function researchSystem(input: ArticleInput): string {
  return `${identityPrompt(input.identity)}\n你是事实核查研究员和内容主编。判断材料是否值得发布，并形成一个有明确主张的编辑简报。证据 excerpt 必须逐字来自对应 material 的 content，不能创造来源或事实。返回 JSON：publishable、reason、topic、angle、rationale、thesis、outline、gaps、evidence[{statement,materialId,excerpt}]。`;
}

function identityPrompt(identity: ArticleInput["identity"]): string {
  return `账号：${identity.name}\n定位：${identity.positioning}\n受众：${identity.audience}\n语气：${identity.tone}\n禁写：${identity.forbiddenTopics?.join("；") || "无"}`;
}

function materialText(material: MaterialSnapshot): string {
  return material.content?.trim() || material.transcript?.trim() || "";
}

function metadataStrings(value: unknown): string[] {
  if (typeof value === "string") return value.trim() ? [value.trim()] : [];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && Boolean(item.trim()));
}

function textArray(value: unknown): string[] {
  return metadataStrings(value);
}

function requireText(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`模型返回缺少${field}`);
  return value.trim();
}

export type { ContentDiagnostic };
