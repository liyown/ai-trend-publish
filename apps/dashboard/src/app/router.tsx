import { lazy, Suspense } from "react";
import {
  createRootRoute,
  createRoute,
  createRouter,
  Navigate,
  Outlet,
} from "@tanstack/react-router";
import { useAuth } from "./auth.tsx";
import { WorkspaceShell } from "./shell.tsx";

const LandingPage = lazy(() =>
  import("../routes/index.tsx").then((module) => ({ default: module.LandingPage })),
);
const WorkspacePage = lazy(() =>
  import("../routes/workspace.tsx").then((module) => ({ default: module.WorkspacePage })),
);
const AutomationsPage = lazy(() =>
  import("../routes/automations.tsx").then((module) => ({ default: module.AutomationsPage })),
);
const IdentitiesPage = lazy(() =>
  import("../routes/identities.tsx").then((module) => ({ default: module.IdentitiesPage })),
);
const SourcesPage = lazy(() =>
  import("../routes/sources.tsx").then((module) => ({ default: module.SourcesPage })),
);
const KnowledgePage = lazy(() =>
  import("../routes/knowledge.tsx").then((module) => ({ default: module.KnowledgePage })),
);
const ContentPlansPage = lazy(() =>
  import("../routes/content-plans.tsx").then((module) => ({ default: module.ContentPlansPage })),
);
const ContentPlanEditorPage = lazy(() =>
  import("../routes/content-plan-editor.tsx").then((module) => ({
    default: module.ContentPlanEditorPage,
  })),
);
const PublishingPage = lazy(() =>
  import("../routes/publishing.tsx").then((module) => ({ default: module.PublishingPage })),
);
const JobsPage = lazy(() =>
  import("../routes/jobs.tsx").then((module) => ({ default: module.JobsPage })),
);
const LibraryPage = lazy(() =>
  import("../routes/library.tsx").then((module) => ({ default: module.LibraryPage })),
);
const ConnectionsPage = lazy(() =>
  import("../routes/connections.tsx").then((module) => ({ default: module.ConnectionsPage })),
);
const SettingsPage = lazy(() =>
  import("../routes/settings.tsx").then((module) => ({ default: module.SettingsPage })),
);

function LandingRoute() {
  return (
    <Suspense fallback={<Loading />}>
      <LandingPage />
    </Suspense>
  );
}
function Loading() {
  return (
    <div className="grid min-h-dvh place-items-center bg-[var(--paper)] text-sm font-semibold">
      Loading TrendPublish
    </div>
  );
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
