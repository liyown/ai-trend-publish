import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { ChannelId, WorkspaceKind } from "@trendpublish/contracts";
import {
  createWorkspaceEntity,
  type ChannelAccount,
  type PublishTarget,
} from "@trendpublish/core/workspace";
import { factory, type AppVariables } from "../deps.ts";
import { HttpError, jsonValidator } from "../middleware/errors.ts";
import {
  objectIdParam,
  saveChannelAccountSchema,
  savePublishTargetSchema,
} from "../schemas/studio.ts";
import {
  removeWorkspaceDocument,
  updateWorkspaceDocument,
  withoutRevision,
} from "./workspace-route-helpers.ts";

const listAccounts = factory.createHandlers(async (c) =>
  c.json({
    channelAccounts: await (
      await c.var.deps.getRuntime()
    ).workspace.list(WorkspaceKind.ChannelAccount),
  }),
);

const createAccount = factory.createHandlers(
  zValidator("json", saveChannelAccountSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    await validateChannelAccount(runtime, body);
    const channelAccount = createWorkspaceEntity({
      id: `account-${crypto.randomUUID()}`,
      ...withoutRevision(body),
    }) as ChannelAccount;
    await runtime.workspace.save(WorkspaceKind.ChannelAccount, channelAccount);
    return c.json({ channelAccount }, 201);
  },
);

const updateAccount = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  zValidator("json", saveChannelAccountSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    await validateChannelAccount(runtime, body);
    const channelAccount = await updateWorkspaceDocument(
      runtime.workspace,
      WorkspaceKind.ChannelAccount,
      c.req.valid("param").id,
      body,
    );
    return c.json({ channelAccount });
  },
);

const deleteAccount = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const id = c.req.valid("param").id;
    if (
      (await runtime.workspace.list(WorkspaceKind.PublishTarget)).some(
        (target) => target.channelAccountId === id,
      )
    ) {
      throw new HttpError("渠道账号正在被发布目标使用", 409);
    }
    await removeWorkspaceDocument(runtime.workspace, WorkspaceKind.ChannelAccount, id);
    return c.json({ success: true });
  },
);

const listTargets = factory.createHandlers(async (c) =>
  c.json({
    publishTargets: await (
      await c.var.deps.getRuntime()
    ).workspace.list(WorkspaceKind.PublishTarget),
  }),
);

const createTarget = factory.createHandlers(
  zValidator("json", savePublishTargetSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    await validateTarget(runtime, body);
    const publishTarget = createWorkspaceEntity({
      id: `target-${crypto.randomUUID()}`,
      ...withoutRevision(body),
    }) as PublishTarget;
    await runtime.workspace.save(WorkspaceKind.PublishTarget, publishTarget);
    return c.json({ publishTarget }, 201);
  },
);

const updateTarget = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  zValidator("json", savePublishTargetSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    await validateTarget(runtime, body);
    const publishTarget = await updateWorkspaceDocument(
      runtime.workspace,
      WorkspaceKind.PublishTarget,
      c.req.valid("param").id,
      body,
    );
    return c.json({ publishTarget });
  },
);

const deleteTarget = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const id = c.req.valid("param").id;
    if (
      (await runtime.workspace.list(WorkspaceKind.ContentPlan)).some((item) =>
        item.publishing?.targetIds.includes(id),
      )
    ) {
      throw new HttpError("发布目标正在被自动化任务使用", 409);
    }
    await removeWorkspaceDocument(runtime.workspace, WorkspaceKind.PublishTarget, id);
    return c.json({ success: true });
  },
);

export const publishingConfigRoutes = new Hono<{ Variables: AppVariables }>()
  .get("/api/channel-accounts", ...listAccounts)
  .post("/api/channel-accounts", ...createAccount)
  .patch("/api/channel-accounts/:id", ...updateAccount)
  .delete("/api/channel-accounts/:id", ...deleteAccount)
  .get("/api/publish-targets", ...listTargets)
  .post("/api/publish-targets", ...createTarget)
  .patch("/api/publish-targets/:id", ...updateTarget)
  .delete("/api/publish-targets/:id", ...deleteTarget);

async function validateChannelAccount(
  runtime: Awaited<ReturnType<AppVariables["deps"]["getRuntime"]>>,
  body: any,
) {
  const connection = await runtime.connectionManager.get(body.connectionId);
  if (!connection || !connection.enabled) {
    throw new HttpError("渠道账号绑定的连接不存在或已禁用", 400);
  }
  const definition = runtime.connectionManager
    .definitions()
    .find((item) => item.id === connection.connectorId);
  const requiredCapability =
    body.channel === ChannelId.WeixinOfficialAccount ? "weixin" : body.channel;
  if (!definition?.capabilities.includes(requiredCapability)) {
    throw new HttpError("所选连接不支持该发布渠道", 400);
  }
}

async function validateTarget(
  runtime: Awaited<ReturnType<AppVariables["deps"]["getRuntime"]>>,
  body: any,
) {
  const account = await runtime.workspace.get(WorkspaceKind.ChannelAccount, body.channelAccountId);
  if (!account) throw new HttpError("发布目标绑定的渠道账号不存在", 400);
}
