import { apiJson, mutation } from "./http.ts";
import type { ContentPlan, SaveContentPlanPayload } from "./types.ts";

export interface PageResult<T> {
  items: T[];
  total: number;
  page: number;
  pageSize: number;
}

function pageQuery(page: number, pageSize: number) {
  return `?page=${page}&pageSize=${pageSize}`;
}

export const listContentPlans = (page = 1, pageSize = 20) =>
  apiJson<PageResult<ContentPlan>>(`/api/content-plans${pageQuery(page, pageSize)}`);

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
