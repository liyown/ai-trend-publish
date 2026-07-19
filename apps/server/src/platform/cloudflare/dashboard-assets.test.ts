import { test } from "vite-plus/test";
import { assertEquals } from "@trendpublish/core/test";
import { buildCloudflareDashboardApp, type DashboardAssetsBinding } from "./dashboard-assets.ts";

test("Cloudflare dashboard assets return index.html for refreshed SPA routes", async () => {
  const requests: string[] = [];
  const app = buildCloudflareDashboardApp({
    ASSETS: fakeAssets({ "/": "<!doctype html><title>Dashboard</title>" }, requests),
  });

  const response = await app.request("/dashboard/workspace", {
    headers: { Accept: "text/html" },
  });

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<!doctype html><title>Dashboard</title>");
  assertEquals(requests, ["/"]);
});

test("Cloudflare dashboard assets strip /dashboard before fetching static assets", async () => {
  const requests: string[] = [];
  const app = buildCloudflareDashboardApp({
    ASSETS: fakeAssets({ "/assets/app.js": "console.log('ok')" }, requests),
  });

  const response = await app.request("/dashboard/assets/app.js");

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "console.log('ok')");
  assertEquals(requests, ["/assets/app.js"]);
});

test("Cloudflare dashboard assets do not return HTML for missing bundle files", async () => {
  const requests: string[] = [];
  const app = buildCloudflareDashboardApp({
    ASSETS: fakeAssets({ "/": "<!doctype html><title>Dashboard</title>" }, requests),
  });

  const response = await app.request("/dashboard/assets/missing.js", {
    headers: { Accept: "*/*" },
  });

  assertEquals(response.status, 404);
  assertEquals(requests, ["/assets/missing.js"]);
});

test("Cloudflare dashboard fallback does not return HTML for asset paths without ASSETS binding", async () => {
  const app = buildCloudflareDashboardApp({});

  const response = await app.request("/dashboard/assets/app.js", {
    headers: { Accept: "text/html" },
  });

  assertEquals(response.status, 404);
});

test("Cloudflare dashboard fallback does not return legacy HTML for routes without ASSETS binding", async () => {
  const app = buildCloudflareDashboardApp({});

  const response = await app.request("/dashboard/workspace", {
    headers: { Accept: "text/html" },
  });

  assertEquals(response.status, 404);
  assertEquals(
    await response.text(),
    "Dashboard index.html not found. Build the dashboard before serving routes.",
  );
});

test("Cloudflare dashboard assets serve the built index for /dashboard", async () => {
  const requests: string[] = [];
  const app = buildCloudflareDashboardApp({
    ASSETS: fakeAssets({ "/": "<!doctype html><title>Dashboard</title>" }, requests),
  });

  const response = await app.request("/dashboard", {
    headers: { Accept: "text/html" },
  });

  assertEquals(response.status, 200);
  assertEquals(await response.text(), "<!doctype html><title>Dashboard</title>");
  assertEquals(requests, ["/"]);
});

function fakeAssets(files: Record<string, string>, requests: string[]): DashboardAssetsBinding {
  return {
    async fetch(request: Request) {
      const pathname = new URL(request.url).pathname;
      requests.push(pathname);
      const body = files[pathname];
      if (body === undefined) {
        return new Response("missing", { status: 404 });
      }
      return new Response(body, {
        headers: { "Content-Type": contentType(pathname) },
      });
    },
  };
}

function contentType(pathname: string): string {
  if (pathname.endsWith(".html")) return "text/html; charset=utf-8";
  if (pathname.endsWith(".js")) return "text/javascript; charset=utf-8";
  return "application/octet-stream";
}
