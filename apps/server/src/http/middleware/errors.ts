import type { Context, ErrorHandler } from "hono";
import { HTTPException } from "hono/http-exception";
import { Logger } from "@trendpublish/core/logging";
import { ConnectorError, ConnectorRevisionConflictError } from "@trendpublish/connectors";
import { WorkspaceRevisionConflictError } from "@trendpublish/core/workspace";
import { ZodError } from "zod";

const logger = new Logger("http");

/**
 * 业务错误。throw new HttpError(msg, status),`errorMapper` 会把它
 * 翻译成 `{ error: msg }` JSON 响应,避免 HTTPException 默认的
 * text/plain 行为污染 API 契约。
 */
export class HttpError extends Error {
  constructor(
    message: string,
    readonly status: number = 400,
  ) {
    super(message);
    this.name = "HttpError";
  }
}

/**
 * zValidator 的标准失败 hook:把 ZodError 翻译成 dashboard 友好的
 * `{ error, issues }` 信封。所有路由共用,确保校验失败消息一致。
 */
export function jsonValidator<T>(
  result: { success: true; data: T } | { success: false; error: ZodError },
  c: Context,
): Response | undefined {
  if (result.success) return undefined;
  const failure = result as { success: false; error: ZodError };
  return c.json(
    {
      error: "请求体校验失败",
      issues: failure.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    },
    400,
  );
}

/**
 * 把业务侧抛出的异常统一映射到 dashboard 友好的错误信封。
 *
 * 信封形状来自 apps/dashboard/src/platform/api/http-dashboard-api.ts 的
 * parseApiError():优先用 `error`(string 或 {message,data}) 给出可读消息,
 * 并保留 `issues[]` 数组用于字段级提示。
 *
 * Zod 校验错误由 `@hono/zod-validator` 的 hook 单独处理(见 app.ts),
 * 这里不再 catch ZodError。
 */
export const errorMapper: ErrorHandler = (error, c) => {
  if (error instanceof HTTPException) {
    return error.getResponse();
  }
  if (error instanceof HttpError) {
    return c.json({ error: error.message }, error.status as 400);
  }
  if (
    error instanceof ConnectorRevisionConflictError ||
    error instanceof WorkspaceRevisionConflictError
  ) {
    return c.json({ error: error.message }, 409);
  }
  if (error instanceof ZodError) {
    return c.json(
      {
        error: "配置校验失败",
        issues: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      },
      400,
    );
  }
  if (error instanceof ConnectorError) {
    return c.json(
      { error: error.message },
      error.kind === "configuration" || error.kind === "invalid_request" ? 400 : 502,
    );
  }

  logger.error("未捕获的路由异常:", error);
  const message = error instanceof Error ? error.message : String(error);
  return c.json(
    {
      error: "内部服务器错误",
      data: { error: message },
    },
    500,
  );
};

export function unauthorizedResponse(c: import("hono").Context): Response {
  return c.json({ error: "未授权的访问" }, 401);
}
