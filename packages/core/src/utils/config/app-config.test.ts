import { test, afterEach } from "vite-plus/test";
import { assertEquals } from "../../test/assert.ts";
import { initializeAppConfig } from "./app-config.ts";

// 每条用例后清理注入的 env，避免测试间污染
afterEach(() => {
  for (const key of [
    "TRENDPUBLISH_API_KEY",
    "TRENDPUBLISH_PORT",
    "TRENDPUBLISH_SQLITE_PATH",
    "TRENDPUBLISH_ENV",
    "OTEL_ENABLED",
  ]) {
    delete process.env[key];
  }
});

test("initializeAppConfig reads config from process.env", () => {
  process.env.TRENDPUBLISH_API_KEY = "server-key";
  process.env.TRENDPUBLISH_PORT = "9000";
  process.env.TRENDPUBLISH_SQLITE_PATH = "data/test.sqlite3";

  const config = initializeAppConfig({ envFile: false });

  assertEquals(config.server.apiKey, "server-key");
  assertEquals(config.server.port, 9000);
  assertEquals(config.database.sqlitePath, "data/test.sqlite3");
});

test("initializeAppConfig uses defaults when env vars are absent", () => {
  const config = initializeAppConfig({ envFile: false });

  assertEquals(config.server.apiKey, "");
  assertEquals(config.server.port, 8000);
  assertEquals(config.database.sqlitePath, "data/trendpublish.sqlite3");
  assertEquals(config.observability.serviceName, "trendpublish");
});
