import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getWorkspace } from "./workspace.ts";

export const WORKSPACE_REFRESH_MS = 8000;
export const workspaceKey = () => ["workspace", "snapshot"] as const;
export const workspaceRootKey = () => ["workspace"] as const;

export interface WorkspaceSnapshotOptions {
  live?: boolean;
}

export function useWorkspaceSnapshot({ live = true }: WorkspaceSnapshotOptions = {}) {
  return useQuery({
    queryKey: workspaceKey(),
    queryFn: getWorkspace,
    refetchInterval: live ? WORKSPACE_REFRESH_MS : false,
  });
}

export function useWorkspaceRefresh() {
  const queryClient = useQueryClient();
  return () => void queryClient.invalidateQueries({ queryKey: workspaceRootKey() });
}
