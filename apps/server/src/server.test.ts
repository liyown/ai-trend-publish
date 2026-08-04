/// <reference types="node" />

import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "vite-plus/test";
import { assertEquals } from "@trendpublish/core/test";
import { buildLocalDashboardApp } from "./server.ts";

test("local dashboard app returns built index.html for refreshed SPA routes", async () => {
  const distDir = await createDashboardDist();
  try {
    const app = buildLocalDashboardApp(distDir);
    const response = await app.request("/dashboard/workspace", {
      headers: { Accept: "text/html" },
    });

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "<!doctype html><title>Dashboard</title>");
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

test("local dashboard app serves static bundle files from dashboard build root", async () => {
  const distDir = await createDashboardDist();
  try {
    const app = buildLocalDashboardApp(distDir);
    const response = await app.request("/dashboard/assets/app.js");

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "console.log('ok')");
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

test("local dashboard app does not return HTML for missing bundle files", async () => {
  const distDir = await createDashboardDist();
  try {
    const app = buildLocalDashboardApp(distDir);
    const response = await app.request("/dashboard/assets/missing.js", {
      headers: { Accept: "text/html" },
    });

    assertEquals(response.status, 404);
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

test("local dashboard app returns built index.html for /dashboard", async () => {
  const distDir = await createDashboardDist();
  try {
    const app = buildLocalDashboardApp(distDir);
    const response = await app.request("/dashboard", {
      headers: { Accept: "text/html" },
    });

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "<!doctype html><title>Dashboard</title>");
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

test("local dashboard app returns 404 for SPA routes when dist is missing", async () => {
  const distDir = await mkdtemp(path.join(tmpdir(), "trendpublish-dashboard-empty-dist-"));
  try {
    const app = buildLocalDashboardApp(distDir);
    const routeResponse = await app.request("/dashboard/publishing", {
      headers: { Accept: "text/html" },
    });
    const assetResponse = await app.request("/dashboard/assets/app.js", {
      headers: { Accept: "text/html" },
    });

    assertEquals(routeResponse.status, 404);
    assertEquals(
      await routeResponse.text(),
      "Dashboard index.html not found. Build the dashboard before serving routes.",
    );
    assertEquals(assetResponse.status, 404);
  } finally {
    await rm(distDir, { recursive: true, force: true });
  }
});

test("local dashboard app proxies dashboard routes to the Vite dev server when configured", async () => {
  const devServer = createServer((request, response) => {
    response.setHeader("Content-Type", "text/html; charset=utf-8");
    response.end(`dev:${request.url}`);
  });
  await listenOnRandomPort(devServer);
  const address = devServer.address();
  if (!address || typeof address === "string") {
    throw new Error("Dev server did not expose a TCP address");
  }

  try {
    const app = buildLocalDashboardApp("/missing-dashboard-dist", {
      dashboardDevServerUrl: `http://127.0.0.1:${address.port}`,
    });
    const response = await app.request("/dashboard/identities?tab=list", {
      headers: { Accept: "text/html" },
    });

    assertEquals(response.status, 200);
    assertEquals(await response.text(), "dev:/dashboard/identities?tab=list");
  } finally {
    await closeServer(devServer);
  }
});

async function createDashboardDist(): Promise<string> {
  const distDir = await mkdtemp(path.join(tmpdir(), "trendpublish-dashboard-dist-"));
  await mkdir(path.join(distDir, "assets"), { recursive: true });
  await writeFile(path.join(distDir, "index.html"), "<!doctype html><title>Dashboard</title>");
  await writeFile(path.join(distDir, "assets", "app.js"), "console.log('ok')");
  return distDir;
}

async function listenOnRandomPort(server: Server): Promise<void> {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
}

async function closeServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()));
  });
}
