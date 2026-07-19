import { apiJson, mutation } from "./http.ts";
import type { Automation, SaveAutomationPayload, JobRecord } from "./types.ts";

export const listAutomations = () => apiJson<{ automations: Automation[] }>("/api/automations");

export const getAutomation = (id: string) =>
  apiJson<{ automation: Automation }>(`/api/automations/${encodeURIComponent(id)}`);

export const createAutomation = (body: SaveAutomationPayload) =>
  mutation<{ automation: Automation }>("/api/automations", "POST", body);

export const updateAutomation = (id: string, body: SaveAutomationPayload) =>
  mutation<{ automation: Automation }>(`/api/automations/${encodeURIComponent(id)}`, "PATCH", body);

export const deleteAutomation = (id: string) =>
  mutation<{ success: boolean }>(`/api/automations/${encodeURIComponent(id)}`, "DELETE");

export const startAutomationRun = (id: string, body: { requestedTopic?: string } = {}) =>
  mutation<{ job: JobRecord }>(`/api/automation-runs/${encodeURIComponent(id)}`, "POST", body);
