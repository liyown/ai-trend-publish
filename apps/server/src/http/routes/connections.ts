import { Hono } from "hono";
import { WorkspaceKind } from "@trendpublish/contracts";
import { zValidator } from "@hono/zod-validator";
import type { SaveConnectionInput } from "@trendpublish/connectors";
import { factory, type AppVariables } from "../deps.ts";
import { HttpError, jsonValidator } from "../middleware/errors.ts";
import { objectIdParam, saveConnectionSchema } from "../schemas/studio.ts";

const list = factory.createHandlers(async (c) => {
  const manager = (await c.var.deps.getRuntime()).connectionManager;
  return c.json({ definitions: manager.definitions(), connections: await manager.list() });
});

const create = factory.createHandlers(
  zValidator("json", saveConnectionSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    const id = body.id ?? `connection-${crypto.randomUUID()}`;
    return c.json(
      { connection: await runtime.connectionManager.save({ ...body, id } as SaveConnectionInput) },
      201,
    );
  },
);

const update = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  zValidator("json", saveConnectionSchema, jsonValidator),
  async (c) => {
    const { id } = c.req.valid("param");
    const runtime = await c.var.deps.getRuntime();
    if (!(await runtime.connectionManager.get(id))) throw new HttpError("连接不存在", 404);
    return c.json({
      connection: await runtime.connectionManager.save({
        ...c.req.valid("json"),
        id,
      } as SaveConnectionInput),
    });
  },
);

const remove = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  async (c) => {
    const { id } = c.req.valid("param");
    const runtime = await c.var.deps.getRuntime();
    const [plans, accounts] = await Promise.all([
      runtime.workspace.list(WorkspaceKind.ContentPlan),
      runtime.workspace.list(WorkspaceKind.ChannelAccount),
    ]);
    if (
      plans.some(
        (plan) =>
          Object.values(plan.connections).includes(id) ||
          plan.researchConnections?.search.includes(id) ||
          plan.researchConnections?.fetch.includes(id),
      )
    ) {
      throw new HttpError("连接正在被内容方案使用", 409);
    }
    if (accounts.some((account) => account.connectionId === id)) {
      throw new HttpError("连接正在被渠道账号使用", 409);
    }
    await runtime.connectionManager.remove(id);
    return c.json({ success: true });
  },
);

const test = factory.createHandlers(
  zValidator("json", saveConnectionSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    const id = body.id ?? `connection-test-${crypto.randomUUID()}`;
    return c.json({
      test: await runtime.connectionManager.check({ ...body, id } as SaveConnectionInput),
    });
  },
);

export const connectionRoutes = new Hono<{ Variables: AppVariables }>()
  .get("/api/connections", ...list)
  .post("/api/connections", ...create)
  .patch("/api/connections/:id", ...update)
  .delete("/api/connections/:id", ...remove)
  .post("/api/connections/test", ...test);
