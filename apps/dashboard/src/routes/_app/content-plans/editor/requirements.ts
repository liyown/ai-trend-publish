import { ArticlePluginId, ChannelId } from "@trendpublish/contracts";
import type { JsonValue, SaveContentPlanPayload, WorkspaceSnapshot } from "#platform/api/types.ts";

export function requiresWeixinCover(
  form: SaveContentPlanPayload,
  workspace: WorkspaceSnapshot,
): boolean {
  return (
    form.publishing.mode === "publish" &&
    form.publishing.targetIds.some((id) => isWeixinPublishTarget(id, workspace))
  );
}

export function isWeixinPublishTarget(targetId: string, workspace: WorkspaceSnapshot): boolean {
  const target = workspace.publishTargets.find((item) => item.id === targetId);
  const account = workspace.channelAccounts.find((item) => item.id === target?.channelAccountId);
  return account?.channel === ChannelId.WeixinOfficialAccount;
}

/** Keeps plan editing aligned with hard requirements declared by selected channels. */
export function applyChannelRequirements(
  form: SaveContentPlanPayload,
  workspace: WorkspaceSnapshot,
): SaveContentPlanPayload {
  if (!requiresWeixinCover(form, workspace)) return form;
  const cover = form.plugins.find((item) => item.pluginId === ArticlePluginId.CoverImage);
  const coverConfig = record(cover?.config);
  const requiredCover = {
    pluginId: ArticlePluginId.CoverImage,
    enabled: true,
    config: { ...coverConfig, necessity: "essential" } as JsonValue,
  };
  const plugins = cover
    ? form.plugins.map((item) =>
        item.pluginId === ArticlePluginId.CoverImage ? requiredCover : item,
      )
    : [...form.plugins, requiredCover];
  const imageConnectionId = isEnabledImageConnection(form.connections.image, workspace)
    ? form.connections.image
    : undefined;
  const otherConnections = { ...form.connections };
  delete otherConnections.image;
  return {
    ...form,
    plugins,
    connections: imageConnectionId
      ? { ...otherConnections, image: imageConnectionId }
      : otherConnections,
  };
}

function isEnabledImageConnection(
  connectionId: string | undefined,
  workspace: WorkspaceSnapshot,
): connectionId is string {
  if (!connectionId) return false;
  const definitions = new Map(workspace.connectorDefinitions.map((item) => [item.id, item]));
  const connection = workspace.connections.find((item) => item.id === connectionId);
  return Boolean(
    connection?.enabled && definitions.get(connection.connectorId)?.capabilities.includes("image"),
  );
}

function record(value: JsonValue | undefined): Record<string, JsonValue> {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}
