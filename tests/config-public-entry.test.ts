import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "vite-plus/test";
import { initializeAppConfig } from "@trendpublish/core/config";
import { assertEquals } from "@trendpublish/core/test";

test("a config file can import the public core config entry", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".trendpublish-config-"));
  const configPath = join(dir, "trendpublish.config.ts");
  try {
    await writeFile(
      configPath,
      `
import { defineConfig } from "@trendpublish/core/config";

export default defineConfig({
  server: { apiKey: "server-key" },
});
`,
    );

    const config = await initializeAppConfig({ configPath });
    assertEquals(config.server.apiKey, "server-key");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
