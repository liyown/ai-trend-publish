import { apiJson, mutation } from "./http.ts";
import type { SourceCollection, SaveSourceCollectionPayload } from "./types.ts";
import type { PageResult } from "./content-plans.ts";

export const listSourceCollections = (page = 1, pageSize = 20) =>
  apiJson<PageResult<SourceCollection>>(
    `/api/source-collections?page=${page}&pageSize=${pageSize}`,
  );

export const getSourceCollection = (id: string) =>
  apiJson<{ sourceCollection: SourceCollection }>(
    `/api/source-collections/${encodeURIComponent(id)}`,
  );

export const createSourceCollection = (body: SaveSourceCollectionPayload) =>
  mutation<{ sourceCollection: SourceCollection }>("/api/source-collections", "POST", body);

export const updateSourceCollection = (id: string, body: SaveSourceCollectionPayload) =>
  mutation<{ sourceCollection: SourceCollection }>(
    `/api/source-collections/${encodeURIComponent(id)}`,
    "PATCH",
    body,
  );

export const deleteSourceCollection = (id: string) =>
  mutation<{ success: boolean }>(`/api/source-collections/${encodeURIComponent(id)}`, "DELETE");
