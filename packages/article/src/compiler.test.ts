import { expect, test } from "vite-plus/test";
import { ArticleSourceFormat, ContentAssetMediaType } from "@trendpublish/contracts";
import { ArticleCompiler } from "./compiler.ts";
import type { ArticleBlockNode, ArticleDocument, ArticleInlineNode } from "./domain.ts";

const equal = (actual: unknown, expected: unknown): void => expect(actual).toBe(expected);
const ok = (value: unknown): void => expect(value).toBe(true);
const deepStrictEqual = (actual: unknown, expected: unknown): void =>
  expect(actual).toEqual(expected);

const material = {
  id: "material-1",
  mediaType: "webpage" as const,
  title: "资料",
  sourceUrl: "https://example.com/source",
  content: "产品已经进入公开测试阶段。",
  retrievedAt: "2026-07-18T00:00:00.000Z",
  contentHash: "material-hash",
};
const evidence = {
  id: "evidence-1",
  statement: "产品已经进入公开测试阶段",
  materialId: material.id,
  locator: { type: "text" as const, excerpt: "产品已经进入公开测试阶段" },
};

test("annotated Markdown compiles into citation and resolved asset nodes", async () => {
  const compiler = new ArticleCompiler();
  const article = {
    source: {
      format: ArticleSourceFormat.Markdown,
      title: "公开测试意味着什么",
      digest: "解释产品变化",
      bodyMarkdown:
        "## 发生了什么\n\n产品已经进入公开测试阶段。[来源](evidence://evidence-1)\n\n![结构图](asset-request://diagram-1)",
    },
    assetRequests: [
      {
        id: "diagram-1",
        type: "diagram" as const,
        necessity: "enhancement" as const,
        brief: "产品架构示意图",
      },
    ],
  };
  const inspection = await compiler.inspect({
    article,
    evidence: [evidence],
    materials: [material],
  });
  deepStrictEqual(inspection.view.evidenceIds, ["evidence-1"]);
  deepStrictEqual(inspection.view.assetRequestIds, ["diagram-1"]);
  equal(inspection.diagnostics.length, 0);

  const compilation = await compiler.compile({
    article,
    evidence: [evidence],
    materials: [material],
    resolutions: [
      {
        requestId: "diagram-1",
        asset: {
          id: "asset-1",
          mediaType: ContentAssetMediaType.Image,
          source: { uri: "https://cdn.example.com/diagram.png" },
          checksum: "0".repeat(64),
        },
      },
    ],
  });
  equal(compilation.diagnostics.length, 0);
  ok(nodeTypes(compilation.document).includes("citation"));
  ok(nodeTypes(compilation.document).includes("asset"));
  equal(nodeTypes(compilation.document).includes("asset-request"), false);
});

test("raw HTML and remote Markdown images are rejected and removed from final IR", async () => {
  const compiler = new ArticleCompiler();
  const article = {
    source: {
      format: ArticleSourceFormat.Markdown,
      title: "标题",
      digest: "摘要",
      bodyMarkdown:
        '<script>alert("x")</script>\n\n![绕过资源图](https://example.com/image.png)\n\n[来源](evidence://evidence-1)',
    },
    assetRequests: [],
  };
  const compilation = await compiler.compile({
    article,
    evidence: [evidence],
    materials: [material],
  });
  ok(compilation.diagnostics.some((item) => item.code === "source.html_forbidden"));
  ok(compilation.diagnostics.some((item) => item.code === "asset.remote_image_forbidden"));
  equal(nodeTypes(compilation.document).includes("html"), false);
  equal(nodeTypes(compilation.document).includes("remote-image"), false);
});

test("an article without a valid evidence citation is blocked", async () => {
  const inspection = await new ArticleCompiler().inspect({
    article: {
      source: {
        format: ArticleSourceFormat.Markdown,
        title: "标题",
        digest: "摘要",
        bodyMarkdown: "正文只陈述事实，但没有标注来源。",
      },
      assetRequests: [],
    },
    evidence: [evidence],
    materials: [material],
  });

  expect(inspection.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "evidence.citation_missing",
      severity: "blocker",
    }),
  );
});

test("evidence locators must be valid and match their material snapshot", async () => {
  const inspection = await new ArticleCompiler().inspect({
    article: {
      source: {
        format: ArticleSourceFormat.Markdown,
        title: "标题",
        digest: "摘要",
        bodyMarkdown: "正文。[来源](evidence://invalid-time)",
      },
      assetRequests: [],
    },
    evidence: [
      {
        ...evidence,
        id: "mismatched-text",
        locator: { type: "text", excerpt: "素材中不存在的摘录" },
      },
      {
        ...evidence,
        id: "invalid-time",
        locator: { type: "time-range", startMs: -1, endMs: Number.NaN },
      },
      {
        ...evidence,
        id: "invalid-page",
        locator: { type: "page", page: 0 },
      },
    ],
    materials: [material],
  });

  expect(inspection.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "evidence.locator_mismatch",
      location: { evidenceId: "mismatched-text" },
    }),
  );
  expect(inspection.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "evidence.locator_invalid",
      location: { evidenceId: "invalid-time" },
    }),
  );
  expect(inspection.diagnostics).toContainEqual(
    expect.objectContaining({
      code: "evidence.locator_invalid",
      location: { evidenceId: "invalid-page" },
    }),
  );
});

function nodeTypes(document: ArticleDocument): string[] {
  const result: string[] = [];
  const visitInline = (node: ArticleInlineNode<any>): void => {
    result.push(node.type);
    if (
      node.type === "emphasis" ||
      node.type === "strong" ||
      node.type === "strikethrough" ||
      node.type === "link"
    ) {
      node.children.forEach(visitInline);
    }
  };
  const visitBlock = (node: ArticleBlockNode<any>): void => {
    result.push(node.type);
    if (node.type === "heading" || node.type === "paragraph") node.children.forEach(visitInline);
    else if (node.type === "blockquote") node.children.forEach(visitBlock);
    else if (node.type === "list") node.items.forEach((item) => item.children.forEach(visitBlock));
    else if (node.type === "table") {
      node.header.forEach((cell) => cell.forEach(visitInline));
      node.rows.forEach((row) => row.forEach((cell) => cell.forEach(visitInline)));
    }
  };
  document.root.children.forEach(visitBlock);
  return result;
}
