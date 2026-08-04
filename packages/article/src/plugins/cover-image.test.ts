import { expect, test } from "vite-plus/test";
import { ArticleSourceFormat } from "@trendpublish/contracts";
import { computeContentAssetChecksum, decodeContentDataUri } from "../asset-integrity.ts";
import {
  type CoverImageGenerationContext,
  CoverImageProvider,
  CoverRequestTransformer,
} from "./cover-image.ts";

test("cover request transformer declares an essential cover without touching source", async () => {
  const transformer = new CoverRequestTransformer({ style: "黑白编辑风" });
  const article = {
    source: {
      format: ArticleSourceFormat.Markdown,
      title: "标题",
      digest: "摘要",
      bodyMarkdown: "正文",
    },
    assetRequests: [],
  };
  const result = await transformer.transform({ article } as never);
  expect(result.source).toEqual(article.source);
  expect(result.assetRequests).toHaveLength(1);
  expect(result.assetRequests[0]?.type).toBe("cover");
  expect(result.assetRequests[0]?.necessity).toBe("essential");
  expect(result.assetRequests[0]?.brief.includes("黑白编辑风")).toBe(true);
});

test("cover provider freezes remote image bytes in the asset and hashes those bytes", async () => {
  const expectedBytes = Uint8Array.from([1, 2, 3, 4]);
  let requestedUrl = "";
  let generationContext: CoverImageGenerationContext | undefined;
  const provider = new CoverImageProvider({
    generator: {
      async generate(_input, context) {
        generationContext = context;
        return { uri: "https://temporary.example/cover.png", width: 1200, height: 630 };
      },
    },
    async fetcher(input) {
      requestedUrl =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      return new Response(expectedBytes, { headers: { "content-type": "image/png" } });
    },
  });

  const context = operationContext();
  const asset = await provider.provide(providerInput(), context);

  expect(requestedUrl).toBe("https://temporary.example/cover.png");
  expect(generationContext).toEqual({
    signal: context.signal,
    jobId: "job-cover",
    taskId: "build/asset/1-cover-main/internal",
  });
  expect(asset.source.uri.startsWith("data:image/png;base64,")).toBe(true);
  expect(decodeContentDataUri(asset.source.uri).bytes).toEqual(expectedBytes);
  expect(asset.checksum).toBe(await computeContentAssetChecksum(expectedBytes));
  expect(asset.id).toBe(`asset-${asset.checksum.slice(0, 20)}`);
});

test("cover provider normalizes generated Data URIs into the same frozen representation", async () => {
  const expectedBytes = new TextEncoder().encode("generated image");
  const provider = new CoverImageProvider({
    generator: {
      async generate() {
        return { uri: "data:image/webp,generated%20image" };
      },
    },
    async fetcher() {
      throw new Error("Data URI must not be fetched");
    },
  });

  const asset = await provider.provide(providerInput(), operationContext());

  expect(asset.source.uri.startsWith("data:image/webp;base64,")).toBe(true);
  expect(decodeContentDataUri(asset.source.uri).bytes).toEqual(expectedBytes);
  expect(asset.checksum).toBe(await computeContentAssetChecksum(expectedBytes));
});

test("cover provider uses a valid frozen fallback when image generation is unavailable", async () => {
  const provider = new CoverImageProvider({});

  const asset = await provider.provide(providerInput(), operationContext());
  const decoded = decodeContentDataUri(asset.source.uri);

  expect(asset.mimeType).toBe("image/png");
  expect(asset.width).toBe(900);
  expect(asset.height).toBe(383);
  expect(asset.metadata).toEqual({ fallback: true });
  expect(decoded.bytes.byteLength).toBeGreaterThan(0);
  expect(asset.checksum).toBe(await computeContentAssetChecksum(decoded.bytes));
});

function providerInput(): Parameters<CoverImageProvider["provide"]>[0] {
  return {
    request: {
      id: "cover-main",
      type: "cover",
      necessity: "essential",
      brief: "生成封面",
    },
    article: {
      source: {
        format: ArticleSourceFormat.Markdown,
        title: "标题",
        digest: "摘要",
        bodyMarkdown: "正文",
      },
      assetRequests: [],
    },
    view: {
      sourceHash: "source-hash",
      title: "标题",
      digest: "摘要",
      root: { id: "root", type: "root", children: [] },
      evidenceIds: [],
      assetRequestIds: [],
    },
    brief: {
      topic: "主题",
      angle: "角度",
      rationale: "理由",
      thesis: "论点",
      outline: [],
      materials: [],
      evidence: [],
      gaps: [],
    },
    identity: {
      id: "identity-1",
      name: "身份",
      positioning: "定位",
      audience: "读者",
      tone: "冷静",
      revision: 1,
    },
  };
}

function operationContext(): Parameters<CoverImageProvider["provide"]>[1] {
  return {
    signal: new AbortController().signal,
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    task: {
      jobId: "job-cover",
      taskId: "build/asset/1-cover-main/internal",
    } as never,
  };
}
