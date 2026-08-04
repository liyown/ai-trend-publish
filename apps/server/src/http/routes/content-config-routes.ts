import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { RunKind, WorkspaceKind, type RunRecord } from "@trendpublish/contracts";
import {
  createWorkspaceEntity,
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

import { paginate, parsePage } from "./workspace-route-helpers.ts";

const listIdentities = factory.createHandlers(async (c) => {
  const { page, pageSize } = parsePage(c.req.queries());
  const all = await (await c.var.deps.getRuntime()).workspace.list(WorkspaceKind.Identity);
  return c.json(paginate(all, page, pageSize));
});

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

const listKnowledgeBases = factory.createHandlers(async (c) => {
  const { page, pageSize } = parsePage(c.req.queries());
  const all = await (await c.var.deps.getRuntime()).workspace.list(WorkspaceKind.KnowledgeBase);
  return c.json(paginate(all, page, pageSize));
});

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

const listSources = factory.createHandlers(async (c) => {
  const { page, pageSize } = parsePage(c.req.queries());
  const all = await (await c.var.deps.getRuntime()).workspace.list(WorkspaceKind.SourceCollection);
  return c.json(paginate(all, page, pageSize));
});

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

const listContentPlans = factory.createHandlers(async (c) => {
  const { page, pageSize } = parsePage(c.req.queries());
  const all = await (await c.var.deps.getRuntime()).workspace.list(WorkspaceKind.ContentPlan);
  return c.json(paginate(all, page, pageSize));
});

const getContentPackageRunContext = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const packageId = c.req.valid("param").id;
    const contentPackage = await runtime.workspace.get(WorkspaceKind.ContentPackage, packageId);
    if (!contentPackage) throw new HttpError("内容包不存在", 404);

    const originJob = await runtime.jobs.get(contentPackage.jobId);
    const allRuns = await runtime.runs.store.listRuns({}, 50_000);
    const generationRun = resolveGenerationRun(allRuns, packageId, originJob?.runId);
    const publicationRuns = allRuns
      .filter(
        (run) =>
          run.kind === RunKind.Publication &&
          (run.packageId === packageId ||
            (generationRun ? run.originRunId === generationRun.id : false)),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));

    return c.json({ contentPackage, generationRun, publicationRuns });
  },
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
  .delete("/api/content-plans/:id", ...deleteContentPlan)
  .get("/api/content-packages/:id/run-context", ...getContentPackageRunContext);

function resolveGenerationRun(
  runs: RunRecord[],
  packageId: string,
  originRunId?: string,
): RunRecord | undefined {
  const origin = originRunId ? runs.find((run) => run.id === originRunId) : undefined;
  if (origin?.kind === RunKind.Content) return origin;
  return runs.find((run) => run.kind === RunKind.Content && run.packageId === packageId);
}

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
  for (const destination of body.publishing?.destinations ?? []) {
    const account = await runtime.workspace.get(
      WorkspaceKind.ChannelAccount,
      destination.accountId,
    );
    if (!account)
      throw new HttpError(`内容方案绑定的发布账号不存在：${destination.accountId}`, 400);
    if (account.enabled === false) throw new HttpError(`发布账号 ${account.name} 已停用`, 400);
    try {
      runtime.channels.getProfile(account.channel, destination.publicationType);
      runtime.channels.getAdapter(account.channel, destination.publicationType);
    } catch (error) {
      throw new HttpError(error instanceof Error ? error.message : String(error), 400);
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
  const modelConnectionId = body.agent?.modelConnectionId ?? body.connections.chat;
  if (!modelConnectionId) throw new HttpError("内容方案必须绑定生成模型连接", 400);
  const modelConnection = connections.get(modelConnectionId);
  if (!modelConnection?.enabled) throw new HttpError("生成模型连接不存在或已禁用", 400);
  const modelCapabilities = definitions.get(modelConnection.connectorId)?.capabilities ?? [];
  if (!modelCapabilities.includes("chat")) {
    throw new HttpError(`连接 ${modelConnection.name} 不支持 chat 能力`, 400);
  }
  if (body.agent && !modelCapabilities.includes("tool-calling")) {
    throw new HttpError(`连接 ${modelConnection.name} 不支持原生 Tool Calling`, 400);
  }
  if (body.agent) {
    for (const connectionId of body.agent.toolConnectionIds) {
      const connection = connections.get(connectionId);
      if (!connection?.enabled) throw new HttpError(`工具连接不存在或已禁用：${connectionId}`, 400);
      const capabilities = definitions.get(connection.connectorId)?.capabilities ?? [];
      if (
        !capabilities.some((capability) =>
          ["source-search", "source-fetch", "image"].includes(capability),
        )
      ) {
        throw new HttpError(`连接 ${connection.name} 没有可供内容 Agent 使用的工具能力`, 400);
      }
    }
  }
  const enabledSources = sourceCollections
    .filter((collection) => collection.enabled)
    .flatMap((collection) => collection.sources)
    .filter((source) => source.enabled);
  const needsSearch = enabledSources.some((source) => source.kind === "query");
  const needsFetch = enabledSources.length > 0;
  const selected = body.researchConnections ?? { search: [], fetch: [] };
  if (body.agent) return;
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
