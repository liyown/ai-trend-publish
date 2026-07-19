import type { JsonObject, JsonValue } from "./json.ts";

export type ConnectorFieldInput = "text" | "url" | "password" | "number" | "boolean" | "select";

export interface ConnectorFieldOption {
  value: string;
  label: string;
}

export interface ConnectorField {
  key: string;
  location: "settings" | "credentials";
  label: string;
  input: ConnectorFieldInput;
  required: boolean;
  description?: string;
  placeholder?: string;
  defaultValue?: string | number | boolean;
  options?: ConnectorFieldOption[];
  order?: number;
}

/** JSON-safe Connector definition exposed by the HTTP API. */
export interface PublicConnectorDefinition {
  id: string;
  version: number;
  displayName: string;
  description: string;
  capabilities: string[];
  fields: ConnectorField[];
  requestOverrides: boolean;
  settingsSchema: JsonObject;
  credentialsSchema: JsonObject;
}

export interface RequestOverrides {
  headers?: Record<string, string>;
  query?: Record<string, string>;
  body?: JsonObject;
}

export interface PublicConnection {
  id: string;
  connectorId: string;
  connectorVersion: number;
  name: string;
  enabled: boolean;
  settings: JsonObject;
  metadata: JsonObject;
  overrides?: RequestOverrides;
  revision: number;
  createdAt: string;
  updatedAt: string;
  credentialState: Record<string, boolean>;
}

export interface SaveConnectionPayload {
  id?: string;
  revision?: number;
  connectorId: string;
  name: string;
  enabled?: boolean;
  settings: Record<string, JsonValue>;
  credentials?: Record<string, JsonValue>;
  clearCredentials?: string[];
  overrides?: RequestOverrides;
}

export interface ConnectorCheckResult {
  success: boolean;
  message: string;
  latencyMs: number;
  checkedAt: string;
}
