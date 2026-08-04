import type {
  ArticleAssetNode,
  ArticleBlockNode,
  ArticleInlineNode,
  ContentAsset,
  ContentPackage,
  EvidenceUnit,
  MaterialReference,
} from "@trendpublish/article";

export interface RenderedArticleHtml {
  html: string;
  contentAssetIds: string[];
}

type DocumentBlock = ArticleBlockNode<ArticleAssetNode>;
type DocumentInline = ArticleInlineNode<ArticleAssetNode>;

interface RenderContext {
  assets: Map<string, ContentAsset>;
  evidence: Map<string, EvidenceUnit>;
  materials: Map<string, MaterialReference>;
  contentAssetIds: Set<string>;
}

/** Renders the frozen document IR without interpreting model-authored Markdown again. */
export function renderArticleDocumentHtml(
  contentPackage: Pick<ContentPackage, "document" | "assets" | "evidence" | "materials">,
): RenderedArticleHtml {
  const context: RenderContext = {
    assets: new Map(contentPackage.assets.map((asset) => [asset.id, asset])),
    evidence: new Map(contentPackage.evidence.map((evidence) => [evidence.id, evidence])),
    materials: new Map(contentPackage.materials.map((material) => [material.id, material])),
    contentAssetIds: new Set<string>(),
  };
  const html = contentPackage.document.root.children
    .map((node) => renderBlock(node, context))
    .join("\n");
  return { html, contentAssetIds: [...context.contentAssetIds] };
}

/** Stable placeholder replaced only after the channel has uploaded this exact asset. */
export function articleAssetUri(assetId: string): string {
  return `asset://${encodeURIComponent(assetId)}`;
}

export function escapeHtmlAttribute(value: string): string {
  return escapeHtml(value).replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function renderBlock(node: DocumentBlock, context: RenderContext): string {
  switch (node.type) {
    case "heading": {
      const depth = Math.min(6, Math.max(1, Math.trunc(node.depth)));
      return `<h${depth}>${renderInlines(node.children, context)}</h${depth}>`;
    }
    case "paragraph":
      return renderParagraph(node.children, context);
    case "blockquote":
      return `<blockquote>${node.children.map((child) => renderBlock(child, context)).join("\n")}</blockquote>`;
    case "list": {
      const tag = node.ordered ? "ol" : "ul";
      const start = node.ordered && node.start !== undefined ? ` start="${node.start}"` : "";
      const items = node.items
        .map((item) => {
          const checkbox =
            item.checked === undefined
              ? ""
              : `<input type="checkbox" disabled${item.checked ? " checked" : ""}> `;
          return `<li>${checkbox}${item.children.map((child) => renderBlock(child, context)).join("\n")}</li>`;
        })
        .join("");
      return `<${tag}${start}>${items}</${tag}>`;
    }
    case "code": {
      const language = node.language
        ? ` class="language-${escapeHtmlAttribute(node.language)}"`
        : "";
      return `<pre><code${language}>${escapeHtml(node.text)}</code></pre>`;
    }
    case "table": {
      const header = node.header
        .map(
          (cell, index) =>
            `<th${alignmentAttribute(node.align[index])}>${renderInlines(cell, context)}</th>`,
        )
        .join("");
      const rows = node.rows
        .map(
          (row) =>
            `<tr>${row
              .map(
                (cell, index) =>
                  `<td${alignmentAttribute(node.align[index])}>${renderInlines(cell, context)}</td>`,
              )
              .join("")}</tr>`,
        )
        .join("");
      return `<table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table>`;
    }
    case "html":
      throw new Error(`可发布文档不能包含原始 HTML 节点 ${node.id}`);
    case "thematic-break":
      return "<hr>";
    default:
      return unsupportedNode(node);
  }
}

function renderParagraph(nodes: DocumentInline[], context: RenderContext): string {
  if (nodes.length === 1 && nodes[0]?.type === "asset") {
    const asset = requireAsset(nodes[0].assetId, context);
    if (asset.mediaType === "image") return renderImageFigure(nodes[0], asset, context);
  }
  return `<p>${renderInlines(nodes, context)}</p>`;
}

function renderInlines(nodes: DocumentInline[], context: RenderContext): string {
  const output: string[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const repaired = renderLegacyStrongQuotes(nodes, index, context);
    if (repaired) {
      output.push(repaired.html);
      index += repaired.consumed - 1;
      continue;
    }
    output.push(renderInline(nodes[index]!, context));
  }
  return output.join("");
}

function renderInline(node: DocumentInline, context: RenderContext): string {
  switch (node.type) {
    case "text":
      return escapeHtml(decodeHtmlText(node.text));
    case "emphasis":
      return `<em>${renderInlines(node.children, context)}</em>`;
    case "strong":
      return `<strong>${renderInlines(node.children, context)}</strong>`;
    case "strikethrough":
      return `<s>${renderInlines(node.children, context)}</s>`;
    case "inline-code":
      return `<code>${escapeHtml(node.text)}</code>`;
    case "link": {
      const content = renderInlines(node.children, context);
      const href = safeExternalUrl(node.href);
      if (!href) return content;
      const title = node.title ? ` title="${escapeHtmlAttribute(node.title)}"` : "";
      return `<a href="${escapeHtmlAttribute(href)}"${title}>${content}</a>`;
    }
    case "citation":
      return renderCitation(node, context);
    case "remote-image":
      throw new Error(`可发布文档不能包含远程图片节点 ${node.id}`);
    case "line-break":
      return "<br>";
    case "asset":
      return renderAsset(node, requireAsset(node.assetId, context), context);
    default:
      return unsupportedNode(node);
  }
}

function renderLegacyStrongQuotes(
  nodes: DocumentInline[],
  index: number,
  context: RenderContext,
): { html: string; consumed: number } | null {
  const before = nodes[index];
  const connector = nodes[index + 1];
  const after = nodes[index + 2];
  if (before?.type !== "text" || connector?.type !== "strong" || after?.type !== "text") {
    return null;
  }
  const opening = before.text.lastIndexOf("**");
  const closing = after.text.indexOf("**");
  if (opening < 0 || closing < 1) return null;
  return {
    consumed: 3,
    html: [
      escapeHtml(decodeHtmlText(before.text.slice(0, opening))),
      `<strong>${escapeHtml(decodeHtmlText(before.text.slice(opening + 2)))}</strong>`,
      renderInlines(connector.children, context),
      `<strong>${escapeHtml(decodeHtmlText(after.text.slice(0, closing)))}</strong>`,
      escapeHtml(decodeHtmlText(after.text.slice(closing + 2))),
    ].join(""),
  };
}

function renderCitation(
  node: Extract<DocumentInline, { type: "citation" }>,
  context: RenderContext,
): string {
  const evidence = context.evidence.get(node.evidenceId);
  if (!evidence) throw new Error(`文章引用了不存在的证据 ${node.evidenceId}`);
  const material = context.materials.get(evidence.materialId);
  if (!material) throw new Error(`证据 ${evidence.id} 引用了不存在的素材 ${evidence.materialId}`);
  const label = escapeHtml(node.label);
  const sourceUrl = material.sourceUrl ? safeExternalUrl(material.sourceUrl) : null;
  const evidenceId = escapeHtmlAttribute(node.evidenceId);
  if (!sourceUrl) return `<span data-evidence-id="${evidenceId}">${label}</span>`;
  return `<a href="${escapeHtmlAttribute(sourceUrl)}" title="${escapeHtmlAttribute(material.title)}" data-evidence-id="${evidenceId}">${label}</a>`;
}

function renderAsset(node: ArticleAssetNode, asset: ContentAsset, context: RenderContext): string {
  if (asset.mediaType === "image") {
    context.contentAssetIds.add(asset.id);
    const title = node.title ? ` title="${escapeHtmlAttribute(node.title)}"` : "";
    return `<img src="${escapeHtmlAttribute(articleAssetUri(asset.id))}" alt="${escapeHtmlAttribute(node.alt || asset.alt || "")}"${title}>`;
  }
  const label = node.caption || node.title || asset.title || node.alt || assetLabel(asset);
  const href = safeAssetUrl(asset.source.uri);
  if (!href) throw new Error(`资源 ${asset.id} 的访问地址不受支持`);
  return `<a href="${escapeHtmlAttribute(href)}">${escapeHtml(label)}</a>`;
}

function renderImageFigure(
  node: ArticleAssetNode,
  asset: ContentAsset,
  context: RenderContext,
): string {
  const image = renderAsset(node, asset, context);
  const caption = node.caption || asset.caption;
  return `<figure>${image}${caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : ""}</figure>`;
}

function requireAsset(assetId: string, context: RenderContext): ContentAsset {
  const asset = context.assets.get(assetId);
  if (!asset) throw new Error(`文章引用了不存在的资源 ${assetId}`);
  return asset;
}

function assetLabel(asset: ContentAsset): string {
  if (asset.mediaType === "video") return "查看视频";
  if (asset.mediaType === "audio") return "收听音频";
  return "查看附件";
}

function alignmentAttribute(value: "left" | "center" | "right" | null | undefined): string {
  return value ? ` style="text-align:${value}"` : "";
}

function safeExternalUrl(value: string): string | null {
  const trimmed = value.trim();
  if (/^(https?:|mailto:|tel:)/i.test(trimmed) || trimmed.startsWith("#")) return trimmed;
  return null;
}

function safeAssetUrl(value: string): string | null {
  const trimmed = value.trim();
  return /^https?:/i.test(trimmed) ? trimmed : null;
}

function escapeHtml(value: string): string {
  return value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function decodeHtmlText(value: string): string {
  return value.replace(/&(?:#x[\da-f]+|#\d+|amp|apos|quot|lt|gt|nbsp);/gi, (entity) => {
    const named: Record<string, string> = {
      "&amp;": "&",
      "&apos;": "'",
      "&quot;": '"',
      "&lt;": "<",
      "&gt;": ">",
      "&nbsp;": " ",
    };
    const normalized = entity.toLowerCase();
    if (normalized in named) return named[normalized]!;
    const hexadecimal = normalized.match(/^&#x([\da-f]+);$/i)?.[1];
    const decimal = normalized.match(/^&#(\d+);$/)?.[1];
    const codePoint = Number.parseInt(hexadecimal ?? decimal ?? "", hexadecimal ? 16 : 10);
    return Number.isSafeInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : entity;
  });
}

function unsupportedNode(node: never): never {
  throw new Error(`不支持的文章节点 ${(node as { type?: string }).type ?? "unknown"}`);
}
