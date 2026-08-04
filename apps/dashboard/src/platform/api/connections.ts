import { apiJson, mutation } from "./http.ts";
import type { Connection, ConnectorDefinition, SaveConnectionPayload } from "./types.ts";

export const listConnections = () =>
  apiJson<{ definitions: ConnectorDefinition[]; connections: Connection[] }>("/api/connections");

export const createConnection = (body: SaveConnectionPayload) =>
  mutation<{ connection: Connection }>("/api/connections", "POST", body);

export const updateConnection = (id: string, body: SaveConnectionPayload) =>
  mutation<{ connection: Connection }>(`/api/connections/${encodeURIComponent(id)}`, "PATCH", body);

export const deleteConnection = (id: string) =>
  mutation<{ success: boolean }>(`/api/connections/${encodeURIComponent(id)}`, "DELETE");

export const testConnection = (body: SaveConnectionPayload) =>
  mutation<{ test: { success: boolean; message: string; latencyMs: number; checkedAt: string } }>(
    "/api/connections/test",
    "POST",
    body,
  );
