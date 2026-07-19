import { createFileRoute, Navigate } from "@tanstack/react-router";
import { useAuth } from "../app/auth.tsx";
import { WorkspaceShell } from "../app/shell.tsx";
function AppLayout() {
  const { isAuthenticated } = useAuth();
  if (!isAuthenticated) return <Navigate to="/" replace />;
  return <WorkspaceShell />;
}
export const Route = createFileRoute("/_app")({ component: AppLayout });
