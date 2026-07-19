import { test } from "vite-plus/test";
import { deepStrictEqual, equal, rejects } from "node:assert/strict";
import { z } from "zod";
import {
  MemoryConnectionStore,
  MemoryCredentialStore,
  type ConnectionRecord,
} from "./connection.ts";
import { defineConnector } from "./definition.ts";
import { ConnectorRegistry } from "./registry.ts";
import { ConnectorClientResolver, ConnectorManager } from "./runtime.ts";
import { ChatCapability, type ChatClient } from "./types.ts";
import type { HttpTransport } from "./http.ts";

const definition = defineConnector({
  id: "example",
  version: 1,
  displayName: "Example",
  description: "Example connector",
  capabilities: ["chat"],
  settingsSchema: z.object({ baseUrl: z.string().url(), model: z.string().min(1) }),
  credentialsSchema: z.object({ apiKey: z.string().min(1) }),
  fields: [
    { key: "baseUrl", location: "settings", label: "Base URL", input: "url", required: true },
    { key: "model", location: "settings", label: "Model", input: "text", required: true },
    { key: "apiKey", location: "credentials", label: "API Key", input: "password", required: true },
  ],
  requestOverrides: true,
  create({ settings }) {
    const chat: ChatClient = {
      async complete(input) {
        return { content: `${settings.model}:${input.messages[0]?.content}` };
      },
    };
    return { chat };
  },
  async check() {
    return "连接成功";
  },
});

test("runtime resolves typed capabilities and caches by connection revision", async () => {
  const connection = createConnection();
  const stores = {
    connections: new MemoryConnectionStore([connection]),
    credentials: new MemoryCredentialStore({ "connector:example": { apiKey: "secret" } }),
  };
  const registry = new ConnectorRegistry([definition]);
  const runtime = new ConnectorClientResolver({
    registry,
    ...stores,
    transport: noopTransport,
  });
  const chat = await runtime.get("default", ChatCapability);
  const output = await chat.complete({ messages: [{ role: "user", content: "hello" }] });
  equal(output.content, "model:hello");
});

test("manager keeps credentials out of public connections and preserves blank secrets", async () => {
  const stores = {
    connections: new MemoryConnectionStore(),
    credentials: new MemoryCredentialStore(),
  };
  const registry = new ConnectorRegistry([definition]);
  const runtime = new ConnectorClientResolver({ registry, ...stores, transport: noopTransport });
  const manager = new ConnectorManager(runtime, registry, stores.connections, stores.credentials);
  const created = await manager.save({
    id: "default",
    connectorId: "example",
    name: "Default",
    settings: { baseUrl: "https://api.example.com", model: "model" },
    credentials: { apiKey: "secret" },
  });
  const saved = await manager.save({
    id: "default",
    revision: created.revision,
    connectorId: "example",
    name: "Default",
    settings: { baseUrl: "https://api.example.com", model: "model" },
    credentials: { apiKey: "" },
  });
  deepStrictEqual(saved.credentialState, { apiKey: true });
  equal("credentials" in saved, false);
  deepStrictEqual(await stores.credentials.get("connector:default"), { apiKey: "secret" });
});

test("manager rejects stale connection edits", async () => {
  const stores = {
    connections: new MemoryConnectionStore(),
    credentials: new MemoryCredentialStore(),
  };
  const registry = new ConnectorRegistry([definition]);
  const runtime = new ConnectorClientResolver({ registry, ...stores, transport: noopTransport });
  const manager = new ConnectorManager(runtime, registry, stores.connections, stores.credentials);
  await manager.save({
    id: "default",
    connectorId: "example",
    name: "Default",
    settings: { baseUrl: "https://api.example.com", model: "model" },
    credentials: { apiKey: "secret" },
  });
  await rejects(
    () =>
      manager.save({
        id: "default",
        revision: 99,
        connectorId: "example",
        name: "Stale",
        settings: { baseUrl: "https://api.example.com", model: "model" },
      }),
    /其他操作更新/,
  );
});

test("manager removes connection metadata and credentials together", async () => {
  const stores = {
    connections: new MemoryConnectionStore(),
    credentials: new MemoryCredentialStore(),
  };
  const registry = new ConnectorRegistry([definition]);
  const runtime = new ConnectorClientResolver({ registry, ...stores, transport: noopTransport });
  const manager = new ConnectorManager(runtime, registry, stores.connections, stores.credentials);
  await manager.save({
    id: "default",
    connectorId: "example",
    name: "Default",
    settings: { baseUrl: "https://api.example.com", model: "model" },
    credentials: { apiKey: "secret" },
  });

  await manager.remove("default");

  equal(await manager.get("default"), null);
  equal(await stores.connections.get("default"), null);
  equal(await stores.credentials.get("connector:default"), null);
});

test("runtime rejects stale connector versions instead of silently migrating", async () => {
  const connection = createConnection();
  connection.connectorVersion = 2;
  const registry = new ConnectorRegistry([definition]);
  const runtime = new ConnectorClientResolver({
    registry,
    connections: new MemoryConnectionStore([connection]),
    credentials: new MemoryCredentialStore({ "connector:example": { apiKey: "secret" } }),
    transport: noopTransport,
  });
  await rejects(() => runtime.get("default", ChatCapability), /版本/);
});

const noopTransport: HttpTransport = {
  send() {
    throw new Error("not used");
  },
};

function createConnection(): ConnectionRecord {
  return {
    id: "default",
    connectorId: "example",
    connectorVersion: 1,
    name: "Default",
    enabled: true,
    settings: { baseUrl: "https://api.example.com", model: "model" },
    credentialRef: "connector:example",
    metadata: {},
    revision: 1,
    createdAt: "2026-07-14T00:00:00.000Z",
    updatedAt: "2026-07-14T00:00:00.000Z",
  };
}
