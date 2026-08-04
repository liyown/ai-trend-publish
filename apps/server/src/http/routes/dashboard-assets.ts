import { Hono, type Context, type Next } from "hono";
import type { AppVariables } from "../deps.ts";
import {
  dashboardAssetPath,
  dashboardIndexAssetPath,
  isDashboardAssetRequestMethod,
  isDashboardSpaRouteRequest,
} from "./dashboard-routing.ts";

const MISSING_INDEX_MESSAGE =
  "Dashboard index.html not found. Build the dashboard before serving routes.";

export interface DashboardAssetStore {
  fetchAsset(assetPath: string, request: Request): Promise<Response | null>;
}

type DashboardAssetContext = Context<{ Variables: AppVariables }>;

export function buildDashboardAssetApp(
  assetStore: DashboardAssetStore,
): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();

  const assetHandler = async (c: DashboardAssetContext, next: Next): Promise<Response | void> => {
    const assetPath = dashboardAssetPath(c.req.path);
    if (!assetPath || !isDashboardAssetRequestMethod(c.req.raw)) {
      return next();
    }

    if (isDashboardSpaRouteRequest(c.req.raw, assetPath)) {
      const indexResponse = await assetStore.fetchAsset(dashboardIndexAssetPath(), c.req.raw);
      if (indexResponse) return indexResponse;
      return c.text(MISSING_INDEX_MESSAGE, 404);
    }

    const assetResponse = await assetStore.fetchAsset(assetPath, c.req.raw);
    if (assetResponse) return assetResponse;

    return c.text("Dashboard asset not found", 404);
  };

  return app.use("/dashboard", assetHandler).use("/dashboard/*", assetHandler);
}
