import { timingSafeEqual } from "node:crypto";
import { factory } from "../deps.ts";
import { unauthorizedResponse } from "./errors.ts";

/**
 * Bearer Token 鉴权中间件。
 *
 * 通过 factory 闭包注入到 c.var,所有路由处理器都能直接读 c.var.deps。
 * 仅作用于 /api/* 路径;dashboard 静态资源直接放行。
 */
export const requireBearer = factory.createMiddleware(async (c, next) => {
  if (!c.req.path.startsWith("/api/")) {
    return next();
  }
  const header = c.req.header("Authorization");
  if (!header || !header.startsWith("Bearer ")) {
    return unauthorizedResponse(c);
  }
  const provided = header.slice("Bearer ".length).trim();
  if (!provided) {
    return unauthorizedResponse(c);
  }
  const expected = await c.var.deps.getApiKey();
  if (!safeEqual(provided, expected)) {
    return unauthorizedResponse(c);
  }
  return next();
});

/**
 * 把 deps 闭包注入到 c.var 的中间件。根 app.use("*", injectDeps(deps)) 一次。
 * 这是 factory 模式与 Hono 生态的"DI 入口"——之后所有中间件/handler
 * 都从 c.var.deps 拿配置、stores、apiKey,不再 import 顶层 deps 对象。
 */
export function injectDeps(deps: import("../deps.ts").HttpDeps) {
  return factory.createMiddleware(async (c, next) => {
    c.set("deps", deps);
    return next();
  });
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) {
    const padded = b + "\0".repeat(Math.max(0, a.length - b.length));
    timingSafeEqual(Buffer.from(a), Buffer.from(padded.slice(0, a.length)));
    return false;
  }
  return timingSafeEqual(Buffer.from(a), Buffer.from(b));
}
