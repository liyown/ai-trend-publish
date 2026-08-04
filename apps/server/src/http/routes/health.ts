import { Hono } from "hono";
import type { WorkspaceSnapshot } from "@trendpublish/contracts";
import { loadWorkspaceSnapshot } from "@trendpublish/core/workspace";
import { CONTENT_PLAN_TEMPLATES } from "@trendpublish/article/application";
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
  const channelAccounts = await Promise.all(
    snapshot.channelAccounts.map(async (account) => {
      const connection = connections.find((item) => item.id === account.connectionId);
      return {
        ...account,
        enabled: account.enabled !== false && Boolean(connection?.enabled),
        settings: connection?.settings ?? account.settings,
        connectorId: connection?.connectorId ?? account.connectorId,
        credentialState: connection?.credentialState ?? account.credentialState,
      };
    }),
  );
  const workspaceSnapshot: WorkspaceSnapshot = {
    generatedAt: new Date().toISOString(),
    mode: c.var.deps.mode,
    ...snapshot,
    channelAccounts,
    jobs,
    connections: connections.filter(
      (connection) => connection.metadata["managedBy"] !== "channel-account",
    ),
    connectorDefinitions: runtime.connectionManager.definitions(),
    contentPlanTemplates: CONTENT_PLAN_TEMPLATES.map((template) => template.definition),
    channelDefinitions: runtime.channels.definitions(),
    publicationTypeProfiles: runtime.channels.profileDefinitions(),
  };
  return c.json({ workspace: workspaceSnapshot });
});

export const healthRoutes = new Hono<{ Variables: AppVariables }>()
  .get("/api/health", ...health)
  .get("/api/workspace", ...workspace);
