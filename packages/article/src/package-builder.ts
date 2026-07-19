import { ArticleSchemaVersion } from "@trendpublish/contracts";
import { fingerprint } from "@trendpublish/runtime";
import {
  decodeContentDataUri,
  isContentAssetChecksum,
  verifyContentAssetChecksum,
} from "./asset-integrity.ts";
import type { ArticleCompilation } from "./compiler.ts";
import type {
  ArticleAssetNode,
  ArticleBlockNode,
  ArticleDocument,
  ArticleInlineNode,
  ContentAsset,
  ContentIdentitySnapshot,
  ContentPackage,
  EditorialBrief,
  EvidenceUnit,
  MaterialSnapshot,
  QualityReport,
  WorkingArticle,
} from "./domain.ts";
import { isBlockingDiagnostic, materialReference } from "./domain.ts";
import { evidenceLocatorIssues } from "./evidence.ts";

export interface ContentPackageOrigin {
  jobId: string;
  planId: string;
  planRevision: number;
  parentPackageId?: string;
}

export interface BuildContentPackageInput {
  article: WorkingArticle;
  compilation: ArticleCompilation;
  brief: EditorialBrief;
  assets: ContentAsset[];
  identity: ContentIdentitySnapshot;
  quality: QualityReport;
  compilerVersion: string;
  origin: ContentPackageOrigin;
  createdAt: string;
}

export class ContentPackageBuildError extends Error {
  constructor(readonly reasons: string[]) {
    super(`无法构造 ContentPackage：${reasons.join("；")}`);
    this.name = "ContentPackageBuildError";
  }
}

/** The one final invariant boundary; there is no separate final quality gate. */
export class ContentPackageBuilder {
  constructor(private readonly idFactory: () => string = () => crypto.randomUUID()) {}

  async build(input: BuildContentPackageInput): Promise<ContentPackage> {
    const reasons = await validatePackageInput(input);
    if (reasons.length) throw new ContentPackageBuildError(reasons);

    const id = `content_${this.idFactory()}`;
    const payload = persistedJson({
      schemaVersion: ArticleSchemaVersion.ContentPackage,
      id,
      source: input.article.source,
      document: input.compilation.document,
      evidence: input.brief.evidence,
      materials: input.brief.materials.map(materialReference),
      assets: input.assets,
      identity: input.identity,
      build: {
        sourceHash: input.compilation.sourceHash,
        compilerVersion: input.compilerVersion,
      },
      quality: {
        reportId: input.quality.id,
        policyVersion: input.quality.policyVersion,
        warnings: input.quality.diagnostics.filter(
          (diagnostic) => diagnostic.severity === "info" || diagnostic.severity === "warning",
        ),
      },
      origin: input.origin,
      createdAt: input.createdAt,
    });
    const checksum = await computeContentPackageChecksum(payload);
    return { ...payload, checksum };
  }
}

export async function computeContentPackageChecksum(
  value: Omit<ContentPackage, "checksum">,
): Promise<string> {
  return await fingerprint(persistedJson(value));
}

export async function verifyContentPackageChecksum(value: ContentPackage): Promise<boolean> {
  const { checksum, ...payload } = persistedJson(value);
  return checksum === (await computeContentPackageChecksum(payload));
}

async function validatePackageInput(input: BuildContentPackageInput): Promise<string[]> {
  const reasons: string[] = [];
  if (input.quality.sourceHash !== input.compilation.sourceHash) {
    reasons.push("质量报告不属于最终文章来源");
  }
  if ((await fingerprint(input.article.source)) !== input.compilation.sourceHash) {
    reasons.push("文章来源与编译结果不一致");
  }
  const blocking = [...input.quality.diagnostics, ...input.compilation.diagnostics].filter(
    isBlockingDiagnostic,
  );
  if (blocking.length) reasons.push(`存在 ${blocking.length} 个阻断问题`);
  if (input.compilation.document.title !== input.article.source.title.trim()) {
    reasons.push("Document 标题与 Source 不一致");
  }
  if (input.compilation.document.digest !== input.article.source.digest.trim()) {
    reasons.push("Document 摘要与 Source 不一致");
  }

  const materialIds = uniqueIds(input.brief.materials, "素材", reasons);
  const evidenceIds = uniqueIds(input.brief.evidence, "证据", reasons);
  const assetIds = uniqueIds(input.assets, "资源", reasons);
  const materialById = new Map(input.brief.materials.map((material) => [material.id, material]));
  for (const evidence of input.brief.evidence) {
    if (!materialIds.has(evidence.materialId)) {
      reasons.push(`证据 ${evidence.id} 引用了不存在的素材 ${evidence.materialId}`);
    }
    reasons.push(...packageEvidenceLocatorReasons(evidence, materialById.get(evidence.materialId)));
  }
  for (const asset of input.assets) {
    if (asset.source.materialId && !materialIds.has(asset.source.materialId)) {
      reasons.push(`资源 ${asset.id} 引用了不存在的素材 ${asset.source.materialId}`);
    }
    if (!asset.source.uri.trim()) reasons.push(`资源 ${asset.id} 缺少 URI`);
    if (!isContentAssetChecksum(asset.checksum)) {
      reasons.push(`资源 ${asset.id} 缺少有效的 SHA-256 校验和`);
    } else if (asset.source.uri.startsWith("data:")) {
      try {
        const { bytes } = decodeContentDataUri(asset.source.uri);
        if (!(await verifyContentAssetChecksum(bytes, asset.checksum))) {
          reasons.push(`资源 ${asset.id} 的 SHA-256 与实际内容不一致`);
        }
      } catch {
        reasons.push(`资源 ${asset.id} 的 Data URI 无效`);
      }
    }
  }
  validateDocument(input.compilation.document, evidenceIds, assetIds, reasons);
  return [...new Set(reasons)];
}

function validateDocument(
  document: ArticleDocument,
  evidenceIds: Set<string>,
  assetIds: Set<string>,
  reasons: string[],
): void {
  if (document.coverAssetId && !assetIds.has(document.coverAssetId)) {
    reasons.push(`封面引用了不存在的资源 ${document.coverAssetId}`);
  }
  let validCitationCount = 0;
  const visitInline = (node: ArticleInlineNode<ArticleAssetNode>): void => {
    if (node.type === "citation" && !evidenceIds.has(node.evidenceId)) {
      reasons.push(`Document 引用了不存在的证据 ${node.evidenceId}`);
    } else if (node.type === "citation") {
      validCitationCount += 1;
    } else if (node.type === "asset" && !assetIds.has(node.assetId)) {
      reasons.push(`Document 引用了不存在的资源 ${node.assetId}`);
    } else if (node.type === "remote-image") {
      reasons.push(`Document 残留远程图片 ${node.sourceUrl}`);
    } else if (
      node.type === "emphasis" ||
      node.type === "strong" ||
      node.type === "strikethrough" ||
      node.type === "link"
    ) {
      node.children.forEach(visitInline);
    }
  };
  const visitBlock = (node: ArticleBlockNode<ArticleAssetNode>): void => {
    if (node.type === "html") reasons.push("Document 残留原始 HTML");
    else if (node.type === "heading" || node.type === "paragraph") {
      node.children.forEach(visitInline);
    } else if (node.type === "blockquote") node.children.forEach(visitBlock);
    else if (node.type === "list") {
      node.items.forEach((item) => item.children.forEach(visitBlock));
    } else if (node.type === "table") {
      node.header.forEach((cell) => cell.forEach(visitInline));
      node.rows.forEach((row) => row.forEach((cell) => cell.forEach(visitInline)));
    }
  };
  document.root.children.forEach(visitBlock);
  if (validCitationCount === 0) reasons.push("Document 至少需要引用一条有效证据");
}

function packageEvidenceLocatorReasons(
  evidence: EvidenceUnit,
  material?: MaterialSnapshot,
): string[] {
  return evidenceLocatorIssues(evidence, material).map((issue) => issue.message);
}

function uniqueIds(values: Array<{ id: string }>, label: string, reasons: string[]): Set<string> {
  const ids = new Set<string>();
  for (const value of values) {
    if (!value.id.trim()) reasons.push(`${label}缺少 ID`);
    else if (ids.has(value.id)) reasons.push(`${label} ID 重复：${value.id}`);
    ids.add(value.id);
  }
  return ids;
}

/** Mirrors JSON persistence before checksumming, so undefined never changes the hash later. */
function persistedJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}
