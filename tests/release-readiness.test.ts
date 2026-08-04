import { readFile, readdir, stat } from "node:fs/promises";
import { test } from "vite-plus/test";
import { assertEquals } from "@trendpublish/core/test";

test("fresh deployments include modular runtime and ReAct run migrations", async () => {
  const migrations = (await readdir("migrations")).filter((file) => file.endsWith(".sql"));
  assertEquals(migrations, ["0001_modular_runtime.sql", "0002_react_runs.sql"]);
  const schema = (
    await Promise.all(migrations.map((migration) => readFile(`migrations/${migration}`, "utf8")))
  ).join("\n");
  for (const table of [
    "workspace_documents",
    "connector_connections",
    "connector_credentials",
    "runtime_jobs",
    "runtime_tasks",
    "runtime_runs",
    "runtime_run_sessions",
    "runtime_run_activities",
    "runtime_run_activity_sequences",
    "internal_schema_versions",
  ]) {
    assertEquals(schema.includes(table), true, `${table} missing from schema`);
  }
  for (const legacy of ["workflow_runs", "runtime_config", "publish_nodes"]) {
    assertEquals(schema.includes(legacy), false, `${legacy} must not be recreated`);
  }
});

test("deployment config contains infrastructure only", async () => {
  const definition = await readFile("packages/core/src/utils/config/define-config.ts", "utf8");
  for (const required of ["ServerConfig", "DatabaseConfig", "ObservabilityConfig"]) {
    assertEquals(definition.includes(required), true);
  }
  for (const forbidden of ["ProviderConfig", "features:", "storage:", "publisher:"]) {
    assertEquals(definition.includes(forbidden), false, `${forbidden} must remain web-managed`);
  }
});

test("package graph and aliases contain no removed architecture", async () => {
  const files = ["package.json", "tsconfig.json", "vite.config.ts", "wrangler.jsonc"];
  for (const file of files) {
    const content = await readFile(file, "utf8");
    for (const removed of [
      "@trendpublish/workflow",
      "@trendpublish/integrations",
      "@trendpublish/agents",
    ]) {
      assertEquals(content.includes(removed), false, `${file}: ${removed}`);
    }
  }
});

test("Cloudflare uses D1 and does not provision the retired workflow storage stack", async () => {
  const config = await readFile("wrangler.jsonc", "utf8");
  assertEquals(config.includes('"d1_databases"'), true);
  assertEquals(config.includes('"workflows"'), false);
  assertEquals(config.includes('"kv_namespaces"'), false);
  assertEquals(config.includes('"r2_buckets"'), false);
});

test("temporary outputs are ignored and no generated type cache is required", async () => {
  const gitignore = await readFile(".gitignore", "utf8");
  assertEquals(gitignore.includes("data/temp/"), true);
  assertEquals(await exists("ENV_CONFIGURATION.md"), false);
});

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
