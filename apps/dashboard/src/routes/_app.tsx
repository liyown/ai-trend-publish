import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "../app/auth.tsx";
import { WorkspaceShell } from "../app/shell.tsx";
function AppLayout() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return <WorkspaceShell />;
}

interface AppSearch {
  tab?: "config" | "runs";
  panel?: "basic" | "identity" | "knowledge" | "sources" | "publishing";
  run?: string;
  runTab?: "main" | "publication";
  destination?: string;
}

function validateAppSearch(search: Record<string, unknown>): AppSearch {
  return {
    tab: search.tab === "config" || search.tab === "runs" ? search.tab : undefined,
    panel:
      search.panel === "basic" ||
      search.panel === "identity" ||
      search.panel === "knowledge" ||
      search.panel === "sources" ||
      search.panel === "publishing"
        ? search.panel
        : undefined,
    run: typeof search.run === "string" && search.run ? search.run : undefined,
    runTab: search.runTab === "main" || search.runTab === "publication" ? search.runTab : undefined,
    destination:
      typeof search.destination === "string" && search.destination ? search.destination : undefined,
  };
}

export const Route = createFileRoute("/_app")({
  validateSearch: validateAppSearch,
  component: AppLayout,
});
