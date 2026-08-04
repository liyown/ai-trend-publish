import { createElement, type ReactNode } from "react";
import type {
  ArticleAssetNode,
  ArticleBlockNode,
  ArticleDocument,
  ArticleInlineNode,
  ContentAsset,
  EvidenceUnit,
  MaterialReference,
} from "@trendpublish/contracts";

interface ArticleDocumentViewProps {
  document: ArticleDocument;
  assets: ContentAsset[];
  evidence: EvidenceUnit[];
  materials: MaterialReference[];
}

type DocumentBlock = ArticleBlockNode<ArticleAssetNode>;
type DocumentInline = ArticleInlineNode<ArticleAssetNode>;

interface ViewContext {
  assets: Map<string, ContentAsset>;
  evidence: Map<string, EvidenceUnit>;
  materials: Map<string, MaterialReference>;
}

export function ArticleDocumentView({
  document,
  assets,
  evidence,
  materials,
}: ArticleDocumentViewProps) {
  const context: ViewContext = {
    assets: new Map(assets.map((asset) => [asset.id, asset])),
    evidence: new Map(evidence.map((item) => [item.id, item])),
    materials: new Map(materials.map((material) => [material.id, material])),
  };
  return (
    <article className="mx-auto grid w-full max-w-3xl gap-5 text-[15px] leading-7 text-[var(--ink-2)]">
      {document.root.children.map((node) => renderBlock(node, context))}
    </article>
  );
}

function renderBlock(node: DocumentBlock, context: ViewContext): ReactNode {
  switch (node.type) {
    case "heading": {
      const depth = Math.min(6, Math.max(1, Math.trunc(node.depth)));
      const className =
        depth <= 2
          ? "mt-4 text-xl font-semibold tracking-[-0.015em] text-[var(--ink)] first:mt-0"
          : "mt-2 text-base font-semibold text-[var(--ink)] first:mt-0";
      return createElement(
        `h${depth}`,
        { key: node.id, className },
        renderInlines(node.children, context),
      );
    }
    case "paragraph":
      return renderParagraph(node, context);
    case "blockquote":
      return (
        <blockquote
          key={node.id}
          className="grid gap-3 border-l-2 border-[var(--border-strong)] pl-4 text-[var(--muted-strong)]"
        >
          {node.children.map((child) => renderBlock(child, context))}
        </blockquote>
      );
    case "list": {
      const Tag = node.ordered ? "ol" : "ul";
      return (
        <Tag
          key={node.id}
          start={node.ordered ? node.start : undefined}
          className={node.ordered ? "grid list-decimal gap-2 pl-6" : "grid list-disc gap-2 pl-6"}
        >
          {node.items.map((item) => (
            <li key={item.id} className="pl-1">
              <div className="grid gap-2">
                {item.checked === undefined ? null : (
                  <span className="inline-flex items-center gap-2 text-xs text-[var(--muted)]">
                    <input type="checkbox" checked={item.checked} readOnly disabled />
                    {item.checked ? "已完成" : "未完成"}
                  </span>
                )}
                {item.children.map((child) => renderBlock(child, context))}
              </div>
            </li>
          ))}
        </Tag>
      );
    }
    case "code":
      return (
        <pre
          key={node.id}
          className="overflow-x-auto rounded-[var(--radius-sm)] border border-[var(--border)] bg-[var(--surface-2)] p-4 font-mono text-[13px] leading-6 text-[var(--ink)]"
        >
          <code>{node.text}</code>
        </pre>
      );
    case "table":
      return (
        <div key={node.id} className="overflow-x-auto border border-[var(--border)]">
          <table className="w-full border-collapse text-left text-sm">
            <thead className="bg-[var(--surface-2)] text-[var(--ink)]">
              <tr>
                {node.header.map((cell, index) => (
                  <th
                    key={`${node.id}:header:${index}`}
                    className="border-b border-r border-[var(--border)] px-3 py-2 font-semibold last:border-r-0"
                    style={{ textAlign: node.align[index] ?? undefined }}
                  >
                    {renderInlines(cell, context)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {node.rows.map((row, rowIndex) => (
                <tr key={`${node.id}:row:${rowIndex}`}>
                  {row.map((cell, cellIndex) => (
                    <td
                      key={`${node.id}:row:${rowIndex}:cell:${cellIndex}`}
                      className="border-b border-r border-[var(--border)] px-3 py-2 align-top last:border-r-0"
                      style={{ textAlign: node.align[cellIndex] ?? undefined }}
                    >
                      {renderInlines(cell, context)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
    case "html":
      return <MissingReference key={node.id} label="文档包含不受支持的原始 HTML" />;
    case "thematic-break":
      return <hr key={node.id} className="my-2 border-0 border-t border-[var(--border)]" />;
    default:
      return unsupportedNode(node);
  }
}

function renderParagraph(
  node: Extract<DocumentBlock, { type: "paragraph" }>,
  context: ViewContext,
): ReactNode {
  const only = node.children.length === 1 ? node.children[0] : undefined;
  if (only?.type === "asset") return renderStandaloneAsset(only, context);
  return (
    <p key={node.id} className="m-0">
      {renderInlines(node.children, context)}
    </p>
  );
}

function renderInlines(nodes: DocumentInline[], context: ViewContext): ReactNode[] {
  const result: ReactNode[] = [];
  for (let index = 0; index < nodes.length; index += 1) {
    const repaired = repairLegacyStrongQuotes(nodes, index, context);
    if (repaired) {
      result.push(...repaired.nodes);
      index += repaired.consumed - 1;
      continue;
    }
    result.push(renderInline(nodes[index]!, context));
  }
  return result;
}

function renderInline(node: DocumentInline, context: ViewContext): ReactNode {
  switch (node.type) {
    case "text":
      return decodeHtmlText(node.text);
    case "emphasis":
      return <em key={node.id}>{renderInlines(node.children, context)}</em>;
    case "strong":
      return (
        <strong key={node.id} className="font-semibold text-[var(--ink)]">
          {renderInlines(node.children, context)}
        </strong>
      );
    case "strikethrough":
      return <s key={node.id}>{renderInlines(node.children, context)}</s>;
    case "inline-code":
      return (
        <code
          key={node.id}
          className="rounded bg-[var(--surface-3)] px-1.5 py-0.5 font-mono text-[0.88em] text-[var(--ink)]"
        >
          {node.text}
        </code>
      );
    case "link":
      return safeUrl(node.href) ? (
        <a
          key={node.id}
          href={node.href}
          title={node.title}
          target="_blank"
          rel="noreferrer"
          className="text-[var(--info)] underline decoration-[var(--info-border)] underline-offset-2"
        >
          {renderInlines(node.children, context)}
        </a>
      ) : (
        <span key={node.id}>{renderInlines(node.children, context)}</span>
      );
    case "citation":
      return renderCitation(node, context);
    case "remote-image":
      return <MissingReference key={node.id} label="文档包含未入库的远程图片" />;
    case "line-break":
      return <br key={node.id} />;
    case "asset":
      return renderInlineAsset(node, context);
    default:
      return unsupportedNode(node);
  }
}

function repairLegacyStrongQuotes(
  nodes: DocumentInline[],
  index: number,
  context: ViewContext,
): { nodes: ReactNode[]; consumed: number } | null {
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
    nodes: [
      decodeHtmlText(before.text.slice(0, opening)),
      <strong key={`${before.id}:repaired`} className="font-semibold text-[var(--ink)]">
        {decodeHtmlText(before.text.slice(opening + 2))}
      </strong>,
      ...renderInlines(connector.children, context),
      <strong key={`${after.id}:repaired`} className="font-semibold text-[var(--ink)]">
        {decodeHtmlText(after.text.slice(0, closing))}
      </strong>,
      decodeHtmlText(after.text.slice(closing + 2)),
    ],
  };
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

function renderCitation(
  node: Extract<DocumentInline, { type: "citation" }>,
  context: ViewContext,
): ReactNode {
  const evidence = context.evidence.get(node.evidenceId);
  const material = evidence ? context.materials.get(evidence.materialId) : undefined;
  return material?.sourceUrl && safeUrl(material.sourceUrl) ? (
    <a
      key={node.id}
      href={material.sourceUrl}
      title={material.title}
      target="_blank"
      rel="noreferrer"
      className="ml-0.5 text-xs font-medium text-[var(--info)] underline decoration-[var(--info-border)] underline-offset-2"
    >
      {node.label}
    </a>
  ) : (
    <span
      key={node.id}
      title={evidence ? "来源没有公开链接" : `证据缺失：${node.evidenceId}`}
      className="ml-0.5 text-xs font-medium text-[var(--warning)]"
    >
      {node.label}
    </span>
  );
}

function renderStandaloneAsset(node: ArticleAssetNode, context: ViewContext): ReactNode {
  const asset = context.assets.get(node.assetId);
  if (!asset) return <MissingReference key={node.id} label={`资源缺失：${node.assetId}`} />;
  if (asset.mediaType !== "image") return renderInlineAsset(node, context);
  if (!safeImageUrl(asset.source.uri)) {
    return <MissingReference key={node.id} label={`图片地址无效：${node.assetId}`} />;
  }
  return (
    <figure key={node.id} className="grid gap-2">
      <img
        src={asset.source.uri}
        alt={node.alt || asset.alt || ""}
        title={node.title}
        className="max-h-[520px] w-full rounded-[var(--radius-sm)] border border-[var(--border)] object-contain"
      />
      {node.caption || asset.caption ? (
        <figcaption className="text-center text-xs leading-5 text-[var(--muted)]">
          {node.caption ?? asset.caption}
        </figcaption>
      ) : null}
    </figure>
  );
}

function renderInlineAsset(node: ArticleAssetNode, context: ViewContext): ReactNode {
  const asset = context.assets.get(node.assetId);
  if (!asset) return <MissingReference key={node.id} label={`资源缺失：${node.assetId}`} />;
  if (asset.mediaType === "image") {
    if (!safeImageUrl(asset.source.uri)) {
      return <MissingReference key={node.id} label={`图片地址无效：${node.assetId}`} />;
    }
    return (
      <img
        key={node.id}
        src={asset.source.uri}
        alt={node.alt || asset.alt || ""}
        title={node.title}
        className="mx-1 inline-block max-h-40 max-w-full align-middle"
      />
    );
  }
  if (!safeAssetUrl(asset.source.uri)) {
    return <MissingReference key={node.id} label={`资源地址无效：${node.assetId}`} />;
  }
  if (asset.mediaType === "video") {
    return (
      <video key={node.id} src={asset.source.uri} controls className="my-3 max-h-[520px] w-full" />
    );
  }
  if (asset.mediaType === "audio") {
    return <audio key={node.id} src={asset.source.uri} controls className="my-3 w-full" />;
  }
  return (
    <a
      key={node.id}
      href={asset.source.uri}
      target="_blank"
      rel="noreferrer"
      className="text-[var(--info)] underline decoration-[var(--info-border)] underline-offset-2"
    >
      {node.caption || node.title || asset.title || node.alt || "查看附件"}
    </a>
  );
}

function MissingReference({ label }: { label: string }) {
  return (
    <span className="inline-flex border border-[var(--warning-border)] bg-[var(--warning-bg)] px-2 py-1 text-xs text-[var(--warning)]">
      {label}
    </span>
  );
}

function safeUrl(value: string): boolean {
  return /^(https?:|mailto:|tel:)/i.test(value.trim()) || value.trim().startsWith("#");
}

function safeImageUrl(value: string): boolean {
  return /^(https?:|data:image\/)/i.test(value.trim());
}

function safeAssetUrl(value: string): boolean {
  return /^https?:/i.test(value.trim());
}

function unsupportedNode(node: never): never {
  throw new Error(`不支持的文章节点 ${(node as { type?: string }).type ?? "unknown"}`);
}
