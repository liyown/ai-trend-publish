import { test } from "vite-plus/test";
import { assertEquals } from "../../test/assert.ts";
import { resolveTrendPublishConfig } from "./define-config.ts";

test("resolveTrendPublishConfig only resolves deployment concerns", () => {
  const config = resolveTrendPublishConfig({
    server: { apiKey: "server-key", port: 9000 },
    database: { sqlitePath: "data/test.sqlite3" },
    observability: { enabled: false, environment: "test" },
  });

  assertEquals(config.server, { apiKey: "server-key", port: 9000 });
  assertEquals(config.database.sqlitePath, "data/test.sqlite3");
  assertEquals(config.observability.enabled, false);
  assertEquals(config.observability.environment, "test");
});

test("resolveTrendPublishConfig provides infrastructure defaults", () => {
  const config = resolveTrendPublishConfig({});

  assertEquals(config.server, { apiKey: "", port: 8000 });
  assertEquals(config.database.sqlitePath, "data/trendpublish.sqlite3");
  assertEquals(config.observability.serviceName, "trendpublish");
});
