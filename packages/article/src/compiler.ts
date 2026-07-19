import {
  ArticleDocumentSchemaVersion,
  ArticleSourceFormat,
  DiagnosticCode,
} from "@trendpublish/contracts";
import { fingerprint } from "@trendpublish/runtime";
import { marked } from "marked";
import type {
  ArticleAssetNode,
  ArticleAssetRequestNode,
  ArticleBlockNode,
  ArticleDocument,
  ArticleInlineNode,
  ArticleRootNode,
  ArticleView,
  AssetRequest,
  ContentAsset,
  ContentDiagnostic,
  EvidenceUnit,
  MaterialSnapshot,
  WorkingArticle,
} from "./domain.ts";
import { EvidenceDiagnosticCode, evidenceLocatorIssues } from "./evidence.ts";

type MarkedToken = {
  type: string;
  raw?: string;
  text?: string;
  depth?: number;
  ordered?: boolean;
  start?: number | "";
  checked?: boolean;
  lang?: string;
  href?: string;
  title?: string | null;
  tokens?: MarkedToken[];
  items?: MarkedToken[];
  header?: Array<{ tokens?: MarkedToken[]; text?: string }>;
  rows?: Array<Array<{ tokens?: MarkedToken[]; text?: string }>>;
  align?: Array<"left" | "center" | "right" | null>;
};

export interface ArticleInspection {
  view: ArticleView;
  diagnostics: ContentDiagnostic[];
}

export interface AssetResolution {
  requestId: string;
  asset: ContentAsset;
}

export interface ArticleCompilation {
  sourceHash: string;
  document: ArticleDocument;
  diagnostics: ContentDiagnostic[];
}

export interface CompileArticleInput {
  article: WorkingArticle;
  evidence: EvidenceUnit[];
  materials: MaterialSnapshot[];
  resolutions?: AssetResolution[];
}

/** Converts model-friendly annotated Markdown into the system document IR. */
export class ArticleCompiler {
  readonly version = "1";

  async inspect(input: Omit<CompileArticleInput, "resolutions">): Promise<ArticleInspection> {
    const sourceHash = await fingerprint(input.article.source);
    const diagnostics = baselineDiagnostics(input, sourceHash);
    let root: ArticleRootNode<ArticleAssetRequestNode> = {
      id: "node:root",
      type: "root",
      children: [],
    };

    try {
      const tokens = marked.lexer(input.article.source.bodyMarkdown) as MarkedToken[];
      if (containsRawHtml(tokens)) {
        diagnostics.push({
          sourceHash,
          code: "source.html_forbidden",
          severity: "blocker",
          scope: "body",
          message: "文章来源不能包含原始 HTML",
        });
      }
      root = {
        id: "node:root",
        type: "root",
        children: blockNodes(tokens, "node"),
      };
    } catch (error) {
      diagnostics.push({
        sourceHash,
        code: DiagnosticCode.SourceInvalid,
        severity: "blocker",
        scope: "body",
        message: `Markdown 解析失败：${error instanceof Error ? error.message : String(error)}`,
      });
    }

    const references = collectReferences(root);
    for (const unsupported of collectUnsupportedNodes(root)) {
      diagnostics.push({
        sourceHash,
        code: "asset.remote_image_forbidden",
        severity: "blocker",
        scope: "asset",
        message: `远程图片必须先转换为 ContentAsset：${unsupported.sourceUrl}`,
        location: { nodeId: unsupported.nodeId },
      });
    }
    const evidenceIds = new Set(input.evidence.map((item) => item.id));
    const requestIds = new Set(input.article.assetRequests.map((item) => item.id));
    if (!references.evidence.some((reference) => evidenceIds.has(reference.value))) {
      diagnostics.push({
        sourceHash,
        code: EvidenceDiagnosticCode.CitationMissing,
        severity: "blocker",
        scope: "evidence",
        message: "正文至少需要引用一条有效证据",
      });
    }
    for (const reference of references.evidence) {
      if (!evidenceIds.has(reference.value)) {
        diagnostics.push({
          sourceHash,
          code: DiagnosticCode.EvidenceReferenceMissing,
          severity: "blocker",
          scope: "evidence",
          message: `正文引用了不存在的证据 ${reference.value}`,
          location: { nodeId: reference.nodeId, evidenceId: reference.value },
        });
      }
    }
    for (const reference of references.assets) {
      if (!requestIds.has(reference.value)) {
        diagnostics.push({
          sourceHash,
          code: DiagnosticCode.AssetRequestMissing,
          severity: "blocker",
          scope: "asset",
          message: `正文引用了不存在的资源请求 ${reference.value}`,
          location: { nodeId: reference.nodeId, assetRequestId: reference.value },
        });
      }
    }

    return {
      view: {
        sourceHash,
        title: input.article.source.title,
        digest: input.article.source.digest,
        root,
        evidenceIds: [...new Set(references.evidence.map((item) => item.value))],
        assetRequestIds: [...new Set(references.assets.map((item) => item.value))],
      },
      diagnostics: normalizeDiagnostics(diagnostics),
    };
  }

  async compile(input: CompileArticleInput): Promise<ArticleCompilation> {
    const inspection = await this.inspect(input);
    const requestById = new Map(
      input.article.assetRequests.map((request) => [request.id, request]),
    );
    const resolutionById = new Map(
      (input.resolutions ?? []).map((resolution) => [resolution.requestId, resolution.asset]),
    );
    const diagnostics = [...inspection.diagnostics];
    const root = resolveRoot(
      inspection.view.root,
      requestById,
      resolutionById,
      diagnostics,
      inspection.view.sourceHash,
    );
    const coverRequests = input.article.assetRequests.filter((request) => request.type === "cover");
    if (coverRequests.length > 1) {
      diagnostics.push({
        sourceHash: inspection.view.sourceHash,
        code: "asset.cover_ambiguous",
        severity: "error",
        scope: "asset",
        message: "文章包含多个封面资源请求",
      });
    }
    const coverAssetId = coverRequests
      .map((request) => resolutionById.get(request.id)?.id)
      .find((value): value is string => Boolean(value));

    return {
      sourceHash: inspection.view.sourceHash,
      document: {
        schemaVersion: ArticleDocumentSchemaVersion.Current,
        title: input.article.source.title.trim(),
        digest: input.article.source.digest.trim(),
        root,
        ...(coverAssetId ? { coverAssetId } : {}),
      },
      diagnostics: normalizeDiagnostics(diagnostics),
    };
  }
}

function baselineDiagnostics(
  input: Omit<CompileArticleInput, "resolutions">,
  sourceHash: string,
): ContentDiagnostic[] {
  const diagnostics: ContentDiagnostic[] = [];
  const source = input.article.source;
  if (source.format !== ArticleSourceFormat.Markdown) {
    diagnostics.push({
      sourceHash,
      code: DiagnosticCode.SourceInvalid,
      severity: "blocker",
      scope: "article",
      message: `不支持的文章来源格式 ${String(source.format)}`,
    });
  }
  if (!source.title.trim()) {
    diagnostics.push({
      sourceHash,
      code: DiagnosticCode.TitleMissing,
      severity: "blocker",
      scope: "title",
      message: "文章缺少标题",
    });
  }
  if (!source.digest.trim()) {
    diagnostics.push({
      sourceHash,
      code: DiagnosticCode.DigestMissing,
      severity: "error",
      scope: "digest",
      message: "文章缺少摘要",
    });
  }
  if (!source.bodyMarkdown.trim()) {
    diagnostics.push({
      sourceHash,
      code: DiagnosticCode.BodyMissing,
      severity: "blocker",
      scope: "body",
      message: "文章缺少正文",
    });
  }
  if (!input.evidence.length) {
    diagnostics.push({
      sourceHash,
      code: DiagnosticCode.EvidenceMissing,
      severity: "blocker",
      scope: "evidence",
      message: "文章没有可追溯证据",
    });
  }

  duplicateDiagnostics(input.materials, "material", sourceHash, diagnostics);
  duplicateDiagnostics(input.evidence, "evidence", sourceHash, diagnostics);
  duplicateDiagnostics(input.article.assetRequests, "asset request", sourceHash, diagnostics);

  const materialById = new Map(input.materials.map((material) => [material.id, material]));
  for (const evidence of input.evidence) {
    const material = materialById.get(evidence.materialId);
    if (!material) {
      diagnostics.push({
        sourceHash,
        code: DiagnosticCode.EvidenceMaterialMissing,
        severity: "blocker",
        scope: "evidence",
        message: `证据 ${evidence.id} 引用了不存在的素材 ${evidence.materialId}`,
        location: { evidenceId: evidence.id },
      });
    }
    for (const issue of evidenceLocatorIssues(evidence, material)) {
      diagnostics.push({
        sourceHash,
        code: issue.code,
        severity: "blocker",
        scope: "evidence",
        message: issue.message,
        location: { evidenceId: evidence.id },
      });
    }
    if (!evidence.statement.trim()) {
      diagnostics.push({
        sourceHash,
        code: "evidence.statement_missing",
        severity: "error",
        scope: "evidence",
        message: `证据 ${evidence.id} 缺少可验证陈述`,
        location: { evidenceId: evidence.id },
      });
    }
  }
  for (const request of input.article.assetRequests) {
    if (!request.brief.trim()) {
      diagnostics.push({
        sourceHash,
        code: "asset.request_brief_missing",
        severity: "error",
        scope: "asset",
        message: `资源请求 ${request.id} 缺少生成说明`,
        location: { assetRequestId: request.id },
      });
    }
  }
  return diagnostics;
}

function duplicateDiagnostics(
  values: Array<{ id: string }>,
  label: string,
  sourceHash: string,
  diagnostics: ContentDiagnostic[],
): void {
  const seen = new Set<string>();
  for (const value of values) {
    if (!value.id.trim() || seen.has(value.id)) {
      diagnostics.push({
        sourceHash,
        code: `${label.replaceAll(" ", "_")}.id_invalid`,
        severity: "blocker",
        scope: label.startsWith("asset") ? "asset" : label === "evidence" ? "evidence" : "article",
        message: value.id.trim() ? `${label} ID 重复：${value.id}` : `${label} 缺少 ID`,
      });
    }
    seen.add(value.id);
  }
}

function blockNodes(
  tokens: MarkedToken[],
  path: string,
): ArticleBlockNode<ArticleAssetRequestNode>[] {
  const result: ArticleBlockNode<ArticleAssetRequestNode>[] = [];
  for (const [index, token] of tokens.entries()) {
    const id = `${path}:${index}`;
    switch (token.type) {
      case "space":
      case "def":
        break;
      case "heading":
        result.push({
          id,
          type: "heading",
          depth: token.depth ?? 1,
          children: inlineNodes(token.tokens ?? textToken(token.text), `${id}:inline`),
        });
        break;
      case "paragraph":
      case "text":
        result.push({
          id,
          type: "paragraph",
          children: inlineNodes(token.tokens ?? textToken(token.text), `${id}:inline`),
        });
        break;
      case "blockquote":
        result.push({
          id,
          type: "blockquote",
          children: blockNodes(token.tokens ?? [], `${id}:quote`),
        });
        break;
      case "list":
        result.push({
          id,
          type: "list",
          ordered: Boolean(token.ordered),
          ...(typeof token.start === "number" ? { start: token.start } : {}),
          items: (token.items ?? []).map((item, itemIndex) => ({
            id: `${id}:item:${itemIndex}`,
            ...(typeof item.checked === "boolean" ? { checked: item.checked } : {}),
            children: blockNodes(item.tokens ?? [], `${id}:item:${itemIndex}`),
          })),
        });
        break;
      case "code":
        result.push({
          id,
          type: "code",
          ...(token.lang?.trim() ? { language: token.lang.trim() } : {}),
          text: token.text ?? "",
        });
        break;
      case "table":
        result.push({
          id,
          type: "table",
          header: (token.header ?? []).map((cell, cellIndex) =>
            inlineNodes(cell.tokens ?? textToken(cell.text), `${id}:header:${cellIndex}`),
          ),
          rows: (token.rows ?? []).map((row, rowIndex) =>
            row.map((cell, cellIndex) =>
              inlineNodes(
                cell.tokens ?? textToken(cell.text),
                `${id}:row:${rowIndex}:${cellIndex}`,
              ),
            ),
          ),
          align: token.align ?? [],
        });
        break;
      case "hr":
        result.push({ id, type: "thematic-break" });
        break;
      case "html":
        result.push({ id, type: "html", html: token.text ?? token.raw ?? "" });
        break;
      default:
        result.push({
          id,
          type: "paragraph",
          children: [{ id: `${id}:inline:0`, type: "text", text: token.text ?? token.raw ?? "" }],
        });
    }
  }
  return result;
}

function inlineNodes(
  tokens: MarkedToken[],
  path: string,
): ArticleInlineNode<ArticleAssetRequestNode>[] {
  return tokens.flatMap((token, index): ArticleInlineNode<ArticleAssetRequestNode>[] => {
    const id = `${path}:${index}`;
    switch (token.type) {
      case "text":
      case "escape":
        return [{ id, type: "text", text: token.text ?? token.raw ?? "" }];
      case "strong":
        return [
          {
            id,
            type: "strong",
            children: inlineNodes(token.tokens ?? textToken(token.text), `${id}:strong`),
          },
        ];
      case "em":
        return [
          {
            id,
            type: "emphasis",
            children: inlineNodes(token.tokens ?? textToken(token.text), `${id}:emphasis`),
          },
        ];
      case "del":
        return [
          {
            id,
            type: "strikethrough",
            children: inlineNodes(token.tokens ?? textToken(token.text), `${id}:delete`),
          },
        ];
      case "codespan":
        return [{ id, type: "inline-code", text: token.text ?? "" }];
      case "br":
        return [{ id, type: "line-break" }];
      case "link": {
        const href = token.href ?? "";
        const labelNodes = inlineNodes(token.tokens ?? textToken(token.text), `${id}:link`);
        if (href.startsWith("evidence://")) {
          return [
            {
              id,
              type: "citation",
              evidenceId: referenceId(href, "evidence://"),
              label: inlineText(labelNodes) || "来源",
            },
          ];
        }
        if (href.startsWith("asset-request://")) {
          return [
            {
              id,
              type: "asset-request",
              requestId: referenceId(href, "asset-request://"),
              alt: inlineText(labelNodes),
              ...(token.title ? { title: token.title } : {}),
            },
          ];
        }
        return [
          {
            id,
            type: "link",
            href,
            ...(token.title ? { title: token.title } : {}),
            children: labelNodes,
          },
        ];
      }
      case "image": {
        const href = token.href ?? "";
        if (href.startsWith("asset-request://")) {
          return [
            {
              id,
              type: "asset-request",
              requestId: referenceId(href, "asset-request://"),
              alt: token.text ?? "",
              ...(token.title ? { title: token.title } : {}),
            },
          ];
        }
        return [
          {
            id,
            type: "remote-image",
            sourceUrl: href,
            alt: token.text ?? "",
            ...(token.title ? { title: token.title } : {}),
          },
        ];
      }
      default:
        return [{ id, type: "text", text: token.text ?? token.raw ?? "" }];
    }
  });
}

function resolveRoot(
  root: ArticleRootNode<ArticleAssetRequestNode>,
  requests: Map<string, AssetRequest>,
  resolutions: Map<string, ContentAsset>,
  diagnostics: ContentDiagnostic[],
  sourceHash: string,
): ArticleRootNode<ArticleAssetNode> {
  return {
    id: root.id,
    type: "root",
    children: root.children
      .map((node) => resolveBlock(node, requests, resolutions, diagnostics, sourceHash))
      .filter((node): node is ArticleBlockNode<ArticleAssetNode> => Boolean(node)),
  };
}

function resolveBlock(
  node: ArticleBlockNode<ArticleAssetRequestNode>,
  requests: Map<string, AssetRequest>,
  resolutions: Map<string, ContentAsset>,
  diagnostics: ContentDiagnostic[],
  sourceHash: string,
): ArticleBlockNode<ArticleAssetNode> | null {
  switch (node.type) {
    case "heading":
    case "paragraph": {
      const children = resolveInlines(
        node.children,
        requests,
        resolutions,
        diagnostics,
        sourceHash,
      );
      if (node.type === "paragraph" && children.length === 0) return null;
      return { ...node, children };
    }
    case "blockquote":
      return {
        ...node,
        children: node.children
          .map((child) => resolveBlock(child, requests, resolutions, diagnostics, sourceHash))
          .filter((child): child is ArticleBlockNode<ArticleAssetNode> => Boolean(child)),
      };
    case "list":
      return {
        ...node,
        items: node.items.map((item) => ({
          ...item,
          children: item.children
            .map((child) => resolveBlock(child, requests, resolutions, diagnostics, sourceHash))
            .filter((child): child is ArticleBlockNode<ArticleAssetNode> => Boolean(child)),
        })),
      };
    case "table":
      return {
        ...node,
        header: node.header.map((cell) =>
          resolveInlines(cell, requests, resolutions, diagnostics, sourceHash),
        ),
        rows: node.rows.map((row) =>
          row.map((cell) => resolveInlines(cell, requests, resolutions, diagnostics, sourceHash)),
        ),
      };
    case "html":
      return null;
    default:
      return structuredClone(node);
  }
}

function resolveInlines(
  nodes: ArticleInlineNode<ArticleAssetRequestNode>[],
  requests: Map<string, AssetRequest>,
  resolutions: Map<string, ContentAsset>,
  diagnostics: ContentDiagnostic[],
  sourceHash: string,
): ArticleInlineNode<ArticleAssetNode>[] {
  return nodes.flatMap((node): ArticleInlineNode<ArticleAssetNode>[] => {
    if (node.type === "asset-request") {
      const request = requests.get(node.requestId);
      const asset = resolutions.get(node.requestId);
      if (asset) {
        return [
          {
            id: node.id,
            type: "asset",
            assetId: asset.id,
            alt: node.alt || request?.alt || asset.alt || "",
            ...(node.title ? { title: node.title } : {}),
            ...(request?.caption || asset.caption
              ? { caption: request?.caption ?? asset.caption }
              : {}),
          },
        ];
      }
      if (request?.necessity === "essential") {
        diagnostics.push({
          sourceHash,
          code: DiagnosticCode.AssetReferenceMissing,
          severity: "blocker",
          scope: "asset",
          message: `必要资源 ${request.id} 尚未生成`,
          location: { nodeId: node.id, assetRequestId: request.id },
        });
      }
      return [];
    }
    if (node.type === "remote-image") return [];
    if (node.type === "emphasis" || node.type === "strong" || node.type === "strikethrough") {
      return [
        {
          ...node,
          children: resolveInlines(node.children, requests, resolutions, diagnostics, sourceHash),
        },
      ];
    }
    if (node.type === "link") {
      return [
        {
          ...node,
          children: resolveInlines(node.children, requests, resolutions, diagnostics, sourceHash),
        },
      ];
    }
    return [structuredClone(node)];
  });
}

function collectUnsupportedNodes(
  root: ArticleRootNode<ArticleAssetRequestNode>,
): Array<{ nodeId: string; sourceUrl: string }> {
  const result: Array<{ nodeId: string; sourceUrl: string }> = [];
  const visitInline = (node: ArticleInlineNode<ArticleAssetRequestNode>): void => {
    if (node.type === "remote-image") {
      result.push({ nodeId: node.id, sourceUrl: node.sourceUrl });
    } else if (
      node.type === "emphasis" ||
      node.type === "strong" ||
      node.type === "strikethrough" ||
      node.type === "link"
    ) {
      node.children.forEach(visitInline);
    }
  };
  const visitBlock = (node: ArticleBlockNode<ArticleAssetRequestNode>): void => {
    if (node.type === "heading" || node.type === "paragraph") node.children.forEach(visitInline);
    else if (node.type === "blockquote") node.children.forEach(visitBlock);
    else if (node.type === "list") {
      node.items.forEach((item) => item.children.forEach(visitBlock));
    } else if (node.type === "table") {
      node.header.forEach((cell) => cell.forEach(visitInline));
      node.rows.forEach((row) => row.forEach((cell) => cell.forEach(visitInline)));
    }
  };
  root.children.forEach(visitBlock);
  return result;
}

function containsRawHtml(tokens: MarkedToken[]): boolean {
  for (const token of tokens) {
    if (token.type === "html") return true;
    if (token.tokens && containsRawHtml(token.tokens)) return true;
    if (token.items && containsRawHtml(token.items)) return true;
    for (const cell of token.header ?? []) {
      if (cell.tokens && containsRawHtml(cell.tokens)) return true;
    }
    for (const row of token.rows ?? []) {
      for (const cell of row) {
        if (cell.tokens && containsRawHtml(cell.tokens)) return true;
      }
    }
  }
  return false;
}

function collectReferences(root: ArticleRootNode<ArticleAssetRequestNode>): {
  evidence: Array<{ nodeId: string; value: string }>;
  assets: Array<{ nodeId: string; value: string }>;
} {
  const result: ReturnType<typeof collectReferences> = { evidence: [], assets: [] };
  const visitInline = (node: ArticleInlineNode<ArticleAssetRequestNode>): void => {
    if (node.type === "citation") {
      result.evidence.push({ nodeId: node.id, value: node.evidenceId });
    } else if (node.type === "asset-request") {
      result.assets.push({ nodeId: node.id, value: node.requestId });
    } else if (
      node.type === "emphasis" ||
      node.type === "strong" ||
      node.type === "strikethrough" ||
      node.type === "link"
    ) {
      node.children.forEach(visitInline);
    }
  };
  const visitBlock = (node: ArticleBlockNode<ArticleAssetRequestNode>): void => {
    if (node.type === "heading" || node.type === "paragraph") node.children.forEach(visitInline);
    else if (node.type === "blockquote") node.children.forEach(visitBlock);
    else if (node.type === "list") {
      node.items.forEach((item) => item.children.forEach(visitBlock));
    } else if (node.type === "table") {
      node.header.forEach((cell) => cell.forEach(visitInline));
      node.rows.forEach((row) => row.forEach((cell) => cell.forEach(visitInline)));
    }
  };
  root.children.forEach(visitBlock);
  return result;
}

function textToken(value?: string): MarkedToken[] {
  return value ? [{ type: "text", text: value }] : [];
}

function inlineText(nodes: ArticleInlineNode<ArticleAssetRequestNode>[]): string {
  return nodes
    .map((node) => {
      if (node.type === "text" || node.type === "inline-code") return node.text;
      if (
        node.type === "emphasis" ||
        node.type === "strong" ||
        node.type === "strikethrough" ||
        node.type === "link"
      ) {
        return inlineText(node.children);
      }
      return "";
    })
    .join("");
}

function referenceId(href: string, scheme: string): string {
  const encoded = href.slice(scheme.length).split(/[?#]/, 1)[0] ?? "";
  try {
    return decodeURIComponent(encoded).trim();
  } catch {
    return encoded.trim();
  }
}

export function normalizeDiagnostics(values: ContentDiagnostic[]): ContentDiagnostic[] {
  const seen = new Set<string>();
  return values
    .map((value) => structuredClone(value))
    .filter((value) => {
      const key = `${value.sourceHash}:${value.code}:${value.message}:${value.location?.nodeId ?? ""}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .sort(
      (left, right) =>
        left.code.localeCompare(right.code) ||
        left.scope.localeCompare(right.scope) ||
        left.message.localeCompare(right.message),
    );
}
