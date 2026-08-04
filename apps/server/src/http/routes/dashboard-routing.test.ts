import { test } from "vite-plus/test";
import { assertEquals } from "@trendpublish/core/test";
import {
  createDashboardAssetRequest,
  dashboardAssetPath,
  dashboardIndexAssetPath,
  isDashboardSpaRouteRequest,
} from "./dashboard-routing.ts";

test("dashboardAssetPath strips the dashboard base path for build assets", () => {
  assertEquals(dashboardAssetPath("/dashboard"), dashboardIndexAssetPath());
  assertEquals(dashboardAssetPath("/dashboard/"), dashboardIndexAssetPath());
  assertEquals(dashboardAssetPath("/dashboard/workspace"), "/workspace");
  assertEquals(dashboardAssetPath("/dashboard/assets/app.js"), "/assets/app.js");
  assertEquals(dashboardAssetPath("/api/health"), null);
});

test("createDashboardAssetRequest targets the dashboard build root", () => {
  const request = new Request("https://example.com/dashboard/assets/app.js?cache=1");
  const assetRequest = createDashboardAssetRequest(request, "/assets/app.js");
  const url = new URL(assetRequest.url);

  assertEquals(url.pathname, "/assets/app.js");
  assertEquals(url.search, "");
});

test("SPA fallback only applies to navigation-like dashboard routes", () => {
  const htmlRequest = new Request("https://example.com/dashboard/workspace", {
    headers: { Accept: "text/html" },
  });
  const assetRequest = new Request("https://example.com/dashboard/assets/app.js", {
    headers: { Accept: "*/*" },
  });

  assertEquals(isDashboardSpaRouteRequest(htmlRequest, "/workspace"), true);
  assertEquals(isDashboardSpaRouteRequest(assetRequest, "/assets/app.js"), false);
});
