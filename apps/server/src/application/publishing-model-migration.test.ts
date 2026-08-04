import { expect, test } from "vite-plus/test";
import { ChannelId, ContentPlanTemplateId } from "@trendpublish/contracts";
import {
  ConnectorClientResolver,
  ConnectorManager,
  MemoryConnectionStore,
  MemoryCredentialStore,
  createBuiltInConnectorRegistry,
} from "@trendpublish/connectors";
import {
  createWorkspaceEntity,
  LegacyWorkspaceKind,
  MemoryWorkspaceRepository,
} from "@trendpublish/core/workspace";
import {
  ChannelRegistry,
  WEIXIN_ARTICLE_PROFILE,
  WEIXIN_CHANNEL_DEFINITION,
  type ChannelAdapter,
} from "@trendpublish/publishing";
import { migratePublishingModel } from "./publishing-model-migration.ts";

test("legacy targets migrate to destinations and shared secrets move to dedicated connections", async () => {
  const runtime = fixture();
  await runtime.connectionManager.save({
    id: "legacy-weixin-shared",
    connectorId: ChannelId.WeixinOfficialAccount,
    name: "旧共享微信连接",
    settings: {},
    credentials: { appId: "app-id", appSecret: "secret-value" },
  });
  for (const id of ["a", "b"]) {
    await runtime.workspace.save(
      "channel-account",
      createWorkspaceEntity({
        id: `account-${id}`,
        name: `账号 ${id}`,
        enabled: true,
        channel: ChannelId.WeixinOfficialAccount,
        connectionId: "legacy-weixin-shared",
        settings: {},
      }),
    );
    await runtime.workspace.save(
      LegacyWorkspaceKind.PublishTarget,
      createWorkspaceEntity({
        id: `target-${id}`,
        name: `旧目标 ${id}`,
        channelAccountId: `account-${id}`,
        publicationType: "article",
        settings: { author: `作者 ${id}` },
      }),
    );
  }
  await runtime.workspace.save(
    "content-plan",
    createWorkspaceEntity({
      id: "legacy-plan",
      name: "旧方案",
      enabled: true,
      templateId: ContentPlanTemplateId.DailyBrief,
      identityId: "identity",
      knowledgeBaseIds: [],
      sourceCollectionIds: [],
      connections: {},
      publishing: { mode: "publish", targetIds: ["target-a", "target-b"] },
    }) as never,
  );

  await migratePublishingModel(runtime);

  const plan = await runtime.workspace.get("content-plan", "legacy-plan");
  expect(plan?.publishing.destinations).toEqual([
    { accountId: "account-a", publicationType: "article", options: { author: "作者 a" } },
    { accountId: "account-b", publicationType: "article", options: { author: "作者 b" } },
  ]);
  expect(await runtime.workspace.list(LegacyWorkspaceKind.PublishTarget)).toHaveLength(0);
  expect(await runtime.workspace.list(LegacyWorkspaceKind.Migration)).toHaveLength(1);
  expect(await runtime.connectionManager.get("legacy-weixin-shared")).toBeNull();
  for (const id of ["a", "b"]) {
    const account = await runtime.workspace.get("channel-account", `account-${id}`);
    expect(account?.connectionId).toBe(`channel-account-${id}`);
    const connection = await runtime.connectionManager.get(`channel-account-${id}`);
    expect(connection?.credentialState).toEqual({
      appId: true,
      appSecret: true,
      proxyUrl: false,
    });
    expect(JSON.stringify(connection)).not.toContain("secret-value");
  }

  const revision = plan?.revision;
  await migratePublishingModel(runtime);
  expect((await runtime.workspace.get("content-plan", "legacy-plan"))?.revision).toBe(revision);
});

test("migration fails explicitly and keeps legacy documents when a target cannot resolve", async () => {
  const runtime = fixture();
  await runtime.workspace.save(
    "content-plan",
    createWorkspaceEntity({
      id: "broken-plan",
      name: "损坏方案",
      enabled: true,
      templateId: ContentPlanTemplateId.DailyBrief,
      identityId: "identity",
      knowledgeBaseIds: [],
      sourceCollectionIds: [],
      connections: {},
      publishing: { mode: "publish", targetIds: ["missing-target"] },
    }) as never,
  );

  await expect(migratePublishingModel(runtime)).rejects.toThrow(/无法迁移/);
  expect(await runtime.workspace.list(LegacyWorkspaceKind.Migration)).toHaveLength(0);
  const stored = (await runtime.workspace.get("content-plan", "broken-plan")) as unknown as {
    publishing: { targetIds: string[] };
  };
  expect(stored.publishing.targetIds).toEqual(["missing-target"]);
});

function fixture() {
  const workspace = new MemoryWorkspaceRepository();
  const connections = new MemoryConnectionStore();
  const credentials = new MemoryCredentialStore();
  const connectorRegistry = createBuiltInConnectorRegistry();
  const resolver = new ConnectorClientResolver({
    registry: connectorRegistry,
    connections,
    credentials,
  });
  const adapter: ChannelAdapter = {
    id: "migration-weixin",
    version: "1",
    channel: ChannelId.WeixinOfficialAccount,
    publicationType: "article",
    async prepare(contentPackage) {
      return {
        title: contentPackage.document.title,
        digest: contentPackage.document.digest,
        body: { format: "html", content: "<p>migration</p>" },
        assets: [],
      };
    },
    async publish(_prepared, _account, context) {
      return { status: "succeeded", publishedAt: context.now().toISOString() };
    },
  };
  return {
    workspace,
    connectionManager: new ConnectorManager(resolver, connectorRegistry, connections, credentials),
    channels: new ChannelRegistry([
      {
        definition: WEIXIN_CHANNEL_DEFINITION,
        profiles: [WEIXIN_ARTICLE_PROFILE],
        adapters: [adapter],
      },
    ]),
  };
}
