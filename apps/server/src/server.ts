import { Hono, type Context, type Next } from "hono";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { serveFetch } from "@trendpublish/core/node";
import { getAppConfig } from "@trendpublish/core/config";
import { createLocalApplicationRuntime } from "./application/runtime.ts";
import { createHttpApp } from "./http/app.ts";
import { type AppVariables, type HttpDeps } from "./http/deps.ts";
import {
  buildDashboardAssetApp,
  type DashboardAssetStore,
} from "./http/routes/dashboard-assets.ts";
import { isUnsafeDashboardAssetPath } from "./http/routes/dashboard-routing.ts";
import { Logger } from "@trendpublish/core/logging";

const logger = new Logger("server");

/**
 * 本地 dashboard 子 app。入口直接按产品路由契约处理:
 * - 开发态可通过 `TRENDPUBLISH_DASHBOARD_DEV_SERVER_URL` 代理到 Vite dev server;
 * - `/dashboard/assets/*` 等真实文件路径只从 `dist/dashboard` 读文件;
 * - `/dashboard/*` 产品路由统一返回构建后的 `index.html`;
 * - dist 缺失时返回明确 404,避免返回非当前构建产物。
 */
export interface LocalDashboardAppOptions {
  dashboardDevServerUrl?: string;
}

export function buildLocalDashboardApp(
  distDir = resolveRepoRootDistDashboard(),
  options: LocalDashboardAppOptions = {},
): Hono<{ Variables: AppVariables }> {
  const dashboardDevServerUrl =
    options.dashboardDevServerUrl ?? process.env.TRENDPUBLISH_DASHBOARD_DEV_SERVER_URL;
  if (dashboardDevServerUrl) {
    return buildDashboardDevProxyApp(dashboardDevServerUrl);
  }
  return buildDashboardAssetApp(new LocalDashboardAssetStore(distDir));
}

function buildDashboardDevProxyApp(devServerUrl: string): Hono<{ Variables: AppVariables }> {
  const app = new Hono<{ Variables: AppVariables }>();
  const devServer = new URL(devServerUrl);

  const handler = async (
    c: Context<{ Variables: AppVariables }>,
    next: Next,
  ): Promise<Response | void> => {
    if (c.req.raw.method !== "GET" && c.req.raw.method !== "HEAD") {
      return next();
    }

    const incoming = new URL(c.req.raw.url);
    const target = new URL(`${incoming.pathname}${incoming.search}`, devServer.origin);
    const headers = new Headers(c.req.raw.headers);
    headers.delete("host");
    headers.delete("connection");

    try {
      return await fetch(target, {
        method: c.req.raw.method,
        headers,
        redirect: "manual",
      });
    } catch {
      return new Response(
        `Dashboard dev server is not reachable at ${devServer.origin}. Start it with: vp run dev:dashboard`,
        {
          status: 503,
          headers: { "Content-Type": "text/plain; charset=utf-8" },
        },
      );
    }
  };

  return app.use("/dashboard", handler).use("/dashboard/*", handler);
}

class LocalDashboardAssetStore implements DashboardAssetStore {
  constructor(private readonly distDir: string) {}

  fetchAsset(assetPath: string): Promise<Response | null> {
    return localDashboardFileResponse(this.distDir, assetPath);
  }
}

async function localDashboardFileResponse(
  distDir: string,
  assetPath: string,
): Promise<Response | null> {
  if (isUnsafeDashboardAssetPath(assetPath)) {
    return null;
  }

  const root = path.resolve(distDir);
  const relative = assetPath.replace(/^\/+/, "");
  const filePath = path.resolve(root, relative);
  if (filePath !== root && !filePath.startsWith(`${root}${path.sep}`)) {
    return null;
  }

  try {
    const bytes = await readFile(filePath);
    return new Response(bytes, {
      headers: { "Content-Type": dashboardContentType(filePath) },
    });
  } catch {
    return null;
  }
}

function dashboardContentType(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (pathname.endsWith(".css")) return "text/css; charset=utf-8";
  if (pathname.endsWith(".svg")) return "image/svg+xml; charset=utf-8";
  if (pathname.endsWith(".png")) return "image/png";
  if (pathname.endsWith(".webp")) return "image/webp";
  return "application/octet-stream";
}

/**
 * 解析 monorepo 根的 dist/dashboard 路径。从 process.cwd() 向上找
 * 包含 `pnpm-workspace.yaml` 的目录,再拼上 dist/dashboard。
 * `vp run dev` / `vp exec tsx` / `tsx` 启动时 cwd 不可控,这种
 * 自上而下的搜索在 monorepo 里最稳。
 */
function resolveRepoRootDistDashboard(): string {
  let dir = process.cwd();
  for (let i = 0; i < 6; i++) {
    if (
      existsSync(path.join(dir, "pnpm-workspace.yaml")) &&
      existsSync(path.join(dir, "package.json"))
    ) {
      return path.join(dir, "dist", "dashboard");
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  // 兜底:相对 cwd
  return path.resolve(process.cwd(), "dist", "dashboard");
}

export function buildLocalDeps(): HttpDeps {
  const config = getAppConfig();
  const runtime = createLocalApplicationRuntime(path.resolve(config.database.sqlitePath));
  return {
    mode: "local",
    async getApiKey() {
      return config.server.apiKey;
    },
    async getRuntime() {
      return runtime;
    },
    dashboardApp: buildLocalDashboardApp(),
  };
}

export default async function startServer(port = 8000): Promise<void> {
  const config = getAppConfig();
  if (!config.server.apiKey.trim()) {
    throw new Error("server.apiKey 未配置，拒绝启动未受保护的服务");
  }
  const deps = buildLocalDeps();
  const app = createHttpApp(deps);
  serveFetch({ port }, (req) => app.fetch(req));
  logger.info(`服务监听在 http://0.0.0.0:${port}`);
  logger.info("dashboard 地址: http://localhost:8000/dashboard");
  if (process.env.TRENDPUBLISH_DASHBOARD_DEV_SERVER_URL) {
    logger.info(`dashboard 开发代理: ${process.env.TRENDPUBLISH_DASHBOARD_DEV_SERVER_URL}`);
  }
}
