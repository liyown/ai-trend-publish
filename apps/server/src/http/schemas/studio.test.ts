import { test } from "vite-plus/test";
import { ArticleSourceFormat } from "@trendpublish/contracts";
import { assert, assertEquals } from "@trendpublish/core/test";
import { completeArticleSchema, saveSourceCollectionSchema } from "./studio.ts";

test("source collections accept explicit URL and query seeds", () => {
  const parsed = saveSourceCollectionSchema.safeParse({
    name: "主动研究来源",
    enabled: true,
    sources: [
      {
        kind: "url",
        url: "https://example.com/news",
        enabled: true,
      },
      {
        kind: "query",
        query: "AI agent runtime release",
        enabled: true,
      },
    ],
  });

  assert(parsed.success);
});

test("manual completion accepts ArticleSource and rejects the removed arbitrary draft shape", () => {
  const accepted = completeArticleSchema.safeParse({
    planId: "plan-1",
    reviewRequestId: "review-1",
    source: {
      format: ArticleSourceFormat.Markdown,
      title: "人工修订标题",
      digest: "人工修订后的摘要",
      bodyMarkdown: "正文。[来源](evidence://evidence-1)",
    },
    assetRequests: [
      {
        id: "cover-1",
        type: "cover",
        necessity: "enhancement",
        brief: "克制的技术主题封面",
        alt: "技术主题封面",
      },
    ],
  });
  const rejected = completeArticleSchema.safeParse({
    planId: "plan-1",
    reviewRequestId: "review-1",
    draft: { document: {} },
  });

  assert(accepted.success);
  assertEquals(rejected.success, false);
});

test("manual completion requires a strict editable resource request list", () => {
  const source = {
    format: ArticleSourceFormat.Markdown,
    title: "人工修订标题",
    digest: "人工修订后的摘要",
    bodyMarkdown: "正文。[来源](evidence://evidence-1)",
  };
  const missingRequests = completeArticleSchema.safeParse({
    planId: "plan-1",
    reviewRequestId: "review-1",
    source,
  });
  const unknownRequestField = completeArticleSchema.safeParse({
    planId: "plan-1",
    reviewRequestId: "review-1",
    source,
    assetRequests: [
      {
        id: "cover-1",
        type: "cover",
        necessity: "enhancement",
        brief: "技术主题封面",
        providerId: "removed-provider-routing",
      },
    ],
  });

  assertEquals(missingRequests.success, false);
  assertEquals(unknownRequestField.success, false);
});
