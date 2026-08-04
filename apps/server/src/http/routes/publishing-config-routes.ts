import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { WorkspaceKind, type ChannelAccount, type JsonObject } from "@trendpublish/contracts";
import type { SaveConnectionInput } from "@trendpublish/connectors";
import { createWorkspaceEntity } from "@trendpublish/core/workspace";
import { factory, type AppVariables } from "../deps.ts";
import { HttpError, jsonValidator } from "../middleware/errors.ts";
import {
  objectIdParam,
  saveChannelAccountSchema,
  testChannelAccountSchema,
} from "../schemas/studio.ts";
import { removeWorkspaceDocument, updateWorkspaceDocument } from "./workspace-route-helpers.ts";

const listAccounts = factory.createHandlers(async (c) => {
  const runtime = await c.var.deps.getRuntime();
  const accounts = await runtime.workspace.list(WorkspaceKind.ChannelAccount);
  return c.json({
    channelAccounts: await Promise.all(accounts.map((account) => publicAccount(runtime, account))),
  });
});

const getAccount = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const account = await runtime.workspace.get(
      WorkspaceKind.ChannelAccount,
      c.req.valid("param").id,
    );
    if (!account) throw new HttpError("发布账号不存在", 404);
    return c.json({ channelAccount: await publicAccount(runtime, account) });
  },
);

const createAccount = factory.createHandlers(
  zValidator("json", saveChannelAccountSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    validateChannelConnector(runtime, body.channel, body.connectorId);
    await validatePublisherTools(runtime, body.channel, body.publisher?.toolConnectionIds ?? []);
    const id = `account-${crypto.randomUUID()}`;
    const connectionId = `channel-${id}`;
    const connection = await runtime.connectionManager.save({
      id: connectionId,
      connectorId: body.connectorId,
      name: body.name,
      enabled: body.enabled,
      settings: body.settings,
      credentials: body.credentials,
      clearCredentials: body.clearCredentials,
      metadata: managedMetadata(id),
    });
    try {
      const channelAccount = createWorkspaceEntity({
        id,
        name: body.name,
        enabled: body.enabled,
        channel: body.channel,
        connectionId,
        settings: body.settings,
        connectorId: connection.connectorId,
        credentialState: connection.credentialState,
        publisher: { toolConnectionIds: body.publisher?.toolConnectionIds ?? [] },
      }) as ChannelAccount;
      await runtime.workspace.save(WorkspaceKind.ChannelAccount, channelAccount);
      return c.json({ channelAccount }, 201);
    } catch (error) {
      await runtime.connectionManager.remove(connectionId);
      throw error;
    }
  },
);

const updateAccount = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  zValidator("json", saveChannelAccountSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const id = c.req.valid("param").id;
    const body = c.req.valid("json");
    const current = await runtime.workspace.get(WorkspaceKind.ChannelAccount, id);
    if (!current) throw new HttpError("发布账号不存在", 404);
    validateChannelConnector(runtime, body.channel, body.connectorId);
    await validatePublisherTools(runtime, body.channel, body.publisher?.toolConnectionIds ?? []);
    const existingConnection = await runtime.connectionManager.get(current.connectionId);
    const switchingConnector = existingConnection?.connectorId !== body.connectorId;
    const connectionId = switchingConnector
      ? `channel-${id}-${crypto.randomUUID()}`
      : current.connectionId;
    const connection = await runtime.connectionManager.save({
      id: connectionId,
      revision: switchingConnector ? undefined : existingConnection?.revision,
      connectorId: body.connectorId,
      name: body.name,
      enabled: body.enabled,
      settings: body.settings,
      credentials: body.credentials,
      clearCredentials: body.clearCredentials,
      metadata: managedMetadata(id),
    });
    try {
      const channelAccount = await updateWorkspaceDocument(
        runtime.workspace,
        WorkspaceKind.ChannelAccount,
        id,
        {
          revision: body.revision,
          name: body.name,
          enabled: body.enabled,
          channel: body.channel,
          connectionId,
          settings: body.settings,
          connectorId: connection.connectorId,
          credentialState: connection.credentialState,
          publisher: { toolConnectionIds: body.publisher?.toolConnectionIds ?? [] },
        },
      );
      if (switchingConnector && existingConnection) {
        await runtime.connectionManager.remove(existingConnection.id);
      }
      return c.json({ channelAccount });
    } catch (error) {
      if (switchingConnector) await runtime.connectionManager.remove(connectionId);
      throw error;
    }
  },
);

const deleteAccount = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const id = c.req.valid("param").id;
    if (
      (await runtime.workspace.list(WorkspaceKind.ContentPlan)).some((plan) =>
        plan.publishing.destinations.some((destination) => destination.accountId === id),
      )
    ) {
      throw new HttpError("发布账号正在被内容方案使用", 409);
    }
    const account = await runtime.workspace.get(WorkspaceKind.ChannelAccount, id);
    if (!account) throw new HttpError("发布账号不存在", 404);
    await removeWorkspaceDocument(runtime.workspace, WorkspaceKind.ChannelAccount, id);
    const connection = await runtime.connectionManager.get(account.connectionId);
    if (connection?.metadata["managedBy"] === "channel-account") {
      await runtime.connectionManager.remove(account.connectionId);
    }
    return c.json({ success: true });
  },
);

const testAccount = factory.createHandlers(
  zValidator("json", testChannelAccountSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const { accountId, revision: _revision, ...body } = c.req.valid("json");
    validateChannelConnector(runtime, body.channel, body.connectorId);

    let connectionId = `channel-account-test-${crypto.randomUUID()}`;
    if (accountId) {
      const account = await runtime.workspace.get(WorkspaceKind.ChannelAccount, accountId);
      if (!account) throw new HttpError("发布账号不存在", 404);
      const connection = await runtime.connectionManager.get(account.connectionId);
      if (!connection) throw new HttpError("发布账号的受管连接不存在", 409);
      if (connection.connectorId === body.connectorId) connectionId = account.connectionId;
    }

    return c.json({
      test: await runtime.connectionManager.check({
        ...body,
        id: connectionId,
        enabled: true,
      } as SaveConnectionInput),
    });
  },
);

export const publishingConfigRoutes = new Hono<{ Variables: AppVariables }>()
  .get("/api/channel-accounts", ...listAccounts)
  .get("/api/channel-accounts/:id", ...getAccount)
  .post("/api/channel-accounts/test", ...testAccount)
  .post("/api/channel-accounts", ...createAccount)
  .patch("/api/channel-accounts/:id", ...updateAccount)
  .delete("/api/channel-accounts/:id", ...deleteAccount);

function validateChannelConnector(
  runtime: Awaited<ReturnType<AppVariables["deps"]["getRuntime"]>>,
  channel: string,
  connectorId: string,
): void {
  let definition;
  try {
    definition = runtime.channels.getDefinition(channel);
  } catch (error) {
    throw new HttpError(error instanceof Error ? error.message : String(error), 400);
  }
  if (!definition.connectorIds.includes(connectorId)) {
    throw new HttpError("所选接入方式不属于该发布渠道", 400);
  }
}

async function validatePublisherTools(
  runtime: Awaited<ReturnType<AppVariables["deps"]["getRuntime"]>>,
  channel: string,
  connectionIds: string[],
): Promise<void> {
  if (new Set(connectionIds).size !== connectionIds.length) {
    throw new HttpError("发布器工具不能重复添加", 400);
  }
  const profiles = runtime.channels
    .profileDefinitions()
    .filter((profile) => profile.channel === channel);
  const allowedCapabilities = new Set(
    profiles.flatMap((profile) => profile.publisherTools?.map((tool) => tool.capability) ?? []),
  );
  const requiredTools = profiles.flatMap(
    (profile) => profile.publisherTools?.filter((tool) => tool.required) ?? [],
  );
  if (connectionIds.length && !allowedCapabilities.size) {
    throw new HttpError("该渠道不支持配置发布器工具", 400);
  }
  const [connections, definitions] = await Promise.all([
    runtime.connectionManager.list(),
    Promise.resolve(runtime.connectionManager.definitions()),
  ]);
  const byId = new Map(connections.map((connection) => [connection.id, connection]));
  const definitionById = new Map(definitions.map((definition) => [definition.id, definition]));
  const selectedCapabilities = new Set<string>();
  for (const connectionId of connectionIds) {
    const connection = byId.get(connectionId);
    if (!connection || !connection.enabled) {
      throw new HttpError(`发布器工具连接不存在或已禁用：${connectionId}`, 400);
    }
    if (connection.metadata["managedBy"] === "channel-account") {
      throw new HttpError("发布器工具必须引用通用连接，不能引用发布账号受管连接", 400);
    }
    const capabilities = definitionById.get(connection.connectorId)?.capabilities ?? [];
    if (!capabilities.some((capability) => allowedCapabilities.has(capability))) {
      throw new HttpError(`连接 ${connection.name} 不支持该渠道的发布器工具能力`, 400);
    }
    for (const capability of capabilities) selectedCapabilities.add(capability);
  }
  const missingRequired = requiredTools.find((tool) => !selectedCapabilities.has(tool.capability));
  if (missingRequired) {
    throw new HttpError(`发布器必须配置${missingRequired.name}连接`, 400);
  }
}

async function publicAccount(
  runtime: Awaited<ReturnType<AppVariables["deps"]["getRuntime"]>>,
  account: ChannelAccount,
): Promise<ChannelAccount> {
  const connection = await runtime.connectionManager.get(account.connectionId);
  return {
    ...account,
    enabled: account.enabled !== false && Boolean(connection?.enabled),
    settings: connection?.settings ?? account.settings,
    connectorId: connection?.connectorId ?? account.connectorId,
    credentialState: connection?.credentialState ?? account.credentialState,
  };
}

function managedMetadata(accountId: string): JsonObject {
  return { managedBy: "channel-account", accountId };
}
