import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { ArticlePluginId, ChannelId, WorkspaceKind } from "@trendpublish/contracts";
import {
  createWorkspaceEntity,
  type ChannelAccount,
  type ContentIdentity,
  type ContentPlan,
  type KnowledgeBase,
  type SourceCollection,
} from "@trendpublish/core/workspace";
import { factory, type AppVariables } from "../deps.ts";
import { HttpError, jsonValidator } from "../middleware/errors.ts";
import {
  objectIdParam,
  saveContentPlanSchema,
  saveIdentitySchema,
  saveKnowledgeBaseSchema,
  saveSourceCollectionSchema,
} from "../schemas/studio.ts";
import {
  removeWorkspaceDocument,
  updateWorkspaceDocument,
  withoutRevision,
} from "./workspace-route-helpers.ts";

const listIdentities = factory.createHandlers(async (c) =>
  c.json({
    identities: await (await c.var.deps.getRuntime()).workspace.list(WorkspaceKind.Identity),
  }),
);

const createIdentity = factory.createHandlers(
  zValidator("json", saveIdentitySchema, jsonValidator),
  async (c) => {
    const body = c.req.valid("json");
    const identity = createWorkspaceEntity({
      id: `identity-${crypto.randomUUID()}`,
      ...withoutRevision(body),
    }) as ContentIdentity;
    await (await c.var.deps.getRuntime()).workspace.save(WorkspaceKind.Identity, identity);
    return c.json({ identity }, 201);
  },
);

const updateIdentity = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  zValidator("json", saveIdentitySchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const identity = await updateWorkspaceDocument(
      runtime.workspace,
      WorkspaceKind.Identity,
      c.req.valid("param").id,
      c.req.valid("json"),
    );
    return c.json({ identity });
  },
);

const deleteIdentity = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const id = c.req.valid("param").id;
    const plans = await runtime.workspace.list(WorkspaceKind.ContentPlan);
    if (plans.some((plan) => plan.identityId === id)) {
      throw new HttpError("内容身份正在被内容方案使用", 409);
    }
    await removeWorkspaceDocument(runtime.workspace, WorkspaceKind.Identity, id);
    return c.json({ success: true });
  },
);

const listKnowledgeBases = factory.createHandlers(async (c) =>
  c.json({
    knowledgeBases: await (
      await c.var.deps.getRuntime()
    ).workspace.list(WorkspaceKind.KnowledgeBase),
  }),
);

const createKnowledgeBase = factory.createHandlers(
  zValidator("json", saveKnowledgeBaseSchema, jsonValidator),
  async (c) => {
    const body = c.req.valid("json");
    const knowledgeBase = createWorkspaceEntity({
      id: `knowledge-${crypto.randomUUID()}`,
      ...withoutRevision(body),
      documents: body.documents.map((document) => ({
        ...document,
        id: document.id ?? `document-${crypto.randomUUID()}`,
      })),
    }) as KnowledgeBase;
    await (
      await c.var.deps.getRuntime()
    ).workspace.save(WorkspaceKind.KnowledgeBase, knowledgeBase);
    return c.json({ knowledgeBase }, 201);
  },
);

const updateKnowledgeBase = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  zValidator("json", saveKnowledgeBaseSchema, jsonValidator),
  async (c) => {
    const body = c.req.valid("json");
    const knowledgeBase = await updateWorkspaceDocument(
      (await c.var.deps.getRuntime()).workspace,
      WorkspaceKind.KnowledgeBase,
      c.req.valid("param").id,
      {
        ...body,
        documents: body.documents.map((document) => ({
          ...document,
          id: document.id ?? `document-${crypto.randomUUID()}`,
        })),
      },
    );
    return c.json({ knowledgeBase });
  },
);

const deleteKnowledgeBase = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const id = c.req.valid("param").id;
    if (
      (await runtime.workspace.list(WorkspaceKind.ContentPlan)).some((plan) =>
        (plan.knowledgeBaseIds ?? []).includes(id),
      )
    ) {
      throw new HttpError("知识库正在被内容方案使用", 409);
    }
    await removeWorkspaceDocument(runtime.workspace, WorkspaceKind.KnowledgeBase, id);
    return c.json({ success: true });
  },
);

const listSources = factory.createHandlers(async (c) =>
  c.json({
    sourceCollections: await (
      await c.var.deps.getRuntime()
    ).workspace.list(WorkspaceKind.SourceCollection),
  }),
);

const createSources = factory.createHandlers(
  zValidator("json", saveSourceCollectionSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    const sourceCollection = createWorkspaceEntity({
      id: `sources-${crypto.randomUUID()}`,
      ...withoutRevision(body),
      sources: body.sources.map((source) => ({
        ...source,
        id: source.id ?? `source-${crypto.randomUUID()}`,
      })),
    }) as SourceCollection;
    await runtime.workspace.save(WorkspaceKind.SourceCollection, sourceCollection);
    return c.json({ sourceCollection }, 201);
  },
);

const updateSources = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  zValidator("json", saveSourceCollectionSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    const sourceCollection = await updateWorkspaceDocument(
      runtime.workspace,
      WorkspaceKind.SourceCollection,
      c.req.valid("param").id,
      {
        ...body,
        sources: body.sources.map((source) => ({
          ...source,
          id: source.id ?? `source-${crypto.randomUUID()}`,
        })),
      },
    );
    return c.json({ sourceCollection });
  },
);

const deleteSources = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const id = c.req.valid("param").id;
    if (
      (await runtime.workspace.list(WorkspaceKind.ContentPlan)).some((plan) =>
        plan.sourceCollectionIds.includes(id),
      )
    ) {
      throw new HttpError("来源集合正在被内容方案使用", 409);
    }
    await removeWorkspaceDocument(runtime.workspace, WorkspaceKind.SourceCollection, id);
    return c.json({ success: true });
  },
);

const listContentPlans = factory.createHandlers(async (c) =>
  c.json({
    contentPlans: await (await c.var.deps.getRuntime()).workspace.list(WorkspaceKind.ContentPlan),
  }),
);

const createContentPlan = factory.createHandlers(
  zValidator("json", saveContentPlanSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    await validateContentPlan(runtime, body);
    const contentPlan = createWorkspaceEntity({
      id: `plan-${crypto.randomUUID()}`,
      ...withoutRevision(body),
    }) as ContentPlan;
    await runtime.workspace.save(WorkspaceKind.ContentPlan, contentPlan);
    return c.json({ contentPlan }, 201);
  },
);

const updateContentPlan = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  zValidator("json", saveContentPlanSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    await validateContentPlan(runtime, body);
    const contentPlan = await updateWorkspaceDocument(
      runtime.workspace,
      WorkspaceKind.ContentPlan,
      c.req.valid("param").id,
      body,
    );
    return c.json({ contentPlan });
  },
);

const deleteContentPlan = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const id = c.req.valid("param").id;
    if (
      (await runtime.workspace.list(WorkspaceKind.Automation)).some(
        (item) => item.contentPlanId === id,
      )
    ) {
      throw new HttpError("内容方案正在被自动化任务使用", 409);
    }
    await removeWorkspaceDocument(runtime.workspace, WorkspaceKind.ContentPlan, id);
    return c.json({ success: true });
  },
);

export const contentConfigRoutes = new Hono<{ Variables: AppVariables }>()
  .get("/api/identities", ...listIdentities)
  .post("/api/identities", ...createIdentity)
  .patch("/api/identities/:id", ...updateIdentity)
  .delete("/api/identities/:id", ...deleteIdentity)
  .get("/api/knowledge-bases", ...listKnowledgeBases)
  .post("/api/knowledge-bases", ...createKnowledgeBase)
  .patch("/api/knowledge-bases/:id", ...updateKnowledgeBase)
  .delete("/api/knowledge-bases/:id", ...deleteKnowledgeBase)
  .get("/api/source-collections", ...listSources)
  .post("/api/source-collections", ...createSources)
  .patch("/api/source-collections/:id", ...updateSources)
  .delete("/api/source-collections/:id", ...deleteSources)
  .get("/api/content-plans", ...listContentPlans)
  .post("/api/content-plans", ...createContentPlan)
  .patch("/api/content-plans/:id", ...updateContentPlan)
  .delete("/api/content-plans/:id", ...deleteContentPlan);

async function validateContentPlan(
  runtime: Awaited<ReturnType<AppVariables["deps"]["getRuntime"]>>,
  body: any,
) {
  const identity = await runtime.workspace.get(WorkspaceKind.Identity, body.identityId);
  if (!identity) throw new HttpError("内容方案绑定的内容身份不存在", 400);
  const sourceCollections: SourceCollection[] = [];
  for (const sourceId of body.sourceCollectionIds) {
    const collection = await runtime.workspace.get(WorkspaceKind.SourceCollection, sourceId);
    if (!collection) {
      throw new HttpError(`内容方案绑定的来源集合不存在：${sourceId}`, 400);
    }
    sourceCollections.push(collection);
  }
  for (const knowledgeBaseId of body.knowledgeBaseIds ?? []) {
    if (!(await runtime.workspace.get(WorkspaceKind.KnowledgeBase, knowledgeBaseId))) {
      throw new HttpError(`内容方案绑定的知识库不存在：${knowledgeBaseId}`, 400);
    }
  }
  const selectedAccounts: ChannelAccount[] = [];
  for (const targetId of body.publishing?.targetIds ?? []) {
    const target = await runtime.workspace.get(WorkspaceKind.PublishTarget, targetId);
    if (!target) throw new HttpError(`内容方案绑定的发布目标不存在：${targetId}`, 400);
    const account = await runtime.workspace.get(
      WorkspaceKind.ChannelAccount,
      target.channelAccountId,
    );
    if (!account) throw new HttpError(`发布目标 ${target.name} 绑定的渠道账号不存在`, 400);
    selectedAccounts.push(account);
  }
  if (
    body.publishing?.mode === "publish" &&
    selectedAccounts.some((account) => account.channel === ChannelId.WeixinOfficialAccount)
  ) {
    const cover = body.plugins.find(
      (plugin: { pluginId: string; enabled: boolean; config?: unknown }) =>
        plugin.pluginId === ArticlePluginId.CoverImage,
    );
    if (!cover?.enabled) {
      throw new HttpError("微信公众号发布必须启用封面图片插件", 400);
    }
    const necessity =
      cover.config && typeof cover.config === "object" && !Array.isArray(cover.config)
        ? (cover.config as Record<string, unknown>).necessity
        : undefined;
    if (necessity !== undefined && necessity !== "essential") {
      throw new HttpError("微信公众号发布必须将封面设为必要资源", 400);
    }
    if (!body.connections.image) {
      throw new HttpError("微信公众号发布必须绑定图片连接", 400);
    }
  }
  const connections = new Map(
    (await runtime.connectionManager.list()).map((item) => [item.id, item]),
  );
  const definitions = new Map(
    runtime.connectionManager.definitions().map((item) => [item.id, item]),
  );
  for (const [capability, connectionId] of Object.entries(
    body.connections as Record<string, string>,
  )) {
    const connection = connections.get(connectionId);
    if (!connection || !connection.enabled) {
      throw new HttpError(`连接不存在或已禁用：${connectionId}`, 400);
    }
    if (!definitions.get(connection.connectorId)?.capabilities.includes(capability)) {
      throw new HttpError(`连接 ${connection.name} 不支持 ${capability} 能力`, 400);
    }
  }
  if (!body.connections.chat) throw new HttpError("内容方案必须绑定 chat 连接", 400);
  const enabledSources = sourceCollections
    .filter((collection) => collection.enabled)
    .flatMap((collection) => collection.sources)
    .filter((source) => source.enabled);
  const needsSearch = enabledSources.some((source) => source.kind === "query");
  const needsFetch = enabledSources.length > 0;
  const selected = body.researchConnections ?? { search: [], fetch: [] };
  validateResearchConnections("source-search", selected.search ?? [], needsSearch);
  validateResearchConnections("source-fetch", selected.fetch ?? [], needsFetch);

  function validateResearchConnections(
    capability: "source-search" | "source-fetch",
    connectionIds: string[],
    required: boolean,
  ): void {
    for (const connectionId of connectionIds) {
      const connection = connections.get(connectionId);
      if (!connection?.enabled) throw new HttpError(`连接不存在或已禁用：${connectionId}`, 400);
      if (!definitions.get(connection.connectorId)?.capabilities.includes(capability)) {
        throw new HttpError(`连接 ${connection.name} 不支持 ${capability} 能力`, 400);
      }
    }
    if (
      required &&
      !connectionIds.length &&
      ![...connections.values()].some(
        (connection) =>
          connection.enabled &&
          definitions.get(connection.connectorId)?.capabilities.includes(capability),
      )
    ) {
      throw new HttpError(
        capability === "source-search"
          ? "查询来源需要至少一个可用的搜索连接"
          : "来源需要至少一个可用的网页抓取连接",
        400,
      );
    }
  }
}
