import { expect, test } from "vite-plus/test";
import type { ContentPackage } from "@trendpublish/article";
import { articleAssetUri, renderArticleDocumentHtml } from "./article-html-renderer.ts";

const equal = (actual: unknown, expected: unknown): void => expect(actual).toBe(expected);
const deepEqual = (actual: unknown, expected: unknown): void => expect(actual).toEqual(expected);
const throws = (operation: () => unknown, expected: RegExp): void =>
  expect(operation).toThrow(expected);

test("renders the frozen article AST and returns the referenced content image manifest", () => {
  const value = contentPackage([
    {
      id: "heading",
      type: "heading",
      depth: 2,
      children: [
        { id: "heading-text", type: "text", text: "结构化内容" },
        {
          id: "heading-strong",
          type: "strong",
          children: [{ id: "heading-strong-text", type: "text", text: "更可靠" }],
        },
        {
          id: "heading-delete",
          type: "strikethrough",
          children: [{ id: "heading-delete-text", type: "text", text: "旧格式" }],
        },
      ],
    },
    {
      id: "paragraph",
      type: "paragraph",
      children: [
        { id: "unsafe-text", type: "text", text: "<内容>" },
        { id: "break", type: "line-break" },
        { id: "citation", type: "citation", evidenceId: "evidence-1", label: "来源" },
        {
          id: "unsafe-link",
          type: "link",
          href: "javascript:alert(1)",
          children: [{ id: "unsafe-link-text", type: "text", text: "不安全链接" }],
        },
      ],
    },
    {
      id: "image-paragraph",
      type: "paragraph",
      children: [
        {
          id: "image",
          type: "asset",
          assetId: "body-image",
          alt: "结构图",
          caption: "系统结构",
        },
      ],
    },
    {
      id: "duplicate-image-paragraph",
      type: "paragraph",
      children: [{ id: "duplicate-image", type: "asset", assetId: "body-image", alt: "结构图" }],
    },
    {
      id: "list",
      type: "list",
      ordered: true,
      start: 2,
      items: [
        {
          id: "item",
          checked: true,
          children: [
            {
              id: "item-paragraph",
              type: "paragraph",
              children: [{ id: "item-text", type: "text", text: "检查完成" }],
            },
          ],
        },
      ],
    },
    {
      id: "table",
      type: "table",
      header: [[{ id: "header", type: "text", text: "项目" }]],
      rows: [[[{ id: "cell", type: "inline-code", text: "AST" }]]],
      align: ["center"],
    },
    { id: "code", type: "code", language: "ts", text: "const value = '<safe>';" },
    { id: "break", type: "thematic-break" },
  ]);

  const rendered = renderArticleDocumentHtml(value);

  equal(rendered.html.includes("<h2>结构化内容<strong>更可靠</strong><s>旧格式</s></h2>"), true);
  equal(rendered.html.includes("&lt;内容&gt;<br>"), true);
  equal(
    rendered.html.includes(
      '<a href="https://source.example.com/article" title="参考资料" data-evidence-id="evidence-1">来源</a>',
    ),
    true,
  );
  equal(rendered.html.includes("javascript:"), false);
  equal(
    rendered.html.includes(
      `<figure><img src="${articleAssetUri("body-image")}" alt="结构图"><figcaption>系统结构</figcaption></figure>`,
    ),
    true,
  );
  equal(rendered.html.includes('<ol start="2"><li><input type="checkbox" disabled checked>'), true);
  equal(rendered.html.includes('<th style="text-align:center">项目</th>'), true);
  equal(rendered.html.includes("const value = '&lt;safe&gt;';"), true);
  deepEqual(rendered.contentAssetIds, ["body-image"]);
});

test("rejects nodes and asset schemes that bypass the frozen asset graph", () => {
  throws(
    () =>
      renderArticleDocumentHtml(
        contentPackage([{ id: "html", type: "html", html: "<aside>raw</aside>" }]),
      ),
    /不能包含原始 HTML 节点/,
  );
  throws(
    () =>
      renderArticleDocumentHtml(
        contentPackage([
          {
            id: "remote-paragraph",
            type: "paragraph",
            children: [
              {
                id: "remote-image",
                type: "remote-image",
                sourceUrl: "https://cdn.example.com/image.png",
                alt: "远程图片",
              },
            ],
          },
        ]),
      ),
    /不能包含远程图片节点/,
  );
  const unsafeAsset = contentPackage([
    {
      id: "file-paragraph",
      type: "paragraph",
      children: [{ id: "file", type: "asset", assetId: "unsafe-file", alt: "附件" }],
    },
  ]);
  unsafeAsset.assets.push({
    id: "unsafe-file",
    mediaType: "file",
    source: { uri: "javascript:alert(1)" },
    checksum: "0".repeat(64),
  });
  throws(() => renderArticleDocumentHtml(unsafeAsset), /访问地址不受支持/);
});

test("fails instead of silently dropping broken package references", () => {
  throws(
    () =>
      renderArticleDocumentHtml(
        contentPackage([
          {
            id: "paragraph",
            type: "paragraph",
            children: [{ id: "image", type: "asset", assetId: "missing", alt: "缺失" }],
          },
        ]),
      ),
    /文章引用了不存在的资源 missing/,
  );

  const missingEvidence = contentPackage([
    {
      id: "paragraph",
      type: "paragraph",
      children: [{ id: "citation", type: "citation", evidenceId: "missing", label: "来源" }],
    },
  ]);
  throws(() => renderArticleDocumentHtml(missingEvidence), /文章引用了不存在的证据 missing/);
});

function contentPackage(children: ContentPackage["document"]["root"]["children"]): ContentPackage {
  return {
    schemaVersion: "content-package.v5",
    id: "package-1",
    checksum: "package-checksum",
    source: {
      format: "article-markdown.v1",
      title: "标题",
      digest: "摘要",
      bodyMarkdown: "正文",
    },
    document: {
      schemaVersion: "article-document.v1",
      title: "标题",
      digest: "摘要",
      coverAssetId: "cover",
      root: { id: "root", type: "root", children },
    },
    evidence: [
      {
        id: "evidence-1",
        statement: "可验证陈述",
        materialId: "material-1",
        locator: { type: "text", excerpt: "原文" },
      },
    ],
    materials: [
      {
        id: "material-1",
        mediaType: "webpage",
        title: "参考资料",
        sourceUrl: "https://source.example.com/article",
        retrievedAt: "2026-07-18T00:00:00.000Z",
        contentHash: "material-hash",
      },
    ],
    assets: [
      {
        id: "cover",
        mediaType: "image",
        source: { uri: "memory://cover" },
        checksum: "0".repeat(64),
      },
      {
        id: "body-image",
        mediaType: "image",
        source: { uri: "memory://body-image" },
        checksum: "0".repeat(64),
      },
    ],
    identity: {
      id: "identity-tech",
      name: "技术编辑",
      positioning: "解释技术趋势",
      audience: "开发者",
      tone: "清晰",
      revision: 1,
    },
    build: { sourceHash: "source-hash", compilerVersion: "1" },
    quality: { reportId: "quality-1", policyVersion: "1", warnings: [] },
    origin: { jobId: "job-1", planId: "plan-1", planRevision: 1 },
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}
