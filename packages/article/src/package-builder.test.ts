import { expect, test } from "vite-plus/test";
import { ArticleDocumentSchemaVersion, ArticleSourceFormat } from "@trendpublish/contracts";
import { fingerprint } from "@trendpublish/runtime";
import type { ArticleCompilation } from "./compiler.ts";
import type { BuildContentPackageInput } from "./package-builder.ts";
import { ContentPackageBuildError, ContentPackageBuilder } from "./package-builder.ts";

test("package building independently rejects missing citations and invalid evidence locators", async () => {
  const input = await buildInput();
  const error = await new ContentPackageBuilder()
    .build(input)
    .then(() => undefined)
    .catch((reason: unknown) => reason);

  expect(error).toBeInstanceOf(ContentPackageBuildError);
  if (error instanceof ContentPackageBuildError) {
    expect(error.reasons).toContain("Document 至少需要引用一条有效证据");
    expect(error.reasons).toContain("证据 evidence-1 的文本摘录不在素材 material-1 中");
  }
});

test("package building requires a canonical asset SHA-256 and verifies inline bytes", async () => {
  const input = await buildInput();
  input.assets = [
    {
      id: "invalid-checksum",
      mediaType: "image",
      source: { uri: "https://assets.example/image.png" },
      checksum: "hash-of-the-uri",
    },
    {
      id: "mismatched-inline-content",
      mediaType: "image",
      source: { uri: "data:image/png;base64,AQID" },
      checksum: "0".repeat(64),
    },
  ];

  const error = await new ContentPackageBuilder()
    .build(input)
    .then(() => undefined)
    .catch((reason: unknown) => reason);

  expect(error).toBeInstanceOf(ContentPackageBuildError);
  if (error instanceof ContentPackageBuildError) {
    expect(error.reasons).toContain("资源 invalid-checksum 缺少有效的 SHA-256 校验和");
    expect(error.reasons).toContain("资源 mismatched-inline-content 的 SHA-256 与实际内容不一致");
  }
});

async function buildInput(): Promise<BuildContentPackageInput> {
  const article = {
    source: {
      format: ArticleSourceFormat.Markdown,
      title: "标题",
      digest: "摘要",
      bodyMarkdown: "没有引用的正文。",
    },
    assetRequests: [],
  };
  const sourceHash = await fingerprint(article.source);
  const compilation: ArticleCompilation = {
    sourceHash,
    diagnostics: [],
    document: {
      schemaVersion: ArticleDocumentSchemaVersion.Current,
      title: article.source.title,
      digest: article.source.digest,
      root: { id: "node:root", type: "root", children: [] },
    },
  };

  return {
    article,
    compilation,
    brief: {
      topic: "主题",
      angle: "角度",
      rationale: "理由",
      thesis: "论点",
      outline: ["正文"],
      materials: [
        {
          id: "material-1",
          mediaType: "webpage",
          title: "素材",
          content: "真实素材内容",
          retrievedAt: "2026-07-18T00:00:00.000Z",
          contentHash: "material-hash",
        },
      ],
      evidence: [
        {
          id: "evidence-1",
          statement: "陈述",
          materialId: "material-1",
          locator: { type: "text", excerpt: "不存在的摘录" },
        },
      ],
      gaps: [],
    },
    assets: [],
    identity: {
      id: "identity-1",
      name: "身份",
      positioning: "定位",
      audience: "读者",
      tone: "冷静",
      revision: 1,
    },
    quality: {
      id: "quality-1",
      sourceHash,
      policyVersion: "1",
      diagnostics: [],
      evaluatedAt: "2026-07-18T00:00:00.000Z",
    },
    compilerVersion: "1",
    origin: { jobId: "job-1", planId: "plan-1", planRevision: 1 },
    createdAt: "2026-07-18T00:00:00.000Z",
  };
}
