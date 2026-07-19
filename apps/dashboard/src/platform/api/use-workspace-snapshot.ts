import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useDashboardApi } from "../../app/providers.tsx";
import { dashboardQueryKeys } from "#platform/api/query-keys.ts";

export const WORKSPACE_REFRESH_MS = 8000;

export interface WorkspaceSnapshotOptions {
  live?: boolean;
}

export function useWorkspaceSnapshot({ live = true }: WorkspaceSnapshotOptions = {}) {
  const api = useDashboardApi();
  return useQuery({
    queryKey: dashboardQueryKeys().snapshot,
    queryFn: () => api.getWorkspace(),
    refetchInterval: live ? WORKSPACE_REFRESH_MS : false,
  });
}

export function useWorkspaceRefresh() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: dashboardQueryKeys().root });
}
