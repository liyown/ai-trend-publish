import { z, type ZodType } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import type { ConnectorField, PublicConnectorDefinition } from "@trendpublish/contracts";
import type { ResolvedConnection } from "./connection.ts";
import {
  buildConnectorRequest,
  type ConnectorExecutor,
  type HttpRequest,
  type HttpResponse,
  type HttpStreamResponse,
  HttpProxyTransport,
  type HttpTransport,
  type ProxyTransportFactory,
} from "./http.ts";
import type { CallContext, ConnectorCapability, ConnectorOperation, JsonObject } from "./types.ts";

export type {
  ConnectorCheckResult,
  ConnectorField,
  ConnectorFieldInput,
  ConnectorFieldOption,
  PublicConnectorDefinition,
} from "@trendpublish/contracts/connectors";

export type ConnectorClients = Partial<Record<string, unknown>>;

export interface ConnectorCreateContext<TSettings, TCredentials> {
  connection: ResolvedConnection;
  settings: TSettings;
  credentials: TCredentials;
  execute(
    operation: ConnectorOperation,
    request: HttpRequest,
    context?: CallContext,
    credentialHeaders?: Record<string, string>,
  ): Promise<HttpResponse>;
  executeStream(
    operation: ConnectorOperation,
    request: HttpRequest,
    context?: CallContext,
    credentialHeaders?: Record<string, string>,
  ): Promise<HttpStreamResponse>;
  proxyTransport(proxyUrl: string): HttpTransport;
  executeWithTransport(
    transport: HttpTransport,
    operation: ConnectorOperation,
    request: HttpRequest,
    context?: CallContext,
    credentialHeaders?: Record<string, string>,
  ): Promise<HttpResponse>;
}

export interface ConnectorDefinition<
  TSettings = JsonObject,
  TCredentials = JsonObject,
  TClients extends ConnectorClients = ConnectorClients,
> {
  id: string;
  version: number;
  displayName: string;
  description: string;
  capabilities: ConnectorCapability[];
  settingsSchema: ZodType<TSettings>;
  credentialsSchema: ZodType<TCredentials>;
  fields: ConnectorField[];
  requestOverrides: boolean;
  create(context: ConnectorCreateContext<TSettings, TCredentials>): TClients;
  check(
    context: ConnectorCreateContext<TSettings, TCredentials>,
    signal?: AbortSignal,
  ): Promise<string>;
}

export function defineConnector<TSettings, TCredentials, TClients extends ConnectorClients>(
  definition: ConnectorDefinition<TSettings, TCredentials, TClients>,
): ConnectorDefinition<TSettings, TCredentials, TClients> {
  assertDefinition(definition);
  return Object.freeze(definition);
}

export function publicDefinition(definition: ConnectorDefinition): PublicConnectorDefinition {
  return {
    id: definition.id,
    version: definition.version,
    displayName: definition.displayName,
    description: definition.description,
    capabilities: [...definition.capabilities],
    fields: definition.fields.map((field) => ({ ...field })),
    requestOverrides: definition.requestOverrides,
    settingsSchema: zodToJsonSchema(definition.settingsSchema, {
      $refStrategy: "none",
    }) as JsonObject,
    credentialsSchema: zodToJsonSchema(definition.credentialsSchema, {
      $refStrategy: "none",
    }) as JsonObject,
  };
}

export function createConnectorContext(
  definition: ConnectorDefinition,
  connection: ResolvedConnection,
  executor: ConnectorExecutor,
  proxyTransportFactory: ProxyTransportFactory = (proxyUrl) => new HttpProxyTransport(proxyUrl),
): ConnectorCreateContext<JsonObject, JsonObject> {
  const settings = definition.settingsSchema.parse(connection.settings) as JsonObject;
  const credentials = definition.credentialsSchema.parse(connection.credentials) as JsonObject;
  return {
    connection,
    settings,
    credentials,
    execute(operation, request, context, credentialHeaders) {
      return executor.send(
        operation,
        buildRequest(
          request,
          definition.requestOverrides ? connection.overrides : undefined,
          credentialHeaders,
        ),
        context,
      );
    },
    executeStream(operation, request, context, credentialHeaders) {
      return executor.stream(
        operation,
        buildRequest(
          request,
          definition.requestOverrides ? connection.overrides : undefined,
          credentialHeaders,
        ),
        context,
      );
    },
    proxyTransport(proxyUrl) {
      return proxyTransportFactory(proxyUrl);
    },
    executeWithTransport(transport, operation, request, context, credentialHeaders) {
      return executor
        .using(transport)
        .send(
          operation,
          buildRequest(
            request,
            definition.requestOverrides ? connection.overrides : undefined,
            credentialHeaders,
          ),
          context,
        );
    },
  };
}

function buildRequest(
  request: HttpRequest,
  overrides: ResolvedConnection["overrides"],
  credentialHeaders?: Record<string, string>,
): HttpRequest {
  // Imported lazily through the helper to keep Connector definitions independent of transport details.
  return buildConnectorRequest(request, overrides, credentialHeaders);
}

function assertDefinition(definition: ConnectorDefinition<any, any, ConnectorClients>): void {
  if (!definition.id.trim()) throw new Error("Connector id is required");
  if (!Number.isInteger(definition.version) || definition.version < 1) {
    throw new Error(`Connector ${definition.id} version must be a positive integer`);
  }
  const keys = new Set<string>();
  for (const field of definition.fields) {
    const unique = `${field.location}:${field.key}`;
    if (keys.has(unique))
      throw new Error(`Connector ${definition.id} has duplicate field ${unique}`);
    keys.add(unique);
    if (field.input === "select" && !field.options?.length) {
      throw new Error(`Connector ${definition.id} select field ${field.key} requires options`);
    }
    if (field.input !== "select" && field.options?.length) {
      throw new Error(`Connector ${definition.id} field ${field.key} has unexpected options`);
    }
  }
  const declared = new Set(definition.capabilities);
  if (!declared.size)
    throw new Error(`Connector ${definition.id} must expose at least one capability`);
  if (definition.settingsSchema instanceof z.ZodObject) {
    const shape = definition.settingsSchema.shape;
    for (const field of definition.fields.filter((item) => item.location === "settings")) {
      if (!(field.key in shape))
        throw new Error(
          `Connector ${definition.id} field ${field.key} is missing from settings schema`,
        );
    }
  }
}
