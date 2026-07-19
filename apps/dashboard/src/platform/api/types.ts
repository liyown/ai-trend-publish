import type {
  PublicConnection,
  PublicConnectorDefinition,
  StoredPublication,
} from "@trendpublish/contracts";

export * from "@trendpublish/contracts";

/** Dashboard-facing compatibility names for public HTTP resources. */
export type Connection = PublicConnection;
export type ConnectorDefinition = PublicConnectorDefinition;
export type Publication = StoredPublication;

export interface HealthResponse {
  ok: boolean;
  mode: "local" | "cloudflare";
  timestamp: string;
  checks: Record<string, { ok: boolean; detail: string }>;
}

export interface ApiErrorPayload {
  error?: string;
  issues?: Array<{ path?: string; message?: string }>;
}
