import { expect, test } from "vite-plus/test";
import { ArticlePluginId, ChannelId } from "@trendpublish/contracts";
import type { SaveContentPlanPayload, WorkspaceSnapshot } from "#platform/api/types.ts";
import { applyChannelRequirements, requiresWeixinCover } from "./-requirements.ts";

test("Weixin targets lock an essential cover but keep connection selection explicit", () => {
  const form = {
    name: "微信方案",
    enabled: true,
    identityId: "identity-1",
    knowledgeBaseIds: [],
    sourceCollectionIds: [],
    plugins: [
      {
        pluginId: ArticlePluginId.CoverImage,
        enabled: false,
        config: { necessity: "enhancement", style: "保留的风格" },
      },
    ],
    connections: { chat: "chat-main", image: "disabled-image" },
    publishing: { mode: "publish", targetIds: ["target-weixin"] },
  } satisfies SaveContentPlanPayload;
  const workspace = {
    publishTargets: [
      {
        id: "target-weixin",
        name: "微信草稿",
        channelAccountId: "account-weixin",
        settings: {},
      },
    ],
    channelAccounts: [
      {
        id: "account-weixin",
        name: "公众号",
        channel: ChannelId.WeixinOfficialAccount,
        connectionId: "weixin-main",
        settings: {},
      },
    ],
    connections: [{ id: "image-main", connectorId: "image-connector", enabled: true }],
    connectorDefinitions: [{ id: "image-connector", capabilities: ["image"] }],
  } as WorkspaceSnapshot;

  expect(requiresWeixinCover(form, workspace)).toBe(true);
  const normalized = applyChannelRequirements(form, workspace);
  expect(normalized.connections.image).toBeUndefined();
  expect(normalized.plugins).toContainEqual({
    pluginId: ArticlePluginId.CoverImage,
    enabled: true,
    config: { necessity: "essential", style: "保留的风格" },
  });

  const explicitlyBound = applyChannelRequirements(
    { ...form, connections: { ...form.connections, image: "image-main" } },
    workspace,
  );
  expect(explicitlyBound.connections.image).toBe("image-main");
});
