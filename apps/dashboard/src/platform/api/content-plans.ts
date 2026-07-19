import { apiJson, mutation } from "./http.ts";
import type { ContentPlan, SaveContentPlanPayload } from "./types.ts";

export const listContentPlans = () =>
  apiJson<{ contentPlans: ContentPlan[] }>("/api/content-plans");

export const getContentPlan = (id: string) =>
  apiJson<{ contentPlan: ContentPlan }>(`/api/content-plans/${encodeURIComponent(id)}`);

export const createContentPlan = (body: SaveContentPlanPayload) =>
  mutation<{ contentPlan: ContentPlan }>("/api/content-plans", "POST", body);

export const updateContentPlan = (id: string, body: SaveContentPlanPayload) =>
  mutation<{ contentPlan: ContentPlan }>(
    `/api/content-plans/${encodeURIComponent(id)}`,
    "PATCH",
    body,
  );

export const deleteContentPlan = (id: string) =>
  mutation<{ success: boolean }>(`/api/content-plans/${encodeURIComponent(id)}`, "DELETE");
