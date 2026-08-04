import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vite-plus/test";
import { assertEquals } from "@trendpublish/core/test";

const ROOT = process.cwd();

test("legacy architecture trees are physically removed", async () => {
  for (const path of ["src", "packages/workflow", "packages/integrations", "packages/agents"]) {
    assertEquals(await pathExists(join(ROOT, path)), false, `${path} must not exist`);
  }
});

test("runtime is business agnostic", async () => {
  assertEquals(
    await findTextViolations("packages/runtime/src", [
      "@trendpublish/",
      "ContentPackage",
      "Connector",
    ]),
    [],
  );
});

test("connectors are independent external service clients", async () => {
  assertEquals(
    await findTextViolations("packages/connectors/src", [
      "@trendpublish/article",
      "@trendpublish/core",
      "@trendpublish/publishing",
      "@trendpublish/server",
    ]),
    [],
  );
});

test("article generation is independent from publishing and application assembly", async () => {
  assertEquals(
    await findTextViolations("packages/article/src", [
      "@trendpublish/core",
      "@trendpublish/publishing",
      "@trendpublish/server",
    ]),
    [],
  );
});

test("publishing is independent from application assembly", async () => {
  assertEquals(
    await findTextViolations("packages/publishing/src", [
      "@trendpublish/core",
      "@trendpublish/server",
    ]),
    [],
  );
});

test("core application layer never imports delivery or operations", async () => {
  assertEquals(
    await findTextViolations("packages/core/src", ["@trendpublish/server", "@trendpublish/ops"]),
    [],
  );
});

test("dashboard only talks to the HTTP contract", async () => {
  assertEquals(
    await findTextViolations("apps/dashboard/src", [
      "@trendpublish/server",
      "@trendpublish/core",
      "@trendpublish/connectors",
      "@trendpublish/runtime",
      "@trendpublish/article",
      'from "node:',
      "from 'node:",
    ]),
    [],
  );
});

test("server HTTP routes depend on one application runtime boundary", async () => {
  const deps = await readFile("apps/server/src/http/deps.ts", "utf8");
  assertEquals(deps.includes("ApplicationRuntime"), true);
  assertEquals(deps.includes("getRuntime()"), true);
  assertEquals(deps.includes("getStores()"), false);
  assertEquals(deps.includes("triggerRun()"), false);
});

test("packages expose only named public entry points", async () => {
  for (const packageJson of [
    "packages/contracts/package.json",
    "packages/article/package.json",
    "packages/connectors/package.json",
    "packages/runtime/package.json",
    "packages/publishing/package.json",
    "packages/core/package.json",
    "packages/ops/package.json",
    "apps/server/package.json",
  ]) {
    const manifest = JSON.parse(await readFile(packageJson, "utf8")) as {
      exports?: Record<string, unknown>;
    };
    assertEquals(
      Object.hasOwn(manifest.exports ?? {}, "./*"),
      false,
      `${packageJson} must not expose arbitrary source subpaths`,
    );
  }
  const tsconfig = JSON.parse(await readFile("tsconfig.json", "utf8")) as {
    compilerOptions?: { paths?: Record<string, unknown> };
  };
  assertEquals(
    Object.keys(tsconfig.compilerOptions?.paths ?? {}).filter((specifier) =>
      specifier.endsWith("/*"),
    ),
    [],
    "tsconfig paths must not bypass package exports",
  );
});

test("cross-package imports use stable public entry points", async () => {
  const allowed = new Set([
    "@trendpublish/agent",
    "@trendpublish/article",
    "@trendpublish/article/application",
    "@trendpublish/connectors",
    "@trendpublish/contracts",
    "@trendpublish/contracts/article",
    "@trendpublish/contracts/connectors",
    "@trendpublish/contracts/execution",
    "@trendpublish/contracts/json",
    "@trendpublish/contracts/publishing",
    "@trendpublish/contracts/workspace",
    "@trendpublish/core/application",
    "@trendpublish/core/config",
    "@trendpublish/core/logging",
    "@trendpublish/core/node",
    "@trendpublish/core/observability",
    "@trendpublish/core/test",
    "@trendpublish/core/utilities",
    "@trendpublish/core/workspace",
    "@trendpublish/ops/cloudflare-smoke",
    "@trendpublish/ops/cloudflare-sync-secrets",
    "@trendpublish/ops/doctor",
    "@trendpublish/ops/install-relay-systemd",
    "@trendpublish/ops/print-relay-systemd",
    "@trendpublish/publishing",
    "@trendpublish/runtime",
    "@trendpublish/server/local-state",
    "@trendpublish/server/server",
  ]);
  const violations: string[] = [];
  for (const relativeDir of ["apps", "packages", "scripts", "tests"]) {
    if (!(await pathExists(join(ROOT, relativeDir)))) continue;
    for await (const path of walkSourceFiles(join(ROOT, relativeDir))) {
      const content = await readFile(path, "utf8");
      for (const specifier of packageSpecifiers(content)) {
        if (!allowed.has(specifier)) {
          violations.push(`${path.replace(`${ROOT}/`, "")}: ${specifier}`);
        }
      }
    }
  }
  for (const entry of await readdir(ROOT)) {
    if (!entry.endsWith(".ts")) continue;
    const content = await readFile(join(ROOT, entry), "utf8");
    for (const specifier of packageSpecifiers(content)) {
      if (!allowed.has(specifier)) violations.push(`${entry}: ${specifier}`);
    }
  }
  assertEquals(violations.sort(), []);
});

test("core package internals use relative imports", async () => {
  assertEquals(await findTextViolations("packages/core/src", ["@trendpublish/core/"]), []);
});

async function findTextViolations(relativeDir: string, forbidden: string[]): Promise<string[]> {
  const violations: string[] = [];
  for await (const path of walkSourceFiles(join(ROOT, relativeDir))) {
    const content = await readFile(path, "utf8");
    for (const text of forbidden) {
      if (content.includes(text)) violations.push(`${path.replace(`${ROOT}/`, "")}: ${text}`);
    }
  }
  return violations.sort();
}

async function* walkSourceFiles(dir: string): AsyncGenerator<string> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) yield* walkSourceFiles(path);
    else if (entry.isFile() && (path.endsWith(".ts") || path.endsWith(".tsx"))) yield path;
  }
}

function packageSpecifiers(content: string): string[] {
  const result: string[] = [];
  const pattern = /(?:from\s+|import\s*\(\s*)["'](@trendpublish\/[^"']+)["']/g;
  for (const match of content.matchAll(pattern)) result.push(match[1]!);
  return result;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT") return false;
    throw error;
  }
}
