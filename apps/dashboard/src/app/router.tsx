import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { useAuth } from "./auth.tsx";
import { WorkspaceShell } from "./shell.tsx";
import { LandingPage } from "../features/landing/page.tsx";
import { WorkspacePage } from "../features/workspace/page.tsx";
import { AutomationsPage } from "../features/automations/page.tsx";
import { IdentitiesPage } from "../features/identities/page.tsx";
import { SourcesPage } from "../features/sources/page.tsx";
import { KnowledgePage } from "../features/knowledge/page.tsx";
import { ContentPlansPage } from "../features/content-plans/page.tsx";
import { ContentPlanEditorPage } from "../features/content-plans/editor-page.tsx";
import { PublishingPage } from "../features/publishing/page.tsx";
import { JobsPage } from "../features/jobs/page.tsx";
import { LibraryPage } from "../features/library/page.tsx";
import { ConnectionsPage } from "../features/connections/page.tsx";
import { SettingsPage } from "../features/settings/page.tsx";

function LandingRoute() {
  return <LandingPage />;
}
function Protected() {
  return useAuth().isAuthenticated ? <WorkspaceShell /> : <Navigate to="/" replace />;
}

const root = createRootRoute({ component: Outlet });
const landing = createRoute({ getParentRoute: () => root, path: "/", component: LandingRoute });
const protectedRoute = createRoute({
  getParentRoute: () => root,
  id: "protected",
  component: Protected,
});
const workspace = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/workspace",
  component: WorkspacePage,
});
const automations = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/automations",
  component: AutomationsPage,
});
const identities = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/identities",
  component: IdentitiesPage,
});
const sources = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/sources",
  component: SourcesPage,
});
const knowledge = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/knowledge",
  component: KnowledgePage,
});
const plans = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/content-plans",
  component: ContentPlansPage,
});
const newPlan = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/content-plans/new",
  component: ContentPlanEditorPage,
});
const editPlan = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/content-plans/$planId/edit",
  component: ContentPlanEditorPage,
});
const publishing = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/publishing",
  component: PublishingPage,
});
const jobs = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/jobs",
  component: JobsPage,
});
const library = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/library",
  component: LibraryPage,
});
const connections = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/connections",
  component: ConnectionsPage,
});
const settings = createRoute({
  getParentRoute: () => protectedRoute,
  path: "/settings",
  component: SettingsPage,
});

const tree = root.addChildren([
  landing,
  protectedRoute.addChildren([
    workspace,
    automations,
    identities,
    knowledge,
    sources,
    plans,
    newPlan,
    editPlan,
    publishing,
    jobs,
    library,
    connections,
    settings,
  ]),
]);

export const router = createRouter({
  routeTree: tree,
  basepath: "/dashboard",
  defaultPreload: "intent",
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
