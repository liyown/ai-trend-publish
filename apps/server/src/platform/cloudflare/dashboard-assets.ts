import { Hono } from "hono";
import { type AppVariables } from "../../http/deps.ts";
import {
  buildDashboardAssetApp,
  type DashboardAssetStore,
} from "../../http/routes/dashboard-assets.ts";
import {
  createDashboardAssetRequest,
  dashboardIndexAssetPath,
} from "../../http/routes/dashboard-routing.ts";

export interface DashboardAssetsBinding {
  fetch(request: Request): Promise<Response>;
}

export interface DashboardAssetsEnv {
  ASSETS?: DashboardAssetsBinding;
}

/**
 * Cloudflare assets binding serves files from dist/dashboard root. The public
 * product is mounted at /dashboard, so Worker requests must strip that base
 * before asking ASSETS for /index.html or /assets/*.
 */
export function buildCloudflareDashboardApp(
  env: DashboardAssetsEnv,
): Hono<{ Variables: AppVariables }> {
  return buildDashboardAssetApp(new CloudflareDashboardAssetStore(env.ASSETS));
}

class CloudflareDashboardAssetStore implements DashboardAssetStore {
  constructor(private readonly assets: DashboardAssetsBinding | undefined) {}

  async fetchAsset(assetPath: string, request: Request): Promise<Response | null> {
    if (!this.assets) return null;

    try {
      const assetRequestPath = assetPath === dashboardIndexAssetPath() ? "/" : assetPath;
      const response = await this.assets.fetch(
        createDashboardAssetRequest(request, assetRequestPath),
      );
      if (response.status === 404) return null;
      return response;
    } catch {
      return null;
    }
  }
}
