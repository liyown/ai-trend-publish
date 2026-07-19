import { test } from "vite-plus/test";
import { assertEquals, assertRejects } from "../../test/assert.ts";
import {
  ConfigurationError,
  createConfigRuntime,
  initializeAppConfig,
  parseConfigArgs,
} from "./app-config.ts";
import { defineConfig } from "./define-config.ts";

test("parseConfigArgs extracts --config and keeps application args", () => {
  const parsed = parseConfigArgs([
    "--config",
    "./custom.config.ts",
    "--dry-run",
    "--max-articles",
    "3",
  ]);

  assertEquals(parsed.configPath, "./custom.config.ts");
  assertEquals(parsed.args, ["--dry-run", "--max-articles", "3"]);
});

test("parseConfigArgs supports --config=value", () => {
  const parsed = parseConfigArgs(["--dry-run", "--config=./docker.config.ts"]);

  assertEquals(parsed.configPath, "./docker.config.ts");
  assertEquals(parsed.args, ["--dry-run"]);
});

test("initializeAppConfig resolves runtime config factory", async () => {
  const config = await initializeAppConfig({
    source: defineConfig((runtime) => ({
      server: {
        apiKey: runtime.required("SERVER_API_KEY"),
      },
    })),
    runtime: createConfigRuntime({
      target: "docker",
      values: {
        SERVER_API_KEY: "server-key",
      },
    }),
  });

  assertEquals(config.server.apiKey, "server-key");
  assertEquals(config.database.sqlitePath, "data/trendpublish.sqlite3");
});

test("initializeAppConfig rejects missing explicit config path", async () => {
  await assertRejects(
    () =>
      initializeAppConfig({
        configPath: "/tmp/trendpublish-missing-config-file.ts",
      }),
    ConfigurationError,
    "配置文件不存在",
  );
});
