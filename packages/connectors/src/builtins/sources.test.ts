import { equal, rejects } from "../test-assert.ts";
import { test } from "vite-plus/test";
import { ConnectorError } from "../errors.ts";
import { FetchHttpTransport } from "../http.ts";
import { createStandaloneConnectorClients } from "../runtime.ts";
import type { SourceFetchClient } from "../types.ts";
import { sourceConnectors } from "./sources.ts";

test("source connectors use the shared executor and retain provider error details", async () => {
  const definition = sourceConnectors.find((connector) => connector.id === "firecrawl")!;
  let calls = 0;
  const clients = createStandaloneConnectorClients(definition, {
    id: "firecrawl-main",
    settings: {},
    credentials: { apiKey: "secret-key" },
    transport: new FetchHttpTransport(async () => {
      calls += 1;
      return new Response(
        JSON.stringify({ success: false, code: "SCRAPE_BLOCKED", error: "Target denied access" }),
        {
          status: 403,
          statusText: "Forbidden",
          headers: { "x-request-id": "firecrawl-request" },
        },
      );
    }),
  });
  const client = clients["source-fetch"] as SourceFetchClient;

  await rejects(
    () => client.fetch("https://example.com/private"),
    (error: unknown) => {
      equal(error instanceof ConnectorError, true);
      const message = (error as Error).message;
      equal(message.includes("SCRAPE_BLOCKED"), true);
      equal(message.includes("Target denied access"), true);
      equal(message.includes("Connector：firecrawl"), true);
      equal(message.includes("连接：firecrawl-main"), true);
      equal(message.includes("操作：source.fetch（source-fetch）"), true);
      return true;
    },
  );
  equal(calls, 1);
});
