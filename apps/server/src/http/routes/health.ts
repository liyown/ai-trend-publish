import { Hono } from "hono";
import {
  ArticlePluginCapability,
  ArticlePluginId,
  ChannelId,
  type WorkspaceSnapshot,
} from "@trendpublish/contracts";
import { loadWorkspaceSnapshot } from "@trendpublish/core/workspace";
import { factory, type AppVariables } from "../deps.ts";

const health = factory.createHandlers(async (c) => {
  try {
    const runtime = await c.var.deps.getRuntime();
    await runtime.workspace.ensureSchema();
    return c.json({
      ok: true,
      mode: c.var.deps.mode,
      timestamp: new Date().toISOString(),
      checks: {
        runtime: { ok: true, detail: "application runtime ready" },
        storage: { ok: true, detail: "workspace, connections, jobs and task checkpoints ready" },
      },
    });
  } catch (error) {
    return c.json(
      {
        ok: false,
        mode: c.var.deps.mode,
        timestamp: new Date().toISOString(),
        checks: {
          runtime: { ok: false, detail: error instanceof Error ? error.message : String(error) },
        },
      },
      500,
    );
  }
});

const workspace = factory.createHandlers(async (c) => {
  const runtime = await c.var.deps.getRuntime();
  const [snapshot, jobs, connections] = await Promise.all([
    loadWorkspaceSnapshot(runtime.workspace),
    runtime.jobs.list(undefined, 100),
    runtime.connectionManager.list(),
  ]);
  const workspaceSnapshot: WorkspaceSnapshot = {
    generatedAt: new Date().toISOString(),
    mode: c.var.deps.mode,
    ...snapshot,
    jobs,
    connections,
    connectorDefinitions: runtime.connectionManager.definitions(),
    articleExtensions: {
      plugins: [
        {
          id: ArticlePluginId.TitleStyle,
          name: "标题规则",
          description: "约束标题表达，不改变文章事实。",
          optional: true,
          capabilities: [ArticlePluginCapability.Transformer],
        },
        {
          id: ArticlePluginId.EditorialQuality,
          name: "编辑质量评估",
          description: "评估内容质量，并声明需要补充的证据。",
          optional: true,
          capabilities: [ArticlePluginCapability.Evaluator],
        },
        {
          id: ArticlePluginId.EvidenceSupplement,
          name: "补充论证",
          description: "根据评估结果调用已有来源能力补充材料和证据。",
          optional: true,
          capabilities: [ArticlePluginCapability.EvidenceSupplementer],
        },
        {
          id: ArticlePluginId.CoverImage,
          name: "封面生成",
          description: "使用图片连接生成内容封面。",
          optional: true,
          capabilities: [
            ArticlePluginCapability.Transformer,
            ArticlePluginCapability.AssetProvider,
          ],
        },
      ],
    },
    channelDefinitions: [
      {
        id: ChannelId.WeixinOfficialAccount,
        name: "微信公众号",
        requiredCapability: "weixin",
      },
    ],
  };
  return c.json({ workspace: workspaceSnapshot });
});

export const healthRoutes = new Hono<{ Variables: AppVariables }>()
  .get("/api/health", ...health)
  .get("/api/workspace", ...workspace);
