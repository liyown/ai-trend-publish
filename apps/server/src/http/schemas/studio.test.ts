import { test } from "vite-plus/test";
import { assert } from "@trendpublish/core/test";
import {
  publishContentSchema,
  saveChannelAccountSchema,
  saveContentPlanSchema,
  saveSourceCollectionSchema,
} from "./studio.ts";

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

test("channel accounts retain publisher connector references", () => {
  const parsed = saveChannelAccountSchema.safeParse({
    name: "公众号",
    enabled: true,
    channel: "weixin-official-account",
    connectorId: "weixin-official-account",
    settings: {},
    publisher: { toolConnectionIds: ["image-1"] },
  });

  assert(parsed.success);
  assert(
    JSON.stringify(parsed.data.publisher) === JSON.stringify({ toolConnectionIds: ["image-1"] }),
  );
});

test("manual publication rejects duplicate account and publication type destinations", () => {
  const parsed = publishContentSchema.safeParse({
    packageId: "package-1",
    destinations: [
      { accountId: "account-1", publicationType: "article" },
      { accountId: "account-1", publicationType: "article", options: { author: "重复" } },
    ],
  });

  assert(!parsed.success);
});

test("content plans retain only the turn budget from legacy payloads", () => {
  const parsed = saveContentPlanSchema.safeParse({
    name: "每日简报",
    enabled: true,
    templateId: "daily-brief",
    identityId: "identity-1",
    sourceCollectionIds: [],
    connections: { chat: "model-1" },
    agent: {
      modelConnectionId: "model-1",
      strategyId: "daily-brief",
      toolConnectionIds: [],
      enhancementToolIds: [],
      budget: { maxTurns: 12, maxToolCalls: 8, maxContextTokens: 32_000 },
    },
    publishing: { destinations: [] },
  });

  assert(parsed.success);
  assert(JSON.stringify(parsed.data.agent?.budget) === JSON.stringify({ maxTurns: 12 }));
});
