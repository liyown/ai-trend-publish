import { Hono } from "hono";
import { type AppVariables, type HttpDeps, factory } from "./deps.ts";
import { requireBearer } from "./middleware/auth.ts";
import { errorMapper } from "./middleware/errors.ts";
import { requestContext } from "./middleware/logger.ts";
import { automationRoutes } from "./routes/automation-routes.ts";
import { connectionRoutes } from "./routes/connections.ts";
import { contentConfigRoutes } from "./routes/content-config-routes.ts";
import { executionRoutes } from "./routes/executions.ts";
import { healthRoutes } from "./routes/health.ts";
import { publishingConfigRoutes } from "./routes/publishing-config-routes.ts";
import { runRoutes } from "./routes/runs.ts";

export function createHttpApp(deps: HttpDeps): Hono<{ Variables: AppVariables }> {
  const inject = factory.createMiddleware(async (c, next) => {
    c.set("deps", deps);
    return next();
  });

  return new Hono<{ Variables: AppVariables }>()
    .use("*", requestContext)
    .use("*", inject)
    .use("/api/*", requireBearer)
    .onError(errorMapper)
    .route("/", deps.dashboardApp)
    .route("/", healthRoutes)
    .route("/", connectionRoutes)
    .route("/", contentConfigRoutes)
    .route("/", publishingConfigRoutes)
    .route("/", automationRoutes)
    .route("/", executionRoutes)
    .route("/", runRoutes)
    .notFound((c) =>
      c.json({ error: "无效的 API 路径", data: { path: c.req.path, method: c.req.method } }, 404),
    );
}
