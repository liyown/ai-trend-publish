import { expect, test } from "vite-plus/test";
import type { AssetProvider } from "@trendpublish/article";
import { ArticlePluginId, ArticleSourceFormat, ChannelId } from "@trendpublish/contracts";
import type {
  CallContext,
  ChatClient,
  ConnectorManager,
  ConnectorClientResolver,
  ImageClient,
} from "@trendpublish/connectors";
import { assert, assertEquals } from "@trendpublish/core/test";
import {
  createWorkspaceEntity,
  MemoryWorkspaceRepository,
  type ContentPlan,
} from "@trendpublish/core/workspace";
import { WorkspaceContentPlanResolver } from "./content-plan-resolver.ts";

test("content plan resolver prepares the fixed pipeline and selected plugin capabilities", async () => {
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
      channel: ChannelId.WeixinOfficialAccount,
      connectionId: "weixin-main",
      settings: {},
    }),
  );
  await workspace.save(
    "publish-target",
    createWorkspaceEntity({
      id: "target-weixin",
      name: "微信草稿",
      channelAccountId: "account-weixin",
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
    plugins: [
      { pluginId: ArticlePluginId.TitleStyle, enabled: true, config: { rules: ["克制"] } },
      {
        pluginId: ArticlePluginId.EditorialQuality,
        enabled: true,
        config: { maxQualityRounds: 3 },
      },
      { pluginId: ArticlePluginId.EvidenceSupplement, enabled: true, config: {} },
      {
        pluginId: ArticlePluginId.CoverImage,
        enabled: true,
        config: { style: "编辑感", necessity: "essential" },
      },
    ],
    connections: { chat: "chat-main", image: "image-main" },
    researchConnections: { search: ["source-search"], fetch: ["source-web"] },
    publishing: { mode: "content_only", targetIds: [] },
  });
  const chat: ChatClient = {
    async complete() {
      return { content: "{}" };
    },
  };
  let imageCallContext: CallContext | undefined;
  const image: ImageClient = {
    async generate(_input, context) {
      imageCallContext = context;
      return { images: [{ base64: "AQID", mimeType: "image/png" }] };
    },
  };
  let imageGets = 0;
  const connectors = {
    async get(id: string, capability: { key: string }) {
      if (id === "chat-main" && capability.key === "chat") return chat;
      if (id === "image-main" && capability.key === "image") {
        imageGets += 1;
        return image;
      }
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
  const resolver = new WorkspaceContentPlanResolver({
    workspace,
    connectors,
    connectionManager,
  });

  const prepared = await resolver.resolve(plan);

  assert(prepared.researcher);
  assert(prepared.writer);
  assert(prepared.reviser);
  assert(prepared.evidenceSupplementer);
  assertEquals(
    prepared.transformers?.map((item) => item.id),
    [ArticlePluginId.TitleStyle, `${ArticlePluginId.CoverImage}-request`],
  );
  assertEquals(
    prepared.evaluators?.map((item) => item.id),
    [ArticlePluginId.EditorialQuality],
  );
  assertEquals(prepared.assetProviders?.cover?.id, ArticlePluginId.CoverImage);
  assertEquals(prepared.quality?.maxQualityRounds, 3);
  assertEquals(imageGets, 0);
  assertEquals(prepared.requiredAssetTypes, []);

  const coverProvider = prepared.assetProviders?.cover;
  assert(coverProvider);
  const controller = new AbortController();
  await coverProvider.provide(coverProviderInput(), {
    signal: controller.signal,
    now: () => new Date("2026-07-18T00:00:00.000Z"),
    task: {
      jobId: "job-cover",
      taskId: "build/asset/1-cover-main/internal",
    } as never,
  });
  assertEquals(imageGets, 1);
  expect(imageCallContext).toEqual({
    signal: controller.signal,
    traceId: "job-cover",
    taskId: "build/asset/1-cover-main/internal",
  });

  const weixinPlan = {
    ...plan,
    publishing: { mode: "publish" as const, targetIds: ["target-weixin"] },
  };
  const preparedForWeixin = await resolver.resolve(weixinPlan);
  assertEquals(preparedForWeixin.requiredAssetTypes, ["cover"]);

  const withoutImage = await resolver.resolve({ ...plan, connections: { chat: "chat-main" } });
  assertEquals(
    withoutImage.transformers?.some((item) => item.id === `${ArticlePluginId.CoverImage}-request`),
    true,
  );
  assertEquals(withoutImage.assetProviders?.cover, undefined);

  await expect(
    resolver.resolve({
      ...weixinPlan,
      plugins: weixinPlan.plugins.filter(
        (selection) => selection.pluginId !== ArticlePluginId.CoverImage,
      ),
    }),
  ).rejects.toThrow("必须启用封面图片插件");
  await expect(
    resolver.resolve({
      ...weixinPlan,
      plugins: weixinPlan.plugins.map((selection) =>
        selection.pluginId === ArticlePluginId.CoverImage
          ? { ...selection, config: { necessity: "enhancement" } }
          : selection,
      ),
    }),
  ).rejects.toThrow("必须将封面设为必要资源");
  await expect(
    resolver.resolve({ ...weixinPlan, connections: { chat: "chat-main" } }),
  ).rejects.toThrow("必须绑定可用的图片连接");
});

function coverProviderInput(): Parameters<AssetProvider["provide"]>[0] {
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
