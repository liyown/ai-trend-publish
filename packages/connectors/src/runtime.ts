import type {
  ConnectionRecord,
  ConnectionStore,
  CredentialStore,
  ResolvedConnection,
} from "./connection.ts";
import type { PublicConnection } from "@trendpublish/contracts";
import { ConnectorError, describeConnectorError } from "./errors.ts";
import {
  createConnectorContext,
  type ConnectorClients,
  type ConnectorCreateContext,
  type ConnectorDefinition,
} from "./definition.ts";
import {
  ConnectorExecutor,
  FetchHttpTransport,
  type ConnectorObserver,
  type HttpTransport,
  type ProxyTransportFactory,
} from "./http.ts";
import { ConnectorRegistry } from "./registry.ts";
import type { CapabilityToken, JsonObject, RequestOverrides } from "./types.ts";

export interface ConnectorClientResolverOptions {
  registry: ConnectorRegistry;
  connections: ConnectionStore;
  credentials: CredentialStore;
  transport?: HttpTransport;
  observer?: ConnectorObserver;
  proxyTransportFactory?: ProxyTransportFactory;
}

export interface StandaloneConnectorOptions {
  id: string;
  name?: string;
  settings: JsonObject;
  credentials: JsonObject;
  overrides?: RequestOverrides;
  transport?: HttpTransport;
  observer?: ConnectorObserver;
  proxyTransportFactory?: ProxyTransportFactory;
}

export function createStandaloneConnectorClients<TClients extends ConnectorClients>(
  definition: ConnectorDefinition<any, any, TClients>,
  options: StandaloneConnectorOptions,
): TClients {
  const now = new Date().toISOString();
  const connection: ResolvedConnection = {
    id: options.id,
    connectorId: definition.id,
    connectorVersion: definition.version,
    name: options.name ?? options.id,
    enabled: true,
    settings: options.settings,
    credentialRef: `standalone:${options.id}`,
    credentials: options.credentials,
    metadata: {},
    overrides: options.overrides,
    revision: 1,
    createdAt: now,
    updatedAt: now,
  };
  const executor = new ConnectorExecutor(
    definition.id,
    connection.id,
    options.transport ?? new FetchHttpTransport(),
    options.observer,
  );
  return definition.create(
    createConnectorContext(definition, connection, executor, options.proxyTransportFactory),
  );
}

interface CachedClients {
  revision: number;
  clients: ConnectorClients;
}

export class ConnectorClientResolver {
  private readonly transport: HttpTransport;
  private readonly cache = new Map<string, CachedClients>();

  constructor(private readonly options: ConnectorClientResolverOptions) {
    this.transport = options.transport ?? new FetchHttpTransport();
  }

  async get<TClient>(connectionId: string, capability: CapabilityToken<TClient>): Promise<TClient> {
    const connection = await this.resolveConnection(connectionId);
    const cached = this.cache.get(connection.id);
    const clients =
      cached?.revision === connection.revision ? cached.clients : this.createClients(connection);
    const client = clients[capability.key];
    if (!client) {
      throw new ConnectorError({
        kind: "configuration",
        connectorId: connection.connectorId,
        connectionId,
        capability: capability.key,
        message: `连接 ${connectionId} 不支持 ${capability.key} 能力`,
      });
    }
    return client as TClient;
  }

  invalidate(connectionId?: string): void {
    if (connectionId) this.cache.delete(connectionId);
    else this.cache.clear();
  }

  async resolveConnection(connectionId: string): Promise<ResolvedConnection> {
    const connection = await this.options.connections.get(connectionId);
    if (!connection) {
      throw new ConnectorError({
        kind: "configuration",
        connectionId,
        message: `连接不存在：${connectionId}`,
      });
    }
    if (!connection.enabled) {
      throw new ConnectorError({
        kind: "configuration",
        connectorId: connection.connectorId,
        connectionId,
        message: `连接已禁用：${connection.name}`,
      });
    }
    const definition = this.options.registry.get(connection.connectorId);
    if (definition.version !== connection.connectorVersion) {
      throw new ConnectorError({
        kind: "configuration",
        connectorId: connection.connectorId,
        connectionId,
        message: `连接版本 ${connection.connectorVersion} 与 Connector 版本 ${definition.version} 不匹配`,
      });
    }
    const credentials = (await this.options.credentials.get(connection.credentialRef)) ?? {};
    return { ...connection, credentials };
  }

  createEphemeralClients(connection: ResolvedConnection): ConnectorClients {
    return this.createClients(connection, false);
  }

  createEphemeralContext(
    connection: ResolvedConnection,
  ): ConnectorCreateContext<JsonObject, JsonObject> {
    const definition = this.options.registry.get(connection.connectorId);
    const executor = new ConnectorExecutor(
      connection.connectorId,
      connection.id,
      this.transport,
      this.options.observer,
    );
    return createConnectorContext(
      definition,
      connection,
      executor,
      this.options.proxyTransportFactory,
    );
  }

  private createClients(connection: ResolvedConnection, cache = true): ConnectorClients {
    const definition = this.options.registry.get(connection.connectorId);
    const executor = new ConnectorExecutor(
      connection.connectorId,
      connection.id,
      this.transport,
      this.options.observer,
    );
    const context = createConnectorContext(
      definition,
      connection,
      executor,
      this.options.proxyTransportFactory,
    );
    const clients = definition.create(context);
    if (cache) this.cache.set(connection.id, { revision: connection.revision, clients });
    return clients;
  }
}

export interface SaveConnectionInput {
  id: string;
  revision?: number;
  connectorId: string;
  name: string;
  enabled?: boolean;
  settings: JsonObject;
  credentials?: JsonObject;
  clearCredentials?: string[];
  metadata?: JsonObject;
  overrides?: ConnectionRecord["overrides"];
}

export type { PublicConnection } from "@trendpublish/contracts/connectors";

export class ConnectorManager {
  constructor(
    private readonly clientResolver: ConnectorClientResolver,
    private readonly registry: ConnectorRegistry,
    private readonly connections: ConnectionStore,
    private readonly credentials: CredentialStore,
  ) {}

  definitions() {
    return this.registry.list();
  }

  async list(): Promise<PublicConnection[]> {
    const connections = await this.connections.list();
    return await Promise.all(connections.map((connection) => this.toPublicConnection(connection)));
  }

  async get(id: string): Promise<PublicConnection | null> {
    const connection = await this.connections.get(id);
    return connection ? await this.toPublicConnection(connection) : null;
  }

  async save(input: SaveConnectionInput): Promise<PublicConnection> {
    const definition = this.registry.get(input.connectorId);
    const settings = definition.settingsSchema.parse(input.settings) as JsonObject;
    const existing = await this.connections.get(input.id);
    if (existing && input.connectorId !== existing.connectorId) {
      throw new ConnectorError({
        kind: "configuration",
        message: "不能修改已有连接的 Connector 类型，请新建连接",
      });
    }
    if (existing && input.revision !== existing.revision) {
      throw new ConnectorError({
        kind: "configuration",
        message: `连接已被其他操作更新（当前版本 ${existing.revision}）`,
      });
    }
    const credentialRef = existing?.credentialRef ?? `connector:${input.id}`;
    const currentCredentials = (await this.credentials.get(credentialRef)) ?? {};
    const nextCredentials = mergeCredentials(
      currentCredentials,
      input.credentials ?? {},
      input.clearCredentials ?? [],
    );
    definition.credentialsSchema.parse(nextCredentials);
    const now = new Date().toISOString();
    const saved = await this.connections.save({
      id: input.id,
      connectorId: input.connectorId,
      connectorVersion: definition.version,
      name: input.name,
      enabled: input.enabled ?? true,
      settings,
      credentialRef,
      metadata: input.metadata ?? existing?.metadata ?? {},
      overrides: input.overrides,
      revision: (existing?.revision ?? 0) + 1,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    });
    await this.credentials.set(credentialRef, nextCredentials);
    this.clientResolver.invalidate(saved.id);
    return await this.toPublicConnection(saved);
  }

  /** Copies settings and secrets entirely inside the service boundary for managed ownership. */
  async clone(
    sourceId: string,
    input: Pick<SaveConnectionInput, "id" | "name" | "metadata">,
  ): Promise<PublicConnection> {
    const existing = await this.connections.get(input.id);
    if (existing) {
      if (
        existing.metadata["managedBy"] !== input.metadata?.["managedBy"] ||
        existing.metadata["accountId"] !== input.metadata?.["accountId"]
      ) {
        throw new ConnectorError({
          kind: "configuration",
          message: `受管连接 ${input.id} 已被其他对象占用`,
        });
      }
      return await this.toPublicConnection(existing);
    }
    const source = await this.connections.get(sourceId);
    if (!source) {
      throw new ConnectorError({ kind: "configuration", message: `连接不存在：${sourceId}` });
    }
    const credentials = (await this.credentials.get(source.credentialRef)) ?? {};
    return await this.save({
      id: input.id,
      connectorId: source.connectorId,
      name: input.name,
      enabled: source.enabled,
      settings: source.settings,
      credentials,
      metadata: input.metadata,
      overrides: source.overrides,
    });
  }

  async manage(
    id: string,
    input: Pick<SaveConnectionInput, "name" | "metadata">,
  ): Promise<PublicConnection> {
    const current = await this.connections.get(id);
    if (!current) {
      throw new ConnectorError({ kind: "configuration", message: `连接不存在：${id}` });
    }
    return await this.save({
      id,
      revision: current.revision,
      connectorId: current.connectorId,
      name: input.name,
      enabled: current.enabled,
      settings: current.settings,
      metadata: input.metadata,
      overrides: current.overrides,
    });
  }

  async remove(id: string): Promise<void> {
    const connection = await this.connections.get(id);
    if (!connection) return;
    await this.connections.remove(id);
    await this.credentials.remove(connection.credentialRef);
    this.clientResolver.invalidate(id);
  }

  async check(input: SaveConnectionInput, signal?: AbortSignal) {
    const definition = this.registry.get(input.connectorId);
    const existing = await this.connections.get(input.id);
    const credentialRef = existing?.credentialRef ?? `connector:${input.id}:check`;
    const currentCredentials = existing
      ? ((await this.credentials.get(existing.credentialRef)) ?? {})
      : {};
    const credentials = mergeCredentials(
      currentCredentials,
      input.credentials ?? {},
      input.clearCredentials ?? [],
    );
    const settings = definition.settingsSchema.parse(input.settings) as JsonObject;
    definition.credentialsSchema.parse(credentials);
    const now = new Date().toISOString();
    const connection: ResolvedConnection = {
      id: input.id,
      connectorId: input.connectorId,
      connectorVersion: definition.version,
      name: input.name,
      enabled: true,
      settings,
      credentials,
      credentialRef,
      metadata: input.metadata ?? {},
      overrides: input.overrides,
      revision: existing?.revision ?? 0,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    const startedAt = Date.now();
    const context = this.clientResolver.createEphemeralContext(connection);
    try {
      const message = await definition.check(context, signal);
      return {
        success: true,
        message,
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      };
    } catch (error) {
      return {
        success: false,
        message: describeConnectorError(error),
        latencyMs: Date.now() - startedAt,
        checkedAt: new Date().toISOString(),
      };
    }
  }

  private async toPublicConnection(connection: ConnectionRecord): Promise<PublicConnection> {
    const definition = this.registry.get(connection.connectorId);
    const credentials = (await this.credentials.get(connection.credentialRef)) ?? {};
    return {
      id: connection.id,
      connectorId: connection.connectorId,
      connectorVersion: connection.connectorVersion,
      name: connection.name,
      enabled: connection.enabled,
      settings: structuredClone(connection.settings),
      metadata: structuredClone(connection.metadata),
      overrides: structuredClone(connection.overrides),
      revision: connection.revision,
      createdAt: connection.createdAt,
      updatedAt: connection.updatedAt,
      credentialState: Object.fromEntries(
        definition.fields
          .filter((field) => field.location === "credentials")
          .map((field) => [field.key, hasValue(credentials[field.key])]),
      ),
    };
  }
}

function mergeCredentials(current: JsonObject, patch: JsonObject, clear: string[]): JsonObject {
  const result = structuredClone(current);
  for (const key of clear) delete result[key];
  for (const [key, value] of Object.entries(patch)) {
    if (typeof value === "string" && !value.trim()) continue;
    result[key] = structuredClone(value);
  }
  return result;
}

function hasValue(value: unknown): boolean {
  if (typeof value === "string") return Boolean(value.trim());
  return value !== undefined && value !== null;
}
