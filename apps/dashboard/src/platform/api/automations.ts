import { apiJson, mutation } from "./http.ts";
import type { Automation, SaveAutomationPayload, JobRecord, RunRecord } from "./types.ts";
import type { PageResult } from "./content-plans.ts";

export const listAutomations = (page = 1, pageSize = 20) =>
  apiJson<PageResult<Automation>>(`/api/automations?page=${page}&pageSize=${pageSize}`);

export const getAutomation = (id: string) =>
  apiJson<{ automation: Automation }>(`/api/automations/${encodeURIComponent(id)}`);

export const createAutomation = (body: SaveAutomationPayload) =>
  mutation<{ automation: Automation }>("/api/automations", "POST", body);

export const updateAutomation = (id: string, body: SaveAutomationPayload) =>
  mutation<{ automation: Automation }>(`/api/automations/${encodeURIComponent(id)}`, "PATCH", body);

export const deleteAutomation = (id: string) =>
  mutation<{ success: boolean }>(`/api/automations/${encodeURIComponent(id)}`, "DELETE");

export const startAutomationRun = (id: string, body: { requestedTopic?: string } = {}) =>
  mutation<{ job: JobRecord; run: RunRecord }>(
    `/api/automations/${encodeURIComponent(id)}/run`,
    "POST",
    body,
  );
