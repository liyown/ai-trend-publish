import { apiJson } from "./http.ts";
import type { WorkspaceSnapshot, HealthResponse } from "./types.ts";

export function assertWorkspace(workspace: WorkspaceSnapshot): void {
  const required = [
    "automations",
    "identities",
    "knowledgeBases",
    "sourceCollections",
    "contentPlans",
    "channelAccounts",
    "publishTargets",
    "contentPackages",
    "reviewRequests",
    "publications",
    "jobs",
    "connections",
    "connectorDefinitions",
  ] as const;
  const missing = required.filter((key) => !Array.isArray(workspace[key]));
  if (missing.length) throw new Error(`Dashboard 与 API 版本不一致：缺少 ${missing.join(", ")}`);
}
export const getWorkspace = async (): Promise<WorkspaceSnapshot> => {
  const data = await apiJson<{ workspace: WorkspaceSnapshot }>("/api/workspace");
  assertWorkspace(data.workspace);
  return data.workspace;
};
export const getHealth = () => apiJson<HealthResponse>("/api/health");
