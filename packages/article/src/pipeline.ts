import { ArticleResultKind, ArticleSchemaVersion, DiagnosticCode } from "@trendpublish/contracts";
import { describeUnknown, fingerprint, type TaskContext } from "@trendpublish/runtime";
import {
  ArticleCompiler,
  normalizeDiagnostics,
  type ArticleInspection,
  type AssetResolution,
} from "./compiler.ts";
import { isContentAssetChecksum } from "./asset-integrity.ts";
import { evidenceLocatorIssues } from "./evidence.ts";
import type {
  ArticleEvaluation,
  ArticleEvidenceSupplementer,
  ArticleEvaluator,
  ArticleOperationContext,
  ArticleResearcher,
  ArticleReviser,
  ArticleTransformer,
  ArticleWriter,
  AssetProvider,
  EvidenceNeed,
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
  EvidenceUnit,
  MaterialSnapshot,
  NoContent,
  QualityReport,
  ReviewRequest,
  WorkingArticle,
} from "./domain.ts";
import { isBlockingDiagnostic } from "./domain.ts";

export interface ArticleExecutionPlan {
  id: string;
  revision: number;
  parentPackageId?: string;
  /** Channel-neutral asset capabilities that every successful package from this plan must contain. */
  requiredAssetTypes?: AssetRequestType[];
  researcher: ArticleResearcher;
  writer: ArticleWriter;
  transformers?: ArticleTransformer[];
  evaluators?: ArticleEvaluator[];
  evidenceSupplementer?: ArticleEvidenceSupplementer;
  reviser?: ArticleReviser;
  assetProviders?: Partial<Record<AssetRequestType, AssetProvider>>;
  quality?: {
    policyVersion?: string;
    maxQualityRounds?: number;
  };
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

export type ArticlePipelineResult =
  | { kind: typeof ArticleResultKind.NoContent; noContent: NoContent }
  | { kind: typeof ArticleResultKind.ReviewRequest; reviewRequest: ReviewRequest }
  | { kind: typeof ArticleResultKind.ContentPackage; contentPackage: ContentPackage };

export interface ArticlePipelineOptions {
  compiler?: ArticleCompiler;
  packageBuilder?: ContentPackageBuilder;
  now?: () => Date;
  idFactory?: () => string;
}

/** Fixed article production line: research, compose, transform, quality and build. */
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
    const research = await this.research(request);
    if (research.kind === "no-content") {
      return { kind: ArticleResultKind.NoContent, noContent: research.noContent };
    }

    const brief = research.brief;
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
  ): Promise<ArticlePipelineResult> {
    const requiredArticle = ensureRequiredAssetRequests(article, request.plan.requiredAssetTypes);
    const qualityResult = await this.runQualityLoop(
      request,
      brief,
      requiredArticle,
      operationalWarnings,
    );
    if (qualityResult.kind === "rejected") {
      const reviewRequest = await this.createReviewRequest(
        request,
        qualityResult.brief,
        qualityResult.article,
        qualityResult.quality,
        "quality/review-request",
      );
      return { kind: ArticleResultKind.ReviewRequest, reviewRequest };
    }
    return await this.build(
      request,
      qualityResult.brief,
      qualityResult.article,
      qualityResult.quality,
    );
  }

  private async research(request: RunArticlePipelineRequest) {
    const researcher = request.plan.researcher;
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

  private async runQualityLoop(
    request: RunArticlePipelineRequest,
    initialBrief: EditorialBrief,
    initial: WorkingArticle,
    operationalWarnings: ContentDiagnostic[],
  ): Promise<QualityLoopResult> {
    const maxRounds = Math.max(0, request.plan.quality?.maxQualityRounds ?? 2);
    const policyVersion = request.plan.quality?.policyVersion ?? "1";
    const seen = new Set<string>();
    const qualityWarnings = structuredClone(operationalWarnings);
    let brief = structuredClone(initialBrief);
    let article = structuredClone(initial);

    for (let round = 0; ; round += 1) {
      const inspection = await this.compiler.inspect({
        article,
        evidence: brief.evidence,
        materials: brief.materials,
      });
      const evaluation = await this.evaluate(request, brief, article, inspection, round);
      const diagnostics = normalizeDiagnostics([
        ...inspection.diagnostics,
        ...qualityWarnings.map((warning) => ({
          ...warning,
          sourceHash: inspection.view.sourceHash,
        })),
        ...evaluation.diagnostics,
      ]);
      const blockers = diagnostics.filter(isBlockingDiagnostic);
      if (!blockers.length) {
        const quality = await this.qualityReport(
          request.task,
          request.plan,
          policyVersion,
          inspection.view.sourceHash,
          diagnostics,
          `quality/report/${round + 1}`,
        );
        return { kind: "accepted", brief, article, quality };
      }

      if (blockers.every(isEvaluatorUnavailable) && round < maxRounds) {
        continue;
      }

      const stateHash = await fingerprint({
        article,
        blockers,
        evidence: brief.evidence,
        materials: brief.materials.map((material) => ({
          id: material.id,
          contentHash: material.contentHash,
        })),
      });
      const cannotRevise = !request.plan.reviser || round >= maxRounds || seen.has(stateHash);
      if (cannotRevise) {
        const quality = await this.qualityReport(
          request.task,
          request.plan,
          policyVersion,
          inspection.view.sourceHash,
          diagnostics,
          `quality/report/${round + 1}`,
        );
        return { kind: "rejected", brief, article, quality };
      }
      seen.add(stateHash);
      const previousBrief = structuredClone(brief);
      const previous = structuredClone(article);
      const blockerCodes = new Set(blockers.map((diagnostic) => diagnostic.code));
      const evidenceNeeds = evaluation.evidenceNeeds.filter((need) =>
        blockerCodes.has(need.diagnosticCode),
      );
      let addedEvidenceIds: string[] = [];
      if (evidenceNeeds.length && request.plan.evidenceSupplementer) {
        const supplementer = request.plan.evidenceSupplementer;
        const supplemented = await request.task.run<EvidenceSupplementStep>(
          {
            id: `quality/supplement/${round + 1}-${supplementer.id}`,
            version: supplementer.version,
            input: {
              plan: planFingerprint(request.plan),
              supplementerId: supplementer.id,
              article: previous,
              brief,
              evidenceNeeds,
            },
            optional: true,
            fallback: (error): EvidenceSupplementStep => ({
              brief,
              addedEvidenceIds: [],
              warning: {
                sourceHash: inspection.view.sourceHash,
                code: `evidence-supplementer.${supplementer.id}.unavailable`,
                severity: "warning",
                scope: "evidence",
                message: describeUnknown(error),
              },
            }),
          },
          async (signal) => {
            const supplement = await supplementer.supplement(
              {
                article: previous,
                view: structuredClone(inspection.view),
                brief: structuredClone(brief),
                identity: structuredClone(request.input.identity),
                needs: structuredClone(evidenceNeeds),
              },
              this.context(
                request.task.scope(`quality/supplement/${round + 1}-${supplementer.id}/internal`),
                signal,
              ),
            );
            return mergeEvidenceSupplement(brief, supplement);
          },
        );
        brief = supplemented.brief;
        addedEvidenceIds = supplemented.addedEvidenceIds;
        if (supplemented.warning) qualityWarnings.push(supplemented.warning);
      }
      const reviser = request.plan.reviser!;
      article = await request.task.run(
        {
          id: `quality/revise/${round + 1}`,
          version: reviser.version,
          input: {
            plan: planFingerprint(request.plan),
            reviserId: reviser.id,
            article: previous,
            diagnostics: blockers,
            brief,
            addedEvidenceIds,
          },
        },
        async (signal) => {
          const revised = await reviser.revise(
            {
              article: previous,
              view: structuredClone(inspection.view),
              brief: structuredClone(brief),
              identity: structuredClone(request.input.identity),
              diagnostics: structuredClone(blockers),
              addedEvidenceIds: structuredClone(addedEvidenceIds),
            },
            this.context(request.task.scope(`quality/revise/${round + 1}/internal`), signal),
          );
          assertWorkingArticle(revised);
          return structuredClone(revised);
        },
      );
      if (
        (await fingerprint({ article: previous, brief: previousBrief })) ===
        (await fingerprint({ article, brief }))
      ) {
        const quality = await this.qualityReport(
          request.task,
          request.plan,
          policyVersion,
          inspection.view.sourceHash,
          diagnostics,
          `quality/report/${round + 1}`,
        );
        return { kind: "rejected", brief, article, quality };
      }
    }
  }

  private async evaluate(
    request: RunArticlePipelineRequest,
    brief: EditorialBrief,
    article: WorkingArticle,
    inspection: ArticleInspection,
    round: number,
  ): Promise<ArticleEvaluation> {
    const diagnostics: ContentDiagnostic[] = [];
    const evidenceNeeds: EvidenceNeed[] = [];
    for (const [index, evaluator] of (request.plan.evaluators ?? []).entries()) {
      const value = await request.task.run<ArticleEvaluation>(
        {
          id: `quality/evaluate/${round + 1}/${index + 1}-${evaluator.id}`,
          version: evaluator.version,
          input: {
            plan: planFingerprint(request.plan),
            evaluatorId: evaluator.id,
            article,
            brief,
          },
          optional: true,
          fallback: (error) => ({
            diagnostics: [
              {
                sourceHash: inspection.view.sourceHash,
                code: `evaluator.${evaluator.id}.unavailable`,
                severity: "blocker",
                scope: "article",
                message: describeUnknown(error),
              },
            ],
            evidenceNeeds: [],
          }),
        },
        async (signal) => {
          const result = await evaluator.evaluate(
            {
              article: structuredClone(article),
              view: structuredClone(inspection.view),
              brief: structuredClone(brief),
              identity: structuredClone(request.input.identity),
            },
            this.context(
              request.task.scope(
                `quality/evaluate/${round + 1}/${index + 1}-${evaluator.id}/internal`,
              ),
              signal,
            ),
          );
          assertArticleEvaluation(result, evaluator.id);
          return result;
        },
      );
      diagnostics.push(
        ...value.diagnostics.map((diagnostic) => ({
          ...structuredClone(diagnostic),
          sourceHash: inspection.view.sourceHash,
        })),
      );
      evidenceNeeds.push(...structuredClone(value.evidenceNeeds));
    }
    if (new Set(evidenceNeeds.map((need) => need.id)).size !== evidenceNeeds.length) {
      throw new Error("Evaluator 返回了重复的 EvidenceNeed ID");
    }
    return { diagnostics, evidenceNeeds };
  }

  private async qualityReport(
    task: TaskContext,
    plan: ArticleExecutionPlan,
    policyVersion: string,
    sourceHash: string,
    diagnostics: ContentDiagnostic[],
    taskId: string,
  ): Promise<QualityReport> {
    return await task.run(
      {
        id: taskId,
        version: "1",
        input: { plan: planFingerprint(plan), policyVersion, sourceHash, diagnostics },
      },
      async () => ({
        id: `quality_${this.idFactory()}`,
        sourceHash,
        policyVersion,
        diagnostics: structuredClone(diagnostics),
        evaluatedAt: this.now().toISOString(),
      }),
    );
  }

  private async build(
    request: RunArticlePipelineRequest,
    brief: EditorialBrief,
    article: WorkingArticle,
    quality: QualityReport,
  ): Promise<
    | { kind: typeof ArticleResultKind.ReviewRequest; reviewRequest: ReviewRequest }
    | { kind: typeof ArticleResultKind.ContentPackage; contentPackage: ContentPackage }
  > {
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
      ...quality.diagnostics,
      ...resolutionResult.diagnostics,
      ...compilation.diagnostics,
    ]);
    const finalQuality: QualityReport = {
      ...quality,
      diagnostics: finalDiagnostics,
    };
    if (finalDiagnostics.some(isBlockingDiagnostic)) {
      const rejectedQuality = await this.qualityReport(
        request.task,
        request.plan,
        quality.policyVersion,
        inspection.view.sourceHash,
        finalDiagnostics,
        "build/report",
      );
      const reviewRequest = await this.createReviewRequest(
        request,
        brief,
        article,
        rejectedQuality,
        "build/review-request",
      );
      return { kind: ArticleResultKind.ReviewRequest, reviewRequest };
    }
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

  private async createReviewRequest(
    request: RunArticlePipelineRequest,
    brief: EditorialBrief,
    article: WorkingArticle,
    quality: QualityReport,
    taskId: string,
  ): Promise<ReviewRequest> {
    return await request.task.run(
      {
        id: taskId,
        version: "2",
        input: {
          plan: planFingerprint(request.plan),
          article,
          brief,
          quality,
          identity: request.input.identity,
        },
      },
      async () => ({
        schemaVersion: ArticleSchemaVersion.ReviewRequest,
        id: `review_${this.idFactory()}`,
        article: structuredClone(article),
        brief: structuredClone(brief),
        identity: structuredClone(request.input.identity),
        quality: structuredClone(quality),
        createdAt: this.now().toISOString(),
      }),
    );
  }

  private context(task: TaskContext, signal: AbortSignal): ArticleOperationContext {
    return { task, signal, now: this.now };
  }
}

type QualityLoopResult =
  | { kind: "accepted"; brief: EditorialBrief; article: WorkingArticle; quality: QualityReport }
  | { kind: "rejected"; brief: EditorialBrief; article: WorkingArticle; quality: QualityReport };

interface TransformerStep {
  article: WorkingArticle;
  warning?: ContentDiagnostic;
}

interface AssetStep {
  resolution?: AssetResolution;
  diagnostic?: ContentDiagnostic;
}

interface EvidenceSupplementStep {
  brief: EditorialBrief;
  addedEvidenceIds: string[];
  warning?: ContentDiagnostic;
}

function assertArticleEvaluation(
  value: ArticleEvaluation,
  evaluatorId: string,
): asserts value is ArticleEvaluation {
  if (!value || typeof value !== "object") {
    throw new Error(`Evaluator ${evaluatorId} 返回格式无效`);
  }
  if (!Array.isArray(value.diagnostics) || !Array.isArray(value.evidenceNeeds)) {
    throw new Error(`Evaluator ${evaluatorId} 必须返回 diagnostics 和 evidenceNeeds`);
  }
  for (const need of value.evidenceNeeds) {
    if (
      !need ||
      typeof need.id !== "string" ||
      !need.id.trim() ||
      typeof need.diagnosticCode !== "string" ||
      !need.diagnosticCode.trim() ||
      typeof need.question !== "string" ||
      !need.question.trim()
    ) {
      throw new Error(`Evaluator ${evaluatorId} 返回了无效 EvidenceNeed`);
    }
  }
}

function mergeEvidenceSupplement(
  brief: EditorialBrief,
  supplement: { materials: MaterialSnapshot[]; evidence: EvidenceUnit[] },
): EvidenceSupplementStep {
  if (!supplement || !Array.isArray(supplement.materials) || !Array.isArray(supplement.evidence)) {
    throw new Error("EvidenceSupplementer 必须返回 materials 和 evidence");
  }
  if (!supplement.evidence.length) {
    return { brief: structuredClone(brief), addedEvidenceIds: [] };
  }

  const existingMaterialIds = new Set(brief.materials.map((material) => material.id));
  const existingMaterialHashes = new Set(brief.materials.map((material) => material.contentHash));
  const suppliedMaterialIds = new Set<string>();
  const suppliedMaterialHashes = new Set<string>();
  for (const material of supplement.materials) {
    if (
      !material ||
      typeof material.id !== "string" ||
      !material.id.trim() ||
      typeof material.title !== "string" ||
      !material.title.trim() ||
      typeof material.contentHash !== "string" ||
      !material.contentHash.trim() ||
      typeof material.retrievedAt !== "string" ||
      !material.retrievedAt.trim()
    ) {
      throw new Error("EvidenceSupplementer 返回了无效 MaterialSnapshot");
    }
    if (existingMaterialIds.has(material.id) || suppliedMaterialIds.has(material.id)) {
      throw new Error(`EvidenceSupplementer 返回了重复素材 ID：${material.id}`);
    }
    if (
      existingMaterialHashes.has(material.contentHash) ||
      suppliedMaterialHashes.has(material.contentHash)
    ) {
      throw new Error(`EvidenceSupplementer 返回了重复素材内容：${material.id}`);
    }
    suppliedMaterialIds.add(material.id);
    suppliedMaterialHashes.add(material.contentHash);
  }

  const allMaterials = [...brief.materials, ...supplement.materials];
  const materialById = new Map(allMaterials.map((material) => [material.id, material]));
  const evidenceIds = new Set(brief.evidence.map((evidence) => evidence.id));
  const referencedMaterialIds = new Set<string>();
  for (const evidence of supplement.evidence) {
    if (
      !evidence ||
      typeof evidence.id !== "string" ||
      !evidence.id.trim() ||
      typeof evidence.statement !== "string" ||
      !evidence.statement.trim() ||
      typeof evidence.materialId !== "string" ||
      !evidence.materialId.trim()
    ) {
      throw new Error("EvidenceSupplementer 返回了无效 EvidenceUnit");
    }
    if (evidenceIds.has(evidence.id)) {
      throw new Error(`EvidenceSupplementer 返回了重复证据 ID：${evidence.id}`);
    }
    evidenceIds.add(evidence.id);
    const material = materialById.get(evidence.materialId);
    if (!material) {
      throw new Error(`EvidenceSupplementer 的证据引用了不存在的素材：${evidence.materialId}`);
    }
    const issues = evidenceLocatorIssues(evidence, material);
    if (issues.length) throw new Error(issues.map((issue) => issue.message).join("；"));
    referencedMaterialIds.add(evidence.materialId);
  }

  const addedMaterials = supplement.materials.filter((material) =>
    referencedMaterialIds.has(material.id),
  );
  return {
    brief: {
      ...structuredClone(brief),
      materials: [...structuredClone(brief.materials), ...structuredClone(addedMaterials)],
      evidence: [...structuredClone(brief.evidence), ...structuredClone(supplement.evidence)],
    },
    addedEvidenceIds: supplement.evidence.map((evidence) => evidence.id),
  };
}

function validateExecutionPlan(plan: ArticleExecutionPlan): void {
  if (!plan.id.trim()) throw new Error("ArticleExecutionPlan 缺少 ID");
  if (!Number.isInteger(plan.revision) || plan.revision < 1) {
    throw new Error("ArticleExecutionPlan revision 必须为正整数");
  }
  const ids = [
    ...(plan.transformers ?? []).map((extension) => `transformer:${extension.id}`),
    ...(plan.evaluators ?? []).map((extension) => `evaluator:${extension.id}`),
    ...(plan.evidenceSupplementer ? [`evidence-supplementer:${plan.evidenceSupplementer.id}`] : []),
    ...(plan.reviser ? [`reviser:${plan.reviser.id}`] : []),
  ];
  if (new Set(ids).size !== ids.length) throw new Error("ArticleExecutionPlan 包含重复插件 ID");
  const requiredAssetTypes = plan.requiredAssetTypes ?? [];
  if (new Set(requiredAssetTypes).size !== requiredAssetTypes.length) {
    throw new Error("ArticleExecutionPlan 包含重复的必要资源类型");
  }
}

function planFingerprint(plan: ArticleExecutionPlan): { planId: string; planRevision: number } {
  return { planId: plan.id, planRevision: plan.revision };
}

function isEvaluatorUnavailable(diagnostic: ContentDiagnostic): boolean {
  return diagnostic.code.startsWith("evaluator.") && diagnostic.code.endsWith(".unavailable");
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
