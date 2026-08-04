import { expect, test } from "vite-plus/test";
import {
  DashboardApiError,
  DashboardEventStreamError,
  isPermanentEventStreamError,
} from "./dashboard-errors.ts";

test("event stream retry classification stops on permanent protocol and client errors", () => {
  expect(
    isPermanentEventStreamError(new DashboardEventStreamError("invalid content type", false)),
  ).toBe(true);
  expect(isPermanentEventStreamError(new DashboardEventStreamError("temporary", true))).toBe(false);
  expect(isPermanentEventStreamError(apiError(404))).toBe(true);
  expect(isPermanentEventStreamError(apiError(401))).toBe(true);
  expect(isPermanentEventStreamError(apiError(429))).toBe(false);
  expect(isPermanentEventStreamError(apiError(503))).toBe(false);
});

function apiError(status: number): DashboardApiError {
  return new DashboardApiError({
    message: `HTTP ${status}`,
    status,
    statusText: "",
    path: "/api/jobs/job-1/events",
  });
}
