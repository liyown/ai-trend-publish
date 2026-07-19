import { createCloudflareApplicationRuntime } from "../../application/cloudflare-runtime.ts";
import { createHttpApp } from "../../http/app.ts";
import type { HttpDeps } from "../../http/deps.ts";
import type { CloudflareD1Database } from "./cloudflare-bindings.ts";
import { buildCloudflareDashboardApp, type DashboardAssetsEnv } from "./dashboard-assets.ts";

export interface CloudflareEnv extends DashboardAssetsEnv {
  ARTICLE_DB: CloudflareD1Database;
  SERVER_API_KEY: string;
}

const runtimes = new WeakMap<object, ReturnType<typeof createCloudflareApplicationRuntime>>();

export function buildCloudflareDeps(env: CloudflareEnv): HttpDeps {
  let runtime = runtimes.get(env.ARTICLE_DB as object);
  if (!runtime) {
    runtime = createCloudflareApplicationRuntime(env.ARTICLE_DB);
    runtimes.set(env.ARTICLE_DB as object, runtime);
  }
  return {
    mode: "cloudflare",
    async getApiKey() {
      if (!env.SERVER_API_KEY?.trim()) throw new Error("Cloudflare Worker 未配置 SERVER_API_KEY");
      return env.SERVER_API_KEY;
    },
    async getRuntime() {
      return runtime;
    },
    dashboardApp: buildCloudflareDashboardApp(env),
  };
}

export default {
  async fetch(request: Request, env: CloudflareEnv): Promise<Response> {
    return createHttpApp(buildCloudflareDeps(env)).fetch(request, env);
  },
};
