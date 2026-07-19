import {
  ArticlePluginId,
  DiagnosticScope,
  DiagnosticSeverity,
  type DiagnosticSeverity as DiagnosticSeverityValue,
} from "@trendpublish/contracts";
import type { ContentDiagnostic } from "../domain.ts";
import type {
  ArticleEvaluation,
  ArticleEvaluator,
  ArticleOperationContext,
  EvidenceNeed,
} from "../extensions.ts";
import { parseModelJson, type LanguageModel } from "../operations/language-model.ts";

export interface EditorialQualityEvaluatorOptions {
  languageModel: LanguageModel;
  severity?: Exclude<DiagnosticSeverityValue, typeof DiagnosticSeverity.Info>;
  standards?: string[];
}

export class EditorialQualityEvaluator implements ArticleEvaluator {
  readonly id = ArticlePluginId.EditorialQuality;
  readonly version = "1";

  constructor(private readonly options: EditorialQualityEvaluatorOptions) {}

  async evaluate(
    input: Parameters<ArticleEvaluator["evaluate"]>[0],
    context: ArticleOperationContext,
  ): Promise<ArticleEvaluation> {
    const result = parseModelJson<{
      issues?: Array<Partial<ContentDiagnostic> & { code?: string; message?: string }>;
      evidenceNeeds?: Array<{ diagnosticCode?: string; question?: string }>;
    }>(
      await this.options.languageModel.generate({
        system: `你是严格但克制的内容主编。检查事实边界、论证完整性、结构、重复、账号一致性和读者价值。只报告会真实降低成品质量的问题。需要补充外部证据的问题，scope 必须是 evidence，并在 evidenceNeeds 中说明需要回答的事实问题；不要自行生成搜索词。${this.options.standards?.length ? `\n额外标准：\n- ${this.options.standards.join("\n- ")}` : ""}\n返回 JSON：{issues:[{code,severity,scope,message,suggestion}],evidenceNeeds:[{diagnosticCode,question}]}。`,
        user: JSON.stringify({
          identity: input.identity,
          source: input.article.source,
          evidence: input.brief.evidence,
          gaps: input.brief.gaps,
        }),
        temperature: 0.1,
        json: true,
        signal: context.signal,
        events: context.task,
      }),
    );
    const diagnostics = normalizeIssues(
      result.issues ?? [],
      input.view.sourceHash,
      this.options.severity ?? DiagnosticSeverity.Error,
    );
    return {
      diagnostics,
      evidenceNeeds: normalizeEvidenceNeeds(result.evidenceNeeds ?? [], diagnostics, this.id),
    };
  }
}

function normalizeEvidenceNeeds(
  values: Array<{ diagnosticCode?: string; question?: string }>,
  diagnostics: ContentDiagnostic[],
  evaluatorId: string,
): EvidenceNeed[] {
  const evidenceCodes = new Set(
    diagnostics
      .filter((diagnostic) => diagnostic.scope === DiagnosticScope.Evidence)
      .map((diagnostic) => diagnostic.code),
  );
  return values
    .filter(
      (value): value is { diagnosticCode: string; question: string } =>
        typeof value.diagnosticCode === "string" &&
        evidenceCodes.has(value.diagnosticCode.trim()) &&
        typeof value.question === "string" &&
        Boolean(value.question.trim()),
    )
    .map((value, index) => ({
      id: `${evaluatorId}:evidence-need:${index + 1}`,
      diagnosticCode: value.diagnosticCode.trim(),
      question: value.question.trim(),
    }));
}

function normalizeIssues(
  issues: Array<Partial<ContentDiagnostic> & { code?: string; message?: string }>,
  sourceHash: string,
  defaultSeverity: DiagnosticSeverityValue,
): ContentDiagnostic[] {
  const severities = new Set<DiagnosticSeverityValue>(Object.values(DiagnosticSeverity));
  const scopes = new Set(Object.values(DiagnosticScope));
  return issues
    .filter(
      (issue): issue is typeof issue & { code: string; message: string } =>
        typeof issue.code === "string" &&
        Boolean(issue.code.trim()) &&
        typeof issue.message === "string" &&
        Boolean(issue.message.trim()),
    )
    .map((issue) => ({
      sourceHash,
      code: issue.code.trim(),
      message: issue.message.trim(),
      severity: severities.has(issue.severity as DiagnosticSeverityValue)
        ? (issue.severity as DiagnosticSeverityValue)
        : defaultSeverity,
      scope: scopes.has(issue.scope as never)
        ? (issue.scope as ContentDiagnostic["scope"])
        : "article",
      ...(typeof issue.suggestion === "string" && issue.suggestion.trim()
        ? { suggestion: issue.suggestion.trim() }
        : {}),
    }));
}
