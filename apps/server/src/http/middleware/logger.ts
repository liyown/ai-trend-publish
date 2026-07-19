import { factory } from "../deps.ts";
import { Logger } from "@trendpublish/core/logging";

const logger = new Logger("http-request");

/**
 * HTTP 请求访问日志中间件:写入 X-Request-Id 响应头便于客户端关联,
 * 输出一行带 method/path/status/duration 的访问日志。
 *
 * 不接入任务执行上下文，HTTP 请求不应该污染 job/task 等业务字段。
 */
export const requestContext = factory.createMiddleware(async (c, next) => {
  const requestId = c.req.header("X-Request-Id") ?? cryptoRandomId();
  c.set("requestId", requestId);
  c.header("X-Request-Id", requestId);
  const method = c.req.method;
  const path = c.req.path;
  const start = Date.now();
  try {
    await next();
  } finally {
    const status = c.res.status;
    const ms = Date.now() - start;
    logger.info(`${method} ${path} -> ${status} (${ms}ms) requestId=${requestId}`);
  }
});

function cryptoRandomId(): string {
  return `req-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
