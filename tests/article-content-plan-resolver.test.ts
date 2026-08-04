import { test } from "vite-plus/test";
import { ChannelId } from "@trendpublish/contracts";
import type {
  ChatClient,
  ConnectorClientResolver,
  ConnectorManager,
} from "@trendpublish/connectors";
import { assert, assertEquals } from "@trendpublish/core/test";
import {
  createWorkspaceEntity,
  MemoryWorkspaceRepository,
  type ContentPlan,
} from "@trendpublish/core/workspace";
import { WorkspaceContentPlanResolver } from "@trendpublish/article/application";

test("content plan resolver keeps channel assets out of the shared ReAct plan", async () => {
  const workspace = new MemoryWorkspaceRepository();
  await workspace.save(
    "source-collection",
    createWorkspaceEntity({
      id: "sources-daily",
      name: "每日来源",
      enabled: true,
      sources: [
        {
          id: "source-release",
          kind: "url" as const,
          url: "https://example.com/releases",
          enabled: true,
        },
        {
          id: "source-query",
          kind: "query" as const,
          query: "AI runtime release",
          enabled: true,
        },
      ],
    }),
  );
  await workspace.save(
    "channel-account",
    createWorkspaceEntity({
      id: "account-weixin",
      name: "公众号",
      enabled: true,
      channel: ChannelId.WeixinOfficialAccount,
      connectionId: "weixin-main",
      settings: {},
    }),
  );
  const plan = createWorkspaceEntity<Omit<ContentPlan, "revision" | "createdAt" | "updatedAt">>({
    id: "plan-daily",
    name: "每日解读",
    enabled: true,
    identityId: "identity-1",
    knowledgeBaseIds: [],
    sourceCollectionIds: ["sources-daily"],
    connections: { chat: "chat-main", image: "image-main" },
    researchConnections: { search: ["source-search"], fetch: ["source-web"] },
    publishing: { destinations: [] },
  });
  const chat: ChatClient = {
    async complete() {
      return { content: "{}" };
    },
  };
  const connectors = {
    async get(id: string, capability: { key: string }) {
      if (id === "chat-main" && capability.key === "chat") return chat;
      throw new Error(`unexpected connector ${id}/${capability.key}`);
    },
  } as unknown as ConnectorClientResolver;
  const connectionManager = {
    definitions() {
      return [
        { id: "web-provider", capabilities: ["source-fetch"] },
        { id: "search-provider", capabilities: ["source-search"] },
      ];
    },
    async list() {
      return [
        {
          id: "source-web",
          revision: 1,
          connectorId: "web-provider",
          name: "Web",
          enabled: true,
        },
        {
          id: "source-search",
          revision: 1,
          connectorId: "search-provider",
          name: "Search",
          enabled: true,
        },
      ];
    },
  } as unknown as ConnectorManager;
  const resolver = new WorkspaceContentPlanResolver({ workspace, connectors, connectionManager });

  const prepared = await resolver.resolve(plan);
  assertEquals(prepared.researcher, undefined);
  assertEquals(prepared.writer, undefined);
  assert(prepared.agent);
  assertEquals(prepared.transformers, undefined);
  assertEquals(prepared.requiredAssetTypes, undefined);
  assertEquals(prepared.assetProviders, undefined);

  const preparedForWeixin = await resolver.resolve({
    ...plan,
    publishing: {
      destinations: [{ accountId: "account-weixin", publicationType: "article" }],
    },
  });
  assert(preparedForWeixin.agent);
  assertEquals(preparedForWeixin.requiredAssetTypes, undefined);
  assertEquals(preparedForWeixin.assetProviders, undefined);
});
