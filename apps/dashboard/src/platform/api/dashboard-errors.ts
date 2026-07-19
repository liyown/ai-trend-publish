export class DashboardApiError extends Error {
  readonly status: number;
  readonly statusText: string;
  readonly path: string;

  constructor({
    message,
    status,
    statusText,
    path,
  }: {
    message: string;
    status: number;
    statusText: string;
    path: string;
  }) {
    super(message);
    this.name = "DashboardApiError";
    this.status = status;
    this.statusText = statusText;
    this.path = path;
  }
}

/**
 * Signals a permanent event-stream contract problem. Network failures and server errors remain
 * retryable, while an HTTP endpoint that does not speak SSE should fall back to snapshot polling
 * instead of reconnecting forever.
 */
export class DashboardEventStreamError extends Error {
  readonly retryable: boolean;

  constructor(message: string, retryable: boolean) {
    super(message);
    this.name = "DashboardEventStreamError";
    this.retryable = retryable;
  }
}

export function isDashboardApiError(error: unknown): error is DashboardApiError {
  return error instanceof DashboardApiError;
}

export function isPermanentEventStreamError(error: unknown): boolean {
  if (error instanceof DashboardEventStreamError) return !error.retryable;
  if (!isDashboardApiError(error)) return false;
  return error.status >= 400 && error.status < 500 && ![408, 425, 429].includes(error.status);
}

export function isUnauthorizedDashboardError(error: unknown) {
  return isDashboardApiError(error) && (error.status === 401 || error.status === 403);
}

export function dashboardErrorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return typeof error === "string" ? error : "请求失败";
}
