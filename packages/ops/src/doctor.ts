import { access } from "node:fs/promises";
import { resolve } from "node:path";
import { initializeAppConfig, parseConfigArgs } from "@trendpublish/core/config";
import { SQLiteStateStore } from "@trendpublish/server/local-state";

export async function main(): Promise<void> {
  const { configPath } = parseConfigArgs(process.argv.slice(2));
  const config = await initializeAppConfig({ configPath });
  const checks: Array<{ name: string; ok: boolean; detail: string }> = [];
  checks.push({
    name: "server.apiKey",
    ok: Boolean(config.server.apiKey.trim()),
    detail: config.server.apiKey.trim() ? "configured" : "missing",
  });
  try {
    const store = new SQLiteStateStore(resolve(config.database.sqlitePath));
    await store.ensureSchema();
    checks.push({ name: "database", ok: true, detail: resolve(config.database.sqlitePath) });
  } catch (error) {
    checks.push({
      name: "database",
      ok: false,
      detail: error instanceof Error ? error.message : String(error),
    });
  }
  for (const file of [
    "packages/connectors/src/index.ts",
    "packages/article/src/index.ts",
    "packages/publishing/src/index.ts",
    "packages/runtime/src/index.ts",
  ]) {
    try {
      await access(resolve(file));
      checks.push({ name: file, ok: true, detail: "present" });
    } catch {
      checks.push({ name: file, ok: false, detail: "missing" });
    }
  }
  for (const check of checks) console.log(`${check.ok ? "✓" : "✗"} ${check.name}: ${check.detail}`);
  if (checks.some((check) => !check.ok)) process.exitCode = 1;
}
