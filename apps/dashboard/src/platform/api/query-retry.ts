import { isUnauthorizedDashboardError } from "./dashboard-errors.ts";

export function shouldRetryDashboardQuery(failureCount: number, error: unknown) {
  if (isUnauthorizedDashboardError(error)) return false;
  return failureCount < 1;
}
