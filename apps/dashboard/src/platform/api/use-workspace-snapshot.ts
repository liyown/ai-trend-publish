import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "../../app/auth.tsx";
import { useDashboardApi } from "../../app/providers.tsx";
import { dashboardQueryKeys } from "#platform/api/query-keys.ts";

export const WORKSPACE_REFRESH_MS = 8000;

export interface WorkspaceSnapshotOptions {
  live?: boolean;
}

export function useWorkspaceSnapshot({ live = true }: WorkspaceSnapshotOptions = {}) {
  const { apiKey } = useAuth();
  const api = useDashboardApi();
  return useQuery({
    queryKey: dashboardQueryKeys(apiKey).snapshot,
    queryFn: () => api.getWorkspace(apiKey),
    enabled: Boolean(apiKey),
    refetchInterval: live ? WORKSPACE_REFRESH_MS : false,
  });
}

export function useWorkspaceRefresh() {
  const { apiKey } = useAuth();
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys(apiKey).root });
}
