import type { JsonValue } from "./json.ts";

type ValueOf<T> = T[keyof T];

export const ArticleResultKind = {
  ContentPackage: "content-package",
  ReviewRequest: "review-request",
  NoContent: "no-content",
} as const;
export type ArticleResultKind = ValueOf<typeof ArticleResultKind>;

export const ArticleSchemaVersion = {
  ContentPackage: "content-package.v5",
  ReviewRequest: "review-request.v2",
} as const;
export type ArticleSchemaVersion = ValueOf<typeof ArticleSchemaVersion>;

export const ArticleSourceFormat = {
  Markdown: "article-markdown.v1",
} as const;
export type ArticleSourceFormat = ValueOf<typeof ArticleSourceFormat>;

export const ArticleDocumentSchemaVersion = {
  Current: "article-document.v1",
} as const;
export type ArticleDocumentSchemaVersion = ValueOf<typeof ArticleDocumentSchemaVersion>;

export const MaterialMediaType = {
  Webpage: "webpage",
  Image: "image",
  Video: "video",
  Audio: "audio",
  Document: "document",
} as const;
export type MaterialMediaType = ValueOf<typeof MaterialMediaType>;

export const ContentAssetMediaType = {
  Image: "image",
  Video: "video",
  Audio: "audio",
  File: "file",
} as const;
export type ContentAssetMediaType = ValueOf<typeof ContentAssetMediaType>;

export const EvidenceLocatorType = {
  Text: "text",
  TimeRange: "time-range",
  Page: "page",
} as const;
export type EvidenceLocatorType = ValueOf<typeof EvidenceLocatorType>;

export const DiagnosticSeverity = {
  Info: "info",
  Warning: "warning",
  Error: "error",
  Blocker: "blocker",
} as const;
export type DiagnosticSeverity = ValueOf<typeof DiagnosticSeverity>;

export const DiagnosticScope = {
  Research: "research",
  Title: "title",
  Digest: "digest",
  Body: "body",
  Evidence: "evidence",
  Asset: "asset",
  Article: "article",
} as const;
export type DiagnosticScope = ValueOf<typeof DiagnosticScope>;

export const DiagnosticCode = {
  SourceInvalid: "source.invalid",
  TitleMissing: "title.missing",
  DigestMissing: "digest.missing",
  BodyMissing: "body.missing",
  EvidenceMissing: "evidence.missing",
  EvidenceMaterialMissing: "evidence.material_missing",
  EvidenceReferenceMissing: "evidence.reference_missing",
  AssetReferenceMissing: "asset.reference_missing",
  AssetRequestMissing: "asset.request_missing",
  AssetRequestUnsupported: "asset.request_unsupported",
} as const;
export type DiagnosticCode = ValueOf<typeof DiagnosticCode>;

export const ArticlePluginId = {
  TitleStyle: "title-style",
  EditorialQuality: "editorial-quality",
  EvidenceSupplement: "evidence-supplement",
  CoverImage: "cover-image",
} as const;
export type ArticlePluginId = ValueOf<typeof ArticlePluginId>;

export const ArticlePluginCapability = {
  Transformer: "transformer",
  Evaluator: "evaluator",
  EvidenceSupplementer: "evidence-supplementer",
  AssetProvider: "asset-provider",
} as const;
export type ArticlePluginCapability = ValueOf<typeof ArticlePluginCapability>;

export type ArticleMetadataValue = JsonValue;

export interface ContentIdentitySnapshot {
  id: string;
  name: string;
  positioning: string;
  audience: string;
  tone: string;
  forbiddenTopics?: string[];
  revision: number;
}

export interface ArticleInput {
  identity: ContentIdentitySnapshot;
  sourceSetId?: string;
  materials?: MaterialSnapshot[];
  requestedTopic?: string;
  requestedAt: string;
  metadata?: Record<string, ArticleMetadataValue>;
}

/** Immutable research material captured before composition. */
export interface MaterialSnapshot {
  id: string;
  mediaType: MaterialMediaType;
  title: string;
  sourceUrl?: string;
  content?: string;
  transcript?: string;
  durationMs?: number;
  publishedAt?: string;
  author?: string;
  sourceName?: string;
  retrievedAt: string;
  contentHash: string;
  snapshotRef?: string;
  metadata?: Record<string, ArticleMetadataValue>;
}

/** The small, traceable material record retained by a content package. */
export interface MaterialReference {
  id: string;
  mediaType: MaterialMediaType;
  title: string;
  sourceUrl?: string;
  publishedAt?: string;
  author?: string;
  sourceName?: string;
  retrievedAt: string;
  contentHash: string;
  snapshotRef?: string;
}

export type EvidenceLocator =
  | { type: typeof EvidenceLocatorType.Text; excerpt: string }
  | {
      type: typeof EvidenceLocatorType.TimeRange;
      startMs: number;
      endMs?: number;
      transcript?: string;
    }
  | { type: typeof EvidenceLocatorType.Page; page: number; excerpt?: string };

/** A concrete statement tied to a stable location in a material snapshot. */
export interface EvidenceUnit {
  id: string;
  statement: string;
  materialId: string;
  locator: EvidenceLocator;
}

/** The single hand-off from research to composition. */
export interface EditorialBrief {
  topic: string;
  angle: string;
  rationale: string;
  thesis: string;
  outline: string[];
  materials: MaterialSnapshot[];
  evidence: EvidenceUnit[];
  gaps: string[];
}

/** The only content format written directly by models or people. */
export interface ArticleSource {
  format: typeof ArticleSourceFormat.Markdown;
  title: string;
  digest: string;
  bodyMarkdown: string;
}

export type AssetRequestType = "cover" | "illustration" | "diagram" | "chart";
export type AssetNecessity = "enhancement" | "essential";

/** A production intent. It never appears unresolved in an ArticleDocument. */
export interface AssetRequest {
  id: string;
  type: AssetRequestType;
  necessity: AssetNecessity;
  brief: string;
  alt?: string;
  caption?: string;
}

/** Mutable only inside one pipeline run; it is not a persisted revision entity. */
export interface WorkingArticle {
  source: ArticleSource;
  assetRequests: AssetRequest[];
}

/** A completed channel-neutral resource. Uploading and transcoding remain publishing concerns. */
export interface ContentAsset {
  id: string;
  mediaType: ContentAssetMediaType;
  source: {
    uri: string;
    materialId?: string;
  };
  mimeType?: string;
  /** Canonical lowercase SHA-256 of the actual resource bytes, never of its URI. */
  checksum: string;
  width?: number;
  height?: number;
  durationMs?: number;
  title?: string;
  alt?: string;
  caption?: string;
  metadata?: Record<string, ArticleMetadataValue>;
}

export interface ArticleRootNode<TAssetNode extends ArticleAssetReferenceNode> {
  id: string;
  type: "root";
  children: ArticleBlockNode<TAssetNode>[];
}

export type ArticleBlockNode<TAssetNode extends ArticleAssetReferenceNode> =
  | ArticleHeadingNode<TAssetNode>
  | ArticleParagraphNode<TAssetNode>
  | ArticleBlockquoteNode<TAssetNode>
  | ArticleListNode<TAssetNode>
  | ArticleCodeNode
  | ArticleTableNode<TAssetNode>
  | ArticleHtmlNode
  | ArticleThematicBreakNode;

export interface ArticleHeadingNode<TAssetNode extends ArticleAssetReferenceNode> {
  id: string;
  type: "heading";
  depth: number;
  children: ArticleInlineNode<TAssetNode>[];
}

export interface ArticleParagraphNode<TAssetNode extends ArticleAssetReferenceNode> {
  id: string;
  type: "paragraph";
  children: ArticleInlineNode<TAssetNode>[];
}

export interface ArticleBlockquoteNode<TAssetNode extends ArticleAssetReferenceNode> {
  id: string;
  type: "blockquote";
  children: ArticleBlockNode<TAssetNode>[];
}

export interface ArticleListNode<TAssetNode extends ArticleAssetReferenceNode> {
  id: string;
  type: "list";
  ordered: boolean;
  start?: number;
  items: Array<{
    id: string;
    checked?: boolean;
    children: ArticleBlockNode<TAssetNode>[];
  }>;
}

export interface ArticleCodeNode {
  id: string;
  type: "code";
  language?: string;
  text: string;
}

export interface ArticleTableNode<TAssetNode extends ArticleAssetReferenceNode> {
  id: string;
  type: "table";
  header: ArticleInlineNode<TAssetNode>[][];
  rows: ArticleInlineNode<TAssetNode>[][][];
  align: Array<"left" | "center" | "right" | null>;
}

export interface ArticleHtmlNode {
  id: string;
  type: "html";
  html: string;
}

export interface ArticleThematicBreakNode {
  id: string;
  type: "thematic-break";
}

export type ArticleInlineNode<TAssetNode extends ArticleAssetReferenceNode> =
  | ArticleTextNode
  | ArticleEmphasisNode<TAssetNode>
  | ArticleStrongNode<TAssetNode>
  | ArticleStrikethroughNode<TAssetNode>
  | ArticleInlineCodeNode
  | ArticleLinkNode<TAssetNode>
  | ArticleCitationNode
  | ArticleRemoteImageNode
  | ArticleLineBreakNode
  | TAssetNode;

export interface ArticleTextNode {
  id: string;
  type: "text";
  text: string;
}

export interface ArticleEmphasisNode<TAssetNode extends ArticleAssetReferenceNode> {
  id: string;
  type: "emphasis";
  children: ArticleInlineNode<TAssetNode>[];
}

export interface ArticleStrongNode<TAssetNode extends ArticleAssetReferenceNode> {
  id: string;
  type: "strong";
  children: ArticleInlineNode<TAssetNode>[];
}

export interface ArticleStrikethroughNode<TAssetNode extends ArticleAssetReferenceNode> {
  id: string;
  type: "strikethrough";
  children: ArticleInlineNode<TAssetNode>[];
}

export interface ArticleInlineCodeNode {
  id: string;
  type: "inline-code";
  text: string;
}

export interface ArticleLinkNode<TAssetNode extends ArticleAssetReferenceNode> {
  id: string;
  type: "link";
  href: string;
  title?: string;
  children: ArticleInlineNode<TAssetNode>[];
}

export interface ArticleCitationNode {
  id: string;
  type: "citation";
  evidenceId: string;
  label: string;
}

export interface ArticleRemoteImageNode {
  id: string;
  type: "remote-image";
  sourceUrl: string;
  alt: string;
  title?: string;
}

export interface ArticleLineBreakNode {
  id: string;
  type: "line-break";
}

export type ArticleAssetReferenceNode = ArticleAssetRequestNode | ArticleAssetNode;

export interface ArticleAssetRequestNode {
  id: string;
  type: "asset-request";
  requestId: string;
  alt: string;
  title?: string;
}

export interface ArticleAssetNode {
  id: string;
  type: "asset";
  assetId: string;
  alt: string;
  title?: string;
  caption?: string;
}

/** Frozen, executable document IR. It contains no unresolved production intent. */
export interface ArticleDocument {
  schemaVersion: typeof ArticleDocumentSchemaVersion.Current;
  title: string;
  digest: string;
  root: ArticleRootNode<ArticleAssetNode>;
  coverAssetId?: string;
}

export interface ContentDiagnostic {
  sourceHash: string;
  code: string;
  severity: DiagnosticSeverity;
  scope: DiagnosticScope;
  message: string;
  location?: {
    nodeId?: string;
    evidenceId?: string;
    assetRequestId?: string;
  };
  suggestion?: string;
  details?: Record<string, ArticleMetadataValue>;
}

export interface QualityReport {
  id: string;
  sourceHash: string;
  policyVersion: string;
  diagnostics: ContentDiagnostic[];
  evaluatedAt: string;
}

export interface ContentPackage {
  schemaVersion: typeof ArticleSchemaVersion.ContentPackage;
  id: string;
  checksum: string;
  source: ArticleSource;
  document: ArticleDocument;
  evidence: EvidenceUnit[];
  materials: MaterialReference[];
  assets: ContentAsset[];
  identity: ContentIdentitySnapshot;
  build: {
    sourceHash: string;
    compilerVersion: string;
  };
  quality: {
    reportId: string;
    policyVersion: string;
    warnings: ContentDiagnostic[];
  };
  origin: {
    jobId: string;
    planId: string;
    planRevision: number;
    parentPackageId?: string;
  };
  createdAt: string;
}

export interface ReviewRequest {
  schemaVersion: typeof ArticleSchemaVersion.ReviewRequest;
  id: string;
  article: WorkingArticle;
  brief: EditorialBrief;
  identity: ContentIdentitySnapshot;
  quality: QualityReport;
  createdAt: string;
}

export interface NoContent {
  reason: string;
  details?: Record<string, ArticleMetadataValue>;
}
