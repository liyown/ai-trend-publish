import { readFile } from "node:fs/promises";
import { test } from "vite-plus/test";
import { assertEquals } from "@trendpublish/core/test";

const ROUTES = [
  "/workspace",
  "/automations",
  "/identities",
  "/sources",
  "/content-plans",
  "/publishing",
  "/jobs",
  "/library",
  "/connections",
  "/settings",
];

test("dashboard exposes every object in the modular content model", async () => {
  const navigation = await readFile("apps/dashboard/src/app/navigation.ts", "utf8");
  const router = await readFile("apps/dashboard/src/app/router.tsx", "utf8");
  for (const route of ROUTES) {
    assertEquals(navigation.includes(`to: "${route}"`), true, `${route} missing from navigation`);
    assertEquals(router.includes(`path: "${route}"`), true, `${route} missing from router`);
  }
  for (const removed of ["/providers", "/publish-nodes", "/runs", "工作流"]) {
    assertEquals(navigation.includes(removed), false, `${removed} must stay removed`);
  }
});

test("connections keep provider details progressive and retain connection testing", async () => {
  const page = await readFile("apps/dashboard/src/features/studio/connections-page.tsx", "utf8");
  for (const required of [
    "高级设置",
    "NativeSelect",
    "Headers",
    "Query",
    "Body",
    "测试连接",
    "credentialState",
  ]) {
    assertEquals(page.includes(required), true, `${required} missing from connections UI`);
  }
  for (const removed of ["基础配置", "最大尝试次数", "超时（毫秒）", "Provider 连接"]) {
    assertEquals(page.includes(removed), false, `${removed} must not return`);
  }
});

test("product edit flows use dialogs and list rows", async () => {
  const common = await readFile("apps/dashboard/src/features/studio/common.tsx", "utf8");
  const dialog = await readFile("apps/dashboard/src/components/product/app-dialog.tsx", "utf8");
  assertEquals(common.includes("EntityList"), true);
  assertEquals(common.includes("EntityRow"), true);
  assertEquals(dialog.includes("DialogContent"), true);
  assertEquals(dialog.includes("Drawer"), false);
});

test("studio pages share one restrained visual hierarchy", async () => {
  const common = await readFile("apps/dashboard/src/features/studio/common.tsx", "utf8");
  const button = await readFile("apps/dashboard/src/components/ui/button.tsx", "utf8");
  const identities = await readFile(
    "apps/dashboard/src/features/studio/identities-page.tsx",
    "utf8",
  );
  const setupList = await readFile(
    "apps/dashboard/src/components/product/setup-page-frame.tsx",
    "utf8",
  );
  const studioPages = await Promise.all(
    ["automations", "sources", "content-plans", "publishing"].map((name) =>
      readFile(`apps/dashboard/src/features/studio/${name}-page.tsx`, "utf8"),
    ),
  );

  assertEquals(common.includes("ProductPageHeader"), false);
  assertEquals(common.includes("rounded-full"), false);
  assertEquals(setupList.includes("bg-[var(--surface)]"), true);
  assertEquals(button.includes("hover:-translate"), false);
  assertEquals(identities.includes('label="状态"'), false);
  for (const section of ["基础信息", "内容边界"]) {
    assertEquals(identities.includes(`title="${section}"`), true);
  }
  assertEquals(identities.includes('label="标题风格"'), false);
  assertEquals(identities.includes('label="质量标准"'), false);
  for (const page of [studioPages[0], studioPages[3]]) {
    assertEquals(page.includes("<NativeSelect"), true);
    assertEquals(page.includes("<select"), false);
  }
  const editorConfig = await readFile(
    "apps/dashboard/src/features/studio/content-plan-editor/config-view.tsx",
    "utf8",
  );
  assertEquals(editorConfig.includes("<NativeSelect"), true);
  assertEquals(editorConfig.includes("<select"), false);
});

test("route changes keep the workspace chrome mounted", async () => {
  const shell = await readFile("apps/dashboard/src/app/shell.tsx", "utf8");
  assertEquals(shell.includes("<ProductSidebar"), true);
  assertEquals(shell.includes("<WorkspaceTopBar"), true);
  assertEquals(shell.includes("key={pathname}"), false);
  assertEquals(shell.includes("<Suspense fallback={<DashboardContentFallback"), true);
});

test("library and sources consume the current content HTTP contract", async () => {
  const types = await readFile("apps/dashboard/src/platform/api/types.ts", "utf8");
  const library = await readFile("apps/dashboard/src/features/studio/library-page.tsx", "utf8");
  const sources = await readFile("apps/dashboard/src/features/studio/sources-page.tsx", "utf8");

  assertEquals(types.includes('from "@trendpublish/article"'), false);
  assertEquals(types.includes('from "@trendpublish/contracts"'), true);
  assertEquals(types.includes("interface ArticleDocument"), false);
  assertEquals(types.includes("interface ContentPackage"), false);
  assertEquals(library.includes("<ArticleDocumentView"), true);
  assertEquals(library.includes("document.blocks"), false);
  assertEquals(sources.includes('<option value="url">网址</option>'), true);
  assertEquals(sources.includes('<option value="query">搜索词</option>'), true);
  assertEquals(sources.includes("item.url.trim()"), true);
  assertEquals(sources.includes("item.query.trim()"), true);
});
