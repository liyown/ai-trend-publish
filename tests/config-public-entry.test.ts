import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { test, afterEach } from "vite-plus/test";
import { initializeAppConfig } from "@trendpublish/core/config";
import { assertEquals } from "@trendpublish/core/test";

afterEach(() => {
  delete process.env.TRENDPUBLISH_API_KEY;
});

test("initializeAppConfig loads config from a .env file", async () => {
  const dir = await mkdtemp(join(process.cwd(), ".trendpublish-test-"));
  const envFile = join(dir, ".env");
  try {
    await writeFile(envFile, "TRENDPUBLISH_API_KEY=server-key\n");

    const config = initializeAppConfig({ envFile });
    assertEquals(config.server.apiKey, "server-key");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
