import { ArticleResultKind, DiagnosticCode } from "@trendpublish/contracts";
import { describeUnknown, type TaskContext } from "@trendpublish/runtime";
import {
  ArticleCompiler,
  normalizeDiagnostics,
  type ArticleInspection,
  type AssetResolution,
} from "./compiler.ts";
import { isContentAssetChecksum } from "./asset-integrity.ts";
import type {
  ArticleOperationContext,
  ArticleResearcher,
  ArticleReactAgent,
  ArticleTransformer,
  ArticleWriter,
  AssetProvider,
} from "./extensions.ts";
import { ContentPackageBuilder, type ContentPackageOrigin } from "./package-builder.ts";
import type {
  ArticleInput,
  AssetRequest,
  AssetRequestType,
  ContentAsset,
  ContentDiagnostic,
  ContentPackage,
  EditorialBrief,
  MasterContent,
  QualityReport,
  WorkingArticle,
} from "./domain.ts";
import { isBlockingDiagnostic } from "./domain.ts";

export interface ArticleExecutionPlan {
  id: string;
  revision: number;
  parentPackageId?: string;
  /** Channel-neutral asset capabilities that every successful package from this plan must contain. */
  requiredAssetTypes?: AssetRequestType[];
  /** Preferred execution engine. When present, the fixed research/write stages are bypassed. */
  agent?: ArticleReactAgent;
  /** @deprecated Legacy fixed-pipeline port; new workspace plans always use agent. */
  researcher?: ArticleResearcher;
  /** @deprecated Legacy fixed-pipeline port; new workspace plans always use agent. */
  writer?: ArticleWriter;
  transformers?: ArticleTransformer[];
  assetProviders?: Partial<Record<AssetRequestType, AssetProvider>>;
}

export interface RunArticlePipelineRequest {
  input: ArticleInput;
  plan: ArticleExecutionPlan;
  task: TaskContext;
}

/** Resumes a manually edited article without rerunning research, writing or transformers. */
export interface CompleteWorkingArticleRequest {
  input: ArticleInput;
  brief: EditorialBrief;
  article: WorkingArticle;
  plan: ArticleExecutionPlan;
  task: TaskContext;
}

export type ArticlePipelineResult = {
  kind: typeof ArticleResultKind.ContentPackage;
  contentPackage: ContentPackage;
};

export interface ArticlePipelineOptions {
  compiler?: ArticleCompiler;
  packageBuilder?: ContentPackageBuilder;
  now?: () => Date;
  idFactory?: () => string;
}

/** Runs the shared ReAct session and deterministically builds its publishable content package. */
export class ArticlePipeline {
  private readonly compiler: ArticleCompiler;
  private readonly packageBuilder: ContentPackageBuilder;
  private readonly now: () => Date;
  private readonly idFactory: () => string;

  constructor(options: ArticlePipelineOptions = {}) {
    this.compiler = options.compiler ?? new ArticleCompiler();
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.packageBuilder = options.packageBuilder ?? new ContentPackageBuilder(this.idFactory);
    this.now = options.now ?? (() => new Date());
  }

  async run(request: RunArticlePipelineRequest): Promise<ArticlePipelineResult> {
    validateExecutionPlan(request.plan);
    if (request.plan.agent) {
      const produced = await request.plan.agent.produce(request.input, request.task.scope("react"));
      return await this.finish(request, produced.brief, produced.article, [], produced.master);
    }
    const research = await this.research(request);
    const brief =
      research.kind === "brief"
        ? research.brief
        : fallbackEditorialBrief(request.input, research.noContent.reason);
    const composed = await this.compose(request, brief);
    const transformed = await this.transform(request, brief, composed);
    return await this.finish(request, brief, transformed.article, transformed.warnings);
  }

  async complete(request: CompleteWorkingArticleRequest): Promise<ArticlePipelineResult> {
    validateExecutionPlan(request.plan);
    assertWorkingArticle(request.article);
    return await this.finish(request, request.brief, request.article, []);
  }

  private async finish(
    request: RunArticlePipelineRequest,
    brief: EditorialBrief,
    article: WorkingArticle,
    operationalWarnings: ContentDiagnostic[],
    master?: MasterContent,
  ): Promise<ArticlePipelineResult> {
    const requiredArticle = ensureRequiredAssetRequests(article, request.plan.requiredAssetTypes);
    return await this.build(request, brief, requiredArticle, operationalWarnings, master);
  }

  private async research(request: RunArticlePipelineRequest) {
    const researcher = request.plan.researcher;
    if (!researcher) throw new Error("旧流水线缺少 Researcher");
    return await request.task.run(
      {
        id: "research",
        version: researcher.version,
        input: {
          plan: planFingerprint(request.plan),
          researcherId: researcher.id,
          input: request.input,
        },
      },
      (signal) =>
        researcher.research(
          structuredClone(request.input),
          this.context(request.task.scope("research/internal"), signal),
        ),
    );
  }

  private async compose(
    request: RunArticlePipelineRequest,
    brief: EditorialBrief,
  ): Promise<WorkingArticle> {
    const writer = request.plan.writer;
    if (!writer) throw new Error("旧流水线缺少 Writer");
    return await request.task.run(
      {
        id: "compose",
        version: writer.version,
        input: {
          plan: planFingerprint(request.plan),
          writerId: writer.id,
          brief,
          identity: request.input.identity,
        },
      },
      async (signal) => {
        const article = await writer.compose(
          {
            brief: structuredClone(brief),
            identity: structuredClone(request.input.identity),
            request: structuredClone(request.input),
          },
          this.context(request.task.scope("compose/internal"), signal),
        );
        assertWorkingArticle(article);
        return structuredClone(article);
      },
    );
  }

  private async transform(
    request: RunArticlePipelineRequest,
    brief: EditorialBrief,
    initial: WorkingArticle,
  ): Promise<{ article: WorkingArticle; warnings: ContentDiagnostic[] }> {
    let article = structuredClone(initial);
    const warnings: ContentDiagnostic[] = [];
    const transformers = request.plan.transformers ?? [];

    for (const [index, transformer] of transformers.entries()) {
      const inspection = await this.compiler.inspect({
        article,
        evidence: brief.evidence,
        materials: brief.materials,
      });
      const previous = structuredClone(article);
      const step = await request.task.run<TransformerStep>(
        {
          id: `transform/${index + 1}-${transformer.id}`,
          version: transformer.version,
          input: {
            plan: planFingerprint(request.plan),
            transformerId: transformer.id,
            article: previous,
            brief,
          },
          optional: true,
          fallback: (error): TransformerStep => ({
            article: previous,
            warning: {
              sourceHash: inspection.view.sourceHash,
              code: `transformer.${transformer.id}.unavailable`,
              severity: "warning" as const,
              scope: "article" as const,
              message: describeUnknown(error),
            },
          }),
        },
        async (signal) => {
          const next = await transformer.transform(
            {
              article: structuredClone(previous),
              view: structuredClone(inspection.view),
              brief: structuredClone(brief),
              identity: structuredClone(request.input.identity),
            },
            this.context(
              request.task.scope(`transform/${index + 1}-${transformer.id}/internal`),
              signal,
            ),
          );
          assertWorkingArticle(next);
          return { article: structuredClone(next) } satisfies TransformerStep;
        },
      );
      article = step.article;
      if (step.warning) warnings.push(step.warning);
    }
    return { article, warnings };
  }

  private async build(
    request: RunArticlePipelineRequest,
    brief: EditorialBrief,
    article: WorkingArticle,
    operationalWarnings: ContentDiagnostic[],
    master?: MasterContent,
  ): Promise<{ kind: typeof ArticleResultKind.ContentPackage; contentPackage: ContentPackage }> {
    const inspection = await this.compiler.inspect({
      article,
      evidence: brief.evidence,
      materials: brief.materials,
    });
    const resolutionResult = await this.resolveAssets(request, brief, article, inspection);
    const compilation = await request.task.run(
      {
        id: "build/compiler",
        version: this.compiler.version,
        input: {
          plan: planFingerprint(request.plan),
          article,
          evidence: brief.evidence,
          materials: brief.materials,
          resolutions: resolutionResult.resolutions,
        },
      },
      () =>
        this.compiler.compile({
          article,
          evidence: brief.evidence,
          materials: brief.materials,
          resolutions: resolutionResult.resolutions,
        }),
    );
    const finalDiagnostics = normalizeDiagnostics([
      ...operationalWarnings.map((warning) => ({
        ...warning,
        sourceHash: compilation.sourceHash,
      })),
      ...resolutionResult.diagnostics,
      ...compilation.diagnostics,
    ]);
    const blockers = finalDiagnostics.filter(isBlockingDiagnostic);
    if (blockers.length) {
      throw new Error(blockers.map((diagnostic) => diagnostic.message).join("；"));
    }
    const finalQuality: QualityReport = {
      id: `quality_${compilation.sourceHash}`,
      sourceHash: compilation.sourceHash,
      policyVersion: `content-plan:${request.plan.id}@${request.plan.revision}`,
      diagnostics: finalDiagnostics,
      evaluatedAt: request.input.requestedAt,
    };
    const origin: ContentPackageOrigin = {
      jobId: request.task.jobId,
      planId: request.plan.id,
      planRevision: request.plan.revision,
      ...(request.plan.parentPackageId ? { parentPackageId: request.plan.parentPackageId } : {}),
    };
    const contentPackage = await request.task.run(
      {
        id: "build/package",
        version: "5",
        input: {
          plan: planFingerprint(request.plan),
          article,
          compilation,
          brief,
          assets: resolutionResult.assets,
          identity: request.input.identity,
          quality: finalQuality,
          origin,
          master,
        },
      },
      () =>
        this.packageBuilder.build({
          article,
          compilation,
          brief,
          assets: resolutionResult.assets,
          identity: request.input.identity,
          quality: finalQuality,
          compilerVersion: this.compiler.version,
          origin,
          createdAt: this.now().toISOString(),
          master,
        }),
    );
    return { kind: ArticleResultKind.ContentPackage, contentPackage };
  }

  private async resolveAssets(
    request: RunArticlePipelineRequest,
    brief: EditorialBrief,
    article: WorkingArticle,
    inspection: ArticleInspection,
  ): Promise<{
    resolutions: AssetResolution[];
    assets: ContentAsset[];
    diagnostics: ContentDiagnostic[];
  }> {
    const resolutions: AssetResolution[] = [];
    const diagnostics: ContentDiagnostic[] = [];

    for (const [index, assetRequest] of article.assetRequests.entries()) {
      const provider = request.plan.assetProviders?.[assetRequest.type];
      if (!provider) {
        diagnostics.push(
          assetDiagnostic(inspection.view.sourceHash, assetRequest, "没有可用 Provider"),
        );
        continue;
      }

      const result = await request.task.run<AssetStep>(
        {
          id: `build/asset/${index + 1}-${assetRequest.id}`,
          version: provider.version,
          input: {
            plan: planFingerprint(request.plan),
            providerId: provider.id,
            request: assetRequest,
            article,
            brief,
          },
          optional: true,
          fallback: (error): AssetStep => ({
            diagnostic: assetDiagnostic(
              inspection.view.sourceHash,
              assetRequest,
              describeUnknown(error),
            ),
          }),
        },
        async (signal) => {
          const asset = await provider.provide(
            {
              request: structuredClone(assetRequest),
              article: structuredClone(article),
              view: structuredClone(inspection.view),
              brief: structuredClone(brief),
              identity: structuredClone(request.input.identity),
            },
            this.context(
              request.task.scope(`build/asset/${index + 1}-${assetRequest.id}/internal`),
              signal,
            ),
          );
          assertContentAsset(asset, assetRequest);
          return {
            resolution: { requestId: assetRequest.id, asset: structuredClone(asset) },
          } satisfies AssetStep;
        },
      );
      if (result.resolution) resolutions.push(result.resolution);
      if (result.diagnostic) diagnostics.push(result.diagnostic);
    }
    const assets = resolutions.map((resolution) => resolution.asset);
    const ids = new Set<string>();
    for (const asset of assets) {
      if (ids.has(asset.id)) throw new Error(`AssetProvider 返回了重复资源 ID：${asset.id}`);
      ids.add(asset.id);
    }
    return { resolutions, assets, diagnostics };
  }

  private context(task: TaskContext, signal: AbortSignal): ArticleOperationContext {
    return { task, signal, now: this.now };
  }
}

interface TransformerStep {
  article: WorkingArticle;
  warning?: ContentDiagnostic;
}

interface AssetStep {
  resolution?: AssetResolution;
  diagnostic?: ContentDiagnostic;
}

function validateExecutionPlan(plan: ArticleExecutionPlan): void {
  if (!plan.id.trim()) throw new Error("ArticleExecutionPlan 缺少 ID");
  if (!Number.isInteger(plan.revision) || plan.revision < 1) {
    throw new Error("ArticleExecutionPlan revision 必须为正整数");
  }
  if (!plan.agent && (!plan.researcher || !plan.writer)) {
    throw new Error("ArticleExecutionPlan 必须提供 ReAct Agent");
  }
  const ids = (plan.transformers ?? []).map((extension) => `transformer:${extension.id}`);
  if (new Set(ids).size !== ids.length) throw new Error("ArticleExecutionPlan 包含重复插件 ID");
  const requiredAssetTypes = plan.requiredAssetTypes ?? [];
  if (new Set(requiredAssetTypes).size !== requiredAssetTypes.length) {
    throw new Error("ArticleExecutionPlan 包含重复的必要资源类型");
  }
}

function planFingerprint(plan: ArticleExecutionPlan): { planId: string; planRevision: number } {
  return { planId: plan.id, planRevision: plan.revision };
}

function fallbackEditorialBrief(input: ArticleInput, reason: string): EditorialBrief {
  const topic =
    input.requestedTopic?.trim() ||
    metadataText(input.metadata?.instructions) ||
    metadataText(input.metadata?.keywords) ||
    input.identity.positioning.trim() ||
    input.identity.name;
  return {
    topic,
    angle: `从${input.identity.audience || "目标读者"}的实际需求出发解释${topic}`,
    rationale: "研究材料不足时使用预设模板继续生产，避免一次运行没有成品。",
    thesis: `围绕${topic}给出清晰判断、适用边界和可执行建议。`,
    outline: ["问题与背景", "关键判断", "适用边界", "行动建议"],
    materials: structuredClone(input.materials ?? []),
    evidence: [],
    gaps: [reason, "缺少外部证据时不得虚构具体事实、数据或来源"],
  };
}

function metadataText(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (Array.isArray(value)) {
    const first = value.find((item): item is string => typeof item === "string" && !!item.trim());
    return first?.trim();
  }
  return undefined;
}

function assertWorkingArticle(article: WorkingArticle): void {
  if (!article || typeof article !== "object") throw new Error("插件没有返回 WorkingArticle");
  if (!article.source || typeof article.source !== "object") throw new Error("文章缺少 Source");
  if (
    typeof article.source.title !== "string" ||
    typeof article.source.digest !== "string" ||
    typeof article.source.bodyMarkdown !== "string"
  ) {
    throw new Error("ArticleSource 字段格式无效");
  }
  if (!Array.isArray(article.assetRequests)) throw new Error("assetRequests 必须是数组");
  const ids = article.assetRequests.map((item) => item.id);
  if (ids.some((id) => typeof id !== "string" || !id.trim())) {
    throw new Error("AssetRequest 缺少 ID");
  }
  if (new Set(ids).size !== ids.length) throw new Error("AssetRequest ID 重复");
}

function ensureRequiredAssetRequests(
  article: WorkingArticle,
  requiredAssetTypes: AssetRequestType[] | undefined,
): WorkingArticle {
  const next = structuredClone(article);
  const requestIds = new Set(next.assetRequests.map((request) => request.id));
  for (const type of requiredAssetTypes ?? []) {
    const existing = next.assetRequests.find((request) => request.type === type);
    if (existing) {
      existing.necessity = "essential";
      continue;
    }
    const request = requiredAssetRequest(type, next.source.title, requestIds);
    next.assetRequests.push(request);
    requestIds.add(request.id);
  }
  return next;
}

function requiredAssetRequest(
  type: AssetRequestType,
  title: string,
  existingIds: ReadonlySet<string>,
): AssetRequest {
  const label =
    type === "cover"
      ? "封面"
      : type === "illustration"
        ? "插图"
        : type === "diagram"
          ? "图解"
          : "图表";
  return {
    id: availableRequestId(`required-${type}`, existingIds),
    type,
    necessity: "essential",
    brief: `为文章《${title}》生成${label}`,
    alt: type === "cover" ? `${title}封面` : undefined,
  };
}

function availableRequestId(base: string, existingIds: ReadonlySet<string>): string {
  if (!existingIds.has(base)) return base;
  let suffix = 2;
  while (existingIds.has(`${base}-${suffix}`)) suffix += 1;
  return `${base}-${suffix}`;
}

function assertContentAsset(asset: ContentAsset, request: AssetRequest): void {
  if (!asset?.id?.trim()) throw new Error(`Provider 没有为 ${request.id} 返回资源 ID`);
  if (!asset.source?.uri?.trim()) throw new Error(`Provider 没有为 ${request.id} 返回资源 URI`);
  if (!asset.mediaType) throw new Error(`Provider 没有为 ${request.id} 返回资源类型`);
  if (!isContentAssetChecksum(asset.checksum)) {
    throw new Error(`Provider 没有为 ${request.id} 返回有效的资源 SHA-256`);
  }
}

function assetDiagnostic(
  sourceHash: string,
  request: AssetRequest,
  reason: string,
): ContentDiagnostic {
  return {
    sourceHash,
    code: DiagnosticCode.AssetRequestUnsupported,
    severity: request.necessity === "essential" ? "blocker" : "warning",
    scope: "asset",
    message:
      request.necessity === "essential"
        ? `必要资源 ${request.id} 无法生成：${reason}`
        : `已省略增强资源 ${request.id}：${reason}`,
    location: { assetRequestId: request.id },
  };
}
