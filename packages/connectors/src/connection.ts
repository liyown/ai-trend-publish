import type { JsonObject, RequestOverrides } from "./types.ts";

export interface ConnectionRecord {
  id: string;
  connectorId: string;
  connectorVersion: number;
  name: string;
  enabled: boolean;
  settings: JsonObject;
  credentialRef: string;
  metadata: JsonObject;
  overrides?: RequestOverrides;
  revision: number;
  createdAt: string;
  updatedAt: string;
}

export interface ResolvedConnection extends ConnectionRecord {
  credentials: JsonObject;
}

export interface ConnectionStore {
  list(): Promise<ConnectionRecord[]>;
  get(id: string): Promise<ConnectionRecord | null>;
  save(connection: ConnectionRecord): Promise<ConnectionRecord>;
  remove(id: string): Promise<void>;
}

export interface CredentialStore {
  get(ref: string): Promise<JsonObject | null>;
  set(ref: string, credentials: JsonObject): Promise<void>;
  remove(ref: string): Promise<void>;
}

export class MemoryConnectionStore implements ConnectionStore {
  private readonly connections = new Map<string, ConnectionRecord>();

  constructor(initial: ConnectionRecord[] = []) {
    for (const connection of initial)
      this.connections.set(connection.id, structuredClone(connection));
  }

  list(): Promise<ConnectionRecord[]> {
    return Promise.resolve([...this.connections.values()].map((item) => structuredClone(item)));
  }

  get(id: string): Promise<ConnectionRecord | null> {
    const value = this.connections.get(id);
    return Promise.resolve(value ? structuredClone(value) : null);
  }

  save(connection: ConnectionRecord): Promise<ConnectionRecord> {
    const current = this.connections.get(connection.id);
    if (current && connection.revision <= current.revision) {
      throw new ConnectorRevisionConflictError(
        connection.id,
        current.revision,
        connection.revision,
      );
    }
    const saved = structuredClone(connection);
    this.connections.set(saved.id, saved);
    return Promise.resolve(structuredClone(saved));
  }

  remove(id: string): Promise<void> {
    this.connections.delete(id);
    return Promise.resolve();
  }
}

export class ConnectorRevisionConflictError extends Error {
  constructor(
    readonly connectionId: string,
    readonly storedRevision: number,
    readonly attemptedRevision: number,
  ) {
    super(
      `连接 ${connectionId} 已更新（当前版本 ${storedRevision}，提交版本 ${attemptedRevision}）`,
    );
    this.name = "ConnectorRevisionConflictError";
  }
}

export class MemoryCredentialStore implements CredentialStore {
  private readonly credentials = new Map<string, JsonObject>();

  constructor(initial: Record<string, JsonObject> = {}) {
    for (const [ref, value] of Object.entries(initial))
      this.credentials.set(ref, structuredClone(value));
  }

  get(ref: string): Promise<JsonObject | null> {
    const value = this.credentials.get(ref);
    return Promise.resolve(value ? structuredClone(value) : null);
  }

  set(ref: string, credentials: JsonObject): Promise<void> {
    this.credentials.set(ref, structuredClone(credentials));
    return Promise.resolve();
  }

  remove(ref: string): Promise<void> {
    this.credentials.delete(ref);
    return Promise.resolve();
  }
}
