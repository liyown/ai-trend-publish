import { Hono } from "hono";
import { zValidator } from "@hono/zod-validator";
import { WorkspaceKind } from "@trendpublish/contracts";
import { createWorkspaceEntity, type Automation } from "@trendpublish/core/workspace";
import { factory, type AppVariables } from "../deps.ts";
import { HttpError, jsonValidator } from "../middleware/errors.ts";
import { objectIdParam, saveAutomationSchema } from "../schemas/studio.ts";
import {
  removeWorkspaceDocument,
  updateWorkspaceDocument,
  withoutRevision,
} from "./workspace-route-helpers.ts";

const listAutomations = factory.createHandlers(async (c) =>
  c.json({
    automations: await (await c.var.deps.getRuntime()).workspace.list(WorkspaceKind.Automation),
  }),
);

const createAutomation = factory.createHandlers(
  zValidator("json", saveAutomationSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    await validateAutomation(runtime, body);
    const automation = createWorkspaceEntity({
      id: `automation-${crypto.randomUUID()}`,
      ...withoutRevision(body),
    }) as Automation;
    await runtime.workspace.save(WorkspaceKind.Automation, automation);
    return c.json({ automation }, 201);
  },
);

const updateAutomation = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  zValidator("json", saveAutomationSchema, jsonValidator),
  async (c) => {
    const runtime = await c.var.deps.getRuntime();
    const body = c.req.valid("json");
    await validateAutomation(runtime, body);
    const automation = await updateWorkspaceDocument(
      runtime.workspace,
      WorkspaceKind.Automation,
      c.req.valid("param").id,
      body,
    );
    return c.json({ automation });
  },
);

const deleteAutomation = factory.createHandlers(
  zValidator("param", objectIdParam, jsonValidator),
  async (c) => {
    await removeWorkspaceDocument(
      (await c.var.deps.getRuntime()).workspace,
      WorkspaceKind.Automation,
      c.req.valid("param").id,
    );
    return c.json({ success: true });
  },
);

export const automationRoutes = new Hono<{ Variables: AppVariables }>()
  .get("/api/automations", ...listAutomations)
  .post("/api/automations", ...createAutomation)
  .patch("/api/automations/:id", ...updateAutomation)
  .delete("/api/automations/:id", ...deleteAutomation);

async function validateAutomation(
  runtime: Awaited<ReturnType<AppVariables["deps"]["getRuntime"]>>,
  body: any,
) {
  const plan = await runtime.workspace.get(WorkspaceKind.ContentPlan, body.contentPlanId);
  if (!plan) throw new HttpError("自动化任务绑定的内容方案不存在", 400);
}
