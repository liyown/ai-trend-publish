import { Hono } from "hono";
import { createFactory } from "hono/factory";
import type { ApplicationRuntime } from "../application/runtime.ts";

export interface HttpDeps {
  getApiKey(): Promise<string>;
  getRuntime(): Promise<ApplicationRuntime>;
  readonly mode: "local" | "cloudflare";
  dashboardApp: Hono<{ Variables: AppVariables }>;
}

export type AppVariables = {
  deps: HttpDeps;
  requestId: string;
};

export const factory = createFactory<{ Variables: AppVariables }>();
