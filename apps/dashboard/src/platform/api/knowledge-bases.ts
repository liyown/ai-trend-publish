import { apiJson, mutation } from "./http.ts";
import type { KnowledgeBase, SaveKnowledgeBasePayload } from "./types.ts";
import type { PageResult } from "./content-plans.ts";

export const listKnowledgeBases = (page = 1, pageSize = 20) =>
  apiJson<PageResult<KnowledgeBase>>(`/api/knowledge-bases?page=${page}&pageSize=${pageSize}`);

export const getKnowledgeBase = (id: string) =>
  apiJson<{ knowledgeBase: KnowledgeBase }>(`/api/knowledge-bases/${encodeURIComponent(id)}`);

export const createKnowledgeBase = (body: SaveKnowledgeBasePayload) =>
  mutation<{ knowledgeBase: KnowledgeBase }>("/api/knowledge-bases", "POST", body);

export const updateKnowledgeBase = (id: string, body: SaveKnowledgeBasePayload) =>
  mutation<{ knowledgeBase: KnowledgeBase }>(
    `/api/knowledge-bases/${encodeURIComponent(id)}`,
    "PATCH",
    body,
  );

export const deleteKnowledgeBase = (id: string) =>
  mutation<{ success: boolean }>(`/api/knowledge-bases/${encodeURIComponent(id)}`, "DELETE");
