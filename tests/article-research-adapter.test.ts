import { test } from "vite-plus/test";
import type { ConnectorClientResolver } from "@trendpublish/connectors";
import { assert, assertEquals } from "@trendpublish/core/test";
import { MemoryTaskStore, TaskRunner } from "@trendpublish/runtime";
import { ConnectionResearchAdapter } from "@trendpublish/article/application";

const operationContext = {
  task: new TaskRunner(new MemoryTaskStore()).forJob("job-research"),
  signal: new AbortController().signal,
  now: () => new Date("2026-07-18T00:00:00.000Z"),
};

test("workspace research adapter returns search candidates without materializing snippets", async () => {
  const calls: unknown[] = [];
  const connectors = {
    async get() {
      return {
        async search(input: unknown) {
          calls.push(input);
          return [
            {
              id: "result-1",
              title: "Runtime release",
              snippet: "This is only a search snippet.",
              url: "https://example.com/release",
            },
          ];
        },
      };
    },
  } as unknown as ConnectorClientResolver;
  const tool = ConnectionResearchAdapter.create({
    connection: { id: "source-main", revision: 2, connectorId: "source-provider" },
    capability: "source-search",
    connectors,
  });

  if (tool.capability !== "search") throw new Error("search adapter expected");
  const candidates = await tool.search("AI runtime release", operationContext);

  assertEquals(calls, [{ query: "AI runtime release" }]);
  assertEquals(candidates.length, 1);
  assertEquals(candidates[0].snippet, "This is only a search snippet.");
});

test("workspace research adapter freezes fetched documents as material snapshots", async () => {
  const connectors = {
    async get() {
      return {
        async fetch(url: string) {
          return [
            {
              id: "document-1",
              title: "Runtime release",
              content: "The runtime improves checkpoint consistency.",
              url,
            },
          ];
        },
      };
    },
  } as unknown as ConnectorClientResolver;
  const tool = ConnectionResearchAdapter.create({
    connection: { id: "source-main", revision: 2, connectorId: "source-provider" },
    capability: "source-fetch",
    connectors,
  });

  if (tool.capability !== "fetch") throw new Error("fetch adapter expected");
  const materials = await tool.fetch("https://example.com/release", operationContext);

  assertEquals(materials.length, 1);
  assertEquals(materials[0].retrievedAt, "2026-07-18T00:00:00.000Z");
  assert(materials[0].contentHash.length > 20);
  assertEquals(materials[0].metadata?.connectionId, "source-main");
});
